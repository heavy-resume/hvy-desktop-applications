import { describe, expect, it } from 'vitest';
import { executeHvyCliCommandSync } from '../../../heavy-file-format/src/cli-core';
import { deserializeDocument } from '../../../heavy-file-format/src/serialization';
import { visitBlocks } from '../../../heavy-file-format/src/block-traversal';
import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';
import { readProfileContextBlockConfig, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';
import { contextProfileName, ignoredProfileContexts, profileContextFor } from './profileContexts';

/** A home page: a Personal context for its section, and a Work container inside it with a context of its own. */
function homePage() {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const run = (command: string) => executeHvyCliCommandSync(document, command);
  run('hvy insert -1 section /body mail Mail');
  run(`hvy insert -1 plugin /body/mail personal ${WEB_PROFILE_CONTEXT_PLUGIN_ID}`);
  run('hvy insert -1 plugin /body/mail personal-mail galaxy.web-api');
  run('hvy insert -1 container /body/mail --id work');
  run(`hvy insert -1 plugin /body/mail/work work-profile ${WEB_PROFILE_CONTEXT_PLUGIN_ID}`);
  run('hvy insert -1 plugin /body/mail/work work-mail galaxy.web-api');
  run('hvy insert -1 container /body/mail --id other');
  run('hvy insert -1 plugin /body/mail/other other-mail galaxy.web-api');
  run('hvy insert -1 section /body notes Notes');
  run('hvy insert -1 plugin /body/notes notes-api galaxy.web-api');
  const blocks = new Map<string, VisualBlock>();
  visitBlocks(document.sections, (block) => blocks.set(block.schema.id, block));
  for (const [id, profile] of [['personal', 'Personal'], ['work-profile', 'Work']]) {
    blocks.get(id)!.schema.pluginConfig = { schemaVersion: 1, profile };
  }
  return { document, block: (id: string) => blocks.get(id)! };
}

describe('web profile contexts', () => {
  it('give a block the nearest context around it: its own list\'s, then an enclosing one\'s, then none', () => {
    const { document, block } = homePage();
    const profileOf = (id: string) => {
      const context = profileContextFor(document, block(id));
      return context ? contextProfileName(context) : null;
    };
    expect(profileOf('personal-mail')).toBe('Personal');
    expect(profileOf('work-mail')).toBe('Work');
    // A container without a context of its own is in its section's.
    expect(profileOf('other-mail')).toBe('Personal');
    // Another section is outside both: the file's profile applies there.
    expect(profileOf('notes-api')).toBeNull();
    expect(ignoredProfileContexts(document)).toEqual([]);
  });

  it('finds a plugin\'s block by its id, since the plugin\'s view of it can be another object', () => {
    const { document, block } = homePage();
    const view = structuredClone(block('work-mail'));
    expect(contextProfileName(profileContextFor(document, view)!)).toBe('Work');
  });

  it('reads a context just inserted, with an empty configuration, as naming no profile yet', () => {
    expect(readProfileContextBlockConfig({})).toEqual({ ok: true, value: {} });
    expect(readProfileContextBlockConfig({ schemaVersion: 1, profile: ' Work ' })).toEqual({ ok: true, value: { profile: 'Work' } });
    expect(readProfileContextBlockConfig({ schemaVersion: 9 }).ok).toBe(false);
  });
});
