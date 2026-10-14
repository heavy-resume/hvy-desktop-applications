import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { deserializeDocumentBytesAsync } from '../../../heavy-file-format/src/serialization';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { readJsonPointer, type ApiEndpointDefinition } from './endpoints';
import { WebAutomationError } from './errors';

/**
 * An endpoint whose response hands out an HVY document: where to read it, how
 * to check what was read, the keys that decrypt it, and its revision. Values
 * are JSON pointers into the response body.
 */
export interface ServedDocumentDefinition {
  urlPointer: string;
  extensionPointer?: string;
  byteLengthPointer?: string;
  sha256Pointer?: string;
  /** A map of key ID to key, used for this read only and never stored. */
  keyringPointer?: string;
  /** The first value present is the revision, with its prefix. */
  revision?: Array<{ pointer: string; prefix?: string }>;
}

export const MAX_SERVED_DOCUMENT_BYTES = 100 * 1024 * 1024;
/** The most text a document contributes to an input. */
export const MAX_DOCUMENT_TEXT = 180_000;

const DOCUMENT_EXTENSIONS = new Set(['.hvy', '.phvy', '.thvy']);

/** HTTPS, or HTTP on a loopback host (for example, a local storage emulator). */
function isTrustworthyOrigin(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.'));
}

/**
 * Where a served document may be downloaded from: the capability's own origin
 * or a storage origin it lists. Anything else is never fetched, whatever the
 * service returns, so a bad response cannot point Galaxy at another host.
 */
export function checkDownloadUrl(value: unknown, allowedOrigins: string[], name: string): URL {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new WebAutomationError('invalid_request', `${name} did not return a document URL.`);
  }
  if (!isTrustworthyOrigin(url) || url.username || url.password) {
    throw new WebAutomationError('out_of_scope', `${name} offered a document from ${url.origin}, which is not a secure origin.`);
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new WebAutomationError('out_of_scope', `${name} offered a document from ${url.origin}, which it does not list as a storage origin.`);
  }
  return url;
}

export interface ServedDocument {
  document: VisualDocument;
  revision: string | null;
}

/**
 * Reads the document an endpoint's response serves, as the Heavy Resume
 * extension does: download from an allowed origin, check the announced size
 * and hash, then decrypt and parse with the reference implementation.
 */
export async function readServedDocument(
  deps: { download(url: string, options: { maxBytes: number }): Promise<Uint8Array> },
  endpoint: ApiEndpointDefinition & { servesDocument: ServedDocumentDefinition },
  body: unknown,
  allowedOrigins: string[],
): Promise<ServedDocument> {
  const served = endpoint.servesDocument;
  const url = checkDownloadUrl(readJsonPointer(body, served.urlPointer), allowedOrigins, `"${endpoint.name}"`);
  const bytes = await deps.download(url.href, { maxBytes: MAX_SERVED_DOCUMENT_BYTES });
  if (bytes.byteLength > MAX_SERVED_DOCUMENT_BYTES) {
    throw new WebAutomationError('invalid_request', `The document from "${endpoint.name}" is larger than ${MAX_SERVED_DOCUMENT_BYTES} bytes.`);
  }
  const byteLength = served.byteLengthPointer ? readJsonPointer(body, served.byteLengthPointer) : undefined;
  if (typeof byteLength === 'number' && byteLength !== bytes.byteLength) {
    throw new WebAutomationError('invalid_request', `The document from "${endpoint.name}" is not the size the service announced.`);
  }
  const expectedHash = served.sha256Pointer ? readJsonPointer(body, served.sha256Pointer) : undefined;
  if (typeof expectedHash === 'string' && expectedHash && expectedHash.toLowerCase() !== bytesToHex(sha256(bytes))) {
    throw new WebAutomationError('invalid_request', `The document from "${endpoint.name}" does not match the hash the service announced.`);
  }
  const extension = served.extensionPointer ? readJsonPointer(body, served.extensionPointer) : undefined;
  const keyring = served.keyringPointer ? readJsonPointer(body, served.keyringPointer) : undefined;
  const document = await deserializeDocumentBytesAsync(
    bytes,
    typeof extension === 'string' && DOCUMENT_EXTENSIONS.has(extension) ? extension as '.hvy' : '.hvy',
    keyring && typeof keyring === 'object' ? { encryption: { keyring: keyring as Record<string, string> } } : undefined,
  );
  return { document, revision: servedRevision(served, body) };
}

function servedRevision(served: ServedDocumentDefinition, body: unknown): string | null {
  for (const { pointer, prefix } of served.revision ?? []) {
    const value = readJsonPointer(body, pointer);
    if (value !== undefined && value !== null && value !== '') return `${prefix ?? ''}${String(value)}`;
  }
  return null;
}
