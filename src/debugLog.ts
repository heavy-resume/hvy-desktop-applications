export type DebugLogKind = 'load' | 'close' | 'llm' | 'event' | 'perf';

export interface DebugLogEntry {
  id: number;
  kind: DebugLogKind;
  label: string;
  startedAt: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

const MAX_DEBUG_LOG_ENTRIES = 500;
const DEFAULT_DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024;

let nextDebugLogId = 1;
const debugLogEntries: DebugLogEntry[] = [];
// Each entry's encoded size, alongside it, so the log's size is kept without stringifying all of it.
const debugLogEntryBytes: number[] = [];
let debugLogBytes = 0;
let maxDebugLogBytes = DEFAULT_DEBUG_LOG_MAX_BYTES;

export function configureDebugLog(options: { maxBytes?: number }): void {
  if (typeof options.maxBytes === 'number' && Number.isFinite(options.maxBytes) && options.maxBytes > 0) {
    maxDebugLogBytes = Math.max(1024, Math.round(options.maxBytes));
    pruneDebugLogEntries();
    emitDebugLogChanged();
  }
}

export function logDebugEvent(kind: DebugLogKind, label: string, details?: Record<string, unknown>): DebugLogEntry {
  const entry: DebugLogEntry = {
    id: nextDebugLogId,
    kind,
    label,
    startedAt: new Date().toISOString(),
    details: {
      ...details,
      action: label,
    },
  };
  nextDebugLogId += 1;
  pushDebugLogEntry(entry);
  return entry;
}

export async function measureDebugAsync<T>(
  kind: DebugLogKind,
  label: string,
  details: Record<string, unknown> | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await callback();
  } finally {
    logDebugEvent(kind, label, {
      ...details,
      durationMs: roundDuration(performance.now() - start),
    });
  }
}

export function measureDebug<T>(
  kind: DebugLogKind,
  label: string,
  details: Record<string, unknown> | undefined,
  callback: () => T,
): T {
  const start = performance.now();
  try {
    return callback();
  } finally {
    logDebugEvent(kind, label, {
      ...details,
      durationMs: roundDuration(performance.now() - start),
    });
  }
}

export function getDebugLogEntries(): DebugLogEntry[] {
  return [...debugLogEntries].reverse();
}

export function clearDebugLogEntries(): void {
  debugLogEntries.length = 0;
  debugLogEntryBytes.length = 0;
  debugLogBytes = 0;
  emitDebugLogChanged();
}

function pushDebugLogEntry(entry: DebugLogEntry): void {
  const bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
  debugLogEntries.push(entry);
  debugLogEntryBytes.push(bytes);
  debugLogBytes += bytes;
  pruneDebugLogEntries();
  emitDebugLogChanged();
}

function pruneDebugLogEntries(): void {
  while (debugLogEntries.length > MAX_DEBUG_LOG_ENTRIES) {
    dropOldestDebugLogEntry();
  }
  while (debugLogEntries.length > 1 && debugLogByteSize() > maxDebugLogBytes) {
    dropOldestDebugLogEntry();
  }
}

function dropOldestDebugLogEntry(): void {
  debugLogEntries.shift();
  debugLogBytes -= debugLogEntryBytes.shift() ?? 0;
}

// The size of the log as JSON: its entries, a comma between each, and the brackets.
function debugLogByteSize(): number {
  return debugLogBytes + Math.max(debugLogEntries.length - 1, 0) + 2;
}

function emitDebugLogChanged(): void {
  window.dispatchEvent(new CustomEvent('hvy:debug-log-changed'));
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}
