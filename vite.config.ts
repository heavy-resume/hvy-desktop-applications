import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { createBrythonMinimalVfsPlugin } from 'heavy-file-format-ref-impl/brython-minimal-vfs-plugin';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json') as { version: string };
const BUILT_IN_PLUGINS_ID = 'virtual:hvy-built-in-plugins';
const BUILT_IN_PLUGINS_RESOLVED_ID = `\0${BUILT_IN_PLUGINS_ID}`;
const HVY_REFERENCE_ROOT = resolve('../heavy-file-format');
const HVY_APP_ROOT = resolve('.');

const builtInDefinitions = [
  {
    id: 'hvy.db-table',
    key: 'dbTable',
    exportName: 'dbTablePlugin',
    modulePath: 'src/plugins/db-table/db-table-component.ts',
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
    id: 'hvy.canvas',
    key: 'canvas',
    exportName: 'canvasPlugin',
    modulePath: 'src/plugins/canvas/canvas.ts',
  },
  {
    id: 'hvy.power-scripting',
    key: 'powerScripting',
    exportName: 'powerScriptingPlugin',
    modulePath: 'src/plugins/power-scripting/power-scripting.ts',
  },
  {
    id: 'hvy.graph',
    key: 'graph',
    exportName: 'graphPlugin',
    modulePath: 'src/plugins/graph.ts',
  },
  {
    id: 'hvy.diagram',
    key: 'diagram',
    exportName: 'diagramPlugin',
    modulePath: 'src/plugins/diagram.ts',
  },
  {
    id: 'hvy.qr-code',
    key: 'qrCode',
    exportName: 'qrCodePlugin',
    modulePath: 'src/plugins/qr-code/qr-code.ts',
  },
  {
    id: 'hvy.video',
    key: 'video',
    exportName: 'videoPlugin',
    modulePath: 'src/plugins/video/video.ts',
  },
  {
    id: 'hvy.editable-text',
    key: 'editableText',
    exportName: 'editableTextPlugin',
    modulePath: 'src/plugins/editable-text/editable-text.ts',
  },
  {
    id: 'hvy.web-records',
    key: 'webRecords',
    exportName: 'webRecordsPlugin',
    modulePath: 'src/plugins/webCapabilities.ts',
    root: 'app',
  },
  {
    id: 'hvy.web-command',
    key: 'webCommand',
    exportName: 'webCommandPlugin',
    modulePath: 'src/plugins/webCapabilities.ts',
    root: 'app',
  },
] as const;

function createHvyBuiltInPluginsPlugin(): Plugin {
  const imports = builtInDefinitions.map((definition, index) => {
    const modulePath = `/@fs/${resolve('root' in definition && definition.root === 'app' ? HVY_APP_ROOT : HVY_REFERENCE_ROOT, definition.modulePath)}`;
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

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [createBrythonMinimalVfsPlugin(), createHvyBuiltInPluginsPlugin()],
  optimizeDeps: {
    entries: ['index.html', 'plugin-builder.html'],
  },
  test: {
    setupFiles: ['./src/test/vitest.setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/.electron-dev/**',
      '**/dist-electron/**',
      '**/src-tauri/target/**',
      'src/integration-inspector.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@automerge/automerge': resolve('node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js'),
      'pdfmake/build/pdfmake.js': require.resolve('pdfmake/build/pdfmake.js'),
      'pdfmake/build/vfs_fonts.js': require.resolve('pdfmake/build/vfs_fonts.js'),
    },
  },
  build: {
    target: ['safari13'],
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        pluginBuilder: resolve('plugin-builder.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        '**/.electron-dev/**',
        '**/dist-electron/**',
        '**/dist/**',
        '**/src-tauri/target/**',
      ],
    },
    fs: {
      allow: ['..'],
    },
  },
});
