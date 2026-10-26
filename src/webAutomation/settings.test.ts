import { describe, expect, it } from 'vitest';
import { createMockFlow } from '../test/webAutomation/flow';
import { ATS_ORIGIN, listingCollection } from '../test/webAutomation/sites';
import { COLLECTION_WORKER_LIMIT_BOUNDS, DEFAULT_COLLECTION_WORKER_LIMITS, emptyAutomationSettings, normalizeAutomationSettings, normalizeCollectionWorkerLimits } from './settings';

describe('automation settings', () => {
  it('round-trips settings produced by a real flow', async () => {
    const flow = createMockFlow();
    const boards = listingCollection([`${ATS_ORIGIN}/acme/jobs`]);
    flow.bindProfiles(boards);
    flow.approve();
    await flow.signIn();
    await flow.completeLogin();
    const saved = JSON.parse(JSON.stringify(flow.settings.get()));
    expect(normalizeAutomationSettings(saved)).toEqual(flow.settings.get());
  });

  it('drops malformed entries instead of failing', () => {
    expect(normalizeAutomationSettings(null)).toEqual(emptyAutomationSettings());
    expect(normalizeAutomationSettings({
      authorizations: { '/doc.hvy': { ok: { profileId: 'p1', partHashes: { page: 'h', bad: 1 }, authorizedAt: 5 }, broken: { profileId: 'p1' } } },
      accounts: { wrongKey: { origin: 'https://a.test', profileId: 'p1' } },
    })).toEqual({
      authorizations: { '/doc.hvy': { ok: { capabilityId: 'ok', profileId: 'p1', partHashes: { page: 'h' }, authorizedAt: 5 } } },
      accounts: {},
    });
  });
  it('keeps the collection limits whole and within their bounds, defaulting what is missing', () => {
    expect(normalizeCollectionWorkerLimits(undefined)).toEqual(DEFAULT_COLLECTION_WORKER_LIMITS);
    expect(normalizeCollectionWorkerLimits({ perSite: 9, total: 0 })).toEqual({ perSite: COLLECTION_WORKER_LIMIT_BOUNDS.perSite, total: 1 });
    expect(normalizeCollectionWorkerLimits({ perSite: 1.5, total: 6 })).toEqual({ perSite: DEFAULT_COLLECTION_WORKER_LIMITS.perSite, total: 6 });
  });
});
