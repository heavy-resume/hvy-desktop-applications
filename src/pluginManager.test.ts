import { describe, expect, test } from 'vitest';
import { pluginAcceptanceKey, pluginPolicyKey } from './pluginManager';

describe('downloaded plugin identity keys', () => {
  test('policy and per-file acceptance use the same exact identity and version', () => {
    const plugin = { id: 'com.example.lookup', uuid: 'lookup-primary', version: '1.2.0' };
    expect(pluginPolicyKey(plugin)).toBe(pluginAcceptanceKey(plugin));
    expect(pluginPolicyKey(plugin)).not.toBe(pluginPolicyKey({ ...plugin, version: '1.3.0' }));
  });

  test('keeps an omitted UUID distinct from an explicit UUID', () => {
    const withoutUuid = pluginPolicyKey({ id: 'com.example.lookup', version: '1.2.0' });
    const withUuid = pluginPolicyKey({ id: 'com.example.lookup', uuid: 'lookup-primary', version: '1.2.0' });
    expect(withoutUuid).not.toBe(withUuid);
  });
});
