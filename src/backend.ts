import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { measureDebugAsync } from './debugLog';

declare global {
  interface Window {
    hvyElectron?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      onMenuEvent(callback: (event: string) => void): () => void;
      onOpenDocumentPath(callback: (path: string) => void): () => void;
      onAppCloseRequest(callback: () => void): () => void;
    };
  }
}

export type DocumentExtension = '.hvy' | '.thvy' | '.phvy' | '.md';
export type TemplateExtension = '.thvy' | '.phvy';
export type DocumentCreationType = 'hvy' | 'thvy' | 'phvy';
export type WorkspaceTemplateVisibilityKey = 'hvyDocuments' | 'thvyTemplates' | 'phvyTemplates' | 'archivedFiles';

export interface WorkspaceTemplateVisibility {
  hvyDocuments: boolean;
  thvyTemplates: boolean;
  phvyTemplates: boolean;
  archivedFiles: boolean;
}

export interface WorkspaceManifest {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootFiles?: string[];
  expandedPaths?: string[];
  templateVisibility?: WorkspaceTemplateVisibility;
  archivedFiles?: string[];
  lockedFiles?: string[];
  hiddenFromAIFiles?: string[];
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  relativePath: string;
  extension: DocumentExtension;
  archived?: boolean;
  locked?: boolean;
  hiddenFromAI?: boolean;
}

export interface WorkspaceFolderNode {
  name: string;
  path: string;
  relativePath: string;
  children: WorkspaceTreeNode[];
}

export type WorkspaceTreeNode =
  | ({ kind: 'folder' } & WorkspaceFolderNode)
  | ({ kind: 'file' } & WorkspaceFileNode);

export interface Workspace {
  path: string;
  manifest: WorkspaceManifest;
  files: WorkspaceTreeNode[];
}

export interface AddFilesResult {
  workspace: Workspace;
  copiedPaths: string[];
  copiedTemplatePaths?: string[];
}

export interface DroppedWorkspaceFile {
  name: string;
  bytes: number[];
}

export interface WorkspaceOpenCandidate {
  path: string;
  hasManifest: boolean;
  defaultName: string;
}

export interface RecentState {
  workspaces: string[];
  files: string[];
  documentModes?: Record<string, string>;
}

export interface ArchivedWorkspace {
  path: string;
  name: string;
  archivedAt: string;
}

export interface DocumentFile {
  path: string;
  name: string;
  extension: DocumentExtension;
  bytes: number[] | Uint8Array;
  locked?: boolean;
  hiddenFromAI?: boolean;
  recoveryState?: string | null;
}

export type DocumentFileMetadata = Omit<DocumentFile, 'bytes'>;
type BufferJson = { type: 'Buffer'; data: number[] };
type RecoveryDraftRecord = {
  id: string;
  documentPath: string;
  name: string;
  extension: DocumentExtension;
  createdAt: string;
  bytes: Blob;
  recoveryState?: string | null;
};

export interface ImportSourceFile {
  path: string;
  name: string;
  extension: DocumentExtension | '.txt' | '.pdf' | '.docx';
  text?: string;
  bytes?: number[] | Uint8Array;
}

export type TemplateScope = 'app' | 'workspace';

export interface SavedTemplate {
  id: string;
  path: string;
  name: string;
  scope: TemplateScope;
  extension: TemplateExtension;
  bytes: number[];
}

export interface SaveDocumentRequest {
  path: string;
  bytes: number[] | Uint8Array;
}

export interface DocumentWriteResult {
  debugTimings?: Record<string, number>;
}

export interface SaveDocumentAsRequest {
  suggestedName: string;
  bytes: number[] | Uint8Array;
}

export interface SavePdfAsRequest {
  suggestedName: string;
  bytes: number[];
}

export interface ThemeFile {
  path: string;
  name: string;
  bytes: number[];
}

export interface SaveThemeAsRequest {
  suggestedName: string;
  bytes: number[];
}

export interface FileMenuState {
  closeDocument: boolean;
  save: boolean;
  saveAs: boolean;
  saveToWorkspace: boolean;
  exportPdf: boolean;
  importCurrent: boolean;
}

export interface CreateDocumentRequest {
  workspacePath: string;
  relativePath: string;
  template: string;
}

export interface RenameDocumentRequest {
  path: string;
  name: string;
}

export interface WorkspaceDocumentRequest {
  workspacePath: string;
  name: string;
  bytes: number[] | Uint8Array;
}

export interface WorkspaceDocumentMoveRequest {
  path: string;
  workspacePath: string;
}

export interface SystemFileClipboardRequest {
  paths: string[];
  operation: 'copy' | 'cut';
}

export interface DocumentBackupRequest {
  documentPath: string;
  name: string;
  extension: DocumentExtension;
  bytes: number[] | Uint8Array;
  recoveryState?: string | null;
}

export interface DocumentRecoveryDraftRequest {
  documentPath: string;
  name: string;
}

export interface SaveDocumentTemplateRequest {
  scope: TemplateScope;
  workspacePath?: string | null;
  name: string;
  extension: TemplateExtension;
  bytes: number[];
}

export interface DocumentBackup {
  id: string;
  documentPath: string;
  name: string;
  extension: DocumentExtension;
  createdAt: string;
  debugTimings?: Record<string, number>;
}

const RECOVERY_DRAFT_DB_NAME = 'hvy-galaxy-recovery-drafts';
const RECOVERY_DRAFT_STORE = 'drafts';
const RECOVERY_DRAFT_ID_PREFIX = 'idb-';
const RECOVERY_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let recoveryDraftDbPromise: Promise<IDBDatabase> | null = null;

export type McpWriteAccess = 'searchOnly' | 'hvyCliEdits' | 'createImportSave';

export interface McpSettings {
  startAutomatically: boolean;
  port: number | null;
  writeAccess: McpWriteAccess;
  bearerToken: string;
}

export interface McpServerStatus {
  running: boolean;
  url: string | null;
  message: string;
  lastError: string | null;
}

export interface McpStdioLaunchConfig {
  command: string;
  args: string[];
  workingDirectory: string;
}

export type McpClientInstallTarget = 'codex' | 'claude';

export interface McpClientInstallStatus {
  target: McpClientInstallTarget;
  label: string;
  configPath: string;
  configExists: boolean;
  executableExists: boolean;
  installed: boolean;
  backupCount: number;
  latestBackupPath: string | null;
  latestBackupLabel: string | null;
  message: string;
}

export type AiActionKey = 'chat' | 'edit' | 'importPlanning' | 'importWriting' | 'importCleanup' | 'semanticFilter' | 'compaction';

export interface AiProviderConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
}

export interface AiActionConfig {
  providerId: string;
  model: string;
  modelsByProvider?: Record<string, string>;
}

export type AiActionSettings = Record<AiActionKey, AiActionConfig>;

export interface AiSettings {
  activeProviderId: string;
  providers: AiProviderConfig[];
  actions: AiActionSettings;
  maxContextChars: number;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hvyElectron);
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isElectronRuntime()) {
    return window.hvyElectron!.invoke<T>(command, args);
  }
  if (!isTauriRuntime()) {
    return Promise.reject(new Error(`Desktop command unavailable in browser: ${command}`));
  }
  return invoke<T>(command, args);
}

function normalizeDesktopBytes(bytes: ArrayBuffer | Uint8Array | number[] | BufferJson): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (isBufferJson(bytes)) {
    return new Uint8Array(bytes.data);
  }
  return new Uint8Array(bytes);
}

function toUint8Array(bytes: number[] | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function isBufferJson(value: unknown): value is BufferJson {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as BufferJson).type === 'Buffer'
    && Array.isArray((value as BufferJson).data)
  );
}

function normalizeDocumentFileBytes(file: DocumentFile): DocumentFile {
  return {
    ...file,
    bytes: normalizeDesktopBytes(file.bytes),
  };
}

export function loadRecentState(): Promise<RecentState> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve({ workspaces: [], files: [] });
  }
  return invokeDesktop('load_recent_state');
}

export function saveDocumentModePreference(path: string, mode: string): Promise<RecentState> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve({ workspaces: [], files: [], documentModes: { [path]: mode } });
  }
  return invokeDesktop('save_document_mode_preference', { path, mode });
}

export function loadAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve(defaultAiSettings());
  }
  return invokeDesktop('load_ai_settings');
}

export function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  return invokeDesktop('save_ai_settings', { settings });
}

export function loadMcpSettings(): Promise<McpSettings> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve(defaultMcpSettings());
  }
  return invokeDesktop('load_mcp_settings');
}

export function saveMcpSettings(settings: McpSettings): Promise<McpSettings> {
  return invokeDesktop('save_mcp_settings', { settings });
}

export function loadMcpServerStatus(): Promise<McpServerStatus> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve(defaultMcpServerStatus());
  }
  return invokeDesktop('load_mcp_server_status');
}

export function loadMcpStdioLaunchConfig(): Promise<McpStdioLaunchConfig> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve(defaultMcpStdioLaunchConfig());
  }
  return invokeDesktop('load_mcp_stdio_launch_config');
}

export function loadMcpClientInstallStatus(): Promise<McpClientInstallStatus[]> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve(defaultMcpClientInstallStatus());
  }
  return invokeDesktop('load_mcp_client_install_status');
}

export function installMcpClient(target: McpClientInstallTarget): Promise<McpClientInstallStatus[]> {
  return invokeDesktop('install_mcp_client', { target });
}

export function removeMcpClient(target: McpClientInstallTarget): Promise<McpClientInstallStatus[]> {
  return invokeDesktop('remove_mcp_client', { target });
}

export function restoreMcpClientBackup(target: McpClientInstallTarget): Promise<McpClientInstallStatus[]> {
  return invokeDesktop('restore_mcp_client_backup', { target });
}

export function startMcpServer(): Promise<McpServerStatus> {
  return invokeDesktop('start_mcp_server');
}

export function stopMcpServer(): Promise<McpServerStatus> {
  return invokeDesktop('stop_mcp_server');
}

export function updateMcpWorkspaces(paths: string[]): Promise<void> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve();
  }
  return invokeDesktop('update_mcp_workspaces', { paths });
}

export function defaultAiSettings(): AiSettings {
  const provider = defaultAiProviderConfig();
  return {
    activeProviderId: provider.provider,
    providers: [provider],
    actions: defaultAiActionSettings(),
    maxContextChars: 40_000,
  };
}

export function defaultMcpSettings(): McpSettings {
  return {
    startAutomatically: false,
    port: 8794,
    writeAccess: 'hvyCliEdits',
    bearerToken: generateMcpBearerToken(),
  };
}

export function defaultMcpStdioLaunchConfig(): McpStdioLaunchConfig {
  return {
    command: '/path/to/HVY Galaxy',
    args: ['--mcp-stdio'],
    workingDirectory: '/path/to/hvy-galaxy-mcp',
  };
}

export function defaultMcpClientInstallStatus(): McpClientInstallStatus[] {
  return [
    {
      target: 'codex',
      label: 'Codex',
      configPath: '~/.codex/config.toml',
      configExists: false,
      executableExists: false,
      installed: false,
      backupCount: 0,
      latestBackupPath: null,
      latestBackupLabel: null,
      message: 'Codex config file was not found.',
    },
    {
      target: 'claude',
      label: 'Claude',
      configPath: 'Claude/claude_desktop_config.json',
      configExists: false,
      executableExists: false,
      installed: false,
      backupCount: 0,
      latestBackupPath: null,
      latestBackupLabel: null,
      message: 'Claude config file was not found.',
    },
  ];
}

export function generateMcpBearerToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function defaultMcpServerStatus(): McpServerStatus {
  return {
    running: false,
    url: null,
    message: 'MCP server is stopped.',
    lastError: null,
  };
}

export function defaultAiProviderConfig(): AiProviderConfig {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
  };
}

export function defaultAiActionSettings(providerId = 'default'): AiActionSettings {
  return {
    chat: { providerId, model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
    edit: { providerId, model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
    importPlanning: { providerId, model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
    importWriting: { providerId, model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
    importCleanup: { providerId, model: 'gpt-5.4-mini', modelsByProvider: { openai: 'gpt-5.4-mini' } },
    semanticFilter: { providerId, model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
    compaction: { providerId, model: 'gpt-5.4-nano', modelsByProvider: { openai: 'gpt-5.4-nano' } },
  };
}

export function loadDefaultGuide(): Promise<DocumentFile> {
  return invokeDesktop<DocumentFile>('load_default_guide').then(normalizeDocumentFileBytes);
}

export function loadHvyGuide(): Promise<DocumentFile> {
  return invokeDesktop<DocumentFile>('load_hvy_guide').then(normalizeDocumentFileBytes);
}

export function openWorkspaceDialog(): Promise<Workspace | null> {
  return invokeDesktop('open_workspace_dialog');
}

export function chooseWorkspaceFolder(): Promise<WorkspaceOpenCandidate | null> {
  return invokeDesktop('choose_workspace_folder');
}

export function createWorkspace(name: string): Promise<Workspace> {
  return invokeDesktop('create_workspace', { name });
}

export function newWorkspaceDialog(): Promise<Workspace | null> {
  return invokeDesktop('new_workspace_dialog');
}

export function initializeWorkspacePath(path: string): Promise<Workspace> {
  return invokeDesktop('initialize_workspace_path', { path });
}

export function loadWorkspace(path: string, options: { includeTemplates?: boolean } = {}): Promise<Workspace> {
  return invokeDesktop('load_workspace', { path, includeTemplates: options.includeTemplates === true });
}

export function loadArchivedWorkspaces(): Promise<ArchivedWorkspace[]> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve([]);
  }
  return invokeDesktop('load_archived_workspaces');
}

export function renameWorkspace(path: string, name: string): Promise<Workspace> {
  return invokeDesktop('rename_workspace', { path, name });
}

export function archiveWorkspace(path: string): Promise<void> {
  return invokeDesktop('archive_workspace', { path });
}

export function unarchiveWorkspace(path: string): Promise<Workspace> {
  return invokeDesktop('unarchive_workspace', { path });
}

export function addFilesToWorkspace(workspacePath: string): Promise<AddFilesResult | null> {
  return invokeDesktop('add_files_to_workspace', { workspacePath });
}

export function addDroppedFilesToWorkspace(workspacePath: string, files: DroppedWorkspaceFile[]): Promise<AddFilesResult> {
  return invokeDesktop('add_dropped_files_to_workspace', { workspacePath, files });
}

export function openFileDialog(): Promise<DocumentFile | null> {
  return measureDebugAsync('load', 'backend:openFileDialog', undefined, async () => {
    const file = await invokeDesktop<DocumentFile | null>('open_file_dialog');
    return file ? normalizeDocumentFileBytes(file) : null;
  });
}

export function openImportSourceDialog(): Promise<ImportSourceFile | null> {
  return invokeDesktop('open_import_source_dialog');
}

export function readDocumentFile(path: string): Promise<DocumentFile> {
  return measureDebugAsync('load', 'backend:readDocumentFile', { path }, async () => {
    if (isTauriRuntime() || isElectronRuntime()) {
      const metadata = await invokeDesktop<DocumentFileMetadata>('read_document_file_metadata', { path });
      const bytes = await measureDebugAsync('load', 'backend:readDocumentFileBytes', { path }, () =>
        invokeDesktop<ArrayBuffer | Uint8Array | number[] | BufferJson>('read_document_file_bytes', { path }));
      return {
        ...metadata,
        bytes: normalizeDesktopBytes(bytes),
      };
    }
    return normalizeDocumentFileBytes(await invokeDesktop('read_document_file', { path }));
  });
}

export function saveDocumentFile(request: SaveDocumentRequest): Promise<DocumentWriteResult | void> {
  if (isTauriRuntime()) {
    return invoke<DocumentWriteResult>('save_document_file_raw', toUint8Array(request.bytes), {
      headers: { 'x-hvy-document-path': encodeURIComponent(request.path) },
    });
  }
  return invokeDesktop('save_document_file', { path: request.path, bytes: request.bytes });
}

export function saveDocumentAsDialog(request: SaveDocumentAsRequest): Promise<DocumentFileMetadata | null> {
  if (isTauriRuntime()) {
    return invoke<DocumentFileMetadata | null>('save_document_as_dialog_raw', toUint8Array(request.bytes), {
      headers: { 'x-hvy-suggested-name': encodeURIComponent(request.suggestedName) },
    });
  }
  return invokeDesktop('save_document_as_dialog', { suggestedName: request.suggestedName, bytes: request.bytes });
}

export function savePdfAsDialog(request: SavePdfAsRequest): Promise<string | null> {
  return invokeDesktop('save_pdf_as_dialog', { suggestedName: request.suggestedName, bytes: request.bytes });
}

export function listSavedTemplates(workspacePath?: string | null): Promise<SavedTemplate[]> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve([]);
  }
  return invokeDesktop('list_saved_templates', { workspacePath: workspacePath ?? null });
}

export function saveDocumentTemplate(request: SaveDocumentTemplateRequest): Promise<SavedTemplate> {
  return invokeDesktop('save_document_template', { request });
}

export function updateWorkspaceTemplateVisibility(
  workspacePath: string,
  templateVisibility: WorkspaceTemplateVisibility,
): Promise<Workspace> {
  return invokeDesktop('update_workspace_template_visibility', { workspacePath, templateVisibility });
}

export function updateWorkspaceFileAiAccess(
  path: string,
  updates: { locked?: boolean; hiddenFromAI?: boolean },
): Promise<Workspace> {
  return invokeDesktop('update_workspace_file_ai_access', { path, updates });
}

export function openColorThemeDialog(): Promise<ThemeFile | null> {
  return invokeDesktop('open_color_theme_dialog');
}

export function saveColorThemeAsDialog(request: SaveThemeAsRequest): Promise<ThemeFile | null> {
  return invokeDesktop('save_color_theme_as_dialog', { suggestedName: request.suggestedName, bytes: request.bytes });
}

export function updateFileMenuState(state: FileMenuState): Promise<void> {
  return invokeDesktop('update_file_menu_state', { state });
}

export function createDocumentFile(request: CreateDocumentRequest): Promise<DocumentFile> {
  return invokeDesktop('create_document_file', {
    workspacePath: request.workspacePath,
    relativePath: request.relativePath,
    template: request.template,
  });
}

export function revealDocumentFile(path: string): Promise<void> {
  return invokeDesktop('reveal_document_file', { path });
}

export function openDocumentFile(path: string): Promise<void> {
  return invokeDesktop('open_document_file', { path });
}

export function loadLaunchDocumentPaths(): Promise<string[]> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve([]);
  }
  return invokeDesktop('load_launch_document_paths');
}

export function renameDocumentFile(request: RenameDocumentRequest): Promise<DocumentFile> {
  return invokeDesktop('rename_document_file', { path: request.path, name: request.name });
}

export function archiveDocumentFile(path: string): Promise<Workspace> {
  return invokeDesktop('archive_document_file', { path });
}

export function restoreDocumentFile(path: string): Promise<Workspace> {
  return invokeDesktop('restore_document_file', { path });
}

export function deleteDocumentFile(path: string): Promise<Workspace | null> {
  return invokeDesktop('delete_document_file', { path });
}

export function saveDocumentToWorkspace(request: WorkspaceDocumentRequest): Promise<DocumentFile> {
  return invokeDesktop('save_document_to_workspace', {
    workspacePath: request.workspacePath,
    name: request.name,
    bytes: request.bytes,
  });
}

export function copyDocumentToWorkspace(request: WorkspaceDocumentMoveRequest): Promise<DocumentFile> {
  return invokeDesktop('copy_document_to_workspace', { path: request.path, workspacePath: request.workspacePath });
}

export function moveDocumentToWorkspace(request: WorkspaceDocumentMoveRequest): Promise<DocumentFile> {
  return invokeDesktop('move_document_to_workspace', { path: request.path, workspacePath: request.workspacePath });
}

export function writeSystemFileClipboard(request: SystemFileClipboardRequest): Promise<void> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return Promise.resolve();
  }
  return invokeDesktop('write_system_file_clipboard', { request });
}

export function pasteSystemFilesToWorkspace(workspacePath: string): Promise<AddFilesResult> {
  return invokeDesktop('paste_system_files_to_workspace', { workspacePath });
}

export async function createDocumentBackup(request: DocumentBackupRequest): Promise<DocumentBackup | null> {
  if (!canUseRecoveryDraftDb()) {
    return invokeDesktop('create_document_backup', { request });
  }
  const startedAt = performance.now();
  await pruneIndexedRecoveryDrafts();
  const createdAt = new Date().toISOString();
  const id = `${RECOVERY_DRAFT_ID_PREFIX}${createdAt.replace(/[^a-zA-Z0-9]/g, '-')}-${Math.random().toString(36).slice(2, 10)}`;
  const bytes = request.bytes instanceof Uint8Array ? request.bytes : new Uint8Array(request.bytes);
  const record: RecoveryDraftRecord = {
    id,
    documentPath: request.documentPath,
    name: request.name,
    extension: request.extension,
    createdAt,
    bytes: new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
    recoveryState: request.recoveryState ?? null,
  };
  const putStartedAt = performance.now();
  await recoveryDraftStoreRequest('readwrite', (store) => store.put(record));
  const putMs = roundDebugDuration(performance.now() - putStartedAt);
  return {
    id,
    documentPath: request.documentPath,
    name: request.name,
    extension: request.extension,
    createdAt,
    debugTimings: {
      indexedDbPutMs: putMs,
      totalMs: roundDebugDuration(performance.now() - startedAt),
    },
  };
}

export async function listDocumentBackups(): Promise<DocumentBackup[]> {
  const indexedBackups = canUseRecoveryDraftDb() ? await listIndexedRecoveryDrafts() : [];
  if (!isTauriRuntime() && !isElectronRuntime()) {
    return indexedBackups;
  }
  const nativeBackups = await invokeDesktop<DocumentBackup[]>('list_document_backups');
  return [...indexedBackups, ...nativeBackups]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function restoreDocumentBackup(id: string): Promise<DocumentFile> {
  if (id.startsWith(RECOVERY_DRAFT_ID_PREFIX) && canUseRecoveryDraftDb()) {
    return restoreIndexedRecoveryDraft(id);
  }
  return invokeDesktop('restore_document_backup', { id });
}

export async function discardDocumentBackup(id: string): Promise<void> {
  if (id.startsWith(RECOVERY_DRAFT_ID_PREFIX) && canUseRecoveryDraftDb()) {
    await deleteIndexedRecoveryDraft(id);
    return;
  }
  if (isTauriRuntime() || isElectronRuntime()) {
    await invokeDesktop('discard_document_backup', { id });
  }
}

export async function clearDocumentRecoveryDrafts(request: DocumentRecoveryDraftRequest): Promise<void> {
  if (canUseRecoveryDraftDb()) {
    await clearIndexedRecoveryDrafts(request);
  }
  if (isTauriRuntime() || isElectronRuntime()) {
    await invokeDesktop('clear_document_recovery_drafts', { request });
  }
}

function canUseRecoveryDraftDb(): boolean {
  return typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined';
}

function openRecoveryDraftDb(): Promise<IDBDatabase> {
  recoveryDraftDbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(RECOVERY_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECOVERY_DRAFT_STORE)) {
        const store = db.createObjectStore(RECOVERY_DRAFT_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('documentKey', ['documentPath', 'name']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open recovery draft store.'));
  });
  return recoveryDraftDbPromise;
}

async function recoveryDraftStoreRequest<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openRecoveryDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECOVERY_DRAFT_STORE, mode);
    const request = callback(transaction.objectStore(RECOVERY_DRAFT_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Recovery draft store request failed.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Recovery draft store transaction failed.'));
  });
}

async function listIndexedRecoveryDrafts(): Promise<DocumentBackup[]> {
  await pruneIndexedRecoveryDrafts();
  const records = await recoveryDraftStoreRequest<RecoveryDraftRecord[]>('readonly', (store) => store.getAll());
  const latestByDocument = new Map<string, RecoveryDraftRecord>();
  for (const record of records) {
    const key = recoveryDraftDocumentKey(record.documentPath, record.name);
    const previous = latestByDocument.get(key);
    if (!previous || record.createdAt > previous.createdAt) {
      latestByDocument.set(key, record);
    }
  }
  return [...latestByDocument.values()].map(indexedRecoveryDraftMetadata);
}

async function restoreIndexedRecoveryDraft(id: string): Promise<DocumentFile> {
  const record = await recoveryDraftStoreRequest<RecoveryDraftRecord | undefined>('readonly', (store) => store.get(id));
  if (!record) throw new Error('Recovery draft was not found.');
  return {
    path: record.documentPath,
    name: record.name,
    extension: record.extension,
    bytes: new Uint8Array(await record.bytes.arrayBuffer()),
    recoveryState: record.recoveryState ?? null,
  };
}

async function deleteIndexedRecoveryDraft(id: string): Promise<void> {
  await recoveryDraftStoreRequest('readwrite', (store) => store.delete(id));
}

async function clearIndexedRecoveryDrafts(request: DocumentRecoveryDraftRequest): Promise<void> {
  const records = await recoveryDraftStoreRequest<RecoveryDraftRecord[]>('readonly', (store) => store.getAll());
  const key = recoveryDraftDocumentKey(request.documentPath, request.name);
  await Promise.all(records
    .filter((record) => recoveryDraftDocumentKey(record.documentPath, record.name) === key)
    .map((record) => deleteIndexedRecoveryDraft(record.id)));
}

async function pruneIndexedRecoveryDrafts(): Promise<void> {
  const cutoff = Date.now() - RECOVERY_DRAFT_RETENTION_MS;
  const records = await recoveryDraftStoreRequest<RecoveryDraftRecord[]>('readonly', (store) => store.getAll());
  await Promise.all(records
    .filter((record) => {
      const createdAt = Date.parse(record.createdAt);
      return !Number.isFinite(createdAt) || createdAt < cutoff;
    })
    .map((record) => deleteIndexedRecoveryDraft(record.id)));
}

function indexedRecoveryDraftMetadata(record: RecoveryDraftRecord): DocumentBackup {
  return {
    id: record.id,
    documentPath: record.documentPath,
    name: record.name,
    extension: record.extension,
    createdAt: record.createdAt,
  };
}

function recoveryDraftDocumentKey(documentPath: string, name: string): string {
  return documentPath || `untitled:${name}`;
}

function roundDebugDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

export function openExternalUrl(url: string): Promise<void> {
  return invokeDesktop('open_external_url', { url });
}

export function requestAppClose(): Promise<void> {
  if (!isTauriRuntime() && !isElectronRuntime()) {
    window.close();
    return Promise.resolve();
  }
  return invokeDesktop('close_app_window');
}

export async function onAppCloseRequest(handler: () => void): Promise<() => void> {
  if (isElectronRuntime()) {
    return window.hvyElectron!.onAppCloseRequest(handler);
  }
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    handler();
  });
}

export function onMenuEvent(handler: (event: string) => void): Promise<() => void> {
  if (isElectronRuntime()) {
    return Promise.resolve(window.hvyElectron!.onMenuEvent(handler));
  }
  if (!isTauriRuntime()) {
    void handler;
    return Promise.resolve(() => undefined);
  }
  return listen<string>('menu-event', (event) => handler(event.payload));
}

export function onOpenDocumentPath(handler: (path: string) => void): Promise<() => void> {
  if (isElectronRuntime()) {
    return Promise.resolve(window.hvyElectron!.onOpenDocumentPath(handler));
  }
  if (!isTauriRuntime()) {
    void handler;
    return Promise.resolve(() => undefined);
  }
  return listen<string>('open-document-path', (event) => handler(event.payload));
}
