import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { deleteDocumentKey, loadedDocumentKeys, loadDocumentKeys, storeDocumentKeys, tryLoadDocumentKeys, type DocumentKeyFileSource, type StoredDocumentKeyInput } from './backend';

export const HVY_KEY_FILE_VERSION = 1;
export const HVY_KEY_FILE_EXTENSION = '.hvykey';

export interface PortableDocumentKey {
  keyId: string;
  algorithm: 'fernet';
  key: string;
  label?: string;
  createdAt?: string;
}

export interface PortableDocumentKeyFile {
  hvy_key_file: 1;
  label?: string;
  keys: PortableDocumentKey[];
}

export interface ReviewedDocumentKey extends PortableDocumentKey {
  sourceName: string;
  bundleLabel?: string;
  fingerprint: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inMemoryKeyring = loadedDocumentKeys();
const pendingGeneratedKeys = new Map<string, string>();
let persistenceQueue: Promise<void> = Promise.resolve();
let persistenceError: unknown = null;

export function documentEncryptionKeyring(): Record<string, string> {
  return inMemoryKeyring;
}

export async function ensureDocumentKeysLoaded(keyIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(keyIds.filter((keyId) => UUID_PATTERN.test(keyId)))];
  const missing = unique.filter((keyId) => !inMemoryKeyring[keyId]);
  if (missing.length > 0) Object.assign(inMemoryKeyring, await loadDocumentKeys(missing));
  const unavailable = unique.filter((keyId) => !inMemoryKeyring[keyId]);
  if (unavailable.length > 0) {
    const ids = unavailable.join(', ');
    throw new Error(`The protected local vault does not contain the required encryption ${unavailable.length === 1 ? 'key' : 'keys'}: ${ids}. Import the matching .hvykey ${unavailable.length === 1 ? 'file' : 'files'} and reopen the document.`);
  }
  return inMemoryKeyring;
}

export async function tryEnsureDocumentKeysLoaded(keyIds: string[]): Promise<boolean> {
  const unique = [...new Set(keyIds.filter((keyId) => UUID_PATTERN.test(keyId)))];
  const missing = unique.filter((keyId) => !inMemoryKeyring[keyId]);
  if (missing.length > 0) {
    const loaded = await tryLoadDocumentKeys(missing);
    if (loaded === null) return false;
    Object.assign(inMemoryKeyring, loaded);
  }
  return unique.every((keyId) => Boolean(inMemoryKeyring[keyId]));
}

export function queueGeneratedDocumentKey(keyId: string, key: string): void {
  validateDocumentKey(keyId, key);
  inMemoryKeyring[keyId] = key;
  pendingGeneratedKeys.set(keyId, key);
  persistenceQueue = persistenceQueue.then(async () => {
    const entries: StoredDocumentKeyInput[] = [...pendingGeneratedKeys].map(([pendingKeyId, pendingKey]) => ({
      keyId: pendingKeyId,
      key: pendingKey,
      source: 'generated',
    }));
    if (entries.length === 0) return;
    try {
      await storeDocumentKeys(entries);
      for (const entry of entries) {
        if (pendingGeneratedKeys.get(entry.keyId) === entry.key) pendingGeneratedKeys.delete(entry.keyId);
      }
      persistenceError = null;
    } catch (error) {
      persistenceError = error;
    }
  });
}

export async function flushDocumentKeyPersistence(): Promise<void> {
  await persistenceQueue;
  if (persistenceError) throw persistenceError;
}

export async function importReviewedDocumentKeys(keys: ReviewedDocumentKey[]): Promise<void> {
  const entries: StoredDocumentKeyInput[] = keys.map((key) => ({
    keyId: key.keyId,
    key: key.key,
    createdAt: key.createdAt,
    source: 'imported',
    label: key.label,
    bundleLabel: key.bundleLabel,
  }));
  await storeDocumentKeys(entries);
  for (const entry of entries) inMemoryKeyring[entry.keyId] = entry.key;
}

export async function generateStoredDocumentKey(label?: string): Promise<PortableDocumentKey> {
  const keyId = crypto.randomUUID();
  const key = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const createdAt = new Date().toISOString();
  const normalizedLabel = label?.trim();
  await storeDocumentKeys([{
    keyId,
    key,
    createdAt,
    source: 'generated',
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
  }]);
  inMemoryKeyring[keyId] = key;
  return {
    keyId,
    algorithm: 'fernet',
    key,
    createdAt,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
  };
}

export async function renameStoredDocumentKey(keyId: string, label: string): Promise<void> {
  const normalizedLabel = label.trim();
  if (normalizedLabel.length > 200) throw new Error('An encryption key name may not exceed 200 characters.');
  await ensureDocumentKeysLoaded([keyId]);
  await storeDocumentKeys([{
    keyId,
    key: inMemoryKeyring[keyId],
    source: 'imported',
    ...(normalizedLabel ? { label: normalizedLabel } : { clearLabel: true }),
  }]);
}

export async function permanentlyDeleteDocumentKey(keyId: string): Promise<void> {
  if (!UUID_PATTERN.test(keyId)) throw new Error(`Invalid HVY encryption key ID: ${keyId || '(missing)'}.`);
  await deleteDocumentKey(keyId);
  delete inMemoryKeyring[keyId];
  pendingGeneratedKeys.delete(keyId);
}

export function parseDocumentKeyFiles(sources: DocumentKeyFileSource[]): ReviewedDocumentKey[] {
  const keys = sources.flatMap((source) => {
    const bundle = parseDocumentKeyFile(source.text);
    return bundle.keys.map((key) => ({
    ...key,
    sourceName: source.name,
    ...(bundle.label ? { bundleLabel: bundle.label } : {}),
    fingerprint: documentKeyFingerprint(key.key),
    }));
  });
  const byId = new Map<string, ReviewedDocumentKey>();
  for (const key of keys) {
    const existing = byId.get(key.keyId);
    if (existing && existing.key !== key.key) throw new Error(`Key ${key.keyId} has conflicting values in the selected files.`);
    byId.set(key.keyId, existing ?? key);
  }
  return [...byId.values()];
}

export function parseDocumentKeyFile(text: string): PortableDocumentKeyFile {
  const value = JSON.parse(text) as { hvy_key_file?: unknown; label?: unknown; keys?: unknown } | null;
  if (!value || value.hvy_key_file !== HVY_KEY_FILE_VERSION || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new Error('This is not a supported HVY encryption key file.');
  }
  if (value.keys.length > 1000) throw new Error('An HVY encryption key file may contain at most 1,000 keys.');
  return {
    hvy_key_file: 1,
    ...(normalizeBundleLabel(value.label) ? { label: normalizeBundleLabel(value.label) } : {}),
    keys: value.keys.map((candidate) => normalizePortableDocumentKey(candidate)),
  };
}

export function serializeDocumentKeyFile(keys: PortableDocumentKey[], options: { label?: string } = {}): Uint8Array {
  if (keys.length === 0) throw new Error('At least one encryption key is required.');
  const normalized = keys.map(normalizePortableDocumentKey);
  const label = normalizeBundleLabel(options.label);
  return new TextEncoder().encode(`${JSON.stringify({ hvy_key_file: 1, ...(label ? { label } : {}), keys: normalized }, null, 2)}\n`);
}

export function documentKeyFingerprint(key: string): string {
  const digest = bytesToHex(sha256(decodeFernetKey(key))).slice(0, 24).toUpperCase();
  return digest.match(/.{1,4}/g)?.join('-') ?? digest;
}

export function extractEncryptionKeyIds(bytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(bytes);
  const ids = new Set<string>();
  const documentKeyId = extractDocumentEnvelopeKeyId(bytes);
  if (documentKeyId) ids.add(documentKeyId);
  for (const match of text.matchAll(/<!--hvy:encrypted\s+\{[^\n]*?"keyId"\s*:\s*"([^"]+)"[^\n]*?\}-->/g)) {
    if (UUID_PATTERN.test(match[1])) ids.add(match[1]);
  }
  return [...ids];
}

export function extractDocumentEnvelopeKeyId(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes);
  const envelope = text.match(/^---HVY-ENCRYPTED---\n([^\n]+)\n---HVY-ENCRYPTED-PAYLOAD---\n/);
  if (envelope) {
    try {
      const header = JSON.parse(envelope[1]) as { keyId?: unknown };
      if (typeof header.keyId === 'string' && UUID_PATTERN.test(header.keyId)) return header.keyId;
    } catch {
      // The Heavy deserializer reports malformed envelope metadata.
    }
  }
  return null;
}

function normalizePortableDocumentKey(value: unknown): PortableDocumentKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('HVY encryption key entries must be objects.');
  const candidate = value as Record<string, unknown>;
  const keyId = typeof candidate.keyId === 'string' ? candidate.keyId.trim() : '';
  const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
  validateDocumentKey(keyId, key);
  if (candidate.algorithm !== 'fernet') throw new Error(`Unsupported encryption algorithm for key ${keyId}.`);
  return {
    keyId,
    algorithm: 'fernet',
    key,
    ...(typeof candidate.label === 'string' && candidate.label.trim() ? { label: candidate.label.trim() } : {}),
    ...(typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? { createdAt: candidate.createdAt.trim() } : {}),
  };
}

function normalizeBundleLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error('An HVY encryption key bundle label must be a non-empty string.');
  const label = value.trim();
  if (label.length > 200) throw new Error('An HVY encryption key bundle label may not exceed 200 characters.');
  return label;
}

function validateDocumentKey(keyId: string, key: string): void {
  if (!UUID_PATTERN.test(keyId)) throw new Error(`Invalid HVY encryption key ID: ${keyId || '(missing)'}.`);
  decodeFernetKey(key);
}

function decodeFernetKey(key: string): Uint8Array {
  try {
    const normalized = key.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (bytes.length !== 32) throw new Error();
    return bytes;
  } catch {
    throw new Error('A Fernet key must be URL-safe base64 encoding exactly 32 bytes.');
  }
}


function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
