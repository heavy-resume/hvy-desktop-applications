import { beforeEach, describe, expect, it } from 'vitest';
import { appSettingsForStorage, appSettingsFromStorage, appSettingsReferenceFile } from './appSettingsFiles';
import { defaultAppSettings, type StoredAppSettings } from './backend';
import { removeRuntimeDocument, resetRuntimeDocuments, runtimeDocumentAtPath, updateRuntimeDocumentFile } from './runtimeDocuments';

const JOBS = '/workspace/jobs.hvy';
const HOME = '/workspace/home.hvy';

// Settings as saved: each per-file setting by the file's path.
function stored(): StoredAppSettings {
  const settings = appSettingsForStorage(defaultAppSettings());
  return {
    ...settings,
    homepage: { kind: 'file', path: HOME },
    powerScriptingAllowedFiles: [JOBS],
    powerScriptAcceptances: { [JOBS]: ['fingerprint'] },
    powerScriptAcceptanceScripts: { [JOBS]: { fingerprint: [{ id: 'script', hash: 'hash' }] } },
    pluginAcceptances: { [JOBS]: ['galaxy.schedule@0.1.0'] },
    webCapabilityProfileBindings: { [JOBS]: { inbox: 'work' } },
    webServiceApprovals: { [JOBS]: { api: { capabilityId: 'api', profileId: 'work', partHashes: {}, authorizedAt: 1 } } },
    scheduledDocuments: { [JOBS]: { name: 'jobs.hvy', idleMinutes: 5, jobs: [], choices: {}, scheduledFrom: {}, lastResults: {} } },
  };
}

describe('app settings kept per file', () => {
  beforeEach(() => resetRuntimeDocuments());

  it('are held by each file\'s reference, and saved as they were loaded', () => {
    const settings = appSettingsFromStorage(stored());
    const jobs = runtimeDocumentAtPath(JOBS)!.documentId;

    expect(settings.pluginAcceptances[jobs]).toEqual(['galaxy.schedule@0.1.0']);
    expect(settings.homepage).toEqual({ kind: 'file', file: runtimeDocumentAtPath(HOME)!.documentId });
    expect(appSettingsForStorage(settings)).toEqual(stored());
  });

  it('follow a file renamed or moved, and are saved with its new path', () => {
    const settings = appSettingsFromStorage(stored());
    const jobs = runtimeDocumentAtPath(JOBS)!;

    updateRuntimeDocumentFile(jobs, { path: '/workspace/notes/jobs.hvy', name: 'jobs.hvy', extension: '.hvy' });

    expect(appSettingsReferenceFile(settings, jobs.documentId)).toBe(true);
    const saved = appSettingsForStorage(settings);
    expect(saved.powerScriptingAllowedFiles).toEqual(['/workspace/notes/jobs.hvy']);
    expect(Object.keys(saved.scheduledDocuments)).toEqual(['/workspace/notes/jobs.hvy']);
    expect(Object.keys(saved.webServiceApprovals)).toEqual(['/workspace/notes/jobs.hvy']);
  });

  it('are dropped, not saved under no path, for a file Galaxy deleted', () => {
    const settings = appSettingsFromStorage(stored());

    removeRuntimeDocument(runtimeDocumentAtPath(JOBS)!);
    removeRuntimeDocument(runtimeDocumentAtPath(HOME)!);

    const saved = appSettingsForStorage(settings);
    expect(saved.powerScriptingAllowedFiles).toEqual([]);
    expect(saved.pluginAcceptances).toEqual({});
    expect(saved.homepage).toEqual({ kind: 'none' });
  });
});
