import { describe, expect, it, vi } from 'vitest';
vi.mock('./core', () => ({ formatBackupTimestamp: (value: string) => value }));
import { state, type AppState } from '../state';
import { renderExternalFileChangeDialog } from './render-document-dialogs';

function dialogState(dirty: boolean): AppState {
  return { ...state, externalFileChangePath: '/test.hvy', document: {
    source: { path: '/test.hvy', name: '<test>.hvy' }, dirty,
  } } as AppState;
}

describe('external file change dialog', () => {
  it('offers reload and keep actions, escaping the filename', () => {
    const html = renderExternalFileChangeDialog(dialogState(false));
    expect(html).toContain('&lt;test&gt;.hvy');
    expect(html).toContain('data-action="reload-external-file-change"');
    expect(html).toContain('data-action="dismiss-external-file-change"');
    expect(html).not.toContain('discard your unsaved edits');
  });
  it('explains that reload discards local edits', () => {
    expect(renderExternalFileChangeDialog(dialogState(true))).toContain('discard your unsaved edits');
  });
  it('does not prompt for a different active file', () => {
    const current = dialogState(false);
    current.externalFileChangePath = '/other.hvy';
    expect(renderExternalFileChangeDialog(current)).toBe('');
  });
});
