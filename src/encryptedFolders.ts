import type { Workspace, WorkspaceFolderNode, WorkspaceTreeNode } from './backend';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes } from '../../heavy-file-format/src/encryption';

export const ENCRYPTED_FOLDER_MANIFEST_FILE = '.hvy-folder';
export const ENCRYPTED_FOLDER_FORMAT_VERSION = 1;

export type EncryptedFolderDocumentExtension = '.hvy' | '.phvy';

export interface EncryptedFolderEntry {
  name: string;
  kind: 'document' | 'folder';
  documentExtension?: EncryptedFolderDocumentExtension;
}

export interface EncryptedFolderManifest {
  version: 1;
  folderId: string;
  name: string;
  entries: Record<string, EncryptedFolderEntry>;
}

export interface EncryptedFolderEnvelope {
  hvy_encrypted_folder: 1;
  algorithm: 'AES-256-GCM';
  keyId: string;
  folderId: string;
  nonce: string;
  ciphertext: string;
}

export interface EncryptedFolderDocumentMutation {
  documentId: string;
  documentBytes: Uint8Array;
  previousManifestBytes: Uint8Array;
  manifestBytes: Uint8Array;
}

export interface EncryptedFolderChildMutation {
  childFolderId: string;
  childManifestBytes: Uint8Array;
  previousManifestBytes: Uint8Array;
  manifestBytes: Uint8Array;
}

export interface EncryptedFolderManifestMutation {
  previousManifestBytes: Uint8Array;
  manifestBytes: Uint8Array;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptFolderManifest(
  manifest: EncryptedFolderManifest,
  keyId: string,
  fernetKey: string,
): Promise<Uint8Array> {
  const normalized = normalizeFolderManifest(manifest);
  validateUuid(keyId, 'folder key ID');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await importFolderKey(fernetKey, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: toArrayBuffer(nonce),
    additionalData: toArrayBuffer(folderManifestAad(keyId, normalized.folderId)),
  }, key, toArrayBuffer(encoder.encode(JSON.stringify(normalized))));
  const envelope: EncryptedFolderEnvelope = {
    hvy_encrypted_folder: 1,
    algorithm: 'AES-256-GCM',
    keyId,
    folderId: normalized.folderId,
    nonce: base64UrlEncode(nonce),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
  return encoder.encode(`${JSON.stringify(envelope, null, 2)}\n`);
}

export async function decryptFolderManifest(bytes: Uint8Array, fernetKey: string): Promise<EncryptedFolderManifest> {
  const envelope = parseFolderEnvelope(bytes);
  const nonce = base64UrlDecode(envelope.nonce);
  if (nonce.length !== 12) throw new Error('Encrypted folder manifest nonce must be 12 bytes.');
  const ciphertext = base64UrlDecode(envelope.ciphertext);
  const key = await importFolderKey(fernetKey, ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(folderManifestAad(envelope.keyId, envelope.folderId)),
    }, key, toArrayBuffer(ciphertext));
  } catch {
    throw new Error('Could not decrypt or authenticate the encrypted folder manifest.');
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error('The encrypted folder manifest payload is not valid JSON.');
  }
  const manifest = normalizeFolderManifest(value);
  if (manifest.folderId !== envelope.folderId) throw new Error('Encrypted folder identity does not match its envelope.');
  return manifest;
}

export function parseFolderEnvelope(bytes: Uint8Array): EncryptedFolderEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error('The encrypted folder envelope is not valid JSON.');
  }
  if (!isRecord(value)
    || value.hvy_encrypted_folder !== 1
    || value.algorithm !== 'AES-256-GCM'
    || typeof value.keyId !== 'string'
    || typeof value.folderId !== 'string'
    || typeof value.nonce !== 'string'
    || typeof value.ciphertext !== 'string') {
    throw new Error('This is not a supported encrypted folder manifest.');
  }
  validateUuid(value.keyId, 'folder key ID');
  validateUuid(value.folderId, 'folder ID');
  return {
    hvy_encrypted_folder: 1,
    algorithm: 'AES-256-GCM',
    keyId: value.keyId,
    folderId: value.folderId,
    nonce: value.nonce,
    ciphertext: value.ciphertext,
  };
}

export function normalizeFolderManifest(value: unknown): EncryptedFolderManifest {
  if (!isRecord(value) || value.version !== 1 || typeof value.folderId !== 'string' || typeof value.name !== 'string' || !isRecord(value.entries)) {
    throw new Error('The encrypted folder manifest payload is invalid.');
  }
  validateUuid(value.folderId, 'folder ID');
  const name = normalizeLogicalName(value.name);
  const entries: Record<string, EncryptedFolderEntry> = {};
  for (const [entryId, rawEntry] of Object.entries(value.entries)) {
    validateUuid(entryId, 'entry ID');
    if (!isRecord(rawEntry) || typeof rawEntry.name !== 'string' || (rawEntry.kind !== 'document' && rawEntry.kind !== 'folder')) {
      throw new Error(`Encrypted folder entry ${entryId} is invalid.`);
    }
    const name = normalizeLogicalName(rawEntry.name);
    if (Object.values(entries).some((entry) => entry.name.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase())) {
      throw new Error(`Encrypted folder contains a duplicate logical name: ${name}.`);
    }
    if (rawEntry.kind === 'document') {
      if (rawEntry.documentExtension !== '.hvy' && rawEntry.documentExtension !== '.phvy') {
        throw new Error(`Encrypted folder document ${entryId} has an unsupported extension.`);
      }
      entries[entryId] = { name, kind: 'document', documentExtension: rawEntry.documentExtension };
    } else {
      entries[entryId] = { name, kind: 'folder' };
    }
  }
  return { version: 1, folderId: value.folderId, name, entries };
}

export async function resolveEncryptedWorkspace(
  workspace: Workspace,
  loadKeys: (keyIds: string[]) => Promise<Record<string, string>>,
): Promise<Workspace> {
  const keyIds = new Set<string>();
  const envelopes = new Map<string, EncryptedFolderEnvelope>();
  const collect = (nodes: WorkspaceTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (node.encryptedFolderManifest) {
        try {
          const envelope = parseFolderEnvelope(Uint8Array.from(node.encryptedFolderManifest));
          envelopes.set(node.path, envelope);
          keyIds.add(envelope.keyId);
        } catch {
          // The resolver marks malformed envelopes invalid without failing the workspace.
        }
      }
      collect(node.children);
    }
  };
  collect(workspace.files);
  const keys = keyIds.size > 0 ? await loadKeys([...keyIds]) : {};
  const files = await Promise.all(workspace.files.map((node) => resolveWorkspaceNode(node, envelopes, keys, null)));
  return { ...workspace, files };
}

export function findEncryptedFolder(
  workspace: Workspace | null | undefined,
  relativePath: string,
): WorkspaceFolderNode | null {
  const target = normalizeRelativePath(relativePath);
  const visit = (nodes: WorkspaceTreeNode[]): WorkspaceFolderNode | null => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (normalizeRelativePath(node.relativePath) === target && node.encryptionState) return node;
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return workspace ? visit(workspace.files) : null;
}

export async function prepareEncryptedFolderDocumentMutation(
  folder: WorkspaceFolderNode,
  logicalName: string,
  extension: EncryptedFolderDocumentExtension,
  plaintextBytes: Uint8Array,
  keyring: Record<string, string>,
): Promise<EncryptedFolderDocumentMutation> {
  if (folder.encryptionState !== 'unlocked' || !folder.encryptedFolderManifest || !folder.encryptedFolderKeyId) {
    throw new Error('Encrypted folder is not unlocked.');
  }
  const previousManifestBytes = Uint8Array.from(folder.encryptedFolderManifest);
  const envelope = parseFolderEnvelope(previousManifestBytes);
  if (envelope.keyId !== folder.encryptedFolderKeyId) throw new Error('Encrypted folder key identity is inconsistent.');
  const key = keyring[envelope.keyId];
  if (!key) throw new Error(`Missing Fernet key for encrypted folder: ${envelope.keyId}`);
  const manifest = await decryptFolderManifest(previousManifestBytes, key);
  const name = normalizeLogicalName(logicalName);
  if (!name.toLowerCase().endsWith(extension)) throw new Error(`Encrypted folder document name must end in ${extension}.`);
  const documentId = crypto.randomUUID();
  const nextManifest = normalizeFolderManifest({
    ...manifest,
    entries: {
      ...manifest.entries,
      [documentId]: { name, kind: 'document', documentExtension: extension },
    },
  });
  const documentBytes = (await encryptDocumentBytes(plaintextBytes, { keyId: envelope.keyId, key })).bytes;
  const manifestBytes = await encryptFolderManifest(nextManifest, envelope.keyId, key);
  return { documentId, documentBytes, previousManifestBytes, manifestBytes };
}

export async function prepareEncryptedFolderImportedDocumentMutation(
  folder: WorkspaceFolderNode,
  logicalName: string,
  extension: EncryptedFolderDocumentExtension,
  sourceBytes: Uint8Array,
  keyring: Record<string, string>,
): Promise<EncryptedFolderDocumentMutation> {
  const plaintext = await decryptDocumentEnvelopeBytes(sourceBytes, { keyring });
  return prepareEncryptedFolderDocumentMutation(folder, logicalName, extension, plaintext.bytes, keyring);
}

export async function prepareEncryptedFolderChildMutation(
  folder: WorkspaceFolderNode,
  logicalName: string,
  keyring: Record<string, string>,
): Promise<EncryptedFolderChildMutation> {
  if (folder.encryptionState !== 'unlocked' || !folder.encryptedFolderManifest || !folder.encryptedFolderKeyId) {
    throw new Error('Encrypted folder is not unlocked.');
  }
  const previousManifestBytes = Uint8Array.from(folder.encryptedFolderManifest);
  const envelope = parseFolderEnvelope(previousManifestBytes);
  if (envelope.keyId !== folder.encryptedFolderKeyId) throw new Error('Encrypted folder key identity is inconsistent.');
  const key = keyring[envelope.keyId];
  if (!key) throw new Error(`Missing Fernet key for encrypted folder: ${envelope.keyId}`);
  const manifest = await decryptFolderManifest(previousManifestBytes, key);
  const name = normalizeLogicalName(logicalName);
  const childFolderId = crypto.randomUUID();
  const nextManifest = normalizeFolderManifest({
    ...manifest,
    entries: { ...manifest.entries, [childFolderId]: { name, kind: 'folder' } },
  });
  const childManifestBytes = await encryptFolderManifest({
    version: 1,
    folderId: childFolderId,
    name,
    entries: {},
  }, envelope.keyId, key);
  const manifestBytes = await encryptFolderManifest(nextManifest, envelope.keyId, key);
  return { childFolderId, childManifestBytes, previousManifestBytes, manifestBytes };
}

export async function prepareEncryptedFolderEntryRename(
  folder: WorkspaceFolderNode,
  entryId: string,
  logicalName: string,
  keyring: Record<string, string>,
): Promise<EncryptedFolderManifestMutation> {
  if (folder.encryptionState !== 'unlocked' || !folder.encryptedFolderManifest || !folder.encryptedFolderKeyId) {
    throw new Error('Encrypted folder is not unlocked.');
  }
  validateUuid(entryId, 'entry ID');
  const previousManifestBytes = Uint8Array.from(folder.encryptedFolderManifest);
  const envelope = parseFolderEnvelope(previousManifestBytes);
  if (envelope.keyId !== folder.encryptedFolderKeyId) throw new Error('Encrypted folder key identity is inconsistent.');
  const key = keyring[envelope.keyId];
  if (!key) throw new Error(`Missing Fernet key for encrypted folder: ${envelope.keyId}`);
  const manifest = await decryptFolderManifest(previousManifestBytes, key);
  const entry = manifest.entries[entryId];
  if (!entry) throw new Error('Encrypted folder entry was not found in its manifest.');
  const name = normalizeLogicalName(logicalName);
  const nextManifest = normalizeFolderManifest({
    ...manifest,
    entries: { ...manifest.entries, [entryId]: { ...entry, name } },
  });
  return {
    previousManifestBytes,
    manifestBytes: await encryptFolderManifest(nextManifest, envelope.keyId, key),
  };
}

export async function prepareEncryptedFolderEntryRemoval(
  folder: WorkspaceFolderNode,
  entryId: string,
  keyring: Record<string, string>,
): Promise<EncryptedFolderManifestMutation> {
  if (folder.encryptionState !== 'unlocked' || !folder.encryptedFolderManifest || !folder.encryptedFolderKeyId) {
    throw new Error('Encrypted folder is not unlocked.');
  }
  validateUuid(entryId, 'entry ID');
  const previousManifestBytes = Uint8Array.from(folder.encryptedFolderManifest);
  const envelope = parseFolderEnvelope(previousManifestBytes);
  const key = keyring[envelope.keyId];
  if (!key) throw new Error(`Missing Fernet key for encrypted folder: ${envelope.keyId}`);
  const manifest = await decryptFolderManifest(previousManifestBytes, key);
  if (!manifest.entries[entryId]) throw new Error('Encrypted folder entry was not found in its manifest.');
  const entries = { ...manifest.entries };
  delete entries[entryId];
  return {
    previousManifestBytes,
    manifestBytes: await encryptFolderManifest({ ...manifest, entries }, envelope.keyId, key),
  };
}

export async function prepareEncryptedFolderSelfRename(
  folder: WorkspaceFolderNode,
  logicalName: string,
  keyring: Record<string, string>,
): Promise<EncryptedFolderManifestMutation> {
  if (folder.encryptionState !== 'unlocked' || !folder.encryptedFolderManifest || !folder.encryptedFolderKeyId) {
    throw new Error('Encrypted folder is not unlocked.');
  }
  const previousManifestBytes = Uint8Array.from(folder.encryptedFolderManifest);
  const envelope = parseFolderEnvelope(previousManifestBytes);
  if (envelope.keyId !== folder.encryptedFolderKeyId) throw new Error('Encrypted folder key identity is inconsistent.');
  const key = keyring[envelope.keyId];
  if (!key) throw new Error(`Missing Fernet key for encrypted folder: ${envelope.keyId}`);
  const manifest = await decryptFolderManifest(previousManifestBytes, key);
  const nextManifest = normalizeFolderManifest({ ...manifest, name: normalizeLogicalName(logicalName) });
  return {
    previousManifestBytes,
    manifestBytes: await encryptFolderManifest(nextManifest, envelope.keyId, key),
  };
}

async function resolveWorkspaceNode(
  node: WorkspaceTreeNode,
  envelopes: Map<string, EncryptedFolderEnvelope>,
  keys: Record<string, string>,
  expectedKeyId: string | null,
): Promise<WorkspaceTreeNode> {
  if (node.kind === 'file') return node;
  if (!node.encryptedFolderManifest) {
    return { ...node, children: await Promise.all(node.children.map((child) => resolveWorkspaceNode(child, envelopes, keys, expectedKeyId))) };
  }
  const envelope = envelopes.get(node.path);
  if (!envelope || (expectedKeyId && envelope.keyId !== expectedKeyId)) {
    return encryptedFolderState(node, null, 'invalid');
  }
  const key = keys[envelope.keyId];
  if (!key) return encryptedFolderState(node, envelope, 'missingKey');
  let manifest: EncryptedFolderManifest;
  try {
    manifest = await decryptFolderManifest(Uint8Array.from(node.encryptedFolderManifest), key);
  } catch {
    return encryptedFolderState(node, envelope, 'invalid');
  }

  const physicalById = new Map(node.children.map((child) => [physicalEntryId(child), child]));
  const children: WorkspaceTreeNode[] = [];
  const issues: string[] = [];
  for (const [entryId, entry] of Object.entries(manifest.entries)) {
    const physical = physicalById.get(entryId);
    const kindMatches = physical && (
      (entry.kind === 'document' && physical.kind === 'file')
      || (entry.kind === 'folder' && physical.kind === 'folder')
    );
    if (!physical || !kindMatches) {
      issues.push(`Missing physical entry ${entryId}`);
      continue;
    }
    if (entry.kind === 'document' && physical.kind === 'file') {
      children.push({
        ...physical,
        name: entry.name,
        extension: entry.documentExtension!,
        encryptedFolderKeyId: envelope.keyId,
      });
      continue;
    }
    if (entry.kind === 'folder' && physical.kind === 'folder') {
      if (!physical.encryptedFolderManifest) {
        issues.push(`Folder entry ${entryId} has no encrypted manifest`);
        children.push({
          ...physical,
          name: entry.name,
          children: [],
          encryptedFolderKeyId: envelope.keyId,
          encryptionState: 'incomplete',
        });
        continue;
      }
      const resolved = await resolveWorkspaceNode(physical, envelopes, keys, envelope.keyId) as WorkspaceFolderNode & { kind: 'folder' };
      children.push({ ...resolved, name: entry.name });
    }
  }
  for (const entryId of physicalById.keys()) {
    if (!manifest.entries[entryId]) issues.push(`Unknown physical entry ${entryId}`);
  }
  children.sort((left, right) => left.name.localeCompare(right.name));
  return {
    ...node,
    name: manifest.name,
    children,
    encryptedFolderKeyId: envelope.keyId,
    encryptionState: issues.length > 0 ? 'incomplete' : 'unlocked',
    ...(issues.length > 0 ? { encryptedFolderIssues: issues } : {}),
  };
}

function encryptedFolderState(
  node: WorkspaceFolderNode & { kind: 'folder' },
  envelope: EncryptedFolderEnvelope | null,
  encryptionState: 'missingKey' | 'invalid',
): WorkspaceTreeNode {
  return {
    ...node,
    name: envelope ? `Encrypted folder · ${envelope.folderId.slice(0, 8)}` : 'Invalid encrypted folder',
    children: [],
    ...(envelope ? { encryptedFolderKeyId: envelope.keyId } : {}),
    encryptionState,
  };
}

function physicalEntryId(node: WorkspaceTreeNode): string {
  if (node.kind === 'folder') return node.name;
  return node.name.slice(0, Math.max(0, node.name.length - node.extension.length));
}

function normalizeLogicalName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Encrypted folder logical names must be non-empty single path components.');
  }
  return name;
}

function folderManifestAad(keyId: string, folderId: string): Uint8Array {
  return encoder.encode(`hvy-galaxy-encrypted-folder-v1:${keyId}:${folderId}`);
}

async function importFolderKey(fernetKey: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const bytes = base64UrlDecode(fernetKey);
  if (bytes.length !== 32) throw new Error('An encrypted folder key must be Fernet key material encoding exactly 32 bytes.');
  return crypto.subtle.importKey('raw', toArrayBuffer(bytes), 'AES-GCM', false, usages);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('Encrypted folder manifest contains invalid base64 data.');
  }
}

function validateUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`Invalid encrypted ${label}: ${value || '(missing)'}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}
