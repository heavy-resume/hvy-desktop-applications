import * as Automerge from '@automerge/automerge';
import { deserializeDocument, serializeDocument } from '../../heavy-file-format/src/serialization';
import { ensureDocumentAttachmentStore } from '../../heavy-file-format/src/attachment-store';
import type { VisualDocument } from '../../heavy-file-format/src/types';
import { serializeHvy } from './hvy';
import {
  createRevisionDocument,
  createSavedVersion,
  revisionAtSavedVersion,
  saveRevisionDocument,
  updateRevisionSnapshot,
  type RevisionAttachmentRef,
  type RevisionAuthor,
  type RevisionDoc,
  type SavedVersion,
} from './revisionModel';

const DB_NAME = 'hvy-galaxy-document-history';
const DB_VERSION = 1;
const HISTORY_STORE = 'histories';
const OBJECT_STORE = 'objects';

interface HistoryRecord {
  path: string;
  name: string;
  documentBytes: Blob;
  versions: SavedVersion[];
}

interface ObjectRecord {
  id: string;
  bytes: Blob;
}

const documentQueues = new Map<string, Promise<void>>();

export function initializeDocumentHistory(path: string, name: string, document: VisualDocument): void {
  if (!path || document.encryption?.encrypted === true || !canUseDocumentHistory()) return;
  queueMicrotask(() => {
    const snapshot = captureDocumentSnapshot(document);
    enqueueHistoryWork(path, () => recordVersion(path, name, snapshot));
  });
}

export function recordSuccessfulDocumentSave(path: string, name: string, document: VisualDocument): void {
  if (!path || document.encryption?.encrypted === true || !canUseDocumentHistory()) return;
  queueMicrotask(() => {
    const snapshot = captureDocumentSnapshot(document);
    enqueueHistoryWork(path, () => recordVersion(path, name, snapshot));
  });
}

export async function listSavedDocumentVersions(path: string): Promise<SavedVersion[]> {
  await documentQueues.get(path);
  const record = await readHistoryRecord(path);
  return [...(record?.versions ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function materializeSavedDocumentVersion(path: string, versionId: string): Promise<Uint8Array> {
  await documentQueues.get(path);
  const record = await readHistoryRecord(path);
  if (!record) throw new Error('Document history was not found.');
  const version = record.versions.find((candidate) => candidate.id === versionId);
  if (!version) throw new Error('The selected document version was not found.');
  const revision = await readRevisionDocument(record.documentBytes);
  const historical = revisionAtSavedVersion(revision, version);
  const document = deserializeDocument(historical.serializedSource, historical.extension);
  const attachments = await Promise.all(Object.values(historical.attachments).map(async (attachment) => ({
    id: attachment.id,
    meta: attachment.meta,
    bytes: await readObjectBytes(attachment.objectId),
  })));
  ensureDocumentAttachmentStore(document).replace(attachments);
  document.attachments = attachments;
  return serializeHvy(document);
}

export function defaultRevisionAuthor(): RevisionAuthor {
  const userId = persistentIdentity('hvy-revision-user-id', 'user');
  const deviceId = persistentIdentity('hvy-revision-device-id', 'device');
  return { userId, deviceId, displayName: 'Local User' };
}

function enqueueHistoryWork(path: string, work: () => Promise<void>): void {
  const previous = documentQueues.get(path) ?? Promise.resolve();
  const next = previous.then(work).catch((error) => {
    console.error('Document history persistence failed.', error);
  }).finally(() => {
    if (documentQueues.get(path) === next) documentQueues.delete(path);
  });
  documentQueues.set(path, next);
}

function captureDocumentSnapshot(document: VisualDocument): VisualDocument {
  const snapshot = deserializeDocument(serializeDocument(document), document.extension);
  const attachments = ensureDocumentAttachmentStore(document).list();
  ensureDocumentAttachmentStore(snapshot).replace(attachments);
  snapshot.attachments = attachments;
  return snapshot;
}

async function recordVersion(path: string, name: string, document: VisualDocument): Promise<void> {
  const author = defaultRevisionAuthor();
  const attachmentRefs = await persistAttachments(document);
  const serializedSource = serializeDocument(document);
  const existing = await readHistoryRecord(path);
  let revision: RevisionDoc;
  let versions = existing?.versions ?? [];
  if (existing) {
    revision = await readRevisionDocument(existing.documentBytes);
    revision = updateRevisionSnapshot(revision, author, serializedSource, attachmentRefs);
  } else {
    revision = createRevisionDocument(document, author, attachmentRefs, serializedSource);
  }
  const version = createSavedVersion(revision, path, author);
  if (!versions.some((candidate) => candidate.id === version.id)) {
    versions = [...versions, version];
  }
  await writeHistoryRecord({
    path,
    name,
    documentBytes: new Blob([saveRevisionDocument(revision) as unknown as BlobPart]),
    versions,
  });
}

async function persistAttachments(document: VisualDocument): Promise<RevisionAttachmentRef[]> {
  const attachments = ensureDocumentAttachmentStore(document).list();
  return Promise.all(attachments.map(async (attachment) => {
    const objectId = await sha256(attachment.bytes);
    await writeObject({ id: objectId, bytes: new Blob([attachment.bytes as unknown as BlobPart]) });
    return {
      id: attachment.id,
      objectId,
      byteLength: attachment.bytes.length,
      meta: attachment.meta,
    };
  }));
}

async function readRevisionDocument(bytes: Blob): Promise<RevisionDoc> {
  return Automerge.load(new Uint8Array(await bytes.arrayBuffer()));
}

async function readHistoryRecord(path: string): Promise<HistoryRecord | null> {
  const record = await requestFromStore<HistoryRecord | undefined>(HISTORY_STORE, 'readonly', (store) => store.get(path));
  return record ?? null;
}

async function writeHistoryRecord(record: HistoryRecord): Promise<void> {
  await requestFromStore(HISTORY_STORE, 'readwrite', (store) => store.put(record));
}

async function writeObject(record: ObjectRecord): Promise<void> {
  const existing = await requestFromStore<ObjectRecord | undefined>(OBJECT_STORE, 'readonly', (store) => store.get(record.id));
  if (!existing) await requestFromStore(OBJECT_STORE, 'readwrite', (store) => store.put(record));
}

async function readObjectBytes(id: string): Promise<Uint8Array> {
  const record = await requestFromStore<ObjectRecord | undefined>(OBJECT_STORE, 'readonly', (store) => store.get(id));
  if (!record) throw new Error(`History attachment object ${id} was not found.`);
  return new Uint8Array(await record.bytes.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function persistentIdentity(key: string, prefix: string): string {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `${prefix}-${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}

function canUseDocumentHistory(): boolean {
  return typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestFromStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  requestFactory: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = requestFactory(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}
