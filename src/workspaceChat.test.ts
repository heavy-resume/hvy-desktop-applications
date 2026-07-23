import { beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceChatContext, openWorkspaceChat, resolveWorkspaceHref } from './workspaceChat';
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
