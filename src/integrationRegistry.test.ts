import { describe, expect, it } from 'vitest';
import { actionPatternPayload, applyInspectionPrivacyRules, defaultIntegrationRegistry, jsonPathFor, matcherSnapshot, matchingInspectionPrivacyRules, selectedInspectionContent } from './integrationRegistry';

describe('integration registry', () => {
  it('names the default Google profile Personal', () => {
    expect(defaultIntegrationRegistry().profiles[0].name).toBe('Personal');
  });

  it('stores only matcher structure and reconstructs an executable pattern', () => {
    const snapshot = {
      selected: {
        directText: 'Private subject',
        accessibleName: 'Private subject',
        attributes: { title: 'Private subject' },
        shape: { tag: 'strong', semanticLineage: ['abc'] },
        relativePath: [{ tag: 'strong' }, { tag: 'div' }],
      },
    };
    const stored = matcherSnapshot(snapshot);
    expect(JSON.stringify(stored)).not.toContain('Private subject');
    expect(stored).toEqual({ selected: { shape: snapshot.selected.shape, relativePath: snapshot.selected.relativePath } });

    expect(actionPatternPayload({
      id: 'action-1', integrationId: 'custom', name: 'Projects', description: '', pageIds: ['page'], script: 'structural-pattern-v1', resultSchema: {}, permissions: ['dom:read'], version: 1,
      pattern: { recordLabel: 'Project', minimumConfidence: 0.8, parents: [stored], fields: [{ id: 'skills', label: 'SKILLS', cardinality: 'list', optional: false, snapshot: stored }] },
    })).toEqual({ minimumConfidence: 0.8, parents: [stored], targets: [{ label: 'SKILLS', cardinality: 'list', optional: false, snapshot: stored, snapshots: [stored], negativeSnapshots: [] }] });
  });
});

describe('integration inspection privacy', () => {
  it('labels and removes nested values without changing the raw snapshot', () => {
    const raw = {
      selected: {
        directText: 'Ada Lovelace',
        attributes: { href: 'mailto:ada@example.com', class: 'contact' },
      },
    };

    const sanitized = applyInspectionPrivacyRules(raw, [
      { path: '/selected/directText', action: 'label', label: 'person name' },
      { path: '/selected/attributes/href', action: 'remove' },
    ]);

    expect(sanitized).toEqual({
      selected: {
        directText: '{{PERSON_NAME}}',
        attributes: { class: 'contact' },
      },
    });
    expect(raw.selected.directText).toBe('Ada Lovelace');
    expect(raw.selected.attributes.href).toBe('mailto:ada@example.com');
  });

  it('applies a parent label to the complete subtree', () => {
    expect(applyInspectionPrivacyRules({ contact: { name: 'Ada', email: 'ada@example.com' } }, [
      { path: '/contact', action: 'label', label: 'contact record' },
    ])).toEqual({ contact: '{{CONTACT_RECORD}}' });
  });

  it('escapes JSON pointer path components', () => {
    expect(jsonPathFor('/selected', 'data/name~raw')).toBe('/selected/data~1name~0raw');
  });

  it('promotes direct selected text for the action example', () => {
    expect(selectedInspectionContent({ selected: { directText: 'Important text', descendantText: 'More text' } })).toBe('Important text');
  });

  it('masks duplicate copies of a selected value throughout one snapshot', () => {
    const snapshot = { selected: { directText: 'Private subject', descendantText: 'Private subject' }, nearby: 'Different subject' };
    const rules = matchingInspectionPrivacyRules(snapshot, '/selected/directText', 'label', 'SUBJECT');
    expect(applyInspectionPrivacyRules(snapshot, rules)).toEqual({
      selected: { directText: '{{SUBJECT}}', descendantText: '{{SUBJECT}}' },
      nearby: 'Different subject',
    });
  });
});
