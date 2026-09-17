import { describe, expect, it } from 'vitest';
import { applyDefinitionPatch, diffDefinition, type DefinitionDiffOptions } from './templateDefinitionDiff';

const options: DefinitionDiffOptions = {
  identity: (value) => value && typeof value === 'object' && 'id' in value ? String(value.id) : undefined,
  ignoreProperty: () => false,
  instantiate: structuredClone,
};
const diff = (before: unknown, after: unknown) => diffDefinition(before, after, options);
const apply = <T>(value: T, patch: ReturnType<typeof diff>) => applyDefinitionPatch(value, patch, options);

describe('definition patches', () => {
  it('patches arbitrary added, changed, and removed properties while leaving unchanged data alone', () => {
    const before = { config: { enabled: false, count: 1, obsolete: true, payload: 'fill me', key: 'old' } };
    const after = { config: { enabled: true, count: 4, added: { custom: 7 }, payload: 'fill me', key: 'new' } };
    const instance = { config: { enabled: false, count: 100, obsolete: false, payload: 'real data', key: 'overridden', local: 'keep' } };
    const patch = diff(before, after);
    expect(apply(instance, patch)).toEqual({ config: { enabled: true, count: 4, added: { custom: 7 }, payload: 'real data', key: 'new', local: 'keep' } });
    expect(instance.config.count).toBe(100);
    expect(before.config.enabled).toBe(false);
    expect(after.config.payload).toBe('fill me');
  });

  it('does nothing to differing instance values when the definition has not changed', () => {
    const definition = { css: 'old', value: 'placeholder', custom: { enabled: false } };
    const instance = { css: 'instance', value: 'data', custom: { enabled: true } };
    expect(diff(definition, structuredClone(definition))).toBeNull();
    expect(apply(instance, diff(definition, definition))).toBe(instance);
  });

  it('applies a single patch to multiple independently filled instances', () => {
    const patch = diff({ style: '', data: 'placeholder' }, { style: 'new style', data: 'placeholder' });
    expect(['one', 'two'].map((data) => apply({ style: 'custom', data }, patch)))
      .toEqual([{ style: 'new style', data: 'one' }, { style: 'new style', data: 'two' }]);
  });

  it('matches reordered nodes by identity when all their labels also change', () => {
    const before = [{ id: 'a', label: 'Alpha', data: '?' }, { id: 'b', label: 'Beta', data: '?' }];
    const after = [{ id: 'b', label: 'Second', data: '?' }, { id: 'a', label: 'First', data: '?' }];
    expect(apply([{ ...before[0], data: 'A data' }, { ...before[1], data: 'B data' }], diff(before, after)))
      .toEqual([{ id: 'b', label: 'Second', data: 'B data' }, { id: 'a', label: 'First', data: 'A data' }]);
  });

  it('does not reorder instance nodes when the definition only changes a property', () => {
    const before = [{ id: 'a', style: '' }, { id: 'b', style: '' }];
    const after = [{ id: 'a', style: 'new' }, before[1]];
    expect(apply([before[1], before[0]], diff(before, after))).toEqual([before[1], after[0]]);
  });

  it('adds and removes nested nodes while preserving neighboring local nodes', () => {
    const before = { nodes: [{ id: 'a', data: '' }, { id: 'b', data: '' }] };
    const after = { nodes: [{ id: 'a', data: '' }, { id: 'c', data: 'new' }] };
    const instance = { nodes: [{ id: 'a', data: 'filled' }, { id: 'local', data: 'local' }, { id: 'b', data: 'removed' }] };
    const expected = { nodes: [{ id: 'a', data: 'filled' }, { id: 'local', data: 'local' }, { id: 'c', data: 'new' }] };
    const patch = diff(before, after);
    expect(apply(instance, patch)).toEqual(expected);
    expect(apply(expected, patch)).toEqual(expected);
  });

  it('applies wording, punctuation, and token changes inside text without losing unrelated filled text', () => {
    const before = 'Name: {% name %}\nBio: {% bio %}\nThanks.';
    const after = 'Full name: {% name %}\nBiography: {% bio | block %}\nThank you!';
    expect(apply('Name: Ada Lovelace\nBio: {% bio %}\nThanks.', diff(before, after)))
      .toBe('Full name: Ada Lovelace\nBiography: {% bio | block %}\nThank you!');
  });

  it('applies ordinary text edits without understanding template variable syntax', () => {
    const before = 'Hello PERSON. Visit PLACE today.';
    const after = 'Welcome PERSON! Visit PLACE tomorrow.';
    expect(apply('Hello Ada. Visit London today.', diff(before, after)))
      .toBe('Welcome Ada! Visit London tomorrow.');
  });
});

it('changes a fixed Markdown link label while preserving a filled destination', () => {
  const before = '[Fixed label]({% url %})';
  const after = '[Updated label]({% url %})';
  expect(apply('[Fixed label](https://example.com/profile)', diff(before, after)))
    .toBe('[Updated label](https://example.com/profile)');
});
