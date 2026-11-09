import type { CapabilityAuthorizations } from './authorization';

export interface AccountSummary {
  origin: string;
  profileId: string;
  checkedAt: number;
}

/** Local app settings used by web automation. Never written into a document. */
export interface AutomationSettings {
  authorizations: CapabilityAuthorizations;
  /** `${origin}\0${profileId}` → account summary. */
  accounts: Record<string, AccountSummary>;
}

export interface AutomationSettingsStore {
  get(): AutomationSettings;
  update(change: (settings: AutomationSettings) => AutomationSettings): void;
}

export function emptyAutomationSettings(): AutomationSettings {
  return { authorizations: {}, accounts: {} };
}

export function createMemorySettingsStore(initial: AutomationSettings = emptyAutomationSettings()): AutomationSettingsStore {
  let value = structuredClone(initial);
  return {
    get: () => value,
    update: (change) => {
      value = change(value);
    },
  };
}

export function accountKey(origin: string, profileId: string): string {
  return `${origin}\0${profileId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Loads service approvals (also Galaxy's `appSettings.webServiceApprovals`), dropping malformed entries. */
export function normalizeCapabilityAuthorizations(value: unknown): CapabilityAuthorizations {
  return Object.fromEntries(Object.entries(isRecord(value) ? value : {}).flatMap(([documentPath, byCapability]) => {
    const entries = Object.entries(isRecord(byCapability) ? byCapability : {}).flatMap(([capabilityId, raw]) => {
      if (!isRecord(raw) || typeof raw.profileId !== 'string' || !isRecord(raw.partHashes) || typeof raw.authorizedAt !== 'number') return [];
      const partHashes = Object.fromEntries(Object.entries(raw.partHashes).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      return [[capabilityId, {
        capabilityId,
        profileId: raw.profileId,
        partHashes,
        authorizedAt: raw.authorizedAt,
        ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}),
      }]];
    });
    return entries.length ? [[documentPath, Object.fromEntries(entries)]] : [];
  }));
}

/** Loads persisted automation settings, dropping malformed entries rather than failing. */
export function normalizeAutomationSettings(value: unknown): AutomationSettings {
  const source = isRecord(value) ? value : {};
  const authorizations = normalizeCapabilityAuthorizations(source.authorizations);
  const accounts = Object.fromEntries(Object.entries(isRecord(source.accounts) ? source.accounts : {}).flatMap(([key, raw]) => {
    if (!isRecord(raw) || typeof raw.origin !== 'string' || typeof raw.profileId !== 'string') return [];
    if (key !== accountKey(raw.origin, raw.profileId)) return [];
    return [[key, {
      origin: raw.origin,
      profileId: raw.profileId,
      checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : 0,
    }]];
  }));
  return {
    authorizations,
    accounts,
  };
}

/**
 * How much web automation does at once (App Settings, "Web collection"): pages collection reads on one site, and in
 * all; and web API calls a browser profile makes at once (to a service's API, not a site's pages, so not paced as
 * page loads are).
 */
export interface CollectionWorkerLimits {
  perSite: number;
  total: number;
  apiCalls: number;
}

export const DEFAULT_COLLECTION_WORKER_LIMITS: CollectionWorkerLimits = { perSite: 2, total: 4, apiCalls: 4 };
/** Each collection worker is a webview, and API calls share one page: these bound what the settings accept. */
export const COLLECTION_WORKER_LIMIT_BOUNDS: CollectionWorkerLimits = { perSite: 4, total: 8, apiCalls: 8 };

/** The stored limits, each a whole number within its bounds, or its default. */
export function normalizeCollectionWorkerLimits(value: unknown): CollectionWorkerLimits {
  const source = isRecord(value) ? value : {};
  const limit = (key: keyof CollectionWorkerLimits) => {
    const stored = source[key];
    return typeof stored === 'number' && Number.isInteger(stored)
      ? Math.min(COLLECTION_WORKER_LIMIT_BOUNDS[key], Math.max(1, stored))
      : DEFAULT_COLLECTION_WORKER_LIMITS[key];
  };
  return { perSite: limit('perSite'), total: limit('total'), apiCalls: limit('apiCalls') };
}
