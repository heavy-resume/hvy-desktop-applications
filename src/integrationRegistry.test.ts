import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionPatternPayload, applyInspectionPrivacyRules, commandExecutionPayload, defaultIntegrationRegistry, jsonPathFor, loadIntegrationRegistry, matcherSnapshot, matchingInspectionPrivacyRules, pageCommandExecutionPayload, selectedInspectionContent } from './integrationRegistry';

afterEach(() => vi.unstubAllGlobals());

describe('integration registry', () => {
  it('names the default Google profile Personal', () => {
    expect(defaultIntegrationRegistry().profiles[0].name).toBe('Personal');
  });

  it('does not configure automatic web integrations', () => {
    const registry = defaultIntegrationRegistry();
    expect(registry.integrations).toEqual([]);
    expect(registry.profiles.map((profile) => profile.id)).toEqual(['default-google']);
  });

  it('restores manually configured web pages and their visible profiles', () => {
    const saved = defaultIntegrationRegistry();
    saved.profiles.push({ id: 'work-google', name: 'Work', providerId: 'google', browserStoreId: 'work-google' });
    saved.integrations.push({
      id: 'custom-mail',
      name: 'Mail',
      profileProviderId: 'browser',
      editable: true,
      pages: [{ id: 'custom-mail-page', name: 'Mail', url: 'https://example.com/mail', allowedOrigins: ['https://example.com'], editable: true, visibleProfileIds: ['work-google'] }],
      actions: [],
    });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) });

    const loaded = loadIntegrationRegistry();

    expect(loaded.integrations.find((integration) => integration.id === 'custom-mail')?.pages[0].visibleProfileIds).toEqual(['work-google']);
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
    })).toEqual({ minimumConfidence: 0.8, parents: [stored], targets: [{ label: 'SKILLS', cardinality: 'list', optional: false, snapshot: stored, snapshots: [stored], negativeSnapshots: [], exampleSnapshots: [] }] });
  });

  it('packages one-step commands with the record pattern and selected record identity', () => {
    const snapshot = { selected: { shape: { tag: 'button' }, relativePath: [{ tag: 'button' }] } };
    const action = {
      id: 'action-1', integrationId: 'custom', name: 'Messages', description: '', pageIds: ['page'], script: 'structural-pattern-v1', resultSchema: {}, permissions: ['dom:read' as const], version: 1,
      pattern: { recordLabel: 'Message', minimumConfidence: 0.8, parents: [snapshot], fields: [{ id: 'subject', label: 'SUBJECT', cardinality: 'single' as const, optional: false, snapshot }] },
    };
    const command = { id: 'open', name: 'Open', scope: 'record' as const, steps: [{ gesture: 'click' as const, target: snapshot }] };

    expect(commandExecutionPayload(action, command, 'main > article:nth-of-type(2)')).toEqual({
      pattern: actionPatternPayload(action),
      command,
      recordParent: 'main > article:nth-of-type(2)',
    });
  });

  it('packages page commands without coupling them to a record definition', () => {
    const snapshot = { selected: { shape: { tag: 'button' }, relativePath: [{ tag: 'button' }] } };
    const command = { id: 'compose', name: 'Compose', scope: 'page' as const, inputs: [{ id: 'body', name: 'Body', required: true }], steps: [{ gesture: 'click' as const, target: snapshot }, { gesture: 'type' as const, target: snapshot, inputId: 'body' }] };

    expect(pageCommandExecutionPayload(command, { body: 'Hello' })).toEqual({
      pattern: { minimumConfidence: 0.8, parents: [], targets: [] },
      command,
      inputs: { body: 'Hello' },
    });
  });

  it('does not restore legacy automatic integrations from saved state', () => {
    const saved = defaultIntegrationRegistry();
    saved.integrations.push({
      id: 'gmail', name: 'Gmail', profileProviderId: 'google', editable: false,
      pages: [{ id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', allowedOrigins: ['https://mail.google.com'], editable: false }],
      actions: [],
    });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) });

    const loaded = loadIntegrationRegistry();
    expect(loaded.integrations).toEqual([]);
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
