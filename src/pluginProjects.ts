import { parseHvyPluginPackageManifest, type HvyPluginPackageManifest } from '../../heavy-file-format/src/plugin-package';
import { readHvyPluginZipManifest } from '../../heavy-file-format/src/plugin-package-zip';
import { strToU8, zipSync, type Zippable } from 'fflate';

export type PluginProjectStarter = 'javascript-component' | 'python-component';

export interface PluginProjectRecord {
  directoryName: string;
  path: string;
  manifest: HvyPluginPackageManifest | null;
  error: string | null;
}

export interface PluginProjectSourceFile {
  path: string;
  content: string;
}

export interface PluginProjectFile {
  path: string;
  content: string | null;
  bytes: number[] | null;
  modifiedAt: number | null;
}

export type PluginProjectPackageFile = Pick<PluginProjectFile, 'path' | 'content' | 'bytes'> | PluginProjectSourceFile;

export interface PluginProjectDiagnostic {
  severity: 'error';
  path: string;
  message: string;
}

export interface PluginProjectValidationResult {
  manifest: HvyPluginPackageManifest | null;
  diagnostics: PluginProjectDiagnostic[];
}

export interface WritePluginProjectFileRequest {
  workspacePath: string;
  directoryName: string;
  path: string;
  content: string;
}

export interface WritePluginProjectBuildRequest {
  workspacePath: string;
  directoryName: string;
  name: string;
  bytes: number[];
}

export interface PluginProjectBuildResult {
  path: string;
  name: string;
}

export interface CreatePluginProjectRequest {
  workspacePath: string;
  directoryName: string;
  files: PluginProjectSourceFile[];
}

export interface PluginProjectScaffold {
  directoryName: string;
  manifest: HvyPluginPackageManifest;
  files: PluginProjectSourceFile[];
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'plugin';
}

function javascriptSource(manifest: HvyPluginPackageManifest, className: string): string {
  return `const plugin = {
  id: ${JSON.stringify(manifest.id)},
  uuid: ${JSON.stringify(manifest.uuid)},
  version: ${JSON.stringify(manifest.version)},
  hvyApiVersion: ${JSON.stringify(manifest.hvyApiVersion)},
  displayName: ${JSON.stringify(manifest.displayName)},
  create(ctx) {
    const element = document.createElement('div');
    element.className = ${JSON.stringify(className)};

    const render = () => {
      element.textContent = ctx.mode === 'editor'
        ? ${JSON.stringify(`${manifest.displayName} editor`)}
        : ${JSON.stringify(manifest.displayName)};
    };

    render();
    return { element, refresh: render };
  },
};

export default plugin;
`;
}

function pythonSource(manifest: HvyPluginPackageManifest, className: string): string {
  return `def create_component(ctx):
    from browser import document

    element = document.createElement("div")
    element.className = ${JSON.stringify(className)}

    def render():
        element.textContent = ${JSON.stringify(manifest.displayName)} + (" editor" if ctx.mode == "editor" else "")

    render()
    return {"element": element, "refresh": render}


plugin = {
    "id": ${JSON.stringify(manifest.id)},
    "uuid": ${JSON.stringify(manifest.uuid)},
    "version": ${JSON.stringify(manifest.version)},
    "hvyApiVersion": ${JSON.stringify(manifest.hvyApiVersion)},
    "displayName": ${JSON.stringify(manifest.displayName)},
    "create": create_component,
}
`;
}

export function createPluginProjectScaffold(
  name: string,
  starter: PluginProjectStarter,
  createUuid: () => string = () => crypto.randomUUID(),
): PluginProjectScaffold {
  const displayName = name.trim();
  if (!displayName) throw new Error('Plugin name is required.');
  const directoryName = slug(displayName);
  const entry = starter === 'python-component' ? 'plugin.py' : 'plugin.js';
  const manifest: HvyPluginPackageManifest = {
    formatVersion: '0.2',
    id: directoryName,
    uuid: createUuid(),
    version: '1.0.0',
    displayName,
    entry,
    styles: ['plugin.css'],
    documentation: 'documentation.txt',
    permissions: [],
    hvyApiVersion: '0.1',
  };
  const className = `hvy-plugin-${directoryName}`;
  const entrySource = starter === 'python-component'
    ? pythonSource(manifest, className)
    : javascriptSource(manifest, className);
  return {
    directoryName,
    manifest,
    files: [
      { path: 'hvy-plugin.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: entry, content: entrySource },
      {
        path: 'plugin.css',
        content: `.${className} {\n  padding: 0.75rem;\n  border: 1px solid var(--hvy-border-color, #c9c5bc);\n  border-radius: 0.5rem;\n}\n`,
      },
      {
        path: 'documentation.txt',
        content: `${displayName}\n\nDescribe what this plugin does and how its configuration is stored.\n`,
      },
    ],
  };
}

export function pluginProjectStarterLabel(starter: PluginProjectStarter): string {
  return starter === 'python-component' ? 'Sandboxed Scripting' : 'Power Scripting';
}

export function normalizePluginProjectRecord(record: PluginProjectRecord): PluginProjectRecord {
  if (!record.manifest) return record;
  try {
    return {
      ...record,
      manifest: parseHvyPluginPackageManifest(JSON.stringify(record.manifest)),
      error: null,
    };
  } catch (error) {
    return {
      ...record,
      manifest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function projectFileText(file: PluginProjectPackageFile): string | null {
  return typeof file.content === 'string' ? file.content : null;
}

export function validatePluginProjectFiles(files: PluginProjectPackageFile[]): PluginProjectValidationResult {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const manifestSource = byPath.get('hvy-plugin.json');
  if (typeof manifestSource !== 'string') {
    return {
      manifest: null,
      diagnostics: [{ severity: 'error', path: 'hvy-plugin.json', message: 'Plugin project must include hvy-plugin.json.' }],
    };
  }
  let manifest: HvyPluginPackageManifest;
  try {
    manifest = parseHvyPluginPackageManifest(manifestSource);
  } catch (error) {
    return {
      manifest: null,
      diagnostics: [{
        severity: 'error',
        path: 'hvy-plugin.json',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  const diagnostics: PluginProjectDiagnostic[] = [];
  for (const path of [manifest.entry, ...manifest.styles, ...(manifest.documentation ? [manifest.documentation] : [])]) {
    if (!byPath.has(path)) diagnostics.push({ severity: 'error', path, message: `Manifest file "${path}" does not exist in the project.` });
  }
  return { manifest, diagnostics };
}

export function buildPluginProjectPackage(files: PluginProjectPackageFile[]): {
  manifest: HvyPluginPackageManifest;
  name: string;
  bytes: Uint8Array;
} {
  const validation = validatePluginProjectFiles(files);
  if (!validation.manifest || validation.diagnostics.length > 0) {
    throw new Error(validation.diagnostics[0]?.message ?? 'Plugin project is invalid.');
  }
  const archiveFiles: Zippable = {};
  const mtime = new Date('1980-01-02T00:00:00.000Z');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (file.path === 'dist' || file.path.startsWith('dist/')) continue;
    const content = projectFileText(file);
    const bytes = content === null && 'bytes' in file && file.bytes ? Uint8Array.from(file.bytes) : strToU8(content ?? '');
    archiveFiles[file.path] = [bytes, { mtime }];
  }
  const bytes = zipSync(archiveFiles, { level: 6 });
  const manifest = readHvyPluginZipManifest(bytes);
  return {
    manifest,
    name: `${slug(manifest.displayName)}.hvy.plugin`,
    bytes,
  };
}
