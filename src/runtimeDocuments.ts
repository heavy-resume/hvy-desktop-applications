import { documentFileChanges } from './documentFileChanges';
import type { DocumentExtension, DocumentFileMetadata } from './backend';

declare const fileKeyBrand: unique symbol;

/**
 * A file's reference: what holds a file in memory holds this, not its path, so a rename or move (which updates the
 * reference's path here, once) needs nothing else changed. Paths are written only where state is saved or loaded.
 */
export type FileKey = string & { readonly [fileKeyBrand]: true };

/** No file: what a setting is kept under when no document is open, which keeps nothing. */
export const NO_FILE = '' as FileKey;

export interface RuntimeDocument {
  documentId: FileKey;
  workingVersionId: string;
  path: string;
  name: string;
  extension: DocumentExtension;
}

const documentsById = new Map<string, RuntimeDocument>();
const documentIdsByPath = new Map<string, FileKey>();

export function runtimeDocumentForFile(
  file: DocumentFileMetadata,
  options: { distinct?: boolean } = {},
): RuntimeDocument {
  const existingId = options.distinct ? null : documentIdsByPath.get(file.path);
  const existing = existingId ? documentsById.get(existingId) : null;
  if (existing) return existing;
  const document: RuntimeDocument = {
    documentId: crypto.randomUUID() as FileKey,
    workingVersionId: crypto.randomUUID(),
    path: file.path,
    name: file.name,
    extension: file.extension,
  };
  documentsById.set(document.documentId, document);
  if (file.path) documentIdsByPath.set(file.path, document.documentId);
  return document;
}

export function runtimeDocumentById(documentId: string): RuntimeDocument | null {
  return documentsById.get(documentId) ?? null;
}

/** The reference for the file at a path, made when nothing held it yet (as when settings saved by path are loaded). */
export function fileKeyForPath(path: string): FileKey {
  const existing = documentIdsByPath.get(path);
  if (existing) return existing;
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return runtimeDocumentForFile({ path, name, extension: (dot >= 0 ? name.slice(dot) : '') as DocumentExtension }).documentId;
}

/** Where a referenced file is now. */
export function pathForFileKey(key: FileKey): string {
  return documentsById.get(key)?.path ?? '';
}

export function runtimeDocumentAtPath(path: string): RuntimeDocument | null {
  const documentId = documentIdsByPath.get(path);
  return documentId ? documentsById.get(documentId) ?? null : null;
}

export function updateRuntimeDocumentFile(document: RuntimeDocument, file: DocumentFileMetadata): void {
  if (document.path) documentIdsByPath.delete(document.path);
  documentFileChanges.relocate(document.path, file.path);
  document.path = file.path;
  document.name = file.name;
  document.extension = file.extension;
  if (file.path) documentIdsByPath.set(file.path, document.documentId);
}

export function removeRuntimeDocument(document: RuntimeDocument): void {
  documentsById.delete(document.documentId);
  if (document.path) documentIdsByPath.delete(document.path);
}

export function resetRuntimeDocuments(): void {
  documentsById.clear();
  documentIdsByPath.clear();
}
