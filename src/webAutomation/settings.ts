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
