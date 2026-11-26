import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../backend';
import { appSettingsForStorage } from '../appSettingsFiles';
import { readAppSettingsForm } from './render-ai-mcp';

// The form carries settings as saved (each file by its path); what it reads is held by file reference, saved by path again.
const savedForm = (data: FormData) => appSettingsForStorage(readAppSettingsForm(data, '/jobs.hvy'));

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

    expect(savedForm(data).webServiceApprovals).toEqual({
      '/jobs.hvy': { other: approval('other', 'Other') },
      '/elsewhere.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume') },
    });
  });

  it('removes the file entry when its last service is revoked, and drops malformed entries', () => {
    const settings = { ...defaultAppSettings(), webServiceApprovals: { '/jobs.hvy': { 'job-fit': approval('job-fit', 'Heavy Resume'), broken: { profileId: 'p' } } } };
    const data = new FormData();
    data.set('settingsJson', JSON.stringify(settings));
    data.append('serviceApprovalListed', 'job-fit');

    expect(savedForm(data).webServiceApprovals).toEqual({});
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

    expect(savedForm(data).pluginAcceptances).toEqual({ '/jobs.hvy': [notShown, shownKept] });
  });
});
