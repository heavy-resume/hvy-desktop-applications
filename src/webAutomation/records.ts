/**
 * What a collection run emits. Runs do not store or merge anything: the
 * consumer (a record sink in the document, a script, or MCP) decides what a
 * record means and where it goes.
 */
export type CollectedRecordState = 'ok' | 'no_pattern' | 'invalid';

export interface CollectedRecordProvenance {
  sourceUrl: string;
  collectedAt: number;
  /** The detail pattern used. Absent when nothing matched. */
  patternId?: string;
}

export interface CollectedRecord {
  /** Identity used for de-duplication, from the collection's key strategy. */
  key: string;
  url: string;
  values: Record<string, unknown>;
  provenance: CollectedRecordProvenance;
  state: CollectedRecordState;
  problem?: string;
}

/**
 * How a record's identity is derived:
 * - `url`: the canonical URL of the record's page (default);
 * - `field`: one extracted value, such as a posting identifier;
 * - `fields`: several values joined, for records without a stable page.
 */
export type RecordKeyStrategy =
  | { kind: 'url' }
  | { kind: 'field'; field: string }
  | { kind: 'fields'; fields: string[] };

/** Query parameters that only track how a link was reached. Collections can add their own. */
export const DEFAULT_IGNORED_QUERY_PARAMETERS = ['utm_*', 'gclid', 'fbclid', 'mc_cid', 'mc_eid'];

function parameterMatcher(pattern: string): (name: string) => boolean {
  const lower = pattern.toLowerCase();
  return lower.endsWith('*') ? (name) => name.toLowerCase().startsWith(lower.slice(0, -1)) : (name) => name.toLowerCase() === lower;
}

/** Canonical URL: no fragment, lowercase host, no ignored parameters, sorted query, no trailing slash. */
export function canonicalUrl(value: string, ignoredParameters: string[] = DEFAULT_IGNORED_QUERY_PARAMETERS): string {
  const url = new URL(value);
  const ignored = ignoredParameters.map(parameterMatcher);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !ignored.some((matches) => matches(name)))
    .sort(([left], [right]) => left.localeCompare(right));
  url.search = '';
  for (const [name, item] of kept) url.searchParams.append(name, item);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.href;
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

/** The record key, or null when the strategy's fields are not available yet. */
export function recordKey(
  strategy: RecordKeyStrategy,
  url: string,
  values: Record<string, unknown>,
  ignoredParameters?: string[],
): string | null {
  if (strategy.kind === 'url') return canonicalUrl(url, ignoredParameters);
  const fields = strategy.kind === 'field' ? [strategy.field] : strategy.fields;
  const parts = fields.map((field) => valueText(values[field]));
  return parts.every(Boolean) ? parts.join('\u001f') : null;
}

/** The first problem with a record's required fields, named by their labels, or null when it has none. */
export function validateRecord(values: Record<string, unknown>, fields: Array<{ id: string; label: string; required?: boolean; minLength?: number }> = []): string | null {
  for (const field of fields) {
    if (!field.required) continue;
    const text = valueText(values[field.id]);
    if (!text) return `"${field.label}" is missing.`;
    if (field.minLength && text.length < field.minLength) return `"${field.label}" is shorter than ${field.minLength} characters.`;
  }
  return null;
}
