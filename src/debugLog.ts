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

let nextDebugLogId = 1;
const debugLogEntries: DebugLogEntry[] = [];

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
  emitDebugLogChanged();
}

function pushDebugLogEntry(entry: DebugLogEntry): void {
  debugLogEntries.push(entry);
  while (debugLogEntries.length > MAX_DEBUG_LOG_ENTRIES) {
    debugLogEntries.shift();
  }
  emitDebugLogChanged();
}

function emitDebugLogChanged(): void {
  window.dispatchEvent(new CustomEvent('hvy:debug-log-changed'));
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}
