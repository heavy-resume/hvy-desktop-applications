import { invoke } from '@tauri-apps/api/core';

/**
 * Diagnostics for a page that hangs or runs out of memory: each step written to trace.log in the app's log folder
 * (append_trace_line) before it runs, as it happens, so the last lines say what the page was doing. The steps are the
 * debug log's timed work (a start line before it, an end line after) and its events, and heavy-file-format's console
 * output (its script runs, document hooks, history). Off unless `localStorage.hvyTrace` is "1" (set it in the page's
 * console and reload); the Tauri app only.
 */
let enabled = false;

export function startTrace(): void {
  try {
    // The Tauri app's page (as backend's isTauriRuntime tells it; not imported, as backend logs through the debug log).
    enabled = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && localStorage.getItem('hvyTrace') === '1';
  } catch {
    enabled = false;
  }
  if (!enabled) return;
  for (const level of ['debug', 'log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      trace(`console.${level}`, args);
      original(...args);
    };
  }
  window.addEventListener('error', (event) => trace('window.error', event.message));
  window.addEventListener('unhandledrejection', (event) => trace('unhandledrejection', String(event.reason)));
  trace('trace started', location.href);
}

/** One line: when, what, and a little of what it was about (cut short: the trace is for finding where it stopped). */
export function trace(label: string, details?: unknown): void {
  if (!enabled) return;
  let text = '';
  if (details !== undefined) {
    try {
      text = typeof details === 'string' ? details : JSON.stringify(details);
    } catch {
      text = String(details);
    }
  }
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  const line = `${new Date().toISOString()} ${label}${memory ? ` heapMB=${Math.round(memory / 1e6)}` : ''}${text ? ` ${text.slice(0, 400)}` : ''}`;
  void invoke('append_trace_line', { line }).catch(() => undefined);
}
