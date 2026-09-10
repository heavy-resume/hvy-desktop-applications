import type { DocumentExtension, DocumentFileMetadata } from './backend';

export interface RuntimeDocument {
  documentId: string;
  workingVersionId: string;
  path: string;
  name: string;
  extension: DocumentExtension;
}

const documentsById = new Map<string, RuntimeDocument>();
const documentIdsByPath = new Map<string, string>();

export function runtimeDocumentForFile(
  file: DocumentFileMetadata,
  options: { distinct?: boolean } = {},
): RuntimeDocument {
  const existingId = options.distinct ? null : documentIdsByPath.get(file.path);
  const existing = existingId ? documentsById.get(existingId) : null;
  if (existing) return existing;
  const document: RuntimeDocument = {
    documentId: crypto.randomUUID(),
    workingVersionId: crypto.randomUUID(),
    path: file.path,
    name: file.name,
    extension: file.extension,
  };
  documentsById.set(document.documentId, document);
  if (file.path) documentIdsByPath.set(file.path, document.documentId);
  return document;
}

export function runtimeDocumentAtPath(path: string): RuntimeDocument | null {
  const documentId = documentIdsByPath.get(path);
  return documentId ? documentsById.get(documentId) ?? null : null;
}

export function updateRuntimeDocumentFile(document: RuntimeDocument, file: DocumentFileMetadata): void {
  if (document.path) documentIdsByPath.delete(document.path);
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
