import { describe, expect, test } from 'vitest';
import { unzipSync } from 'fflate';

import { buildPluginProjectPackage, createPluginProjectScaffold, normalizePluginProjectRecord, validatePluginProjectFiles } from './pluginProjects';

describe('plugin project scaffolds', () => {
  test('creates a JavaScript package-format project', () => {
    const scaffold = createPluginProjectScaffold(
      'Skill Rating',
      'javascript-component',
      () => 'plugin-uuid',
    );

    expect(scaffold.directoryName).toBe('skill-rating');
    expect(scaffold.manifest).toMatchObject({
      formatVersion: '0.2',
      id: 'skill-rating',
      uuid: 'plugin-uuid',
      version: '1.0.0',
      entry: 'plugin.js',
      styles: ['plugin.css'],
      documentation: 'documentation.txt',
    });
    expect(scaffold.files.map((file) => file.path)).toEqual([
      'hvy-plugin.json',
      'plugin.js',
      'plugin.css',
      'documentation.txt',
    ]);
    expect(scaffold.files.find((file) => file.path === 'plugin.js')?.content)
      .toContain("export default plugin");
  });

  test('creates a Python package-format project', () => {
    const scaffold = createPluginProjectScaffold(
      'Timeline',
      'python-component',
      () => 'python-uuid',
    );

    expect(scaffold.manifest.id).toBe('timeline');
    expect(scaffold.manifest.entry).toBe('plugin.py');
    expect(scaffold.files.find((file) => file.path === 'plugin.py')?.content)
      .toContain('plugin = {');
  });

  test('requires a name', () => {
    expect(() => createPluginProjectScaffold('   ', 'javascript-component'))
      .toThrow('Plugin name is required.');
  });

  test('uses the reference manifest parser for discovered projects', () => {
    const normalized = normalizePluginProjectRecord({
      directoryName: 'broken',
      path: '/workspace/plugins/broken',
      manifest: { displayName: 'Broken' } as never,
      error: null,
    });

    expect(normalized.manifest).toBeNull();
    expect(normalized.error).toContain('formatVersion');
  });

  test('validates and builds a deterministic package', () => {
    const scaffold = createPluginProjectScaffold('Timeline', 'javascript-component', () => 'timeline-uuid');

    expect(validatePluginProjectFiles(scaffold.files).diagnostics).toEqual([]);
    const first = buildPluginProjectPackage(scaffold.files);
    const second = buildPluginProjectPackage([...scaffold.files].reverse());

    expect(first.name).toBe('timeline.hvy.plugin');
    expect(first.manifest).toEqual(scaffold.manifest);
    expect(first.bytes).toEqual(second.bytes);
  });

  test('reports missing manifest files', () => {
    const scaffold = createPluginProjectScaffold('Timeline', 'python-component', () => 'timeline-uuid');
    const files = scaffold.files.filter((file) => file.path !== 'plugin.css');

    expect(validatePluginProjectFiles(files).diagnostics).toEqual([{
      severity: 'error',
      path: 'plugin.css',
      message: 'Manifest file "plugin.css" does not exist in the project.',
    }]);
  });

  test('preserves binary project assets in a build', () => {
    const scaffold = createPluginProjectScaffold('Timeline', 'javascript-component', () => 'timeline-uuid');
    const asset = [0, 255, 4, 128];
    const built = buildPluginProjectPackage([
      ...scaffold.files,
      { path: 'assets/marker.bin', content: null, bytes: asset },
    ]);

    expect(Array.from(unzipSync(built.bytes)['assets/marker.bin'] ?? [])).toEqual(asset);
  });
});
