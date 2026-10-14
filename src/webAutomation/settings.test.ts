import { describe, expect, it } from 'vitest';
import { createFauxFlow } from './faux/flow';
import { ATS_ORIGIN, listingCollection } from './faux/sites';
import { emptyAutomationSettings, normalizeAutomationSettings } from './settings';

describe('automation settings', () => {
  it('round-trips settings produced by a real flow', async () => {
    const flow = createFauxFlow();
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
      profileBindings: { '/doc.hvy': { good: 'p1', empty: '', bad: 3 }, '': { x: 'p' } },
      authorizations: { '/doc.hvy': { ok: { profileId: 'p1', partHashes: { page: 'h', bad: 1 }, authorizedAt: 5 }, broken: { profileId: 'p1' } } },
      accounts: { wrongKey: { origin: 'https://a.test', profileId: 'p1', accountId: 'u' } },
    })).toEqual({
      profileBindings: { '/doc.hvy': { good: 'p1' } },
      authorizations: { '/doc.hvy': { ok: { capabilityId: 'ok', profileId: 'p1', partHashes: { page: 'h' }, authorizedAt: 5 } } },
      accounts: {},
    });
  });
});
