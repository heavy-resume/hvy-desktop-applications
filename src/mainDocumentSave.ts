import { clearDocumentRecoveryDrafts, createDocumentBackup, discardDocumentBackup, listDocumentBackups, readDocumentFile, requestAppClose, saveDocumentAsDialog, saveDocumentFile, savePdfAsDialog, type DocumentBackup } from './backend';
import { logDebugEvent, measureDebug, measureDebugAsync } from './debugLog';
import { deserializeHvy, getMountedDocument, getMountedRecoveryState, isMountedDocumentDirty, markMountedDocumentSaved, profileHvySerializationCosts, serializeHvy, serializeMountedDocumentAsync, type VisualDocument } from './hvy';
import { state } from './state';
import { pdfFileName } from './mainUtilities';
import { refreshOpenWorkspaceForFile } from './mainWorkspaceUtils';
import { adoptSavedAsDocument, documentSessions, getTabStackIndex, mountCurrentDocument, openDocument, preserveCurrentDocumentSession, readDocumentColorPreference, refreshRecents, removeDocumentTabPath, renderAllAroundDocument, rerender, resetMountLifecycleState, runBusy, setPendingMountState, syncDocumentTabs, updateCurrentDocumentSession, updateDirtyChrome, workspaceFilterDocumentCache, writeHotReloadSessionSnapshot } from './main';

const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_DEBOUNCE_MS = 1500;
const MIN_BACKUP_SPACING_MS = 60 * 1000;
let backupTimer: number | null = null;
let pendingBackupIdleHandle: ReturnType<typeof setTimeout> | number | null = null;
const backupSnapshots = new Map<string, { bytesKey: string; createdAtMs: number; revision: number }>();
const documentBackupRevisions = new Map<string, number>();
const restoredBackupSuppressionKeys = new Set<string>();

export async function saveCurrentDocument(): Promise<void> {
  const openDocument = state.document;
  const mounted = openDocument?.mounted;
  if (!openDocument || !mounted) return;
  if (openDocument.isNew || !openDocument.path) {
    openSaveAsDialog();
    return;
  }
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  state.status = 'Saving...';
  updateDirtyChrome();
  const saveStartedAt = performance.now();
  try {
    if (openDocument.readOnly) {
      state.status = 'The HVY Galaxy guide is read-only';
      return;
    }
    const document = mounted.document;
    await logSerializationCostProfile('save', openDocument.path, null, document);
    const bytes = await measureDebugAsync('perf', 'save:serializeMountedDocument', { path: openDocument.path }, () => serializeMountedDocumentAsync(mounted));
    const writeStartedAt = performance.now();
    const writeResult = await saveDocumentFile({ path: openDocument.path, bytes });
    const writeDurationMs = Math.round((performance.now() - writeStartedAt) * 10) / 10;
    logDebugEvent('perf', 'save:writeDocumentFile', { path: openDocument.path, byteCount: bytes.length, durationMs: writeDurationMs });
    if (writeResult?.debugTimings) {
      logDebugEvent('perf', 'save:persistenceTimings', { path: openDocument.path, byteCount: bytes.length, ...writeResult.debugTimings });
      if (typeof writeResult.debugTimings.totalMs === 'number') {
        logDebugEvent('perf', 'save:bridgeOverhead', {
          path: openDocument.path,
          byteCount: bytes.length,
          durationMs: Math.max(0, Math.round((writeDurationMs - writeResult.debugTimings.totalMs) * 10) / 10),
          writeDurationMs,
          hostTotalMs: writeResult.debugTimings.totalMs,
        });
      }
    }
    markMountedDocumentSaved(mounted);
    openDocument.dirty = false;
    openDocument.recoveryBackupId = null;
    state.status = `Saved ${openDocument.name}`;
    updateCurrentDocumentSession(document);
    await refreshOpenWorkspaceForFile(openDocument.path);
    await refreshRecents();
    await clearRecoveryDraftsForDocument(openDocument.path, openDocument.name);
    logDebugEvent('perf', 'save:complete', {
      path: openDocument.path,
      byteCount: bytes.length,
      durationMs: Math.round((performance.now() - saveStartedAt) * 10) / 10,
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    updateDirtyChrome();
  }
}

export function openSaveAsDialog(): void {
  if (!state.document?.mounted || state.document.readOnly) return;
  state.saveAsDialogOpen = true;
  state.saveAsKind = 'document';
  state.saveAsScope = state.workspaces.length > 0 ? 'workspace' : 'anywhere';
  state.error = null;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

export async function saveCurrentDocumentAsAnywhere(): Promise<void> {
  await runBusy('Saving as...', async () => {
    await performSaveCurrentDocumentAs();
  });
}

export async function exportCurrentDocumentPdf(): Promise<void> {
  const openDocument = state.document;
  const mounted = openDocument?.mounted;
  if (!openDocument || !mounted || openDocument.readOnly) return;
  if (openDocument.extension !== '.phvy') {
    state.status = 'PDF export is available for PHVY documents';
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (openDocument.isNew || openDocument.dirty || isMountedDocumentDirty(mounted)) {
    state.exportPdfSavePromptOpen = true;
    state.status = 'Save before exporting PDF';
    rerender({ preserveMountedDocument: true });
    return;
  }
  await runBusy('Exporting PDF...', async () => {
    if (!state.document?.mounted) return;
    const blob = await state.document.mounted.mount.getPdfBlob({ filename: pdfFileName(state.document.name) });
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const savedPath = await savePdfAsDialog({ suggestedName: pdfFileName(state.document.name), bytes });
    state.exportedPdfPath = savedPath;
    state.status = savedPath ? `Exported ${pdfFileName(state.document.name)}` : 'Ready';
  }, { preserveMountedDocument: true });
}

export async function saveBeforeExportPdf(): Promise<void> {
  state.exportPdfSavePromptOpen = false;
  await saveCurrentDocument();
  if (state.document && !state.document.dirty && !state.document.isNew) {
    await exportCurrentDocumentPdf();
  }
}

export async function performSaveCurrentDocumentAs(): Promise<void> {
  if (!state.document?.mounted) return;
  if (state.document.readOnly) {
    state.status = 'The HVY Galaxy guide is read-only';
    rerender();
    return;
  }
  const bytes = await serializeMountedDocumentAsync(state.document.mounted);
  const previousPath = state.document.path;
  const previousName = state.document.name;
  const previousMode = state.document.mode;
  const previousUseDocumentColors = readDocumentColorPreference(previousPath);
  const document = getMountedDocument(state.document.mounted);
  const file = await saveDocumentAsDialog({ suggestedName: state.document.name, bytes });
  if (!file) return;
  adoptSavedAsDocument(file, state.document.mounted, document, previousMode, previousPath, previousUseDocumentColors);
  state.selectedFilePath = file.path;
  state.status = `Saved ${file.name}`;
  await refreshOpenWorkspaceForFile(file.path);
  await refreshRecents();
  await clearRecoveryDraftsForDocument(previousPath, previousName);
  await clearRecoveryDraftsForDocument(file.path, file.name);
  rerender({ preserveMountedDocument: true });
}

export async function selectDocumentTab(path: string): Promise<void> {
  state.tabStackOpen = false;
  if (state.document?.path === path) {
    rerender({ preserveMountedDocument: true });
    return;
  }
  const session = documentSessions.get(path);
  if (session?.dirty || session?.isNew) {
    await openDocument({
      path: session.path,
      name: session.name,
      extension: session.extension,
      bytes: [],
      recoveryState: session.recoveryState,
    });
    await refreshRecents();
    return;
  }
  await openDocument(await readDocumentFile(path));
  await refreshRecents();
}

export function cycleTabStack(direction: 1 | -1): void {
  syncDocumentTabs();
  if (state.documentTabs.length === 0) return;
  if (!state.tabStackOpen) {
    state.tabStackOpen = true;
    state.tabStackIndex = direction < 0 ? state.documentTabs.length - 1 : 0;
  } else {
    state.tabStackIndex = getTabStackIndex() + direction;
  }
  rerender({ preserveMountedDocument: true });
}

export async function commitTabStack(): Promise<void> {
  if (!state.tabStackOpen || state.documentTabs.length === 0) return;
  const tab = state.documentTabs[getTabStackIndex()];
  state.tabStackOpen = false;
  state.tabStackIndex = 0;
  if (tab) {
    await selectDocumentTab(tab.path);
  } else {
    rerender({ preserveMountedDocument: true });
  }
}

export async function closeDocumentTab(path: string): Promise<void> {
  if (state.document?.path === path) {
    await closeCurrentDocument();
    return;
  }
  const session = documentSessions.get(path);
  if (session?.dirty && !session.readOnly) {
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = path;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    return;
  }
  documentSessions.delete(path);
  removeDocumentTabPath(path);
  state.status = 'Closed tab';
  rerender({ preserveMountedDocument: true });
}

export async function saveAndCloseDocument(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  if (state.document?.path === targetPath) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    await saveCurrentDocument();
    if (state.document && !state.document.dirty) {
      await closeCurrentDocument({ discard: true });
    }
    return;
  }
  const session = documentSessions.get(targetPath);
  if (!session) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    rerender({ preserveMountedDocument: true });
    return;
  }
  if (session.isNew || !session.path) {
    state.closeDocumentDialogOpen = false;
    state.closeDocumentDraftDialogOpen = false;
    state.closeDocumentTargetPath = null;
    await selectDocumentTab(targetPath);
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = targetPath;
    rerender({ preserveMountedDocument: true });
    return;
  }
  await runBusy('Saving...', async () => {
    const bytes = Array.from(await serializeHvy(session.document));
    await saveDocumentFile({ path: session.path, bytes });
    documentSessions.delete(session.path);
    removeDocumentTabPath(session.path);
    workspaceFilterDocumentCache.delete(session.path);
    deleteBackupTracking(backupDocumentKey(session.path, session.name));
    await clearRecoveryDraftsForDocument(session.path, session.name);
    await refreshOpenWorkspaceForFile(session.path);
    await refreshRecents();
    state.closeDocumentDialogOpen = false;
    state.closeDocumentTargetPath = null;
    state.status = `Saved ${session.name}`;
  }, { preserveMountedDocument: true });
}

export async function promptCloseDocumentDraftChoice(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  state.closeDocumentDialogOpen = false;
  await ensureCloseDocumentRecoveryDraft(targetPath);
  state.closeDocumentDraftDialogOpen = true;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

export async function ensureCloseDocumentRecoveryDraft(targetPath: string): Promise<string | null> {
  if (state.document?.path === targetPath && state.document.mounted) {
    if (state.document.recoveryBackupId) return state.document.recoveryBackupId;
    const bytes = await serializeMountedDocumentAsync(state.document.mounted);
    const backup = await createDocumentBackup({
      documentPath: state.document.path,
      name: state.document.name,
      extension: state.document.extension,
      bytes,
      recoveryState: getMountedRecoveryState(state.document.mounted),
    });
    state.document.recoveryBackupId = backup?.id ?? null;
    return state.document.recoveryBackupId;
  }
  const session = documentSessions.get(targetPath);
  if (!session) return null;
  if (session.recoveryBackupId) return session.recoveryBackupId;
  const bytes = await serializeHvy(session.document);
  const backup = await createDocumentBackup({
    documentPath: session.path,
    name: session.name,
    extension: session.extension,
    bytes,
    recoveryState: session.recoveryState,
  });
  session.recoveryBackupId = backup?.id ?? null;
  return session.recoveryBackupId;
}

export function getCloseDocumentRecoveryBackupId(targetPath: string): string | null {
  if (state.document?.path === targetPath) {
    return state.document.recoveryBackupId;
  }
  return documentSessions.get(targetPath)?.recoveryBackupId ?? null;
}

export async function closeDocumentWithoutSaving(): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  if (getCloseDocumentRecoveryBackupId(targetPath)) {
    await promptCloseDocumentDraftChoice();
    return;
  }
  await closeTargetDocumentWithoutSaving({ discardDraft: true, createDraft: false });
}

export async function closeTargetDocumentWithoutSaving(options: { discardDraft: boolean; createDraft?: boolean }): Promise<void> {
  const targetPath = state.closeDocumentTargetPath ?? state.document?.path ?? null;
  if (targetPath === null) return;
  const backupId = options.createDraft === false
    ? getCloseDocumentRecoveryBackupId(targetPath)
    : await ensureCloseDocumentRecoveryDraft(targetPath);
  if (options.discardDraft && backupId) {
    await discardDocumentBackup(backupId);
  }
  if (state.document?.path === targetPath) {
    await closeActiveDocumentAfterUnsavedChoice({ discardDraft: options.discardDraft });
    return;
  }
  const session = documentSessions.get(targetPath);
  if (options.discardDraft && session) {
    await clearRecoveryDraftsForDocument(session.path, session.name);
    deleteBackupTracking(backupDocumentKey(session.path, session.name));
  }
  documentSessions.delete(targetPath);
  removeDocumentTabPath(targetPath);
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.status = options.discardDraft ? 'Discarded unsaved edits' : 'Kept recovery draft for later';
  rerender({ preserveMountedDocument: true });
}

export async function closeActiveDocumentAfterUnsavedChoice(options: { discardDraft: boolean }): Promise<void> {
  const openDocument = state.document;
  if (!openDocument) return;
  const path = openDocument.path;
  const name = openDocument.name;
  const closeStartedAt = performance.now();
  logDebugEvent('close', 'closeActiveDocumentAfterUnsavedChoice:start', { path, name, discardDraft: options.discardDraft });
  measureDebug('close', 'closeActiveDocumentAfterUnsavedChoice:destroyMount', { path }, () => {
    openDocument.mounted?.mount.destroy();
  });
  measureDebug('close', 'closeActiveDocumentAfterUnsavedChoice:cleanupThemeReapply', { path }, resetMountLifecycleState);
  documentSessions.delete(path);
  workspaceFilterDocumentCache.delete(path);
  removeDocumentTabPath(path);
  deleteBackupTracking(backupDocumentKey(path, name));
  if (options.discardDraft) {
    await measureDebugAsync('close', 'closeActiveDocumentAfterUnsavedChoice:clearRecoveryDrafts', { path, name }, () => clearRecoveryDraftsForDocument(path, name));
  }
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.document = null;
  state.selectedFilePath = null;
  state.status = options.discardDraft ? 'Discarded unsaved edits' : 'Kept recovery draft for later';
  measureDebug('close', 'closeActiveDocumentAfterUnsavedChoice:rerender', { path }, () => rerender());
  logDebugEvent('close', 'closeActiveDocumentAfterUnsavedChoice:complete', {
    path,
    durationMs: Math.round((performance.now() - closeStartedAt) * 10) / 10,
  });
}

export async function closeCurrentDocument(options: { discard?: boolean } = {}): Promise<void> {
  const openDocument = state.document;
  if (!openDocument) return;
  if (!openDocument.readOnly && openDocument.dirty && !options.discard) {
    state.closeDocumentDialogOpen = true;
    state.closeDocumentTargetPath = openDocument.path;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
    return;
  }
  const path = openDocument.path;
  const name = openDocument.name;
  const closeStartedAt = performance.now();
  logDebugEvent('close', 'closeCurrentDocument:start', { path, name, discard: options.discard === true });
  measureDebug('close', 'closeCurrentDocument:destroyMount', { path }, () => {
    openDocument.mounted?.mount.destroy();
  });
  measureDebug('close', 'closeCurrentDocument:cleanupThemeReapply', { path }, resetMountLifecycleState);
  if (path) {
    documentSessions.delete(path);
    workspaceFilterDocumentCache.delete(path);
  }
  removeDocumentTabPath(path);
  deleteBackupTracking(backupDocumentKey(path, name));
  await measureDebugAsync('close', 'closeCurrentDocument:clearRecoveryDrafts', { path, name }, () => clearRecoveryDraftsForDocument(path, name));
  state.closeDocumentDialogOpen = false;
  state.closeDocumentDraftDialogOpen = false;
  state.closeDocumentTargetPath = null;
  state.document = null;
  state.selectedFilePath = null;
  state.status = 'Closed document';
  measureDebug('close', 'closeCurrentDocument:rerender', { path }, () => rerender());
  logDebugEvent('close', 'closeCurrentDocument:complete', {
    path,
    durationMs: Math.round((performance.now() - closeStartedAt) * 10) / 10,
  });
}

export async function handleAppCloseRequest(): Promise<void> {
  if (state.appCloseDialogOpen) return;
  if (!hasUnsavedWritableDocument()) {
    await requestAppClose();
    return;
  }
  try {
    await backupActiveDocument({ force: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  state.appCloseDialogOpen = true;
  state.status = 'Ready';
  rerender({ preserveMountedDocument: true });
}

export async function saveAndCloseApp(): Promise<void> {
  state.appCloseDialogOpen = false;
  await saveCurrentDocument();
  if (!hasUnsavedWritableDocument()) {
    await requestAppClose();
  } else {
    state.appCloseDialogOpen = true;
    rerender({ preserveMountedDocument: true });
  }
}

export async function closeAppWithoutSaving(): Promise<void> {
  state.appCloseDialogOpen = false;
  try {
    await backupActiveDocument({ force: true });
  } catch {
    // The user chose to close without saving; the normal timed drafts may still exist.
  }
  await requestAppClose();
}

export function hasUnsavedWritableDocument(): boolean {
  const openDocument = state.document;
  if (!openDocument?.mounted || openDocument.readOnly) return false;
  return openDocument.dirty || isMountedDocumentDirty(openDocument.mounted);
}

export function startBackupTimer(): void {
  if (backupTimer !== null) return;
  backupTimer = window.setInterval(() => {
    scheduleBackupActiveDocument();
  }, BACKUP_INTERVAL_MS);
}

export function scheduleBackupActiveDocument(): void {
  if (pendingBackupIdleHandle !== null) return;
  logDebugEvent('perf', 'recoveryDraft:schedule', {
    path: state.document?.path ?? null,
    debounceMs: BACKUP_DEBOUNCE_MS,
  });
  const callback = () => {
    pendingBackupIdleHandle = null;
    logDebugEvent('perf', 'recoveryDraft:debounceElapsed', {
      path: state.document?.path ?? null,
    });
    void backupActiveDocument();
  };
  pendingBackupIdleHandle = globalThis.setTimeout(callback, BACKUP_DEBOUNCE_MS);
}

export function setupRecoveryLifecycle(): void {
  window.addEventListener('pagehide', () => {
    preserveCurrentDocumentSession();
    writeHotReloadSessionSnapshot();
    void backupActiveDocument({ force: true }).catch(() => undefined);
  });
  window.addEventListener('beforeunload', () => {
    preserveCurrentDocumentSession();
    writeHotReloadSessionSnapshot();
    void backupActiveDocument({ force: true }).catch(() => undefined);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      preserveCurrentDocumentSession();
      writeHotReloadSessionSnapshot();
      void backupActiveDocument({ force: true }).catch(() => undefined);
    }
  });
}

export async function backupActiveDocument(options: { force?: boolean } = {}): Promise<void> {
  if (!state.document?.mounted || state.document.readOnly) return;
  if (!state.document.dirty) return;
  const path = state.document.path;
  const name = state.document.name;
  const backupStartedAt = performance.now();
  const documentKey = backupDocumentKey(state.document.path, state.document.name);
  const revision = currentBackupRevision(documentKey);
  const previousBackup = backupSnapshots.get(documentKey);
  const now = Date.now();
  logDebugEvent('perf', 'recoveryDraft:start', { path, force: options.force === true, revision });
  if (!options.force && state.busy) {
    logDebugEvent('perf', 'recoveryDraft:skipBusy', {
      path,
      revision,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    return;
  }
  if (previousBackup?.revision === revision) {
    logDebugEvent('perf', 'recoveryDraft:skipNoRevisionChange', {
      path,
      revision,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    return;
  }
  if (!options.force && previousBackup && now - previousBackup.createdAtMs < MIN_BACKUP_SPACING_MS) {
    logDebugEvent('perf', 'recoveryDraft:skipRecent', {
      path,
      elapsedMs: now - previousBackup.createdAtMs,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    return;
  }
  if (state.document.recoveryBackupId && restoredBackupSuppressionKeys.has(documentKey)) {
    logDebugEvent('perf', 'recoveryDraft:skipRestoredDraftBaseline', {
      path,
      revision,
      recoveryBackupId: state.document.recoveryBackupId,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    return;
  }
  const documentProfile = measureDebug('perf', 'recoveryDraft:profileDocument', { path, revision }, () => profileDocumentForDebug(getMountedDocument(state.document!.mounted!)));
  logDebugEvent('perf', 'recoveryDraft:documentProfile', { path, revision, ...documentProfile });
  await logSerializationCostProfile('recoveryDraft', path, revision, getMountedDocument(state.document!.mounted!));
  const bytes = await measureDebugAsync('perf', 'recoveryDraft:serializeMountedDocument', { path, revision }, () => serializeMountedDocumentAsync(state.document!.mounted!));
  const recoveryState = measureDebug('perf', 'recoveryDraft:getRecoveryState', { path, revision }, () => getMountedRecoveryState(state.document!.mounted!));
  const bytesKey = measureDebug('perf', 'recoveryDraft:hashBytes', { path, revision, byteCount: bytes.length }, () => backupBytesKey(bytes));
  if (previousBackup?.bytesKey === bytesKey) {
    logDebugEvent('perf', 'recoveryDraft:skipUnchangedBytes', {
      path,
      revision,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    backupSnapshots.set(documentKey, { ...previousBackup, revision });
    return;
  }
  try {
    const createStartedAt = performance.now();
    const backup = await createDocumentBackup({
      documentPath: path,
      name,
      extension: state.document!.extension,
      bytes,
      recoveryState,
    });
    const createDurationMs = Math.round((performance.now() - createStartedAt) * 10) / 10;
    logDebugEvent('perf', 'recoveryDraft:create', { path, revision, byteCount: bytes.length, durationMs: createDurationMs });
    if (backup) {
      const hostTotalMs = typeof backup.debugTimings?.totalMs === 'number' ? backup.debugTimings.totalMs : null;
      if (backup.debugTimings) {
        logDebugEvent('perf', 'recoveryDraft:persistenceTimings', {
          path,
          revision,
          byteCount: bytes.length,
          ...backup.debugTimings,
        });
      }
      if (hostTotalMs !== null && !('indexedDbPutMs' in (backup.debugTimings ?? {}))) {
        logDebugEvent('perf', 'recoveryDraft:bridgeOverhead', {
          path,
          revision,
          byteCount: bytes.length,
          durationMs: Math.max(0, Math.round((createDurationMs - hostTotalMs) * 10) / 10),
          createDurationMs,
          hostTotalMs,
        });
      }
      backupSnapshots.set(documentKey, { bytesKey, createdAtMs: Date.parse(backup.createdAt) || now, revision });
      restoredBackupSuppressionKeys.delete(documentKey);
      state.document.recoveryBackupId = backup.id;
    }
    logDebugEvent('perf', 'recoveryDraft:complete', {
      path,
      revision,
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
  } catch (error) {
    logDebugEvent('perf', 'recoveryDraft:error', {
      path,
      revision,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Math.round((performance.now() - backupStartedAt) * 10) / 10,
    });
    if (options.force) {
      throw error;
    }
    // Keep timed recovery drafts quiet; explicit recovery will surface failures.
  }
}

export function markRestoredBackupSuppression(path: string, name: string): void {
  restoredBackupSuppressionKeys.add(backupDocumentKey(path, name));
}

export function backupDocumentKey(path: string, name: string): string {
  return path || `untitled:${name}`;
}

export function deleteBackupTracking(key: string): void {
  backupSnapshots.delete(key);
  restoredBackupSuppressionKeys.delete(key);
}

export function clearActiveRestoredBackupSuppression(): void {
  const document = state.document;
  if (!document?.recoveryBackupId) return;
  restoredBackupSuppressionKeys.delete(backupDocumentKey(document.path, document.name));
}

export function markActiveDocumentBackupChanged(): void {
  const document = state.document;
  if (!document) return;
  const key = backupDocumentKey(document.path, document.name);
  documentBackupRevisions.set(key, (documentBackupRevisions.get(key) ?? 0) + 1);
}

export function currentBackupRevision(key: string): number {
  return documentBackupRevisions.get(key) ?? 0;
}

export function moveBackupTracking(fromKey: string, toKey: string): void {
  const backup = backupSnapshots.get(fromKey);
  if (backup) {
    backupSnapshots.delete(fromKey);
    backupSnapshots.set(toKey, backup);
  }
  if (restoredBackupSuppressionKeys.has(fromKey)) {
    restoredBackupSuppressionKeys.delete(fromKey);
    restoredBackupSuppressionKeys.add(toKey);
  }
  const revision = documentBackupRevisions.get(fromKey);
  if (revision !== undefined) {
    documentBackupRevisions.delete(fromKey);
    documentBackupRevisions.set(toKey, revision);
  }
}

export function backupBytesKey(bytes: Uint8Array | number[]): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length}:${hash >>> 0}`;
}

export async function logSerializationCostProfile(
  prefix: 'save' | 'recoveryDraft',
  path: string,
  revision: number | null,
  document: VisualDocument,
): Promise<void> {
  const details = revision === null ? { path } : { path, revision };
  const profile = await measureDebugAsync('perf', `${prefix}:profileSerializationCosts`, details, () => profileHvySerializationCosts(document));
  logDebugEvent('perf', `${prefix}:serializationCostProfile`, {
    ...details,
    totalProfileMs: profile.totalProfileMs,
    sectionCount: profile.sectionCount,
    blockCount: profile.blockCount,
    componentTotals: profile.componentTotals,
    slowestSections: profile.slowestSections,
    slowestBlocks: profile.slowestBlocks,
  });
}

export function profileDocumentForDebug(document: VisualDocument): Record<string, unknown> {
  const root = document as unknown as Record<string, unknown>;
  const attachments = profileAttachmentDescriptors(root);
  const blockProfile = profileDocumentBlocks(root);
  return {
    sectionCount: blockProfile.sectionCount,
    blockCount: blockProfile.blockCount,
    componentCounts: blockProfile.componentCounts,
    attachmentCount: attachments.count,
    attachmentBytes: attachments.bytes,
    attachmentMediaTypes: attachments.mediaTypes,
    largestAttachments: attachments.largest,
  };
}

export function profileAttachmentDescriptors(document: Record<string, unknown>): {
  count: number;
  bytes: number;
  mediaTypes: Record<string, number>;
  largest: Array<{ id: string; bytes: number; mediaType: string | null }>;
} {
  const store = document.attachmentStore as { listDescriptors?: () => unknown[] } | undefined;
  const descriptors = Array.isArray(store?.listDescriptors?.())
    ? store!.listDescriptors!()
    : Array.isArray(document.attachments)
    ? document.attachments
    : [];
  const mediaTypes: Record<string, number> = {};
  const largest: Array<{ id: string; bytes: number; mediaType: string | null }> = [];
  let bytes = 0;
  for (const descriptor of descriptors) {
    if (!isRecord(descriptor)) continue;
    const id = typeof descriptor.id === 'string' ? descriptor.id : '';
    const meta = isRecord(descriptor.meta) ? descriptor.meta : {};
    const mediaType = typeof meta.mediaType === 'string' ? meta.mediaType : typeof meta.type === 'string' ? meta.type : null;
    const length = typeof descriptor.length === 'number'
      ? descriptor.length
      : isByteLike(descriptor.bytes)
      ? descriptor.bytes.length
      : 0;
    bytes += length;
    mediaTypes[mediaType ?? 'unknown'] = (mediaTypes[mediaType ?? 'unknown'] ?? 0) + 1;
    largest.push({ id, bytes: length, mediaType });
  }
  largest.sort((left, right) => right.bytes - left.bytes);
  return { count: descriptors.length, bytes, mediaTypes, largest: largest.slice(0, 8) };
}

export function profileDocumentBlocks(document: Record<string, unknown>): {
  sectionCount: number;
  blockCount: number;
  componentCounts: Record<string, number>;
} {
  const componentCounts: Record<string, number> = {};
  let sectionCount = 0;
  let blockCount = 0;
  const visitBlock = (block: unknown) => {
    if (!isRecord(block)) return;
    blockCount += 1;
    const schema = isRecord(block.schema) ? block.schema : {};
    const component = typeof block.component === 'string'
      ? block.component
      : typeof schema.component === 'string'
      ? schema.component
      : typeof schema.type === 'string'
      ? schema.type
      : 'unknown';
    componentCounts[component] = (componentCounts[component] ?? 0) + 1;
    visitBlocks(schema.containerBlocks);
    visitBlocks(schema.componentListBlocks);
    if (Array.isArray(schema.gridItems)) {
      for (const item of schema.gridItems) {
        if (isRecord(item)) visitBlock(item.block);
      }
    }
    if (isRecord(schema.expandableStubBlocks)) visitBlocks(schema.expandableStubBlocks.children);
    if (isRecord(schema.expandableContentBlocks)) visitBlocks(schema.expandableContentBlocks.children);
  };
  const visitBlocks = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    blocks.forEach(visitBlock);
  };
  const visitSection = (section: unknown) => {
    if (!isRecord(section)) return;
    sectionCount += 1;
    visitBlocks(section.blocks);
    if (Array.isArray(section.children)) section.children.forEach(visitSection);
  };
  if (Array.isArray(document.sections)) document.sections.forEach(visitSection);
  return { sectionCount, blockCount, componentCounts };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

export function isByteLike(value: unknown): value is { length: number } {
  return Boolean(value && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number');
}

export async function clearRecoveryDraftsForDocument(documentPath: string, name: string): Promise<void> {
  deleteBackupTracking(backupDocumentKey(documentPath, name));
  try {
    await clearDocumentRecoveryDrafts({ documentPath, name });
  } catch {
    // Recovery drafts are best-effort cleanup after an explicit save or discard.
  }
}

export async function discardRecoveryStateForBackup(backup: DocumentBackup): Promise<void> {
  const key = backupDocumentKey(backup.documentPath, backup.name);
  deleteBackupTracking(key);
  if (backup.documentPath) {
    documentSessions.delete(backup.documentPath);
    workspaceFilterDocumentCache.delete(backup.documentPath);
  }
  if (!state.document || state.document.path !== backup.documentPath || state.document.name !== backup.name) {
    return;
  }
  if (!state.document.path) {
    state.document.dirty = false;
    state.document.isNew = false;
    setPendingMountState(null, null);
    return;
  }
  const file = await readDocumentFile(state.document.path);
  const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
  const wasMounted = Boolean(state.document.mounted);
  state.document = {
    ...state.document,
    name: file.name,
    extension: file.extension,
    dirty: false,
    isNew: false,
    mounted: null,
    recoveryBackupId: null,
  };
  setPendingMountState(null, null);
  if (wasMounted) {
    rerender();
    await mountCurrentDocument(document);
  } else {
    setPendingMountState(document, null);
    updateDirtyChrome();
  }
}

export async function openRecoveryDialog(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  state.status = 'Loading recoverable edits...';
  try {
    state.recoveryBackups = await measureDebugAsync('load', 'recovery:listBackups', undefined, () => listDocumentBackups());
    state.recoveryDialogOpen = true;
    state.status = state.recoveryBackups.length > 0 ? 'Loaded recoverable edits' : 'No recoverable edits available';
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    renderAllAroundDocument();
  }
}

export async function openRecoveryDialogOnBoot(): Promise<void> {
  try {
    state.recoveryBackups = await measureDebugAsync('load', 'recovery:listBackupsOnBoot', undefined, () => listDocumentBackups());
    if (state.recoveryBackups.length === 0) return;
    state.recoveryDialogOpen = true;
    state.status = 'Recoverable edits available';
    rerender({ preserveMountedDocument: true });
  } catch {
    state.recoveryBackups = [];
  }
}
