import type { AppSettings, HomepageSetting, StoredAppSettings, StoredHomepageSetting } from './backend';
import { fileKeyForPath, pathForFileKey, type FileKey } from './runtimeDocuments';

/**
 * The settings Galaxy keeps per file (power scripts, plugin and web approvals, profile bindings, scheduled jobs, the
 * homepage) are held by the file's reference in memory and saved by its path. This is the one place that converts
 * between the two, so a file renamed or moved in Galaxy keeps its settings with nothing else to update: saving again
 * writes its new path.
 */

// A file Galaxy deleted has no reference left: what was kept for it is dropped, not saved under no path.
function keyedBy<From extends string, To extends string, V>(record: Record<From, V>, key: (from: From) => To): Record<To, V> {
  return Object.fromEntries(Object.entries(record).flatMap(([from, value]) => {
    const to = key(from as From);
    return to ? [[to, value]] : [];
  })) as Record<To, V>;
}

function perFile<From extends string, To extends string>(settings: StoredAppSettings | AppSettings, key: (from: From) => To) {
  const source = settings as unknown as AppSettings & StoredAppSettings;
  return {
    powerScriptingAllowedFiles: (source.powerScriptingAllowedFiles as unknown as From[]).map(key).filter(Boolean),
    powerScriptAcceptances: keyedBy(source.powerScriptAcceptances as Record<From, string[]>, key),
    powerScriptAcceptanceScripts: keyedBy(source.powerScriptAcceptanceScripts as Record<From, AppSettings['powerScriptAcceptanceScripts'][FileKey]>, key),
    pluginAcceptances: keyedBy(source.pluginAcceptances as Record<From, string[]>, key),
    webCapabilityProfileBindings: keyedBy(source.webCapabilityProfileBindings as Record<From, Record<string, string>>, key),
    webCapabilityAuthorizations: keyedBy(source.webCapabilityAuthorizations as Record<From, AppSettings['webCapabilityAuthorizations'][FileKey]>, key),
    webServiceApprovals: keyedBy(source.webServiceApprovals as Record<From, AppSettings['webServiceApprovals'][FileKey]>, key),
    scheduledDocuments: keyedBy(source.scheduledDocuments as Record<From, AppSettings['scheduledDocuments'][FileKey]>, key),
  };
}

export function homepageFromStorage(homepage: StoredHomepageSetting): HomepageSetting {
  return homepage.kind === 'file' ? { kind: 'file', file: fileKeyForPath(homepage.path) } : homepage;
}

export function homepageForStorage(homepage: HomepageSetting): StoredHomepageSetting {
  if (homepage.kind !== 'file') return homepage;
  const path = pathForFileKey(homepage.file);
  return path ? { kind: 'file', path } : { kind: 'none' };
}

/** Settings as loaded (each file by its path), held by each file's reference. */
export function appSettingsFromStorage(stored: StoredAppSettings): AppSettings {
  return { ...stored, ...perFile<string, FileKey>(stored, fileKeyForPath), homepage: homepageFromStorage(stored.homepage) };
}

/** Settings to save: each file by where it is now. */
export function appSettingsForStorage(settings: AppSettings): StoredAppSettings {
  return { ...settings, ...perFile<FileKey, string>(settings, pathForFileKey), homepage: homepageForStorage(settings.homepage) };
}

/** Whether any setting is kept for this file: when it moves, the settings are saved again, with its new path. */
export function appSettingsReferenceFile(settings: AppSettings, file: FileKey): boolean {
  return (settings.homepage.kind === 'file' && settings.homepage.file === file)
    || settings.powerScriptingAllowedFiles.includes(file)
    || [
      settings.powerScriptAcceptances,
      settings.powerScriptAcceptanceScripts,
      settings.pluginAcceptances,
      settings.webCapabilityProfileBindings,
      settings.webCapabilityAuthorizations,
      settings.webServiceApprovals,
      settings.scheduledDocuments,
    ].some((record) => file in record);
}
