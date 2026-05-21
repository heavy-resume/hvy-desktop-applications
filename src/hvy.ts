import {
  builtInPlugins,
  deserializeDocumentBytes,
  mountHvy,
  mountHvyViewer,
  type HvyMount,
} from 'heavy-file-format-ref-impl/embed';
import type { DocumentExtension } from './backend';

export type HvyMode = 'viewer' | 'editor';
type VisualDocument = ReturnType<typeof deserializeDocumentBytes>;

export interface MountedDocument {
  mount: HvyMount;
  document: VisualDocument;
}

export function deserializeHvy(bytes: Uint8Array, extension: DocumentExtension): VisualDocument {
  return deserializeDocumentBytes(bytes, extension);
}

export function mountHvyDocument(root: HTMLElement, document: VisualDocument, mode: HvyMode): MountedDocument {
  root.replaceChildren();
  root.classList.add('hvy-document-host');
  const mount = mode === 'viewer'
    ? mountHvyViewer({ root, document, plugins: builtInPlugins, controls: false })
    : mountHvy({ root, document, mode: 'editor', plugins: builtInPlugins, controls: false });
  return { mount, document };
}

export function serializeMountedDocument(mounted: MountedDocument): Uint8Array {
  return mounted.mount.serializeDocumentBytes();
}
