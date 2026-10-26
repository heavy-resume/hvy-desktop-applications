import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BrowserHost, ExtractedRecord, HostResponse, NavigationEvent, PageInspection, PatternMatch } from './host';
import { LINK_FIELD_ID, type IntegrationPatternMatcher } from './integrationPatterns';
import type { SitePatternDefinition } from './sitePatterns';

/**
 * Web automation's BrowserHost in the desktop apps: hidden worker windows
 * that share a browser profile's session, inspected with the integration
 * inspector. Electron (src-electron/web-automation-host.cjs) and Tauri
 * (src-tauri/src/web_automation.rs) take the same commands; only how a
 * command reaches them differs. Site patterns made from picked integrations
 * carry the inspector's pattern and their commands.
 */

/** How the host's commands and navigation events reach the native side. */
interface HostTransport {
  call<T>(command: string, args: Record<string, unknown>): Promise<T>;
  onNavigation(listener: (event: NavigationEvent) => void): () => void;
}

interface ElectronBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  onWebAutomationNavigation(callback: (event: NavigationEvent) => void): () => void;
}

/** A record as the integration inspector extracts it. */
interface InspectorRecord {
  parent: string;
  score: number;
  targets: Array<{ label: string; value: unknown; href?: string | null }>;
}

interface RawInspection {
  url: string;
  ready: boolean;
  matches: Record<string, InspectorRecord[]>;
  frames: Array<{ src: string }>;
}


function matcherOf(pattern: SitePatternDefinition): IntegrationPatternMatcher | null {
  return (pattern.matcher as IntegrationPatternMatcher | undefined) ?? null;
}

/** Field values by field ID, and the record's link: the first link among its fields. */
function recordValues(record: InspectorRecord): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const target of record.targets) {
    // A picked field's label is the collection field it was assigned to.
    values[target.label] = target.value;
    if (target.href && values[LINK_FIELD_ID] === undefined) values[LINK_FIELD_ID] = target.href;
  }
  return values;
}

function patternMatch(records: InspectorRecord[]): PatternMatch {
  const extracted: ExtractedRecord[] = records.map((record) => ({ ref: record.parent, values: recordValues(record) }));
  return { confidence: records.length ? Math.max(...records.map((record) => record.score)) : 0, records: extracted };
}

function electronTransport(): HostTransport {
  const bridge = (window as unknown as { hvyElectron: ElectronBridge }).hvyElectron;
  return {
    call: (command, args) => bridge.invoke('web_automation_host', { command, ...args }),
    onNavigation: (listener) => bridge.onWebAutomationNavigation(listener),
  };
}

function tauriTransport(): HostTransport {
  return {
    call: (command, args) => invoke('web_automation_host', { command, args }),
    onNavigation(listener) {
      const unlisten = listen<NavigationEvent>('web-automation-navigation', (event) => listener(event.payload));
      return () => void unlisten.then((stop) => stop());
    },
  };
}

export function createElectronBrowserHost(): BrowserHost {
  return createNativeBrowserHost(electronTransport());
}

export function createTauriBrowserHost(): BrowserHost {
  return createNativeBrowserHost(tauriTransport());
}

function createNativeBrowserHost(transport: HostTransport): BrowserHost {
  const call = <T>(command: string, args: Record<string, unknown> = {}) => transport.call<T>(command, args);
  return {
    createWorker: (profileId) => call<string>('create-worker', { profileId }),
    resetWorker: async (workerId) => {
      await call('reset-worker', { workerId });
    },
    closeWorker: async (workerId) => {
      await call('close-worker', { workerId });
    },
    showWorker: async (workerId) => {
      await call('show-worker', { workerId });
    },
    hideWorker: async (workerId) => {
      await call('hide-worker', { workerId });
    },
    navigate: (workerId, url) => call('navigate', { workerId, url }),
    back: (workerId) => call('back', { workerId }),

    async inspect(workerId, request): Promise<PageInspection> {
      const patterns = request.patterns.flatMap((pattern) => {
        const matcher = matcherOf(pattern);
        return matcher ? [{ id: pattern.id, matcher: matcher.pattern }] : [];
      });
      const raw = await call<RawInspection>('inspect', { workerId, request: { patterns } });
      return {
        url: raw.url,
        ready: raw.ready,
        matches: Object.fromEntries(Object.entries(raw.matches).map(([id, records]) => [id, patternMatch(records)])),
        // Fingerprint signals are not evaluated by this host yet.
        fingerprintMatches: {},
        frames: raw.frames,
      };
    },

    async runCommand(workerId, request) {
      const matcher = matcherOf(request.pattern);
      const command = matcher?.commands[request.commandId];
      if (!matcher || !command) return { status: 'no_match' };
      return call('run-command', {
        workerId,
        payload: {
          command,
          pattern: matcher.pattern,
          ...(request.recordRef ? { recordParent: request.recordRef } : {}),
        },
      });
    },

    request: (workerId, hostRequest) => call<HostResponse>('request', { workerId, request: hostRequest }),
    fetchFile: async (url, options) => new Uint8Array(await call<ArrayBuffer | Uint8Array>('fetch-file', { url, maxBytes: options.maxBytes })),
    openUserWindow: async (profileId, url) => {
      await call('open-user-window', { profileId, url });
    },
    hideUserWindow: async (profileId) => {
      await call('hide-user-window', { profileId });
    },
    onNavigation: (listener) => transport.onNavigation(listener),
  };
}
