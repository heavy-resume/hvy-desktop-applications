import { describe, expect, it } from 'vitest';
import { defaultAppSettings, type AppSettings } from './backend';
import { relocatedDocumentSettings } from './documentSettingsRelocation';

const FROM = '/workspace/Jobs.hvy';
const TO = '/workspace/Renamed.hvy';
const OTHER = '/workspace/Other.hvy';

function settingsFor(path: string): Partial<AppSettings> {
  return {
    homepage: { kind: 'file', path },
    powerScriptingAllowedFiles: [path, OTHER],
    powerScriptAcceptances: { [path]: ['script-hash'], [OTHER]: ['other-hash'] },
    powerScriptAcceptanceScripts: { [path]: { block: [{ id: 'script', hash: 'script-hash' }] } },
    pluginAcceptances: { [path]: ['galaxy.web-api@0.1.0'] },
    webCapabilityProfileBindings: { [path]: { 'job-fit': 'personal' } },
    webServiceApprovals: { [path]: { 'job-fit': { capabilityId: 'job-fit', profileId: 'personal', partHashes: {}, authorizedAt: 1 } } },
  };
}

describe('document settings relocation', () => {
  it('moves every setting kept for a path, leaving other documents alone', () => {
    const settings: AppSettings = { ...defaultAppSettings(), ...settingsFor(FROM) };
    const moved = relocatedDocumentSettings(settings, FROM, TO);
    expect(moved).toEqual({ ...defaultAppSettings(), ...settingsFor(TO), powerScriptAcceptances: { [TO]: ['script-hash'], [OTHER]: ['other-hash'] } });
  });

  it('returns the same settings when the path has none, so nothing is saved', () => {
    const settings = defaultAppSettings();
    expect(relocatedDocumentSettings(settings, FROM, TO)).toBe(settings);
  });
});
