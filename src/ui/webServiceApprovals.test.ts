import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../backend';
import { readAppSettingsForm } from './render-ai-mcp';

const approval = (capabilityId: string, name: string) => ({ capabilityId, name, profileId: 'service', partHashes: { endpoints: 'h' }, authorizedAt: 5 });

describe('web services for this file (app settings)', () => {
  it('revokes a listed service the user unchecked, and keeps the rest', () => {
    const settings = {
      ...defaultAppSettings(),
      webServiceApprovals: {
        '/jobs.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume'), other: approval('other', 'Other') },
        '/elsewhere.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume') },
      },
    };
    const data = new FormData();
    data.set('settingsJson', JSON.stringify(settings));
    data.append('serviceApprovalListed', 'job-fit');
    data.append('serviceApprovalListed', 'other');
    data.set('serviceApproved:other', 'on');

    const saved = readAppSettingsForm(data, '/jobs.hvy');
    expect(saved.webServiceApprovals).toEqual({
      '/jobs.hvy': { other: approval('other', 'Other') },
      '/elsewhere.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume') },
    });
  });

  it('removes the file entry when its last service is revoked, and drops malformed entries', () => {
    const settings = { ...defaultAppSettings(), webServiceApprovals: { '/jobs.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume'), broken: { profileId: 'p' } } } };
    const data = new FormData();
    data.set('settingsJson', JSON.stringify(settings));
    data.append('serviceApprovalListed', 'job-fit');

    expect(readAppSettingsForm(data, '/jobs.hvy').webServiceApprovals).toEqual({});
  });
});

describe('per-file plugin acceptances (app settings)', () => {
  it('replaces each listed acceptance by its checkbox, and keeps acceptances not shown', () => {
    const shownKept = JSON.stringify(['hvy.video', null, '0.1.0']);
    const shownCleared = JSON.stringify(['com.example.lookup', null, '1.2.0']);
    const notShown = JSON.stringify(['com.example.other', null, '2.0.0']);
    const settings = { ...defaultAppSettings(), pluginAcceptances: { '/jobs.hvy': [shownCleared, notShown] } };
    const data = new FormData();
    data.set('settingsJson', JSON.stringify(settings));
    data.append('pluginAcceptanceListed', shownKept);
    data.append('pluginAcceptanceListed', shownCleared);
    data.set(`pluginAccepted:${shownKept}`, 'on');

    expect(readAppSettingsForm(data, '/jobs.hvy').pluginAcceptances).toEqual({ '/jobs.hvy': [notShown, shownKept] });
  });
});
