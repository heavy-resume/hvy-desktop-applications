import type { AppSettings } from './backend';

function moveKey<T>(record: Record<string, T>, previousPath: string, nextPath: string): Record<string, T> {
  if (!(previousPath in record)) return record;
  const { [previousPath]: moved, ...rest } = record;
  return { ...rest, [nextPath]: moved };
}

/**
 * App settings after a document moves from one path to another (rename, move between workspaces, archive): the
 * settings Galaxy keeps per file follow it. A copy keeps none of them, so trust never comes with a copied file.
 */
export function relocatedDocumentSettings(settings: AppSettings, previousPath: string, nextPath: string): AppSettings {
  const keyed = [settings.powerScriptAcceptances, settings.powerScriptAcceptanceScripts, settings.pluginAcceptances, settings.webCapabilityProfileBindings, settings.webCapabilityAuthorizations, settings.webServiceApprovals];
  const hasSettings = (settings.homepage.kind === 'file' && settings.homepage.path === previousPath)
    || settings.powerScriptingAllowedFiles.includes(previousPath)
    || keyed.some((record) => previousPath in record);
  if (previousPath === nextPath || !hasSettings) return settings;
  return {
    ...settings,
    homepage: settings.homepage.kind === 'file' && settings.homepage.path === previousPath ? { kind: 'file', path: nextPath } : settings.homepage,
    powerScriptingAllowedFiles: settings.powerScriptingAllowedFiles.map((path) => (path === previousPath ? nextPath : path)),
    powerScriptAcceptances: moveKey(settings.powerScriptAcceptances, previousPath, nextPath),
    powerScriptAcceptanceScripts: moveKey(settings.powerScriptAcceptanceScripts, previousPath, nextPath),
    pluginAcceptances: moveKey(settings.pluginAcceptances, previousPath, nextPath),
    webCapabilityProfileBindings: moveKey(settings.webCapabilityProfileBindings, previousPath, nextPath),
    webCapabilityAuthorizations: moveKey(settings.webCapabilityAuthorizations, previousPath, nextPath),
    webServiceApprovals: moveKey(settings.webServiceApprovals, previousPath, nextPath),
  };
}
