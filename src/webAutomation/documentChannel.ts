import { walkHvyDocument, type HvyDocumentWalkResult } from '../../../heavy-file-format/src/search/hvy-document-walk';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { WebAutomationError } from './errors';

/**
 * Reads an HVY document page by page. The same walk runs either on a local
 * document (walkHvyDocument) or on a document open in a signed-in page
 * (the reference implementation's WebMCP walk_hvy_document tool, which wraps
 * the same function), so the code consuming it does not care where the
 * document lives.
 */
export interface HvyDocumentChannel {
  walk(cursor?: string): Promise<HvyDocumentWalkResult>;
}

export function createLocalDocumentChannel(document: VisualDocument): HvyDocumentChannel {
  return {
    walk: async (cursor) => walkHvyDocument({ document, cursor, limit: 20 }),
  };
}

export type WebMcpToolInvoker = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

function isWalkResult(value: unknown): value is HvyDocumentWalkResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return Array.isArray(result.items)
    && result.items.every((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).content === 'string')
    && (result.nextCursor === undefined || typeof result.nextCursor === 'string');
}

export function createWebMcpDocumentChannel(invoke: WebMcpToolInvoker): HvyDocumentChannel {
  return {
    walk: async (cursor) => {
      const result = await invoke('walk_hvy_document', { ...(cursor ? { cursor } : {}), limit: 20 });
      if (!isWalkResult(result)) throw new WebAutomationError('invalid_request', 'The page returned an unexpected walk_hvy_document result.');
      return result;
    },
  };
}

const WEBMCP_SOURCE_PREFIX = 'webmcp:';

/** A document-text source bound to a document open in a signed-in page, read through its WebMCP walk tool. */
export function webMcpDocumentSource(pageUrl: string): string {
  return `${WEBMCP_SOURCE_PREFIX}${new URL(pageUrl).href}`;
}

/** The page URL of a WebMCP source, or null for a workspace path. */
export function webMcpDocumentPage(source: string): string | null {
  return source.startsWith(WEBMCP_SOURCE_PREFIX) ? source.slice(WEBMCP_SOURCE_PREFIX.length) : null;
}

export const MAX_DOCUMENT_TEXT = 180_000;

/** Walks the whole document and joins its content into plain text, in document order. */
export async function readDocumentTextFromChannel(channel: HvyDocumentChannel, maxChars = MAX_DOCUMENT_TEXT): Promise<string> {
  const parts: string[] = [];
  let length = 0;
  let cursor: string | undefined;
  do {
    const page = await channel.walk(cursor);
    for (const item of page.items) {
      const content = item.content.trim();
      if (!content) continue;
      parts.push(content);
      length += content.length + 2;
      if (length >= maxChars) return parts.join('\n\n').slice(0, maxChars);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return parts.join('\n\n');
}
