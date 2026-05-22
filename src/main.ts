import './styles.css';
import { installAiChatClient } from './aiClient';
import {
  addFilesToWorkspace,
  chooseWorkspaceFolder,
  createDocumentBackup,
  createDocumentFile,
  createWorkspace,
  initializeWorkspacePath,
  isTauriRuntime,
  loadAiSettings,
  loadDefaultGuide,
  loadWorkspace,
  listDocumentBackups,
  loadRecentState,
  onMenuEvent,
  openExternalUrl,
  openFileDialog,
  readDocumentFile,
  restoreDocumentBackup,
  saveAiSettings,
  saveDocumentAsDialog,
  saveDocumentFile,
  type DocumentFile,
} from './backend';
import { deserializeHvy, isMountedDocumentDirty, markMountedDocumentSaved, mountHvyDocument, serializeMountedDocument, type HvyMode, type VisualDocument } from './hvy';
import { state } from './state';
import { getHvyTemplate, type HvyTemplate } from './templates';
import { render, type UiHandlers } from './ui';

let mountRoot: HTMLElement | null = null;
let mountGeneration = 0;
let pendingMountDocument: VisualDocument | null = null;
let backupTimer: number | null = null;
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MIN_BACKUP_SPACING_MS = 60 * 1000;
interface DocumentSession {
  path: string;
  name: string;
  extension: DocumentFile['extension'];
  mode: HvyMode;
  dirty: boolean;
  readOnly: boolean;
  isNew: boolean;
  document: VisualDocument;
}
const documentSessions = new Map<string, DocumentSession>();
const backupSnapshots = new Map<string, { bytesKey: string; createdAtMs: number }>();

const handlers: UiHandlers = {
  newWorkspace: () => {
    state.openWorkspaceActionsPath = null;
    state.newWorkspaceDialogOpen = true;
    state.newWorkspaceLocation = 'managed';
    state.status = 'Ready';
    rerender();
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="workspaceName"]')?.focus();
    });
  },
  toggleWorkspaceActions: (path) => {
    const document = state.document?.mounted?.document;
    state.openWorkspaceActionsPath = state.openWorkspaceActionsPath === path ? null : path;
    rerender();
    void mountCurrentDocument(document);
  },
  closeWorkspaceActions: () => {
    if (!state.openWorkspaceActionsPath) return;
    const document = state.document?.mounted?.document;
    state.openWorkspaceActionsPath = null;
    rerender();
    void mountCurrentDocument(document);
  },
  createWorkspace: (name, location) => void runBusy('Creating workspace...', async () => {
    const trimmed = name.trim();
    if (location === 'managed' && !trimmed) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Workspace name is required';
      return;
    }
    if (location === 'managed' && hasOpenWorkspaceNamed(trimmed)) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Workspace name must be unique';
      return;
    }
    const workspace = location === 'choose'
      ? await createWorkspaceInChosenFolder()
      : await createWorkspace(trimmed);
    if (!workspace) {
      state.newWorkspaceDialogOpen = true;
      state.status = 'Ready';
      return;
    }
    state.newWorkspaceDialogOpen = false;
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    await refreshRecents();
  }),
  setNewWorkspaceLocation: (location) => {
    state.newWorkspaceLocation = location;
    state.status = 'Ready';
    rerender();
  },
  cancelNewWorkspace: () => {
    state.newWorkspaceDialogOpen = false;
    state.status = 'Ready';
    rerender();
  },
  newDocumentInWorkspace: (workspacePath) => {
    state.openWorkspaceActionsPath = null;
    state.newDocumentWorkspacePath = workspacePath;
    state.status = 'Ready';
    rerender();
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[name="documentName"]')?.focus();
    });
  },
  createDocumentInWorkspace: (name, templateId) => void runBusy('Creating HVY document...', async () => {
    const workspacePath = state.newDocumentWorkspacePath;
    const template = getHvyTemplate(templateId);
    const fileName = documentFileName(name, template);
    if (!workspacePath) return;
    if (!fileName) {
      state.status = 'Document name is required';
      return;
    }
    state.newDocumentWorkspacePath = null;
    const file = await createDocumentFile({
      workspacePath,
      relativePath: fileName,
      template: applyTemplateTitle(template.content, documentTitle(fileName)),
    });
    upsertWorkspace(await loadWorkspace(workspacePath));
    state.selectedWorkspacePath = workspacePath;
    await openDocument(file, { isNew: true, deferMount: true });
    await refreshRecents();
  }),
  cancelNewDocument: () => {
    state.newDocumentWorkspacePath = null;
    state.status = 'Ready';
    rerender();
  },
  addFilesToWorkspace: (workspacePath) => void runBusy('Adding files...', async () => {
    state.openWorkspaceActionsPath = null;
    const workspace = await addFilesToWorkspace(workspacePath);
    if (!workspace) return;
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    state.status = 'Added files to workspace';
    await refreshRecents();
  }),
  openAiSettings: () => {
    closeUiBeforeAiSettings();
    state.aiSettingsDraft = cloneAiSettings(state.aiSettings);
    state.aiSettingsDialogInitialJson = JSON.stringify(canonicalAiSettings(state.aiSettingsDraft));
    state.aiSettingsDialogOpen = true;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  selectAiProvider: (providerId, settings) => {
    state.aiSettingsDraft = {
      ...settings,
      activeProviderId: providerId,
    };
    rerender({ preserveMountedDocument: true });
  },
  openProviderDocs: (url) => {
    void openExternalUrl(url)
      .then(() => {
        state.status = 'Opened setup instructions';
      })
      .catch((error) => {
        state.error = error instanceof Error ? error.message : String(error);
        state.status = 'Ready';
        rerender();
        void mountCurrentDocument();
      });
  },
  saveAiSettings: (settings) => void runBusy('Saving AI settings...', async () => {
    state.aiSettings = await saveAiSettings(settings);
    installAiChatClient(state.aiSettings);
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.status = 'Saved AI settings';
  }),
  cancelAiSettings: (settings) => {
    if (!confirmDiscardAiSettings(settings)) return;
    state.aiSettingsDialogOpen = false;
    state.aiSettingsDraft = null;
    state.aiSettingsDialogInitialJson = null;
    state.status = 'Ready';
    rerender({ preserveMountedDocument: true });
  },
  restoreBackup: (id) => void runBusy('Restoring backup...', async () => {
    const file = await restoreDocumentBackup(id);
    state.recoveryDialogOpen = false;
    state.recoveryBackups = [];
    await openDocument(file, { recovered: true, deferMount: true });
  }),
  cancelRecovery: () => {
    state.recoveryDialogOpen = false;
    state.status = 'Ready';
    rerender();
  },
  openWorkspace: () => void runBusy('Opening workspace...', async () => {
    const candidate = await chooseWorkspaceFolder();
    if (!candidate) return;
    const workspace = candidate.hasManifest
      ? await loadWorkspace(candidate.path)
      : await confirmWorkspaceInitialization(candidate.path, candidate.defaultName);
    if (!workspace) {
      state.status = 'Ready';
      return;
    }
    upsertWorkspace(workspace);
    state.selectedWorkspacePath = workspace.path;
    await refreshRecents();
    rerender();
  }),
  openFile: () => void runBusy('Opening file...', async () => {
    const file = await openFileDialog();
    if (!file) return;
    await openDocument(file, { deferMount: true });
    await refreshRecents();
  }),
  openRecentWorkspace: (path) => void runBusy('Opening recent workspace...', async () => {
    upsertWorkspace(await loadWorkspace(path));
    state.selectedWorkspacePath = path;
    await refreshRecents();
    rerender();
  }),
  openRecentFile: (path) => void runBusy('Opening recent file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  }),
  selectFile: (path) => void runBusy('Opening file...', async () => {
    await openDocument(await readDocumentFile(path), { deferMount: true });
    await refreshRecents();
  }),
  setMode: (mode) => {
    if (!state.document) return;
    if (state.document.readOnly && mode !== 'viewer') {
      state.status = 'The HVY guide is read-only';
      rerender();
      void mountCurrentDocument();
      return;
    }
    const document = state.document.mounted?.document;
    state.document.mode = mode;
    if (document) {
      updateCurrentDocumentSession(document);
    }
    rerender();
    void mountCurrentDocument(document);
  },
  save: () => void saveCurrentDocument(),
  saveAs: () => void saveCurrentDocumentAs(),
  createFile: () => void createBlankDocument(),
};

void boot();

async function boot(): Promise<void> {
  setupErrorSurface();
  mountRoot = render(state, handlers);
  try {
    await refreshRecents();
    state.aiSettings = await loadAiSettings();
    installAiChatClient(state.aiSettings);
    await loadRecentWorkspaces();
    mountRoot = render(state, handlers);
    await openDefaultGuide();
    startBackupTimer();
    await onMenuEvent((event) => {
      if (event === 'new-workspace') handlers.newWorkspace();
      if (event === 'open-workspace') handlers.openWorkspace();
      if (event === 'open-file') handlers.openFile();
      if (event === 'open-guide') void openDefaultGuide({ force: true });
      if (event === 'ai-settings') handlers.openAiSettings();
      if (event === 'recover-backup') void openRecoveryDialog();
      if (event === 'save') handlers.save();
      if (event === 'save-as') handlers.saveAs();
      if (event.startsWith('recent-workspace:')) handlers.openRecentWorkspace(event.slice('recent-workspace:'.length));
      if (event.startsWith('recent-file:')) handlers.openRecentFile(event.slice('recent-file:'.length));
    });
  } catch (error) {
    showStartupError(error);
  }
}

async function refreshRecents(): Promise<void> {
  state.recent = await loadRecentState();
}

async function loadRecentWorkspaces(): Promise<void> {
  for (const path of state.recent.workspaces) {
    try {
      upsertWorkspace(await loadWorkspace(path));
    } catch {
      // Recents are pruned by the backend when they are opened or reloaded.
    }
  }
  state.selectedWorkspacePath = state.workspaces[0]?.path ?? null;
}

async function openDefaultGuide(options: { force?: boolean } = {}): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!options.force && (state.document || state.selectedFilePath)) return;
  try {
    await openDocument(await loadDefaultGuide(), { defaultDocument: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Could not load HVY guide';
    mountRoot = render(state, handlers);
  }
}

async function openDocument(file: DocumentFile, options: { defaultDocument?: boolean; isNew?: boolean; recovered?: boolean; deferMount?: boolean } = {}): Promise<void> {
  preserveCurrentDocumentSession();
  state.document?.mounted?.mount.destroy();
  const storedSession = options.defaultDocument || options.recovered || options.isNew ? null : documentSessions.get(file.path);
  const session = storedSession?.dirty || storedSession?.isNew ? storedSession : null;
  const bytes = new Uint8Array(file.bytes);
  const document = session?.document ?? await deserializeHvy(bytes, file.extension);
  state.document = {
    path: session?.path ?? file.path,
    name: session?.name ?? file.name,
    extension: session?.extension ?? file.extension,
    mode: session?.mode ?? (options.isNew ? 'editor' : 'viewer'),
    dirty: session?.dirty ?? (options.isNew === true || options.recovered === true),
    readOnly: session?.readOnly ?? options.defaultDocument === true,
    isNew: session?.isNew ?? options.isNew === true,
    mounted: null,
  };
  state.selectedFilePath = options.defaultDocument ? null : file.path;
  state.status = options.defaultDocument
    ? 'Opened HVY guide'
    : session
    ? `Restored unsaved session for ${file.name}`
    : options.recovered
    ? `Restored backup of ${file.name}`
    : options.isNew
    ? 'Created blank HVY document'
    : `Opened ${file.name}`;
  if (options.deferMount) {
    pendingMountDocument = document;
    return;
  }
  rerender();
  await mountCurrentDocument(document);
}

function preserveCurrentDocumentSession(): void {
  const openDocument = state.document;
  if (!openDocument?.path || openDocument.readOnly) return;
  const document = openDocument.mounted?.document ?? pendingMountDocument;
  if (!document) return;
  const dirty = openDocument.mounted
    ? openDocument.dirty || isMountedDocumentDirty(openDocument.mounted)
    : openDocument.dirty;
  documentSessions.set(openDocument.path, {
    path: openDocument.path,
    name: openDocument.name,
    extension: openDocument.extension,
    mode: openDocument.mode,
    dirty,
    readOnly: openDocument.readOnly,
    isNew: openDocument.isNew,
    document,
  });
}

function updateCurrentDocumentSession(document: VisualDocument): void {
  const openDocument = state.document;
  if (!openDocument?.path || openDocument.readOnly) return;
  documentSessions.set(openDocument.path, {
    path: openDocument.path,
    name: openDocument.name,
    extension: openDocument.extension,
    mode: openDocument.mode,
    dirty: openDocument.dirty,
    readOnly: openDocument.readOnly,
    isNew: openDocument.isNew,
    document,
  });
}

async function mountCurrentDocument(document = state.document?.mounted?.document): Promise<void> {
  if (!state.document || !mountRoot || !document) return;
  state.document.mounted?.mount.destroy();
  const generation = ++mountGeneration;
  const mounted = await mountHvyDocument(mountRoot, document, state.document.mode, {
    storageKey: documentStorageKey(state.document.path || state.document.name),
    onDocumentChange: (event) => {
      if (generation !== mountGeneration) return;
      setDocumentDirty(event.dirty);
    },
  });
  state.document.mounted = mounted;
  setDocumentDirty(state.document.dirty || state.document.isNew ? true : isMountedDocumentDirty(mounted), { preserveStatus: true });
}

function setDocumentDirty(dirty: boolean, options: { preserveStatus?: boolean } = {}): void {
  if (!state.document || state.document.readOnly) return;
  const changed = state.document.dirty !== dirty;
  state.document.dirty = dirty;
  if (!options.preserveStatus || changed) {
    state.status = dirty ? 'Unsaved changes' : `Saved ${state.document.name}`;
  }
  const document = state.document.mounted?.document ?? pendingMountDocument;
  if (document) {
    updateCurrentDocumentSession(document);
  }
  updateDirtyChrome();
}

function updateDirtyChrome(): void {
  const openDocument = state.document;
  if (!openDocument) return;
  const label = openDocument.readOnly ? 'Read only' : openDocument.dirty ? 'Unsaved' : 'Saved';
  const indicator = document.querySelector<HTMLElement>('.dirty-indicator');
  indicator?.replaceChildren(document.createTextNode(label));
  indicator?.setAttribute('data-state', openDocument.readOnly ? 'read-only' : openDocument.dirty ? 'dirty' : 'clean');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (openDocument.dirty && !openDocument.readOnly) {
    saveButton?.removeAttribute('disabled');
  } else {
    saveButton?.setAttribute('disabled', '');
  }
  document.querySelector('.status-bar')?.replaceChildren(document.createTextNode(state.status));
}

async function saveCurrentDocument(): Promise<void> {
  await runBusy('Saving...', async () => {
    if (!state.document?.mounted) return;
    if (state.document.readOnly) {
      state.status = 'The HVY guide is read-only';
      rerender();
      return;
    }
    if (state.document.isNew || !state.document.path) {
      await performSaveCurrentDocumentAs();
      return;
    }
    const bytes = Array.from(serializeMountedDocument(state.document.mounted));
    await saveDocumentFile({ path: state.document.path, bytes });
    markMountedDocumentSaved(state.document.mounted);
    state.document.dirty = false;
    state.status = `Saved ${state.document.name}`;
    const document = state.document.mounted.document;
    updateCurrentDocumentSession(document);
    await refreshOpenWorkspaceForFile(state.document.path);
    await refreshRecents();
    rerender();
    await mountCurrentDocument(document);
  });
}

async function saveCurrentDocumentAs(): Promise<void> {
  await runBusy('Saving as...', async () => {
    await performSaveCurrentDocumentAs();
  });
}

async function performSaveCurrentDocumentAs(): Promise<void> {
  if (!state.document?.mounted) return;
  if (state.document.readOnly) {
    state.status = 'The HVY guide is read-only';
    rerender();
    return;
  }
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const previousPath = state.document.path;
  const previousMode = state.document.mode;
  const file = await saveDocumentAsDialog({ suggestedName: state.document.name, bytes });
  if (!file) return;
  const document = await deserializeHvy(new Uint8Array(file.bytes), file.extension);
  if (previousPath && previousPath !== file.path) {
    documentSessions.delete(previousPath);
  }
  state.document = {
    path: file.path,
    name: file.name,
    extension: file.extension,
    mode: previousMode,
    dirty: false,
    readOnly: false,
    isNew: false,
    mounted: null,
  };
  updateCurrentDocumentSession(document);
  state.selectedFilePath = file.path;
  state.status = `Saved ${file.name}`;
  await refreshOpenWorkspaceForFile(file.path);
  await refreshRecents();
  rerender();
  await mountCurrentDocument(document);
}

function startBackupTimer(): void {
  if (backupTimer !== null || !isTauriRuntime()) return;
  backupTimer = window.setInterval(() => {
    void backupActiveDocument();
  }, BACKUP_INTERVAL_MS);
}

async function backupActiveDocument(options: { force?: boolean } = {}): Promise<void> {
  if (!state.document?.mounted || state.document.readOnly) return;
  if (!state.document.dirty) return;
  const bytes = Array.from(serializeMountedDocument(state.document.mounted));
  const documentKey = backupDocumentKey(state.document.path, state.document.name);
  const bytesKey = backupBytesKey(bytes);
  const previousBackup = backupSnapshots.get(documentKey);
  const now = Date.now();
  if (previousBackup?.bytesKey === bytesKey) return;
  if (previousBackup && now - previousBackup.createdAtMs < MIN_BACKUP_SPACING_MS) return;
  try {
    const backup = await createDocumentBackup({
      documentPath: state.document.path,
      name: state.document.name,
      extension: state.document.extension,
      bytes,
    });
    if (backup) {
      backupSnapshots.set(documentKey, { bytesKey, createdAtMs: Date.parse(backup.createdAt) || now });
    }
  } catch (error) {
    if (options.force) {
      throw error;
    }
    // Keep timed backups quiet; explicit recovery will surface failures.
  }
}

function backupDocumentKey(path: string, name: string): string {
  return path || `untitled:${name}`;
}

function backupBytesKey(bytes: number[]): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length}:${hash >>> 0}`;
}

async function openRecoveryDialog(): Promise<void> {
  if (state.busy) return;
  const document = state.document?.mounted?.document;
  state.busy = true;
  state.error = null;
  state.status = 'Loading backups...';
  try {
    try {
      await backupActiveDocument({ force: true });
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    state.recoveryBackups = await listDocumentBackups();
    state.recoveryDialogOpen = true;
    state.status = state.recoveryBackups.length > 0 ? 'Loaded backups' : 'No backups available';
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = 'Ready';
  } finally {
    state.busy = false;
    rerender();
    await mountCurrentDocument(document);
  }
}

async function createBlankDocument(): Promise<void> {
  await runBusy('Creating blank document...', async () => {
    const bytes = Array.from(new TextEncoder().encode(defaultHvyDocument()));
    await openDocument({
      path: '',
      name: 'Untitled.hvy',
      extension: '.hvy',
      bytes,
    }, { isNew: true, deferMount: true });
  });
}

async function refreshOpenWorkspaceForFile(filePath: string): Promise<void> {
  const workspace = state.workspaces.find((candidate) => filePath.startsWith(candidate.path));
  if (!workspace) return;
  upsertWorkspace(await loadWorkspace(workspace.path));
}

function upsertWorkspace(workspace: Awaited<ReturnType<typeof loadWorkspace>>): void {
  const index = state.workspaces.findIndex((candidate) => candidate.path === workspace.path);
  if (index >= 0) {
    state.workspaces[index] = workspace;
  } else {
    state.workspaces.push(workspace);
  }
  sortWorkspaces();
}

function sortWorkspaces(): void {
  state.workspaces.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function hasOpenWorkspaceNamed(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return state.workspaces.some((workspace) => workspace.manifest.name.trim().toLowerCase() === normalized);
}

function rerender(options: { preserveMountedDocument?: boolean } = {}): void {
  const preserveMount = options.preserveMountedDocument ? mountRoot : null;
  if (!options.preserveMountedDocument) {
    state.document?.mounted?.mount.destroy();
    if (state.document) {
      state.document.mounted = null;
    }
  }
  mountRoot = render(state, handlers, { preserveMount });
}

async function runBusy(label: string, task: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  const document = state.document?.mounted?.document;
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
    pendingMountDocument = null;
    rerender();
    await mountCurrentDocument(documentToMount);
  }
}

function defaultHvyDocument(title = 'Untitled'): string {
  return `---
hvy_version: 0.1
title: ${JSON.stringify(title)}
---
`;
}

function documentFileName(name: string, template: HvyTemplate): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return hasDocumentExtension(trimmed) ? trimmed : `${trimmed}${template.extension}`;
}

function documentTitle(fileName: string): string {
  return fileName.replace(/\.(t?hvy)$/i, '');
}

function hasDocumentExtension(fileName: string): boolean {
  return /\.(t?hvy)$/i.test(fileName);
}

function applyTemplateTitle(template: string, title: string): string {
  return template.replace(/^title:.*$/m, `title: ${JSON.stringify(title)}`);
}

function documentStorageKey(identifier: string): string {
  return `hvy-workspace:document:${identifier}`;
}

function closeUiBeforeAiSettings(): void {
  state.newWorkspaceDialogOpen = false;
  state.newDocumentWorkspacePath = null;
  state.recoveryDialogOpen = false;
  state.recoveryBackups = [];
  state.openWorkspaceActionsPath = null;
  closeMountedTransientUi();
}

function closeMountedTransientUi(): void {
  const root = mountRoot;
  if (!root) return;
  root
    .querySelector<HTMLElement>('[data-action="close-search"], [data-action="close-ai-edit"], [data-modal-action="close"]')
    ?.click();
  if (root.querySelector('.search-palette, .search-backdrop, .modal-root, .ai-edit-popover')) {
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
}

function cloneAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return JSON.parse(JSON.stringify(settings)) as typeof state.aiSettings;
}

function confirmDiscardAiSettings(settings: typeof state.aiSettings | undefined): boolean {
  const initial = state.aiSettingsDialogInitialJson;
  if (!initial) return true;
  const current = JSON.stringify(canonicalAiSettings(settings ?? state.aiSettingsDraft ?? state.aiSettings));
  if (current === initial) return true;
  return window.confirm('Discard changes to AI settings?');
}

function canonicalAiSettings(settings: typeof state.aiSettings): typeof state.aiSettings {
  return {
    activeProviderId: settings.activeProviderId,
    providers: [...settings.providers].sort((left, right) => left.provider.localeCompare(right.provider)),
    actions: {
      chat: settings.actions.chat,
      edit: settings.actions.edit,
      importPlanning: settings.actions.importPlanning,
      importWriting: settings.actions.importWriting,
      importCleanup: settings.actions.importCleanup,
      compaction: settings.actions.compaction,
    },
  };
}

async function confirmWorkspaceInitialization(path: string, defaultName: string) {
  const shouldInitialize = window.confirm(
    `"${defaultName}" is not an HVY workspace yet. Create .hvyworkspace.json in this folder?`
  );
  return shouldInitialize ? initializeWorkspacePath(path) : null;
}

async function createWorkspaceInChosenFolder() {
  const candidate = await chooseWorkspaceFolder();
  if (!candidate) return null;
  if (candidate.hasManifest) {
    return loadWorkspace(candidate.path);
  }
  return initializeWorkspacePath(candidate.path);
}

function setupErrorSurface(): void {
  window.addEventListener('error', (event) => {
    showStartupError(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    showStartupError(event.reason);
  });
}

function showStartupError(error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
  state.status = 'Startup error';
  mountRoot = render(state, handlers);
}
