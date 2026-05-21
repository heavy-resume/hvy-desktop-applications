import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type DocumentExtension = '.hvy' | '.thvy' | '.md';

export interface GalaxyManifest {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootFiles?: string[];
  expandedPaths?: string[];
}

export interface GalaxyFileNode {
  name: string;
  path: string;
  relativePath: string;
  extension: DocumentExtension;
}

export interface GalaxyFolderNode {
  name: string;
  path: string;
  relativePath: string;
  children: GalaxyTreeNode[];
}

export type GalaxyTreeNode =
  | ({ kind: 'folder' } & GalaxyFolderNode)
  | ({ kind: 'file' } & GalaxyFileNode);

export interface Galaxy {
  path: string;
  manifest: GalaxyManifest;
  files: GalaxyTreeNode[];
}

export interface GalaxyOpenCandidate {
  path: string;
  hasManifest: boolean;
  defaultName: string;
}

export interface RecentState {
  galaxies: string[];
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
  galaxyPath: string;
  relativePath: string;
  template: string;
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
    return Promise.resolve({ galaxies: [], files: [] });
  }
  return invokeDesktop('load_recent_state');
}

export function loadDefaultGuide(): Promise<DocumentFile> {
  return invokeDesktop('load_default_guide');
}

export function openGalaxyDialog(): Promise<Galaxy | null> {
  return invokeDesktop('open_galaxy_dialog');
}

export function chooseGalaxyFolder(): Promise<GalaxyOpenCandidate | null> {
  return invokeDesktop('choose_galaxy_folder');
}

export function newGalaxyDialog(): Promise<Galaxy | null> {
  return invokeDesktop('new_galaxy_dialog');
}

export function initializeGalaxyPath(path: string): Promise<Galaxy> {
  return invokeDesktop('initialize_galaxy_path', { path });
}

export function loadGalaxy(path: string): Promise<Galaxy> {
  return invokeDesktop('load_galaxy', { path });
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
    galaxyPath: request.galaxyPath,
    relativePath: request.relativePath,
    template: request.template,
  });
}

export function onMenuEvent(handler: (event: string) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    void handler;
    return Promise.resolve(() => undefined);
  }
  return listen<string>('menu-event', (event) => handler(event.payload));
}
