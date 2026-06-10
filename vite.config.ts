import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json') as { version: string };
const BUILT_IN_PLUGINS_ID = 'virtual:hvy-built-in-plugins';
const BUILT_IN_PLUGINS_RESOLVED_ID = `\0${BUILT_IN_PLUGINS_ID}`;
const BRYTHON_MINIMAL_VFS_ID = 'virtual:hvy-brython-minimal-vfs';
const BRYTHON_MINIMAL_VFS_RESOLVED_ID = `\0${BRYTHON_MINIMAL_VFS_ID}`;
const HVY_REFERENCE_ROOT = resolve('../heavy-file-format');

const builtInDefinitions = [
  {
    id: 'hvy.db-table',
    key: 'dbTable',
    exportName: 'dbTablePlugin',
    modulePath: 'src/plugins/db-table-plugin.ts',
  },
  {
    id: 'hvy.form',
    key: 'form',
    exportName: 'formPlugin',
    modulePath: 'src/plugins/form.ts',
  },
  {
    id: 'hvy.progress-bar',
    key: 'progressBar',
    exportName: 'progressBarPlugin',
    modulePath: 'src/plugins/progress-bar.ts',
  },
  {
    id: 'hvy.scripting',
    key: 'scripting',
    exportName: 'scriptingPlugin',
    modulePath: 'src/plugins/scripting/scripting.ts',
  },
  {
    id: 'hvy.graph',
    key: 'graph',
    exportName: 'graphPlugin',
    modulePath: 'src/plugins/graph.ts',
  },
  {
    id: 'hvy.qr-code',
    key: 'qrCode',
    exportName: 'qrCodePlugin',
    modulePath: 'src/plugins/qr-code/qr-code.ts',
  },
] as const;

function createHvyBuiltInPluginsPlugin(): Plugin {
  const imports = builtInDefinitions.map((definition, index) => {
    const modulePath = `/@fs/${resolve(HVY_REFERENCE_ROOT, definition.modulePath)}`;
    return `import { ${definition.exportName} as plugin${index} } from ${JSON.stringify(modulePath)};`;
  });

  return {
    name: 'hvy-galaxy-built-in-plugins',
    resolveId(id) {
      return id === BUILT_IN_PLUGINS_ID ? BUILT_IN_PLUGINS_RESOLVED_ID : null;
    },
    load(id) {
      if (id !== BUILT_IN_PLUGINS_RESOLVED_ID) {
        return null;
      }
      return [
        ...imports,
        `export const builtInPluginIds = ${JSON.stringify(builtInDefinitions.map((definition) => definition.id))};`,
        `export const builtInPlugins = [${builtInDefinitions.map((_definition, index) => `plugin${index}`).join(', ')}];`,
        `export const builtInPluginMap = Object.freeze({`,
        ...builtInDefinitions.map((definition, index) => `  ${definition.key}: plugin${index},`),
        `});`,
        `export const builtInPluginById = Object.freeze({`,
        ...builtInDefinitions.map((definition, index) => `  ${JSON.stringify(definition.id)}: plugin${index},`),
        `});`,
      ].join('\n');
    },
  };
}

function createBrythonMinimalVfsPlugin(): Plugin {
  return {
    name: 'hvy-galaxy-brython-minimal-vfs',
    resolveId(id) {
      return id === BRYTHON_MINIMAL_VFS_ID ? BRYTHON_MINIMAL_VFS_RESOLVED_ID : null;
    },
    load(id) {
      if (id !== BRYTHON_MINIMAL_VFS_RESOLVED_ID) {
        return null;
      }
      const stdlibPath = require.resolve('brython/brython_stdlib.js');
      const stdlibSource = require('node:fs').readFileSync(stdlibPath, 'utf8') as string;
      const marker = 'var scripts = ';
      const start = stdlibSource.indexOf(marker);
      const end = stdlibSource.lastIndexOf('\n__BRYTHON__.update_VFS');
      if (start < 0 || end < 0) {
        throw new Error('Unable to extract Brython VFS metadata.');
      }
      const vfs = Function(`return ${stdlibSource.slice(start + marker.length, end).trim().replace(/;$/, '')}`)() as Record<string, unknown>;
      const minimalVfs = {
        $timestamp: vfs.$timestamp,
        browser: vfs.browser,
        sys: vfs.sys,
      };
      const source = [
        '__BRYTHON__.use_VFS = true;',
        `__BRYTHON__.update_VFS(${JSON.stringify(minimalVfs)});`,
      ].join('\n');
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [createBrythonMinimalVfsPlugin(), createHvyBuiltInPluginsPlugin()],
  resolve: {
    alias: {
      'pdfmake/build/pdfmake.js': require.resolve('pdfmake/build/pdfmake.js'),
      'pdfmake/build/vfs_fonts.js': require.resolve('pdfmake/build/vfs_fonts.js'),
    },
  },
  build: {
    target: ['safari13'],
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
  },
});
