import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type DocumentExtension = '.hvy' | '.thvy' | '.md';

export interface WorkspaceManifest {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootFiles?: string[];
  expandedPaths?: string[];
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  relativePath: string;
  extension: DocumentExtension;
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

export interface WorkspaceOpenCandidate {
  path: string;
  hasManifest: boolean;
  defaultName: string;
}

export interface RecentState {
  workspaces: string[];
  files: string[];
}

export interface DocumentFile {
  path: string;
  name: string;
  extension: DocumentExtension;
  bytes: number[];
}

export interface SaveDocumentRequest {
  path: string;
  bytes: number[];
}

export interface SaveDocumentAsRequest {
  suggestedName: string;
  bytes: number[];
}

export interface CreateDocumentRequest {
  workspacePath: string;
  relativePath: string;
  template: string;
}

export interface DocumentBackupRequest {
  documentPath: string;
  name: string;
  extension: DocumentExtension;
  bytes: number[];
}

export interface DocumentBackup {
  id: string;
  documentPath: string;
  name: string;
  extension: DocumentExtension;
  createdAt: string;
}

export type AiActionKey = 'chat' | 'edit' | 'importPlanning' | 'importWriting' | 'importCleanup' | 'compaction';

export interface AiProviderConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
}

export interface AiActionConfig {
  providerId: string;
  model: string;
}

export type AiActionSettings = Record<AiActionKey, AiActionConfig>;

export interface AiSettings {
  activeProviderId: string;
  providers: AiProviderConfig[];
  actions: AiActionSettings;
}


export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error(`Desktop command unavailable in browser: ${command}`));
  }
  return invoke<T>(command, args);
}

export function loadRecentState(): Promise<RecentState> {
  if (!isTauriRuntime()) {
    return Promise.resolve({ workspaces: [], files: [] });
  }
  return invokeDesktop('load_recent_state');
}

export function loadAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime()) {
    return Promise.resolve(defaultAiSettings());
  }
  return invokeDesktop('load_ai_settings');
}

export function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  return invokeDesktop('save_ai_settings', { settings });
}

export function defaultAiSettings(): AiSettings {
  const provider = defaultAiProviderConfig();
  return {
    activeProviderId: provider.provider,
    providers: [provider],
    actions: defaultAiActionSettings(),
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
    chat: { providerId, model: 'gpt-5.4-nano' },
    edit: { providerId, model: 'gpt-5.4-mini' },
    importPlanning: { providerId, model: 'gpt-5.4-mini' },
    importWriting: { providerId, model: 'gpt-5.4-mini' },
    importCleanup: { providerId, model: 'gpt-5.4-mini' },
    compaction: { providerId, model: 'gpt-5.4-nano' },
  };
}

export function loadDefaultGuide(): Promise<DocumentFile> {
  return invokeDesktop('load_default_guide');
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

export function loadWorkspace(path: string): Promise<Workspace> {
  return invokeDesktop('load_workspace', { path });
}

export function addFilesToWorkspace(workspacePath: string): Promise<Workspace | null> {
  return invokeDesktop('add_files_to_workspace', { workspacePath });
}

export function openFileDialog(): Promise<DocumentFile | null> {
  return invokeDesktop('open_file_dialog');
}

export function readDocumentFile(path: string): Promise<DocumentFile> {
  return invokeDesktop('read_document_file', { path });
}

export function saveDocumentFile(request: SaveDocumentRequest): Promise<void> {
  return invokeDesktop('save_document_file', { path: request.path, bytes: request.bytes });
}

export function saveDocumentAsDialog(request: SaveDocumentAsRequest): Promise<DocumentFile | null> {
  return invokeDesktop('save_document_as_dialog', { suggestedName: request.suggestedName, bytes: request.bytes });
}

export function createDocumentFile(request: CreateDocumentRequest): Promise<DocumentFile> {
  return invokeDesktop('create_document_file', {
    workspacePath: request.workspacePath,
    relativePath: request.relativePath,
    template: request.template,
  });
}

export function createDocumentBackup(request: DocumentBackupRequest): Promise<DocumentBackup | null> {
  return invokeDesktop('create_document_backup', { request });
}

export function listDocumentBackups(): Promise<DocumentBackup[]> {
  if (!isTauriRuntime()) {
    return Promise.resolve([]);
  }
  return invokeDesktop('list_document_backups');
}

export function restoreDocumentBackup(id: string): Promise<DocumentFile> {
  return invokeDesktop('restore_document_backup', { id });
}

export function openExternalUrl(url: string): Promise<void> {
  return invokeDesktop('open_external_url', { url });
}

export function onMenuEvent(handler: (event: string) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    void handler;
    return Promise.resolve(() => undefined);
  }
  return listen<string>('menu-event', (event) => handler(event.payload));
}
