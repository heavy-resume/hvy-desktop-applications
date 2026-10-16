import { loadInstalledPluginPackages, type AppSettings, type InstalledPluginPackageFile } from './backend';
import { loadHvyPluginZip, readHvyPluginZipManifest, type LoadedHvyPluginPackage } from '../../heavy-file-format/src/plugin-package-zip';
import type { HvyPluginPackageManifest } from '../../heavy-file-format/src/plugin-package';
import { createConditionallyAllowedPlugin } from '../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import type { HvyPlugin } from '../../heavy-file-format/src/plugins/types';

export type PluginPolicy = 'disabled' | 'enabled' | 'conditional';

export interface InstalledPluginRecord {
  file: InstalledPluginPackageFile;
  manifest: HvyPluginPackageManifest | null;
  key: string;
  error: string | null;
}

let installedPlugins: InstalledPluginRecord[] = [];
const loadedPackages = new Map<string, Promise<LoadedHvyPluginPackage>>();
const styleElements = new Map<string, HTMLStyleElement[]>();

export function pluginPolicyKey(manifest: Pick<HvyPluginPackageManifest, 'id' | 'uuid' | 'version'>): string {
  return JSON.stringify([manifest.id, manifest.uuid ?? null, manifest.version]);
}

export function getInstalledPlugins(): InstalledPluginRecord[] {
  return installedPlugins;
}

export async function refreshInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  const files = await loadInstalledPluginPackages();
  installedPlugins = files.map((file) => {
    try {
      const manifest = readHvyPluginZipManifest(new Uint8Array(file.bytes));
      return { file, manifest, key: pluginPolicyKey(manifest), error: null };
    } catch (error) {
      return {
        file,
        manifest: null,
        key: file.path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return installedPlugins;
}

async function loadPackage(record: InstalledPluginRecord): Promise<LoadedHvyPluginPackage> {
  if (!record.manifest) throw new Error(record.error ?? `Invalid plugin package "${record.file.name}".`);
  let pending = loadedPackages.get(record.key);
  if (!pending) {
    pending = loadHvyPluginZip(new Uint8Array(record.file.bytes)).then((loaded) => {
      if (!styleElements.has(record.key)) {
        const elements = loaded.styles.map((css) => {
          const style = document.createElement('style');
          style.dataset.hvyPlugin = record.key;
          style.textContent = css;
          document.head.append(style);
          return style;
        });
        styleElements.set(record.key, elements);
      }
      return loaded;
    });
    loadedPackages.set(record.key, pending);
  }
  return pending;
}

export async function enabledDownloadedPlugins(settings: AppSettings, documentPath = ''): Promise<HvyPlugin[]> {
  const plugins: HvyPlugin[] = [];
  for (const record of installedPlugins) {
    if (!record.manifest) continue;
    const configuredPolicy = settings.pluginPolicies[record.key] ?? 'disabled';
    const policy = record.manifest.authorization === 'required' && configuredPolicy === 'enabled'
      ? 'conditional'
      : configuredPolicy;
    if (policy === 'disabled') continue;
    if (policy === 'conditional') {
      if ((settings.pluginAcceptances[documentPath] ?? []).includes(record.key)) {
        plugins.push((await loadPackage(record)).plugin);
        continue;
      }
      const manifest = record.manifest;
      plugins.push(createConditionallyAllowedPlugin({
        ...manifest,
        load: async () => (await loadPackage(record)).plugin,
      }));
    } else {
      plugins.push((await loadPackage(record)).plugin);
    }
  }
  return plugins;
}

export function pluginAcceptanceKey(request: { id: string; uuid?: string; version: string }): string {
  return JSON.stringify([request.id, request.uuid ?? null, request.version]);
}

/**
 * The policy a built-in plugin runs under: what the user chose, or by default
 * enabled for all files, and per-file approval for a plugin that requires it
 * (such as the web plugins), which can never be enabled for all files.
 */
export function builtInPluginPolicy(settings: Pick<AppSettings, 'pluginPolicies'>, plugin: Pick<HvyPlugin, 'id' | 'authorization'>): PluginPolicy {
  const configured = settings.pluginPolicies[plugin.id];
  if (plugin.authorization === 'required') return configured === 'disabled' ? 'disabled' : 'conditional';
  return configured ?? 'enabled';
}

/** Built-in plugins for a document under their policies, as enabledDownloadedPlugins applies them to custom plugins. */
export function enabledBuiltInPlugins(settings: Pick<AppSettings, 'pluginPolicies' | 'pluginAcceptances'>, plugins: HvyPlugin[], documentPath = ''): HvyPlugin[] {
  return plugins.flatMap((plugin) => {
    const policy = builtInPluginPolicy(settings, plugin);
    if (policy === 'disabled') return [];
    // A plugin that requires authorization is already a conditional registration and prompts itself.
    if (policy === 'enabled' || plugin.authorization === 'required') return [plugin];
    if ((settings.pluginAcceptances[documentPath] ?? []).includes(pluginAcceptanceKey(plugin))) return [plugin];
    return [createConditionallyAllowedPlugin({
      id: plugin.id,
      ...(plugin.uuid ? { uuid: plugin.uuid } : {}),
      version: plugin.version,
      hvyApiVersion: plugin.hvyApiVersion,
      displayName: plugin.displayName,
      load: async () => plugin,
    })];
  });
}
