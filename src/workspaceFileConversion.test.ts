import { describe, expect, it } from 'vitest';
import { workspaceFileConversionAction } from './workspaceFileConversion';

describe('workspaceFileConversionAction', () => {
  it('converts HVY documents to THVY templates', () => {
    expect(workspaceFileConversionAction('notes.hvy', 'Projects/notes.hvy')).toEqual({
      label: 'Convert to Template',
      toTemplate: true,
    });
  });

  it('converts THVY templates to HVY documents', () => {
    expect(workspaceFileConversionAction('notes.thvy', 'templates/notes.thvy')).toEqual({
      label: 'Convert to Document',
      toTemplate: false,
    });
  });

  it('uses location to classify PHVY without changing its extension', () => {
    expect(workspaceFileConversionAction('notice.phvy', 'Survey/notice.phvy')?.toTemplate).toBe(true);
    expect(workspaceFileConversionAction('notice.phvy', 'templates/notice.phvy')?.toTemplate).toBe(false);
  });

  it('does not offer conversion for Markdown', () => {
    expect(workspaceFileConversionAction('notes.md', 'notes.md')).toBeNull();
  });
});
