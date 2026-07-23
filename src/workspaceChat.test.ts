import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorkspaceChatContext,
  buildWorkspaceCitationRepairPrompt,
  invalidWorkspaceCitationTargets,
  openWorkspaceChat,
  removeInvalidWorkspaceCitations,
  resolveWorkspaceHref,
} from './workspaceChat';
import { state } from './state';
import type { Workspace } from './backend';

describe('workspace chat helpers', () => {
  beforeEach(() => {
    state.workspaces = [workspace('/tmp/work', 'Work', [{
      kind: 'file',
      name: 'Notes.hvy',
      path: '/tmp/work/Projects/Alpha/Notes.hvy',
      relativePath: 'Projects/Alpha/Notes.hvy',
      extension: '.hvy',
    }])];
    state.selectedWorkspacePath = '/tmp/work';
    state.document = null;
    state.workspaceChat = {
      open: false,
      workspacePath: null,
      targetDirectory: '',
      scopeLabel: '',
      status: null,
      error: null,
      dirty: false,
      closePromptOpen: false,
      isSending: false,
      draft: '',
      progress: null,
      messages: [],
    };
  });

  it('opens a folder-scoped chat with a readable scope label', () => {
    openWorkspaceChat('/tmp/work', 'Projects/Alpha');

    expect(state.workspaceChat.open).toBe(true);
    expect(state.workspaceChat.workspacePath).toBe('/tmp/work');
    expect(state.workspaceChat.targetDirectory).toBe('Projects/Alpha');
    expect(state.workspaceChat.scopeLabel).toBe('Alpha');
  });

  it('resolves relative workspace links against the current document folder', () => {
    state.document = {
      path: '/tmp/work/Projects/Chat.hvy',
      name: 'Chat.hvy',
      extension: '.hvy',
      mode: 'viewer',
      dirty: false,
      readOnly: false,
      hiddenFromAI: false,
      isNew: false,
      metaOpen: false,
      mounted: null,
      recoveryBackupId: null,
    };

    expect(resolveWorkspaceHref('../Notes.hvy')).toBe('/tmp/work/Notes.hvy');
  });

  it('resolves workspace-absolute links against the workspace root', () => {
    openWorkspaceChat('/tmp/work', 'Projects/Alpha');

    expect(resolveWorkspaceHref('/Projects/Alpha/Notes.hvy#minutes')).toBe('/tmp/work/Projects/Alpha/Notes.hvy');
  });

  it('resolves workspace-absolute links that include the workspace display name', () => {
    openWorkspaceChat('/tmp/work', 'Projects/Alpha');

    expect(resolveWorkspaceHref('/Work/Projects/Alpha/Notes.hvy#minutes')).toBe('/tmp/work/Projects/Alpha/Notes.hvy');
  });

  it('formats workspace chat evidence with workspace-root markdown source links instead of raw path fields', () => {
    openWorkspaceChat('/tmp/work', 'Projects');

    const context = buildWorkspaceChatContext([{
      id: 'chunk-1',
      documentId: '/tmp/work/Meeting Minutes.hvy',
      documentTitle: 'Meeting Minutes.hvy',
      documentPath: '/tmp/work/Meeting Minutes.hvy',
      sourceFile: 'Meeting Minutes.hvy',
      targetKind: 'block',
      sectionKey: 'notes',
      targetId: 'minutes',
      label: 'Minutes',
      text: 'Discussed minutes and next steps.',
      score: 0.91,
    }], 10_000);

    expect(context).toContain('[Meeting Minutes.hvy](/Meeting%20Minutes.hvy)');
    expect(context).toContain('Source 1: [Meeting Minutes.hvy](/Meeting%20Minutes.hvy#minutes)');
    expect(context).not.toContain('Path:');
    expect(context).not.toContain('/tmp/work/Meeting Minutes.hvy');
  });

  it('lints rewritten workspace citation targets without flagging allowed or external links', () => {
    const output = [
      '[Bad](/Work/Notes%20for%20%20Petro%20Park.hvy)',
      '[Good](/Notes%20for%20Petro%20Park.hvy#minutes)',
      '[Website](https://example.com)',
    ].join('\n');

    expect(invalidWorkspaceCitationTargets(output, [
      '/Notes%20for%20Petro%20Park.hvy',
      '/Notes%20for%20Petro%20Park.hvy#minutes',
    ])).toEqual(['/Work/Notes%20for%20%20Petro%20Park.hvy']);
  });

  it('builds a repair prompt with the invalid target and original source choices', () => {
    const prompt = buildWorkspaceCitationRepairPrompt(
      ['/Work/Wrong.hvy'],
      ['[Notes.hvy](/Projects/Notes.hvy)', '[Plan.hvy](/Projects/Plan.hvy)'],
    );

    expect(prompt).toContain('Invalid link targets:\n- /Work/Wrong.hvy');
    expect(prompt).toContain('- [Notes.hvy](/Projects/Notes.hvy)');
    expect(prompt).toContain('- [Plan.hvy](/Projects/Plan.hvy)');
    expect(prompt).toContain('Return the complete corrected answer');
  });

  it('removes only links that remain invalid while preserving their labels and the rest of the answer', () => {
    const output = [
      'See [Petro notes](/Work/Notes%20for%20%20Petro%20Park.hvy) for details.',
      'Keep [the valid source](/Stop-Petro-Disc-Golf%206.hvy).',
      'The same typo appears [again](/Work/Notes%20for%20%20Petro%20Park.hvy).',
    ].join('\n');

    expect(removeInvalidWorkspaceCitations(output, ['/Work/Notes%20for%20%20Petro%20Park.hvy'])).toBe([
      'See Petro notes for details.',
      'Keep [the valid source](/Stop-Petro-Disc-Golf%206.hvy).',
      'The same typo appears again.',
    ].join('\n'));
  });
});

function workspace(path: string, name: string, files: Workspace['files'] = []): Workspace {
  return {
    path,
    manifest: {
      schemaVersion: 1,
      name,
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    },
    files,
  };
}
