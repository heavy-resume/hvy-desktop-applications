import './styles.css';
import type { HvyDocumentSearchDocument } from '../../heavy-file-format/src/search/types';
import { readDocumentFile, saveAppSettings, saveDocumentColorPreference, saveDocumentModePreference, type DocumentExtension, type DocumentFile, type DocumentFileMetadata, type ImportSourceFile } from './backend';
import { getDebugLogEntries, logDebugEvent, measureDebug, measureDebugAsync } from './debugLog';
import { getFileActionAvailability } from './fileActions';
import { applyMountedRecoveryState, deserializeHvy, getMountedRecoveryState, isMountedDocumentDirty, markMountedDocumentSaved, mountHvyDocument, powerScriptDescriptors, type HvyMode, type MountedDocument, type VisualDocument } from './hvy';
import { attachMatchingSidecarEmbeddingIndex, writePreparedDocumentEmbeddingSidecar } from './embeddingIndex';
import { state } from './state';
import { removeRuntimeDocument, runtimeDocumentAtPath, runtimeDocumentForFile, updateRuntimeDocumentFile, type RuntimeDocument } from './runtimeDocuments';
import { createHandlers } from './mainHandlers';
import { applyAppColorTheme, boot, refreshRecents } from './mainStartup';
import { createWorkspaceFilterSnapshotForDocument, normalizeFilePath, workspaceFileAiAccess } from './mainWorkspaceFilter';
export { applyAppColorTheme, bindFindShortcut, boot, createSessionFromHotReloadSnapshot, currentMountRoot, getActiveRichEditable, loadRecentWorkspaces, loadStartupWorkspacesInBackground, openDefaultGuide, openGuide, openHomepage, openHvyGuide, openMountedSearch, performRedo, performRichTextAction, performUndo, readSnapshotDocumentFile, refreshArchivedWorkspaces, refreshMcpClientInstallStatus, refreshRecents, restoreHotReloadSession, restoreStartupDocument, routeNativeEditCommand } from './mainStartup';
import { clearActiveRestoredBackupSuppression, markActiveDocumentBackupChanged, markRestoredBackupSuppression, scheduleBackupActiveDocument } from './mainDocumentSave';
import { syncFileMenuState } from './mainWorkspaceUtils';
import { documentStorageKey, normalizeAiMaxContextChars, normalizeDocumentMode, normalizeImageAttachmentMaxDimensions } from './mainUtilities';
import { currentWorkspaceChatDocumentName, currentWorkspaceChatDocumentPath, isWorkspaceChatDocumentPath } from './workspaceChat';
import { initializeDocumentHistory } from './documentHistory';
import { isWholeDocumentEncrypted, recoveryStateForPersistence } from './encryptedDocumentPolicy';
import { recordDocumentNavigation } from './documentNavigationHistory';
import { captureDocumentViewState, restoreDocumentViewState, type DocumentViewState } from './documentViewState';
import { documentDirtyAfterMountedChange, mountedDocumentDirtyAfterMount, recoveryDocumentTabName } from './recoveryDocuments';
export { applyWorkspaceFilterToCurrentDocument, clearWorkspaceFilter, createWorkspaceFilterSnapshotForDocument, ensureWorkspaceFileAiAccess, normalizeFilePath, submitWorkspaceFilter, syncOpenDocumentAiAccess, syncOpenDocumentWorkspaceAccess, workspaceFileAiAccess, displayDocumentName } from './mainWorkspaceFilter';
export { backupDocumentKey, cancelSaveConflict, clearActiveRestoredBackupSuppression, clearRecoveryDraftsForDocument, closeAppWithoutSaving, closeCurrentDocument, closeDocumentTab, closeDocumentWithoutSaving, closeTargetDocumentWithoutSaving, commitTabStack, confirmSaveConflict, cycleTabStack, deleteBackupTracking, discardRecoveryStateForBackup, exportCurrentDocumentPdf, handleAppCloseRequest, hasUnsavedWritableDocument, markActiveDocumentBackupChanged, markRestoredBackupSuppression, moveBackupTracking, relocateRecoveryDraftsForDocument, openRecoveryDialog, openRecoveryDialogOnBoot, openSaveAsDialog, openSavedVersionPreview, openVersionHistory, saveAndCloseApp, saveAndCloseDocument, saveBeforeExportPdf, saveCurrentDocument, saveCurrentDocumentAsAnywhere, scheduleBackupActiveDocument, selectDocumentTab, setupRecoveryLifecycle, startBackupTimer } from './mainDocumentSave';
export { recoveryDocumentId } from './recoveryDocuments';
export { refreshOpenWorkspaceForFile, createBlankDocument, currentDocumentCanSaveToWorkspace, openWorkspaceTransfer, workspaceTransferBusyLabel, saveCurrentDocumentToWorkspace, saveImportedDocumentToWorkspace, createTemporaryImportMount, moveOpenWorkspaceFileToWorkspace, convertOpenWorkspaceFileKind, finishAddingFilesToWorkspace, applyArchivedFileRelocations, droppedWorkspaceFilesFrom, workspacePathForFile, loadWorkspace, loadWorkspaceEntry, retryWorkspaceEntry, workspaceDisplayNameFromPath, showWorkspaceDocumentsView, refreshSavedTemplates, templatesForCurrentWorkspaceDocumentType, creationTemplate, upsertWorkspace, sortWorkspaces, reorderedWorkspaceEntries, sortedWorkspaceEntries, syncMcpWorkspaces, syncFileMenuState, hasOpenWorkspaceNamed, type WorkspaceOrderSort } from './mainWorkspaceUtils';
export { defaultHvyDocument, documentFileName, workspaceRootDocumentFileName, hasInvalidDocumentNameSyntax, documentTypeForExtension, documentTitle, syncRenamedTemplateMetadata, renameTemplateDefinitionEntries, hasDocumentExtension, templateFileName, pdfFileName, revealStatusLabel, applyTemplateTitle, documentStorageKey, normalizeDocumentMode, closeUiBeforeAiSettings, closeUiBeforeAbout, closeUiBeforeAppSettings, closeUiBeforeColorTheme, closeUiBeforeMcpSettings, closeUiBeforeWorkspaceFilter, persistAndApplyColorTheme, updateThemeRowChrome, currentThemeDisplayName, themeSuggestedFileName, cssEscape, closeMountedTransientUi, cloneAiSettings, cloneAppSettings, cloneMcpSettings, aiSettingsChanged, appSettingsChanged, mcpSettingsChanged, copyMcpConnectionUrl, copyMcpBearerToken, copyMcpSetupValue, canonicalAiSettings, canonicalAppSettings, normalizeAiMaxContextChars, normalizeMaxConcurrentSemanticFilters, normalizeImageAttachmentMaxDimensions, effectiveImageAttachmentMaxDimensions, requestWorkspaceInitialization, createWorkspaceInChosenFolder, updateHomepageDocumentPath, clearHomepageDocumentPath, clearArchivedHomepageDocument } from './mainUtilities';
import { render, renderAllAroundDocument as renderUiAroundDocument, renderModals, type UiHandlers } from './ui';
export let mountRoot: HTMLElement | null = null;
let mountGeneration = 0;
export let pendingMountDocument: VisualDocument | null = null;
export let pendingMountRecoveryState: string | null = null;
let mountThemeReapplyCleanup: (() => void) | null = null;
let workspaceFilterRenderTimer: number | null = null;
let workspaceFilterRenderQueued = false;
const HOT_RELOAD_SESSION_STORAGE_KEY = 'hvy-galaxy:hot-reload-session';
const DOCUMENT_MODE_STORAGE_KEY = 'hvy-galaxy:document-modes';
const ZOOM_STORAGE_KEY = 'hvy-galaxy:zoom';
const ZOOM_LEVELS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const CHANGE_PERF_LOG_THRESHOLD_MS = 8;
const CHANGE_PERF_SAMPLE_INTERVAL = 50;
export interface MountScrollRatio {
  top: number;
  left: number;
  topPosition: number;
  leftPosition: number;
}
export interface DocumentSession {
  documentId: string;
  versionId: string;
  source: RuntimeDocument;
  displayName?: string;
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  hiddenFromAI: boolean;
  isNew: boolean;
  metaOpen: boolean;
  document: VisualDocument;
  chatState: ReturnType<MountedDocument['mount']['getChatState']> | null;
  scrollRatio: MountScrollRatio | null;
  viewState: DocumentViewState | null;
  recoveryState: string | null;
  recoveryBackupId: string | null;
  virtual?: 'recoveryDraft' | 'defaultDocument';
  recoveryModified: boolean;
}
export interface HotReloadDocumentSnapshot {
  path: string;
  mode: HvyMode;
  metaOpen: boolean;
  scrollRatio: MountScrollRatio | null;
  recoveryState: string | null;
}
export interface HotReloadSessionSnapshot {
  activePath: string | null;
  tabPaths: string[];
  documents: HotReloadDocumentSnapshot[];
}
type PreparedImportSource = ImportSourceFile & { text: string; sourceDocument?: VisualDocument };
export const documentSessions = new Map<string, DocumentSession>();
export const workspaceFilterDocumentCache = new Map<string, VisualDocument>();
let openedDocumentTabOrder: string[] = [];
let documentChangeEventCount = 0;
let documentZoomDirtySuppressionDepth = 0;
export function setPendingMountState(document: VisualDocument | null, recoveryState: string | null): void {
  pendingMountDocument = document;
  pendingMountRecoveryState = recoveryState;
}
export function setMountRoot(root: HTMLElement | null): void {
  mountRoot = root;
}
export function hasOpenedDocumentTabs(): boolean {
  return openedDocumentTabOrder.length > 0;
}
export function resetMountLifecycleState(): void {
  mountThemeReapplyCleanup?.();
  mountThemeReapplyCleanup = null;
  pendingMountDocument = null;
  pendingMountRecoveryState = null;
  mountGeneration += 1;
}
export function measurePerf<T>(
  label: string,
  details: Record<string, unknown> | undefined,
  callback: () => T,
  thresholdMs = CHANGE_PERF_LOG_THRESHOLD_MS,
): T {
  const startedAt = performance.now();
  try {
    return callback();
  } finally {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    if (durationMs >= thresholdMs) {
      logDebugEvent('perf', label, {
        ...details,
        durationMs,
      });
    }
  }
}
export const handlers: UiHandlers = createHandlers();
export function importedTemplateOutputExtension(extension: DocumentExtension): DocumentExtension {
  if (extension === '.thvy') return '.hvy';
  if (extension === '.phvy') return '.phvy';
  return extension;
}
export async function importSourceFrom(pastedSourceText: string): Promise<PreparedImportSource | null> {
  const pasted = pastedSourceText.trim();
  const source = state.importSource;
  if (source?.extension === '.pdf' || source?.extension === '.docx') {
    const text = pasted || source.text?.trim() || '';
    return text ? { ...source, text } : null;
  }
  if (pasted.length >= 50) {
    return { path: '', name: 'Pasted text', extension: '.txt', text: pasted };
  }
  if (!source) {
    return null;
  }
  if (source.text) {
    return { ...source, text: source.text };
  }
  if (!source.bytes || !isHvyDocumentExtension(source.extension)) {
    return null;
  }
  const document = await deserializeHvy(new Uint8Array(source.bytes), source.extension);
  return {
    ...source,
    text: '',
    sourceDocument: document,
  };
}
export function isHvyDocumentExtension(extension: ImportSourceFile['extension']): extension is DocumentExtension {
  return extension === '.hvy' || extension === '.thvy' || extension === '.phvy' || extension === '.md';
}
export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
export function markDocumentTabOpened(path: string): void {
  openedDocumentTabOrder = [path, ...openedDocumentTabOrder.filter((candidate) => candidate !== path)];
}
export function removeDocumentTabPath(path: string): void {
  openedDocumentTabOrder = openedDocumentTabOrder.filter((candidate) => candidate !== path);
}
export function updateOpenDocumentFile(previousPath: string, file: DocumentFileMetadata): void {
  const document = runtimeDocumentAtPath(previousPath);
  if (document) updateRuntimeDocumentFile(document, file);
}
export function removeOpenDocumentFile(path: string): void {
  const document = runtimeDocumentAtPath(path);
  if (!document) return;
  for (const session of documentSessions.values()) {
    if (session.documentId !== document.documentId) continue;
    documentSessions.delete(session.versionId);
    removeDocumentTabPath(session.versionId);
  }
  if (state.document?.documentId === document.documentId) {
    removeDocumentTabPath(state.document.versionId);
  }
  removeRuntimeDocument(document);
}
export function getTabStackIndex(): number {
  const count = state.documentTabs.length;
  if (count === 0) return 0;
  return ((state.tabStackIndex % count) + count) % count;
}
export function defaultDocumentMode(extension: DocumentFile['extension'], options: { defaultDocument?: boolean; hiddenFromAI?: boolean } = {}): HvyMode {
  if (options.defaultDocument) return 'viewer';
  if (options.hiddenFromAI && extension === '.hvy') return 'viewer';
  if (extension === '.thvy' || extension === '.phvy') return 'editor';
  if (extension === '.hvy') return 'ai';
  return 'viewer';
}
export function syncDocumentTabs(): void {
  const tabs = new Map<string, { versionId: string; documentId: string; sourcePath: string; name: string; dirty: boolean; readOnly: boolean; hiddenFromAI: boolean; active: boolean }>();
  if (state.document) {
    tabs.set(state.document.versionId, {
      versionId: state.document.versionId,
      documentId: state.document.documentId,
      sourcePath: state.document.source.path,
      name: state.document.virtual === 'recoveryDraft' ? recoveryDocumentTabName(state.document.source.name) : state.document.displayName ?? state.document.source.name,
      dirty: state.document.dirty,
      readOnly: state.document.readOnly,
      hiddenFromAI: state.document.hiddenFromAI,
      active: true,
    });
  }
  const workspaceChatPath = state.workspaceChat.open ? currentWorkspaceChatDocumentPath() : null;
  if (workspaceChatPath) {
    tabs.set(workspaceChatPath, {
      versionId: workspaceChatPath,
      documentId: state.document?.virtual === 'workspaceChat'
        ? state.document.documentId
        : runtimeDocumentAtPath(workspaceChatPath)?.documentId ?? workspaceChatPath,
      sourcePath: workspaceChatPath,
      name: currentWorkspaceChatDocumentName(),
      dirty: state.workspaceChat.dirty,
      readOnly: false,
      hiddenFromAI: false,
      active: state.document?.versionId === workspaceChatPath,
    });
  }
  for (const session of documentSessions.values()) {
    if (session.readOnly || (!openedDocumentTabOrder.includes(session.versionId) && !session.dirty && !session.isNew)) continue;
    const active = session.versionId === state.document?.versionId;
    tabs.set(session.versionId, {
      versionId: session.versionId,
      documentId: session.documentId,
      sourcePath: session.source.path,
      name: session.virtual === 'recoveryDraft' ? recoveryDocumentTabName(session.source.name) : session.displayName ?? session.source.name,
      dirty: active ? state.document?.dirty ?? session.dirty : session.dirty,
      readOnly: session.readOnly,
      hiddenFromAI: session.hiddenFromAI,
      active,
    });
  }
  for (const versionId of openedDocumentTabOrder) {
    if (tabs.has(versionId)) continue;
    if (isWorkspaceChatDocumentPath(versionId)) continue;
    const session = documentSessions.get(versionId);
    if (!session) continue;
    tabs.set(versionId, {
      versionId,
      documentId: session.documentId,
      sourcePath: session.source.path,
      name: session.virtual === 'recoveryDraft' ? recoveryDocumentTabName(session.source.name) : session.displayName ?? session.source.name,
      dirty: session.dirty,
      readOnly: session.readOnly,
      hiddenFromAI: session.hiddenFromAI,
      active: false,
    });
  }
  state.documentTabs = Array.from(tabs.values()).sort((left, right) => {
    const leftIndex = openedDocumentTabOrder.indexOf(left.versionId);
    const rightIndex = openedDocumentTabOrder.indexOf(right.versionId);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  if (state.tabStackIndex >= state.documentTabs.length) {
    state.tabStackIndex = 0;
  }
  writeHotReloadSessionSnapshot();
}
export function activateWorkspaceChatDocument(): void {
  const path = currentWorkspaceChatDocumentPath();
  if (!path) return;
  const source = runtimeDocumentForFile({ path, name: currentWorkspaceChatDocumentName(), extension: '.hvy' });
  preserveCurrentDocumentSession();
  markDocumentTabOpened(path);
  resetMountLifecycleState();
  state.document?.mounted?.mount.destroy();
  state.document = {
    documentId: source.documentId,
    versionId: path,
    source,
    virtual: 'workspaceChat',
    mode: 'viewer',
    dirty: state.workspaceChat.dirty,
    readOnly: false,
    hiddenFromAI: false,
    isNew: false,
    metaOpen: false,
    mounted: null,
    recoveryBackupId: null,
    recoveryModified: false,
  };
  state.selectedFilePath = null;
}
export async function openDocument(file: DocumentFile, options: { source?: RuntimeDocument; versionId?: string; defaultDocument?: boolean; defaultDocumentLabel?: string; includedDocumentId?: string; isNew?: boolean; recovered?: boolean; deferMount?: boolean; recoveryBackupId?: string | null; readOnly?: boolean; hiddenFromAI?: boolean; historyPreview?: { sourcePath: string; sourceName: string; versionId: string } } = {}): Promise<void> {
  const source = options.source ?? runtimeDocumentForFile(file, { distinct: options.isNew || options.defaultDocument });
  const versionId = options.versionId ?? source.workingVersionId;
  const loadStartedAt = performance.now();
  logDebugEvent('load', 'openDocument:start', {
    path: file.path,
    name: file.name,
    extension: file.extension,
    byteCount: file.bytes.length,
    deferMount: options.deferMount === true,
  });
  preserveCurrentDocumentSession();
  markDocumentTabOpened(versionId);
  measureDebug('close', 'openDocument:destroyPreviousMount', { nextPath: file.path }, () => {
    state.document?.mounted?.mount.destroy();
  });
  const storedSession = options.defaultDocument || options.recovered || options.isNew ? null : documentSessions.get(versionId);
  const viewSession = storedSession;
  const session = storedSession?.dirty || storedSession?.isNew || storedSession?.readOnly ? storedSession : null;
  const bytes = measureDebug('load', 'openDocument:bytesToUint8Array', { path: file.path, byteCount: file.bytes.length }, () => documentFileBytes(file));
  const cachedFilterDocument = options.defaultDocument || options.recovered || options.isNew ? null : workspaceFilterDocumentCache.get(file.path) ?? null;
  const workspaceAccess = workspaceFileAiAccess(file.path);
  const access = options.defaultDocument
    ? { locked: true, archived: false, hiddenFromAI: false, readOnly: true }
    : {
        archived: workspaceAccess.archived,
        locked: file.locked === true || workspaceAccess.locked,
        hiddenFromAI: file.hiddenFromAI === true || workspaceAccess.hiddenFromAI,
        readOnly: file.locked === true || workspaceAccess.readOnly,
      };
  const readOnly = session?.readOnly ?? (options.readOnly === true || access.readOnly || options.defaultDocument === true);
  const configuredHiddenFromAI = session?.hiddenFromAI ?? (options.hiddenFromAI === true || access.hiddenFromAI);
  const document = session?.document ?? cachedFilterDocument ?? await measureDebugAsync(
    'load',
    'openDocument:deserialize',
    { path: file.path, extension: file.extension, byteCount: bytes.byteLength },
    () => deserializeHvy(bytes, file.extension),
  );
  const hiddenFromAI = configuredHiddenFromAI || isWholeDocumentEncrypted(document);
  if (!hiddenFromAI && file.extension === '.hvy' && state.aiSettings.embeddings.enabled) {
    const attached = await measureDebugAsync(
      'load',
      'openDocument:attachSidecarEmbeddingIndex',
      { path: file.path },
      () => attachMatchingSidecarEmbeddingIndex(file.path, document, state.aiSettings),
    );
    logDebugEvent('load', 'openDocument:sidecarEmbeddingIndex', {
      path: file.path,
      attached,
    });
  }
  const recoveryState = options.recovered ? file.recoveryState ?? null : viewSession?.recoveryState ?? null;
  const restoredMode = viewSession?.mode
    ?? readDocumentModePreference(file.path)
    ?? defaultDocumentMode(file.extension, { ...options, hiddenFromAI });
  state.document = {
    documentId: source.documentId,
    versionId: session?.versionId ?? versionId,
    source,
    displayName: options.historyPreview ? file.name : session?.displayName,
    mode: normalizeDocumentMode(restoredMode, { readOnly, hiddenFromAI, extension: file.extension }),
    dirty: session?.dirty ?? (options.isNew === true || options.recovered === true),
    readOnly,
    hiddenFromAI,
    isNew: session?.isNew ?? options.isNew === true,
    metaOpen: viewSession?.metaOpen ?? false,
    mounted: null,
    recoveryBackupId: session?.recoveryBackupId ?? options.recoveryBackupId ?? null,
    recoveryModified: session?.recoveryModified ?? false,
    virtual: options.historyPreview ? 'versionHistory' : options.defaultDocument ? 'defaultDocument' : options.recovered ? 'recoveryDraft' : session?.virtual,
    includedDocumentId: options.includedDocumentId,
    historySourcePath: options.historyPreview?.sourcePath,
    historySourceName: options.historyPreview?.sourceName,
    historyVersionId: options.historyPreview?.versionId,
  };
  logDebugEvent('load', 'openDocument:stateInitialized', {
    path: file.path,
    hasStoredSession: Boolean(storedSession),
    storedSessionDirty: storedSession?.dirty ?? null,
    storedSessionIsNew: storedSession?.isNew ?? null,
    usingDirtySession: Boolean(session),
    usingCachedFilterDocument: !session && Boolean(cachedFilterDocument),
    initialDirty: state.document.dirty,
    isNew: state.document.isNew,
    recovered: options.recovered === true,
    readOnly: state.document.readOnly,
    recoveryState: Boolean(recoveryState),
  });
  if (options.recovered && state.document.recoveryBackupId) {
    markRestoredBackupSuppression(state.document.source.path, state.document.source.name);
  }
  state.selectedFilePath = options.defaultDocument ? null : file.path;
  if (!options.defaultDocument && !options.isNew && !options.historyPreview && file.path) {
    initializeDocumentHistory(file.path, file.name, document);
  }
  const defaultDocumentLabel = options.defaultDocumentLabel ?? 'HVY Galaxy guide';
  state.status = options.defaultDocument
    ? `Opened ${defaultDocumentLabel}`
    : session
    ? `Restored unsaved session for ${file.name}`
    : options.recovered
    ? `Restored unsaved edits for ${file.name}`
    : options.isNew
    ? 'Created blank HVY document'
    : `Opened ${file.name}`;
  recordDocumentNavigation(source.path);
  if (options.deferMount) {
    pendingMountDocument = document;
    pendingMountRecoveryState = recoveryState;
    logDebugEvent('load', 'openDocument:deferred', {
      path: file.path,
      durationMs: Math.round((performance.now() - loadStartedAt) * 10) / 10,
    });
    return;
  }
  measureDebug('load', 'openDocument:rerenderBeforeMount', { path: file.path }, () => rerender());
  await mountCurrentDocument(document);
  if (recoveryState && state.document?.mounted) {
    measureDebug('load', 'openDocument:applyRecoveryState', { path: file.path }, () => {
      applyMountedRecoveryState(state.document!.mounted!, recoveryState);
    });
  }
  await restoreDocumentViewState(mountRoot, viewSession?.viewState ?? null);
  restoreMountScrollRatio(mountRoot, viewSession?.scrollRatio ?? null);
  logDebugEvent('load', 'openDocument:complete', {
    path: file.path,
    durationMs: Math.round((performance.now() - loadStartedAt) * 10) / 10,
  });
}
export function documentFileBytes(file: DocumentFile): Uint8Array {
  return file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
}
export async function openLaunchDocumentPath(path: string): Promise<void> {
  if (!path) return;
  await runBusy('Opening file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  });
}
export function preserveCurrentDocumentSession(): void {
  const openDocument = state.document;
  if (!openDocument?.source.path) return;
  if (openDocument.virtual === 'workspaceChat') return;
  const document = openDocument.mounted?.document ?? pendingMountDocument;
  if (!document) return;
  measurePerf('session:writeDocumentModePreference', { path: openDocument.source.path }, () => {
    writeDocumentModePreference(openDocument.source.path, openDocument.mode);
  });
  const dirty = openDocument.mounted
    ? openDocument.dirty || measurePerf('session:isMountedDocumentDirty', { path: openDocument.source.path }, () => isMountedDocumentDirty(openDocument.mounted!))
    : openDocument.dirty;
  openDocument.dirty = dirty;
  const scrollRatioValue = measurePerf('session:captureMountScrollRatio', { path: openDocument.source.path }, () => captureMountScrollRatio(mountRoot));
  const recoveryStateValue = openDocument.mounted && !isWholeDocumentEncrypted(document)
    ? measurePerf('session:getRecoveryState', { path: openDocument.source.path }, () => getMountedRecoveryState(openDocument.mounted!))
    : null;
  documentSessions.set(openDocument.versionId, {
    documentId: openDocument.documentId,
    versionId: openDocument.versionId,
    source: openDocument.source,
    displayName: openDocument.displayName,
    mode: openDocument.mode,
    dirty,
    readOnly: openDocument.readOnly,
    hiddenFromAI: openDocument.hiddenFromAI,
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    chatState: openDocument.mounted?.mount.getChatState() ?? null,
    scrollRatio: scrollRatioValue,
    viewState: captureDocumentViewState(mountRoot),
    recoveryState: recoveryStateValue,
    recoveryBackupId: openDocument.recoveryBackupId,
    virtual: openDocument.virtual === 'recoveryDraft' || openDocument.virtual === 'defaultDocument' ? openDocument.virtual : undefined,
    recoveryModified: openDocument.recoveryModified,
  });
  measurePerf('session:writeHotReloadSessionSnapshot', { path: openDocument.source.path }, () => writeHotReloadSessionSnapshot());
}
export function updateCurrentDocumentSession(document: VisualDocument): void {
  const openDocument = state.document;
  if (!openDocument?.source.path || openDocument.readOnly) return;
  if (openDocument.virtual === 'workspaceChat') return;
  measurePerf('session:update:writeDocumentModePreference', { path: openDocument.source.path }, () => {
    writeDocumentModePreference(openDocument.source.path, openDocument.mode);
  });
  const scrollRatioValue = measurePerf('session:update:captureMountScrollRatio', { path: openDocument.source.path }, () => captureMountScrollRatio(mountRoot));
  const recoveryStateValue = openDocument.mounted && !isWholeDocumentEncrypted(document)
    ? measurePerf('session:update:getRecoveryState', { path: openDocument.source.path }, () => getMountedRecoveryState(openDocument.mounted!))
    : null;
  documentSessions.set(openDocument.versionId, {
    documentId: openDocument.documentId,
    versionId: openDocument.versionId,
    source: openDocument.source,
    displayName: openDocument.displayName,
    mode: openDocument.mode,
    dirty: openDocument.dirty,
    readOnly: openDocument.readOnly,
    hiddenFromAI: openDocument.hiddenFromAI,
    isNew: openDocument.isNew,
    metaOpen: openDocument.metaOpen,
    document,
    chatState: openDocument.mounted?.mount.getChatState() ?? documentSessions.get(openDocument.versionId)?.chatState ?? null,
    scrollRatio: scrollRatioValue,
    viewState: captureDocumentViewState(mountRoot),
    recoveryState: recoveryStateValue,
    recoveryBackupId: openDocument.recoveryBackupId,
    virtual: openDocument.virtual === 'recoveryDraft' || openDocument.virtual === 'defaultDocument' ? openDocument.virtual : undefined,
    recoveryModified: openDocument.recoveryModified,
  });
  measurePerf('session:update:writeHotReloadSessionSnapshot', { path: openDocument.source.path }, () => writeHotReloadSessionSnapshot());
}
export function adoptSavedAsDocument(
  file: DocumentFileMetadata,
  mounted: MountedDocument,
  document: VisualDocument,
  mode: HvyMode,
  previousPath: string,
  previousUseDocumentColors: boolean,
): void {
  const previousVersionId = state.document?.versionId ?? previousPath;
  if (previousVersionId) {
    documentSessions.delete(previousVersionId);
    removeDocumentTabPath(previousVersionId);
  }
  const source = runtimeDocumentForFile(file, { distinct: true });
  markDocumentTabOpened(source.workingVersionId);
  state.document = {
    documentId: source.documentId,
    versionId: source.workingVersionId,
    source,
    mode,
    dirty: false,
    readOnly: false,
    hiddenFromAI: workspaceFileAiAccess(file.path).hiddenFromAI,
    isNew: false,
    metaOpen: false,
    mounted,
    recoveryBackupId: null,
    recoveryModified: false,
  };
  writeDocumentColorPreference(file.path, previousUseDocumentColors);
  markMountedDocumentSaved(mounted);
  setDocumentDirty(false, { preserveStatus: true });
  updateCurrentDocumentSession(document);
}
export function cacheWorkspaceFilterDocuments(workspacePath: string, documents: HvyDocumentSearchDocument[]): void {
  clearWorkspaceFilterDocumentCache(workspacePath);
  for (const entry of documents) {
    workspaceFilterDocumentCache.set(entry.documentId, entry.document);
  }
}
export function clearWorkspaceFilterDocumentCache(workspacePath: string): void {
  for (const path of workspaceFilterDocumentCache.keys()) {
    if (pathStartsWithWorkspace(path, workspacePath)) {
      workspaceFilterDocumentCache.delete(path);
    }
  }
}
export function pathStartsWithWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPath = normalizeFilePath(path);
  const normalizedWorkspacePath = normalizeFilePath(workspacePath).replace(/\/+$/, '');
  return normalizedPath === normalizedWorkspacePath || normalizedPath.startsWith(`${normalizedWorkspacePath}/`);
}
export async function mountCurrentDocument(document = state.document?.mounted?.document): Promise<void> {
  if (!state.document || !mountRoot || !document) return;
  const generation = ++mountGeneration;
  const path = state.document.source.path;
  const searchSnapshot = await measureDebugAsync(
    'load',
    'mountCurrentDocument:createWorkspaceFilterSnapshot',
    { path, name: state.document.source.name },
    () => createWorkspaceFilterSnapshotForDocument(state.document!.source.path, state.document!.source.name, document),
  );
  if (generation !== mountGeneration || !state.document || !mountRoot) return;
  measureDebug('close', 'mountCurrentDocument:destroyExistingMount', { path }, () => {
    state.document?.mounted?.mount.destroy();
  });
  measureDebug('close', 'mountCurrentDocument:cleanupThemeReapply', { path }, () => {
    mountThemeReapplyCleanup?.();
  });
  mountThemeReapplyCleanup = null;
  const currentDocument = state.document;
  const mountStartedDirty = currentDocument.dirty;
  const mountShouldStartSaved = !currentDocument.dirty && !currentDocument.isNew;
  logDebugEvent('load', 'mountCurrentDocument:baselineBeforeMount', {
    path,
    dirty: currentDocument.dirty,
    isNew: currentDocument.isNew,
    readOnly: currentDocument.readOnly,
    pendingRecoveryState: Boolean(pendingMountRecoveryState),
    shouldStartSaved: mountShouldStartSaved,
  });
  mountRoot.classList.toggle('is-hidden-from-ai', currentDocument.hiddenFromAI);
  const storedChatState = documentSessions.get(currentDocument.versionId)?.chatState ?? null;
  const powerScripts = state.appSettings.powerScriptingAllowedFiles.includes(currentDocument.source.path)
    ? 'enabled'
    : 'prompt';
  const mounted = await measureDebugAsync('load', 'mountCurrentDocument:mountHvyDocument', { path, mode: currentDocument.mode }, () => mountHvyDocument(mountRoot!, document, currentDocument.mode, {
    storageKey: documentStorageKey(currentDocument.source.path || currentDocument.source.name),
    initialChatState: storedChatState,
    themeOverrides: readDocumentColorPreference(path) ? null : state.colorTheme.colors,
    searchSnapshot,
    hiddenFromAI: currentDocument.hiddenFromAI,
    maxContextChars: normalizeAiMaxContextChars(state.aiSettings.maxContextChars),
    imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(state.appSettings.imageAttachmentMaxDimensions),
    powerScripts,
    getPowerScriptAcceptance: ({ fingerprint }) =>
      (state.appSettings.powerScriptAcceptances[path] ?? []).includes(fingerprint),
    onPowerScriptAcceptanceChanged: ({ document: acceptedDocument, fingerprint, accepted }) => {
      if (!accepted || (state.appSettings.powerScriptAcceptances[path] ?? []).includes(fingerprint)) return;
      const acceptedFingerprints = [...(state.appSettings.powerScriptAcceptances[path] ?? []), fingerprint];
      const settings = {
        ...state.appSettings,
        powerScriptAcceptances: {
          ...state.appSettings.powerScriptAcceptances,
          [path]: acceptedFingerprints,
        },
        powerScriptAcceptanceScripts: {
          ...state.appSettings.powerScriptAcceptanceScripts,
          [path]: {
            ...(state.appSettings.powerScriptAcceptanceScripts[path] ?? {}),
            [fingerprint]: powerScriptDescriptors(acceptedDocument),
          },
        },
      };
      state.appSettings = settings;
      void saveAppSettings(settings)
        .then((savedSettings) => {
          state.appSettings = savedSettings;
          state.status = 'Remembered power scripting approval';
          rerender({ preserveMountedDocument: true });
        })
        .catch((error: unknown) => {
          state.appSettings = {
            ...state.appSettings,
            powerScriptAcceptances: {
              ...state.appSettings.powerScriptAcceptances,
              [path]: (state.appSettings.powerScriptAcceptances[path] ?? [])
                .filter((candidate) => candidate !== fingerprint),
            },
            powerScriptAcceptanceScripts: {
              ...state.appSettings.powerScriptAcceptanceScripts,
              [path]: Object.fromEntries(Object.entries(state.appSettings.powerScriptAcceptanceScripts[path] ?? {})
                .filter(([candidate]) => candidate !== fingerprint)),
            },
          };
          state.error = error instanceof Error ? error.message : String(error);
          rerender({ preserveMountedDocument: true });
        });
    },
    onEmbeddingIndexPrepared: currentDocument.source.extension === '.hvy' && !currentDocument.hiddenFromAI && state.aiSettings.embeddings.enabled
      ? async () => {
          const written = await measureDebugAsync(
            'load',
            'chat:writePreparedDocumentEmbeddingSidecar',
            { path },
            () => writePreparedDocumentEmbeddingSidecar(path, document, state.aiSettings),
          );
          logDebugEvent('load', 'chat:preparedDocumentEmbeddingSidecar', {
            path,
            written,
          });
        }
      : undefined,
    onDocumentChange: (event) => {
      if (generation !== mountGeneration) return;
      const changeStartedAt = performance.now();
      const dirtyBefore = state.document?.dirty ?? null;
      if (event.dirty && documentZoomDirtySuppressionDepth > 0) {
        documentChangeEventCount += 1;
        logDebugEvent('perf', 'documentChange:suppressZoomDirty', {
          path,
          dirtyBefore,
          source: event.source,
          reason: event.reason,
          eventCount: documentChangeEventCount,
        });
        return;
      }
      const dirty = documentDirtyAfterMountedChange(event.dirty, state.document?.virtual, state.document?.isNew ?? false);
      setDocumentDirty(dirty);
      const durationMs = Math.round((performance.now() - changeStartedAt) * 10) / 10;
      documentChangeEventCount += 1;
      if (dirtyBefore !== dirty || durationMs >= CHANGE_PERF_LOG_THRESHOLD_MS || documentChangeEventCount <= 20 || documentChangeEventCount % CHANGE_PERF_SAMPLE_INTERVAL === 0) {
        logDebugEvent('perf', 'documentChange:onDocumentChange', {
          path,
          dirty,
          mountedDirty: event.dirty,
          dirtyBefore,
          dirtyAfter: state.document?.dirty ?? null,
          source: event.source,
          reason: event.reason,
          eventCount: documentChangeEventCount,
          durationMs,
        });
      }
    },
  }));
  if (pendingMountRecoveryState) {
    measureDebug('load', 'mountCurrentDocument:applyPendingRecoveryState', { path }, () => {
      applyMountedRecoveryState(mounted, pendingMountRecoveryState);
    });
    pendingMountRecoveryState = null;
  }
  measureDebug('load', 'mountCurrentDocument:applyColorTheme', { path }, () => applyAppColorTheme());
  mountThemeReapplyCleanup = measureDebug('load', 'mountCurrentDocument:bindThemeReapply', { path }, () => bindMountThemeReapply(mountRoot!));
  state.document.mounted = mounted;
  measureDebug('load', 'mountCurrentDocument:applyDocumentZoom', { path }, () => applyDocumentZoom());
  measureDebug('load', 'mountCurrentDocument:setDirtyState', { path }, () => {
    const dirtyBeforeBaseline = state.document!.dirty;
    const mountedDirtyBeforeBaseline = isMountedDocumentDirty(mounted);
    if (mountShouldStartSaved) {
      markMountedDocumentSaved(mounted);
      state.document!.dirty = false;
    }
    const mountedDirtyAfterBaseline = isMountedDocumentDirty(mounted);
    const nextDirty = mountedDocumentDirtyAfterMount(mountStartedDirty, state.document!.isNew, mountedDirtyAfterBaseline);
    logDebugEvent('load', 'mountCurrentDocument:baselineAfterMount', {
      path,
      shouldStartSaved: mountShouldStartSaved,
      dirtyBeforeBaseline,
      mountedDirtyBeforeBaseline,
      mountedDirtyAfterBaseline,
      nextDirty,
      isNew: state.document!.isNew,
    });
    setDocumentDirty(nextDirty, { preserveStatus: true, recoveryBaseline: true });
  });
}
export async function ensureCurrentDocumentMounted(): Promise<void> {
  if (!state.document || state.document.mounted) return;
  await mountCurrentDocument(pendingMountDocument ?? undefined);
}
export function bindMountThemeReapply(root: HTMLElement): () => void {
  const controller = new AbortController();
  let frame = 0;
  const schedule = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateDocumentStageOverlayState(root);
      });
    });
  };
  const clearRestoredBackupSuppressionForInput = () => clearActiveRestoredBackupSuppression();
  root.addEventListener('click', schedule, { signal: controller.signal });
  root.addEventListener('beforeinput', clearRestoredBackupSuppressionForInput, { signal: controller.signal });
  root.addEventListener('input', clearRestoredBackupSuppressionForInput, { signal: controller.signal });
  root.addEventListener('input', schedule, { signal: controller.signal });
  root.addEventListener('paste', clearRestoredBackupSuppressionForInput, { signal: controller.signal });
  root.addEventListener('drop', clearRestoredBackupSuppressionForInput, { signal: controller.signal });
  root.addEventListener('submit', schedule, { signal: controller.signal });
  root.addEventListener('keydown', schedule, { signal: controller.signal });
  const overlayObserver = new MutationObserver(schedule);
  overlayObserver.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
    childList: true,
    subtree: true,
  });
  updateDocumentStageOverlayState(root);
  return () => {
    controller.abort();
    overlayObserver.disconnect();
    root.closest<HTMLElement>('.document-stage')?.classList.remove(
      'has-embedded-overlay',
      'has-embedded-pullout',
      'has-embedded-context-popover',
    );
    if (frame) window.cancelAnimationFrame(frame);
  };
}
export function updateDocumentStageOverlayState(root: HTMLElement): void {
  const stage = root.closest<HTMLElement>('.document-stage');
  if (!stage) return;
  const hasPullout = Boolean(root.querySelector('.viewer-shell.is-sidebar-open, .editor-shell.is-sidebar-open'));
  const hasContextPopover = Boolean(root.querySelector('.hvy-context-popover-backdrop'));
  stage.classList.toggle('has-embedded-pullout', hasPullout);
  stage.classList.toggle('has-embedded-context-popover', hasContextPopover);
}
export function getMountScrollElement(root: HTMLElement | null): HTMLElement | null {
  const metaView = root?.querySelector<HTMLElement>('.document-meta-view');
  const metaPane = metaView?.closest<HTMLElement>('.full-pane');
  if (metaPane) return metaPane;
  return root?.querySelector<HTMLElement>(
    '.editor-shell .editor-tree, .viewer-shell .reader-document, .raw-hvy-textarea'
  ) ?? null;
}
export function captureMountScrollRatio(root: HTMLElement | null): MountScrollRatio | null {
  const scroller = getMountScrollElement(root);
  if (!scroller) return null;
  return {
    top: scrollRatio(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight),
    left: scrollRatio(scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth),
    topPosition: scroller.scrollTop,
    leftPosition: scroller.scrollLeft,
  };
}
export function scrollRatio(position: number, max: number): number {
  return max > 0 ? position / max : 0;
}
export function restoreMountScrollRatio(root: HTMLElement | null, ratio: MountScrollRatio | null): void {
  if (!root || !ratio) return;
  const restore = () => {
    const scroller = getMountScrollElement(root);
    if (!scroller) return;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollTop = Math.min(ratio.topPosition, maxTop) || ratio.top * maxTop;
    scroller.scrollLeft = Math.min(ratio.leftPosition, maxLeft) || ratio.left * maxLeft;
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}
export function setDocumentDirty(dirty: boolean, options: { preserveStatus?: boolean; recoveryBaseline?: boolean } = {}): void {
  if (!state.document || state.document.readOnly) return;
  const path = state.document.source.path;
  measurePerf('dirty:setDocumentDirty', { path, dirty, preserveStatus: options.preserveStatus === true }, () => {
    const changed = state.document!.dirty !== dirty;
    const previousDirty = state.document!.dirty;
    state.document!.dirty = dirty;
    if (dirty && state.document!.virtual === 'recoveryDraft' && options.recoveryBaseline !== true) {
      state.document!.recoveryModified = true;
    }
    if (changed) {
      logDebugEvent('perf', 'dirty:stateChanged', {
        path,
        dirty,
        previousDirty,
        preserveStatus: options.preserveStatus === true,
        isNew: state.document!.isNew,
        mounted: Boolean(state.document!.mounted),
        statusBefore: state.status,
      });
    }
    if (!options.preserveStatus || changed) {
      state.status = dirty ? 'Unsaved changes' : `Saved ${state.document!.source.name}`;
    }
    const document = state.document!.mounted?.document ?? pendingMountDocument;
    if (document) {
      measurePerf('dirty:updateCurrentDocumentSession', { path }, () => updateCurrentDocumentSession(document));
    }
    if (dirty) {
      markActiveDocumentBackupChanged();
      scheduleBackupActiveDocument();
    }
    measurePerf('dirty:updateDirtyChrome', { path }, () => updateDirtyChrome());
  });
}
export function updateDirtyChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  syncDocumentTabs();
  const label = openDocument.virtual === 'versionHistory' ? 'Saved version' : openDocument.readOnly ? 'Read only' : openDocument.dirty ? 'Unsaved' : 'Saved';
  const indicator = document.querySelector<HTMLElement>('.dirty-indicator');
  indicator?.replaceChildren(document.createTextNode(label));
  indicator?.setAttribute('data-state', openDocument.readOnly ? 'read-only' : openDocument.dirty ? 'dirty' : 'clean');
  const activeTab = document.querySelector<HTMLElement>('.document-tab.is-active');
  activeTab?.classList.toggle('is-dirty', openDocument.dirty);
  const fileActions = getFileActionAvailability(state);
  syncToolbarButtonDisabled('save', !fileActions.save);
  syncToolbarButtonDisabled('save-as', !fileActions.saveAs);
  syncToolbarButtonDisabled('import-into-current', !fileActions.importCurrent);
  syncToolbarButtonDisabled('export-pdf', !fileActions.exportPdf);
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
  syncFileMenuState();
}
export function syncToolbarButtonDisabled(action: string, disabled: boolean): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!button) return;
  if (disabled) {
    button.setAttribute('disabled', '');
  } else {
    button.removeAttribute('disabled');
  }
}
export function updateModeMetaChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  const advancedButton = document.querySelector<HTMLButtonElement>('.mode-button[data-mode="advanced"]');
  const metaButton = document.querySelector<HTMLButtonElement>('.mode-button-meta');
  const advancedActive = openDocument.mode === 'advanced' && !openDocument.metaOpen;
  advancedButton?.classList.toggle('is-active', advancedActive);
  advancedButton?.setAttribute('aria-pressed', advancedActive ? 'true' : 'false');
  metaButton?.classList.toggle('is-active', openDocument.metaOpen);
  metaButton?.setAttribute('aria-pressed', openDocument.metaOpen ? 'true' : 'false');
}
export function rerender(options: { preserveMountedDocument?: boolean } = {}): void {
  const mountScrollRatio = options.preserveMountedDocument ? captureMountScrollRatio(mountRoot) : null;
  syncDocumentTabs();
  if (!options.preserveMountedDocument) {
    state.document?.mounted?.mount.destroy();
    if (state.document) {
      state.document.mounted = null;
    }
  }
  mountRoot = render(state, handlers);
  applyZoomSettings();
  syncFileMenuState();
  restoreMountScrollRatio(mountRoot, mountScrollRatio);
}
export function renderAllAroundDocument(): void {
  renderUiAroundDocument(state);
  applyZoomSettings();
  syncFileMenuState();
}
export function refreshDebugLogModal(): void {
  if (!state.debugLogDialogOpen) return;
  state.debugLogEntries = getDebugLogEntries();
  renderModals(state);
}
export function loadZoomSettings(): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(ZOOM_STORAGE_KEY) ?? '{}') as { appZoom?: unknown; documentZoom?: unknown };
    state.appZoom = normalizeZoomLevel(parsed.appZoom, 1);
    state.documentZoom = normalizeZoomLevel(parsed.documentZoom, 1);
  } catch {
    state.appZoom = 1;
    state.documentZoom = 1;
  }
}
export function saveZoomSettings(): void {
  localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify({
    appZoom: state.appZoom,
    documentZoom: state.documentZoom,
  }));
}
export function setAppZoom(zoom: number): void {
  state.appZoom = normalizeZoomLevel(zoom, 1);
  saveZoomSettings();
  applyAppZoom();
  state.status = `Workspace zoom ${zoomPercent(state.appZoom)}`;
  renderAllAroundDocument();
}
export function setDocumentZoom(zoom: number): void {
  state.documentZoom = normalizeZoomLevel(zoom, 1);
  saveZoomSettings();
  const scrollRatio = captureMountScrollRatio(mountRoot);
  applyDocumentZoom();
  restoreMountScrollRatio(mountRoot, scrollRatio);
  state.status = `Document zoom ${zoomPercent(state.documentZoom)}`;
  renderAllAroundDocument();
}
export function applyZoomSettings(): void {
  applyAppZoom();
  applyDocumentZoom();
}
export function applyAppZoom(): void {
  const shell = document.querySelector<HTMLElement>('.app-shell');
  if (state.appZoom === 1) {
    document.body.style.removeProperty('zoom');
    shell?.style.removeProperty('width');
    shell?.style.removeProperty('height');
    return;
  }
  document.body.style.setProperty('zoom', String(state.appZoom));
  shell?.style.setProperty('width', `${100 / state.appZoom}vw`);
  shell?.style.setProperty('height', `${100 / state.appZoom}vh`);
}
export function applyDocumentZoom(): void {
  if (!mountRoot) return;
  documentZoomDirtySuppressionDepth += 1;
  try {
    if (state.documentZoom === 1) {
      mountRoot.style.removeProperty('zoom');
      return;
    }
    mountRoot.style.setProperty('zoom', String(state.documentZoom));
  } finally {
    const releaseSuppression = () => {
      documentZoomDirtySuppressionDepth = Math.max(0, documentZoomDirtySuppressionDepth - 1);
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(releaseSuppression);
    });
  }
}
export function normalizeZoomLevel(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return ZOOM_LEVELS.includes(value) ? value : closestZoomLevel(value);
}
export function nextZoomLevel(current: number, direction: 1 | -1): number {
  const normalized = normalizeZoomLevel(current, 1);
  const index = ZOOM_LEVELS.indexOf(normalized);
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))] ?? 1;
}
export function closestZoomLevel(value: number): number {
  return ZOOM_LEVELS.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ), 1);
}
export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
export function scheduleWorkspaceFilterProgressRender(): void {
  if (workspaceFilterRenderTimer) {
    workspaceFilterRenderQueued = true;
    return;
  }
  rerender({ preserveMountedDocument: true });
  workspaceFilterRenderTimer = window.setTimeout(() => {
    workspaceFilterRenderTimer = null;
    if (!workspaceFilterRenderQueued) return;
    workspaceFilterRenderQueued = false;
    scheduleWorkspaceFilterProgressRender();
  }, 100);
}
export function cancelWorkspaceFilterProgressRender(): void {
  if (workspaceFilterRenderTimer) {
    window.clearTimeout(workspaceFilterRenderTimer);
  }
  workspaceFilterRenderTimer = null;
  workspaceFilterRenderQueued = false;
}
export async function runBusy(label: string, task: () => Promise<void>, options: { preserveMountedDocument?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  const document = state.document?.mounted?.document;
  const mountedBeforeTask = state.document?.mounted ?? null;
  state.busy = true;
  state.error = null;
  state.status = label;
  try {
    await task();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    const documentToMount = pendingMountDocument ?? state.document?.mounted?.document ?? document;
    const preserveMountedDocument = options.preserveMountedDocument ?? (
      mountedBeforeTask !== null
      && state.document?.mounted === mountedBeforeTask
      && pendingMountDocument === null
    );
    pendingMountDocument = null;
    if (preserveMountedDocument) {
      rerender({ preserveMountedDocument: true });
    } else {
      rerender();
      await mountCurrentDocument(documentToMount);
    }
  }
}
export function readDocumentModePreference(path: string): HvyMode | null {
  if (!path) return null;
  const recentMode = state.recent.documentModes?.[path];
  if (isHvyMode(recentMode)) return recentMode;
  try {
    const raw = localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)
      ?? sessionStorage.getItem(DOCUMENT_MODE_STORAGE_KEY);
    if (!raw) return null;
    const modes = JSON.parse(raw) as Record<string, unknown>;
    const mode = modes[path];
    return isHvyMode(mode) ? mode : null;
  } catch {
    return null;
  }
}
export function writeDocumentModePreference(path: string, mode: HvyMode): void {
  if (!path) return;
  state.recent = {
    ...state.recent,
    documentModes: { ...(state.recent.documentModes ?? {}), [path]: mode },
  };
  void saveDocumentModePreference(path, mode).then((recent) => {
    state.recent = recent;
  }).catch(() => undefined);
  try {
    const raw = localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)
      ?? sessionStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)
      ?? '{}';
    const modes = JSON.parse(raw) as Record<string, unknown>;
    modes[path] = mode;
    const serialized = JSON.stringify(modes);
    localStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, serialized);
    sessionStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, serialized);
  } catch {
    // Mode preferences are best-effort; document content and recovery drafts are independent.
  }
}

export function readDocumentColorPreference(path: string): boolean {
  return Boolean(path && state.recent.documentColorUses?.[path] === true);
}

export function writeDocumentColorPreference(path: string, useDocumentColors: boolean): void {
  if (!path) return;
  state.recent = {
    ...state.recent,
    documentColorUses: { ...(state.recent.documentColorUses ?? {}), [path]: useDocumentColors },
  };
  void saveDocumentColorPreference(path, useDocumentColors).then((recent) => {
    state.recent = recent;
  }).catch(() => undefined);
}
export function readHotReloadSessionSnapshot(): HotReloadSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(HOT_RELOAD_SESSION_STORAGE_KEY)
      ?? sessionStorage.getItem(HOT_RELOAD_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HotReloadSessionSnapshot>;
    return {
      activePath: typeof parsed.activePath === 'string' ? parsed.activePath : null,
      tabPaths: Array.isArray(parsed.tabPaths) ? parsed.tabPaths.filter((path): path is string => typeof path === 'string') : [],
      documents: Array.isArray(parsed.documents)
        ? parsed.documents
          .filter((entry): entry is HotReloadDocumentSnapshot => isHotReloadDocumentSnapshot(entry))
        : [],
    };
  } catch {
    return null;
  }
}
export function writeHotReloadSessionSnapshot(): void {
  try {
    const documents = new Map<string, HotReloadDocumentSnapshot>();
    const tabPaths: string[] = [];
    const addTabPath = (path: string, readOnly: boolean) => {
      if (readOnly || tabPaths.includes(path)) return;
      tabPaths.push(path);
    };
    if (state.document && state.document.virtual !== 'workspaceChat' && state.document.virtual !== 'recoveryDraft') {
      addTabPath(state.document.source.path, state.document.readOnly);
    }
    for (const session of documentSessions.values()) {
      if (session.readOnly || session.virtual === 'recoveryDraft') continue;
      addTabPath(session.source.path, false);
      documents.set(session.source.path, {
        path: session.source.path,
        mode: session.mode,
        metaOpen: session.metaOpen,
        scrollRatio: session.scrollRatio,
        recoveryState: recoveryStateForPersistence(session.document, session.recoveryState),
      });
    }
    for (const versionId of openedDocumentTabOrder) {
      if (isWorkspaceChatDocumentPath(versionId)) continue;
      const session = documentSessions.get(versionId);
      if (session?.virtual === 'recoveryDraft') continue;
      if (session) addTabPath(session.source.path, session.readOnly);
    }
    if (tabPaths.length === 0) {
      const serialized = JSON.stringify({
        activePath: null,
        tabPaths: [],
        documents: [],
      } satisfies HotReloadSessionSnapshot);
      localStorage.setItem(HOT_RELOAD_SESSION_STORAGE_KEY, serialized);
      sessionStorage.setItem(HOT_RELOAD_SESSION_STORAGE_KEY, serialized);
      return;
    }
    if (state.document && !state.document.readOnly && state.document.virtual !== 'workspaceChat' && state.document.virtual !== 'recoveryDraft') {
      documents.set(state.document.source.path, {
        path: state.document.source.path,
        mode: state.document.mode,
        metaOpen: state.document.metaOpen,
        scrollRatio: captureMountScrollRatio(mountRoot),
        recoveryState: recoveryStateForPersistence(
          state.document.mounted?.document,
          state.document.mounted ? getMountedRecoveryState(state.document.mounted) : pendingMountRecoveryState,
        ),
      });
    }
    const snapshot: HotReloadSessionSnapshot = {
      activePath: state.document && !state.document.readOnly && state.document.virtual !== 'workspaceChat' && state.document.virtual !== 'recoveryDraft' ? state.document.source.path : tabPaths[0] ?? null,
      tabPaths,
      documents: Array.from(documents.values()).filter((entry) => tabPaths.includes(entry.path)),
    };
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(HOT_RELOAD_SESSION_STORAGE_KEY, serialized);
    sessionStorage.setItem(HOT_RELOAD_SESSION_STORAGE_KEY, serialized);
  } catch {
    // Hot reload state is opportunistic; recents still provide startup restore.
  }
}
export function isHotReloadDocumentSnapshot(value: unknown): value is HotReloadDocumentSnapshot {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HotReloadDocumentSnapshot>;
  return typeof entry.path === 'string'
    && isHvyMode(entry.mode)
    && typeof entry.metaOpen === 'boolean'
    && (entry.scrollRatio === null || isMountScrollRatio(entry.scrollRatio))
    && (entry.recoveryState === null || typeof entry.recoveryState === 'string');
}
export function isHvyMode(value: unknown): value is HvyMode {
  return value === 'viewer' || value === 'editor' || value === 'advanced' || value === 'ai' || value === 'hvy';
}
export function isMountScrollRatio(value: unknown): value is MountScrollRatio {
  if (!value || typeof value !== 'object') return false;
  const ratio = value as Partial<MountScrollRatio>;
  return typeof ratio.top === 'number'
    && typeof ratio.left === 'number'
    && typeof ratio.topPosition === 'number'
    && typeof ratio.leftPosition === 'number';
}
export function setupErrorSurface(): void {
  window.addEventListener('error', (event) => {
    showStartupError(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    showStartupError(event.reason);
  });
}
export function showStartupError(error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
  state.status = 'Startup error';
  mountRoot = render(state, handlers);
}
void boot();
