import { describe, expect, it } from 'vitest';
import {
  authorizeWebCapabilityRecord,
  createWebCommandCapabilityConfig,
  createWebRecordsCapabilityConfig,
  isWebCapabilityAuthorized,
  readWebRecordsCapabilityConfig,
  reviewWebCapabilityAuthorization,
  setWebCapabilityProfileBinding,
  webCapabilityHash,
} from './webCapabilities';
import type { IntegrationActionDefinition, IntegrationCommandDefinition, IntegrationPageDefinition } from './integrationRegistry';

const snapshot = {
  selected: {
    directText: 'Private subject',
    accessibleName: 'Private subject',
    shape: { tag: 'strong', roles: ['heading'] },
    relativePath: [{ tag: 'strong' }],
  },
};

const page: IntegrationPageDefinition = {
  id: 'mail',
  name: 'Mail',
  url: 'https://mail.example.com/inbox',
  allowedOrigins: ['https://mail.example.com'],
  editable: true,
};

const itemCommand: IntegrationCommandDefinition = {
  id: 'open',
  name: 'Open message',
  scope: 'record',
  steps: [{ gesture: 'click', target: snapshot }],
};

const action: IntegrationActionDefinition = {
  id: 'messages',
  integrationId: 'mail',
  name: 'Messages',
  description: 'Inbox messages',
  pageIds: ['mail'],
  script: 'structural-pattern-v1',
  resultSchema: { type: 'array' },
  permissions: ['dom:read'],
  version: 1,
  pattern: {
    recordLabel: 'Message',
    minimumConfidence: 0.8,
    parents: [snapshot],
    fields: [{ id: 'subject', label: 'Subject', cardinality: 'single', optional: false, snapshot }],
  },
  commands: [itemCommand],
};

describe('web capabilities', () => {
  it('copies a portable record definition without private inspection text or profiles', () => {
    const config = createWebRecordsCapabilityConfig('mail', page, action, 'inbox');
    const serialized = JSON.stringify(config);

    expect(config.capabilityId).toBe('inbox');
    expect(config.record.commands[0]?.steps[0]?.target).toEqual({
      selected: { shape: snapshot.selected.shape, relativePath: snapshot.selected.relativePath },
    });
    expect(serialized).not.toContain('Private subject');
    expect(serialized).not.toContain('profile');
    expect(readWebRecordsCapabilityConfig(JSON.parse(serialized))).toEqual(config);
  });

  it('keeps MCP item commands disabled unless record reads are exposed', () => {
    const config = createWebRecordsCapabilityConfig('mail', page, action, 'inbox');
    const parsed = readWebRecordsCapabilityConfig({
      ...config,
      mcp: { exposeRead: false, commandIds: ['open'] },
    });

    expect(parsed?.mcp).toEqual({ exposeRead: false, commandIds: [] });
  });

  it('hashes execution behavior but not MCP exposure or source registry IDs', () => {
    const config = createWebRecordsCapabilityConfig('mail', page, action, 'inbox');
    const initialHash = webCapabilityHash(config);

    expect(webCapabilityHash({ ...config, mcp: { exposeRead: true, commandIds: ['open'] } })).toBe(initialHash);
    expect(webCapabilityHash({ ...config, source: { integrationId: 'other', pageId: 'other' } })).toBe(initialHash);
    expect(webCapabilityHash({ ...config, page: { ...config.page, url: 'https://mail.example.com/archive' } })).not.toBe(initialHash);
  });

  it('binds profiles locally and authorizes an exact capability/profile pair', () => {
    const config = createWebRecordsCapabilityConfig('mail', page, action, 'inbox');
    const bindings = setWebCapabilityProfileBinding({}, '/docs/inbox.hvy', 'inbox', 'work');
    const authorizations = authorizeWebCapabilityRecord({}, '/docs/inbox.hvy', config, 'work');

    expect(bindings['/docs/inbox.hvy']).toEqual({ inbox: 'work' });
    expect(isWebCapabilityAuthorized(authorizations, '/docs/inbox.hvy', config, 'work')).toBe(true);
    expect(isWebCapabilityAuthorized(authorizations, '/docs/inbox.hvy', config, 'personal')).toBe(false);
  });

  it('explains which capability categories changed', () => {
    const config = createWebRecordsCapabilityConfig('mail', page, action, 'inbox');
    const authorizations = authorizeWebCapabilityRecord({}, '/docs/inbox.hvy', config, 'work');
    const changed = {
      ...config,
      page: { ...config.page, allowedOrigins: [...config.page.allowedOrigins, 'https://auth.example.com'] },
      record: {
        ...config.record,
        commands: [{ ...config.record.commands[0]!, name: 'Open selected message' }],
      },
    };

    expect(reviewWebCapabilityAuthorization(authorizations, '/docs/inbox.hvy', changed, 'work')).toMatchObject({
      reason: 'capability-changed',
      changedCategories: ['origins', 'commands'],
    });
  });

  it('creates portable page-command definitions', () => {
    const command: IntegrationCommandDefinition = {
      id: 'subject',
      name: 'Enter subject',
      scope: 'page',
      steps: [{ gesture: 'type', target: snapshot, text: 'Project update' }],
    };

    const config = createWebCommandCapabilityConfig('mail', page, command, 'enter-subject');

    expect(config.command.steps[0]?.target).toEqual({
      selected: { shape: snapshot.selected.shape, relativePath: snapshot.selected.relativePath },
    });
    expect(config.command.steps[0]).toMatchObject({ gesture: 'type', text: 'Project update' });
    expect(JSON.stringify(config)).not.toContain('Private subject');
  });
});
