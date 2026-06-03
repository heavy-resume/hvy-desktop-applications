import { describe, expect, it } from 'vitest';
import { richTextActionForShortcutKey } from './uiShortcuts';

describe('richTextActionForShortcutKey', () => {
  it('maps formatting hotkeys to rich text actions', () => {
    expect(richTextActionForShortcutKey('b', false)).toBe('bold');
    expect(richTextActionForShortcutKey('i', false)).toBe('italic');
    expect(richTextActionForShortcutKey('u', false)).toBe('underline');
    expect(richTextActionForShortcutKey('x', true)).toBe('strikethrough');
  });

  it('ignores shifted inline formatting keys other than strikethrough', () => {
    expect(richTextActionForShortcutKey('b', true)).toBeNull();
    expect(richTextActionForShortcutKey('i', true)).toBeNull();
    expect(richTextActionForShortcutKey('u', true)).toBeNull();
    expect(richTextActionForShortcutKey('x', false)).toBeNull();
  });
});
