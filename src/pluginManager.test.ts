import { describe, expect, test } from 'vitest';
import { createConditionallyAllowedPlugin } from '../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import { blockedPlugins, builtInPluginPolicy, enabledBuiltInPlugins, pluginAcceptanceKey, pluginPolicyKey } from './pluginManager';

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

  test('mounts a built-in under per-file approval as a conditional registration until the file accepts it', async () => {
    const settings = { pluginPolicies: { [safe.id]: 'conditional' as const }, pluginAcceptances: {} };
    const [unaccepted] = await enabledBuiltInPlugins(settings, [safe], '/doc.hvy');
    expect(unaccepted).toMatchObject({ id: safe.id, authorization: 'required' });
    expect(unaccepted).not.toBe(safe);

    const accepted = { ...settings, pluginAcceptances: { '/doc.hvy': [pluginAcceptanceKey(safe)] } };
    expect(await enabledBuiltInPlugins(accepted, [safe], '/doc.hvy')).toEqual([safe]);
    expect(await enabledBuiltInPlugins({ pluginPolicies: { [safe.id]: 'disabled' }, pluginAcceptances: {} }, [safe, conditional])).toEqual([conditional]);
    expect(await enabledBuiltInPlugins({ pluginPolicies: {}, pluginAcceptances: {} }, [safe, conditional])).toEqual([safe, conditional]);
  });

  test('passes a plugin that requires authorization as its implementation once the file accepts it, so scripts can use it at once', async () => {
    const implementation = { id: 'galaxy.web-api', version: '0.1.0', hvyApiVersion: '0.1', displayName: 'Web API', scripting: { methods: {} } };
    const registration = createConditionallyAllowedPlugin({ ...implementation, load: async () => implementation });
    const settings = { pluginPolicies: {}, pluginAcceptances: { '/doc.hvy': [pluginAcceptanceKey(registration)] } };
    expect(await enabledBuiltInPlugins(settings, [registration], '/doc.hvy')).toEqual([implementation]);
    expect(await enabledBuiltInPlugins(settings, [registration], '/other.hvy')).toEqual([registration]);
  });
});

describe('plugins waiting for approval in a file', () => {
  const implementation = { id: 'galaxy.web-api', version: '0.1.0', hvyApiVersion: '0.1', displayName: 'Web API', scripting: { methods: {} } };
  const registration = createConditionallyAllowedPlugin({ ...implementation, load: async () => implementation });
  const safe = { id: 'hvy.video', version: '0.1.0', hvyApiVersion: '0.1', displayName: 'Video' };

  test('lists the conditional registrations the document uses, with how many blocks use each', () => {
    expect(blockedPlugins([registration, safe], ['galaxy.web-api', 'hvy.video', 'galaxy.web-api'])).toEqual([
      { id: 'galaxy.web-api', version: '0.1.0', displayName: 'Web API', blocks: 2 },
    ]);
  });

  test('leaves out approved plugins, which are mounted as their implementation, and plugins the document does not use', () => {
    expect(blockedPlugins([implementation, safe], ['galaxy.web-api'])).toEqual([]);
    expect(blockedPlugins([registration], ['hvy.video'])).toEqual([]);
  });
});
