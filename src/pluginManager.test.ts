import { describe, expect, test } from 'vitest';
import { builtInPluginPolicy, enabledBuiltInPlugins, pluginAcceptanceKey, pluginPolicyKey } from './pluginManager';

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

describe('built-in plugin policies', () => {
  const safe = { id: 'hvy.video', version: '0.1.0', hvyApiVersion: '0.1', displayName: 'Video' };
  const conditional = { ...safe, id: 'galaxy.web-collection', displayName: 'Web Collection', authorization: 'required' as const, load: async () => safe };

  test('defaults to enabled for safe built-ins, and to per-file approval for ones that require it', () => {
    expect(builtInPluginPolicy({ pluginPolicies: {} }, safe)).toBe('enabled');
    expect(builtInPluginPolicy({ pluginPolicies: {} }, conditional)).toBe('conditional');
    expect(builtInPluginPolicy({ pluginPolicies: { [conditional.id]: 'enabled' } }, conditional)).toBe('conditional');
    expect(builtInPluginPolicy({ pluginPolicies: { [conditional.id]: 'disabled' } }, conditional)).toBe('disabled');
    expect(builtInPluginPolicy({ pluginPolicies: { [safe.id]: 'conditional' } }, safe)).toBe('conditional');
  });

  test('mounts a built-in under per-file approval as a conditional registration until the file accepts it', () => {
    const settings = { pluginPolicies: { [safe.id]: 'conditional' as const }, pluginAcceptances: {} };
    const [unaccepted] = enabledBuiltInPlugins(settings, [safe], '/doc.hvy');
    expect(unaccepted).toMatchObject({ id: safe.id, authorization: 'required' });
    expect(unaccepted).not.toBe(safe);

    const accepted = { ...settings, pluginAcceptances: { '/doc.hvy': [pluginAcceptanceKey(safe)] } };
    expect(enabledBuiltInPlugins(accepted, [safe], '/doc.hvy')).toEqual([safe]);
    expect(enabledBuiltInPlugins({ pluginPolicies: { [safe.id]: 'disabled' }, pluginAcceptances: {} }, [safe, conditional])).toEqual([conditional]);
    expect(enabledBuiltInPlugins({ pluginPolicies: {}, pluginAcceptances: {} }, [safe, conditional])).toEqual([safe, conditional]);
  });
});
