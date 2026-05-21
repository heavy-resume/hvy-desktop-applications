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

export function loadRecentState(): Promise<RecentState> {
  return invoke('load_recent_state');
}

export function openGalaxyDialog(): Promise<Galaxy | null> {
  return invoke('open_galaxy_dialog');
}

export function chooseGalaxyFolder(): Promise<GalaxyOpenCandidate | null> {
  return invoke('choose_galaxy_folder');
}

export function newGalaxyDialog(): Promise<Galaxy | null> {
  return invoke('new_galaxy_dialog');
}

export function initializeGalaxyPath(path: string): Promise<Galaxy> {
  return invoke('initialize_galaxy_path', { path });
}

export function loadGalaxy(path: string): Promise<Galaxy> {
  return invoke('load_galaxy', { path });
}

export function openFileDialog(): Promise<DocumentFile | null> {
  return invoke('open_file_dialog');
}

export function readDocumentFile(path: string): Promise<DocumentFile> {
  return invoke('read_document_file', { path });
}

export function saveDocumentFile(request: SaveDocumentRequest): Promise<void> {
  return invoke('save_document_file', { path: request.path, bytes: request.bytes });
}

export function saveDocumentAsDialog(request: SaveDocumentAsRequest): Promise<DocumentFile | null> {
  return invoke('save_document_as_dialog', { suggestedName: request.suggestedName, bytes: request.bytes });
}

export function createDocumentFile(request: CreateDocumentRequest): Promise<DocumentFile> {
  return invoke('create_document_file', {
    galaxyPath: request.galaxyPath,
    relativePath: request.relativePath,
    template: request.template,
  });
}

export function onMenuEvent(handler: (event: string) => void): Promise<() => void> {
  return listen<string>('menu-event', (event) => handler(event.payload));
}
