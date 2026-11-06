import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BrowserHost, ExtractedRecord, HostResponse, NavigationEvent, PageInspection, PatternMatch } from './host';
import { expandedPattern, LINK_FIELD_ID, type IntegrationPatternMatcher } from './integrationPatterns';
import type { SitePatternDefinition } from './sitePatterns';
import { state } from '../state';

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
export interface InspectorRecord {
  parent: string;
  score: number;
  targets: Array<{ label: string; value: unknown; href?: string | null }>;
  /** What opens the row's item, for a list whose pattern has one (null when not found in this row), and its link. */
  opener?: { element: string; href: string | null } | null;
}

interface RawInspection {
  url: string;
  ready: boolean;
  matches: Record<string, InspectorRecord[]>;
  frames: Array<{ src: string }>;
}


// The matcher as the page's inspector matches it: a site setup keeps its fields' snapshots once (storedPattern).
function matcherOf(pattern: SitePatternDefinition): IntegrationPatternMatcher | null {
  const matcher = pattern.matcher as IntegrationPatternMatcher | undefined;
  return matcher ? { ...matcher, pattern: expandedPattern(matcher.pattern) } : null;
}

/**
 * Field values by field ID, and the record's link: where what opens the row goes, for a list that was shown what
 * (`opener`), or else the first link among its fields. As a run reads a row, so site setup too.
 */
export function recordValues(record: InspectorRecord): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const target of record.targets) {
    // A picked field's label is the collection field it was assigned to.
    values[target.label] = target.value;
  }
  const link = record.opener !== undefined ? record.opener?.href : record.targets.find((target) => target.href)?.href;
  if (link) values[LINK_FIELD_ID] = link;
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

/**
 * The browser store a profile's windows use: the one its integration browser uses (its registry entry's), so what was
 * done in either holds in both. Tauri opens that store; Electron shares the profile's cookies through its vault instead.
 */
function browserStoreOf(profileId: string): string {
  return state.integrationRegistry.profiles.find((profile) => profile.id === profileId)?.browserStoreId ?? profileId;
}

function createNativeBrowserHost(transport: HostTransport): BrowserHost {
  const call = <T>(command: string, args: Record<string, unknown> = {}) => transport.call<T>(command, args);
  return {
    createWorker: (profileId) => call<string>('create-worker', { profileId, browserStoreId: browserStoreOf(profileId) }),
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
      // An item's own page has one record: found, reading stops, rather than scrolling the rest of the page for more.
      const patterns = request.patterns.flatMap((pattern) => {
        const matcher = matcherOf(pattern);
        return matcher ? [{ id: pattern.id, matcher: { ...matcher.pattern, ...(pattern.role === 'detail' ? { recordLimit: 1 } : {}) } }] : [];
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
          ...(request.pageNumber ? { pageNumber: request.pageNumber } : {}),
        },
      });
    },

    request: (workerId, hostRequest) => call<HostResponse>('request', { workerId, request: hostRequest }),
    fetchFile: async (url, options) => new Uint8Array(await call<ArrayBuffer | Uint8Array>('fetch-file', { url, maxBytes: options.maxBytes })),
    openUserWindow: async (profileId, url) => {
      await call('open-user-window', { profileId, browserStoreId: browserStoreOf(profileId), url });
    },
    hideUserWindow: async (profileId) => {
      await call('hide-user-window', { profileId });
    },
    onNavigation: (listener) => transport.onNavigation(listener),
  };
}
