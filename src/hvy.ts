import type { DocumentExtension } from './backend';

export type HvyMode = 'viewer' | 'editor';
type HvyEmbedModule = typeof import('../../heavy-file-format/src/embed');
type HvyMount = ReturnType<HvyEmbedModule['mountHvy']>;
type VisualDocument = ReturnType<HvyEmbedModule['deserializeDocumentBytes']>;
type HvyDocumentChangeCallback = NonNullable<Parameters<HvyEmbedModule['mountHvy']>[0]['onDocumentChange']>;

export interface MountedDocument {
  mount: HvyMount;
  document: VisualDocument;
}

export interface MountHvyDocumentOptions {
  onDocumentChange?: HvyDocumentChangeCallback;
}

let hvyEmbedModule: Promise<HvyEmbedModule> | null = null;

function loadHvyEmbed(): Promise<HvyEmbedModule> {
  hvyEmbedModule ??= import('../../heavy-file-format/src/embed');
  return hvyEmbedModule;
}

export async function deserializeHvy(bytes: Uint8Array, extension: DocumentExtension): Promise<VisualDocument> {
  const { deserializeDocumentBytes } = await loadHvyEmbed();
  return deserializeDocumentBytes(bytes, extension);
}

export async function mountHvyDocument(
  root: HTMLElement,
  document: VisualDocument,
  mode: HvyMode,
  options: MountHvyDocumentOptions = {},
): Promise<MountedDocument> {
  const { builtInPlugins, mountHvy, mountHvyViewer } = await loadHvyEmbed();
  root.replaceChildren();
  root.classList.add('hvy-document-host');
  const mount = mode === 'viewer'
    ? mountHvyViewer({ root, document, plugins: builtInPlugins, controls: false, onDocumentChange: options.onDocumentChange })
    : mountHvy({ root, document, mode: 'editor', plugins: builtInPlugins, controls: false, onDocumentChange: options.onDocumentChange });
  return { mount, document };
}

export function serializeMountedDocument(mounted: MountedDocument): Uint8Array {
  return mounted.mount.serializeDocumentBytes();
}

export function markMountedDocumentSaved(mounted: MountedDocument): void {
  mounted.mount.markSaved();
}

export function isMountedDocumentDirty(mounted: MountedDocument): boolean {
  return mounted.mount.isDirty();
}
