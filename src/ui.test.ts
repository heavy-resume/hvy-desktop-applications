import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRichTextActionButton, hasOpenHvyModal, richTextActionForShortcutKey } from './uiShortcuts';

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

describe('desktop HVY integration boundaries', () => {
  it.each([
    '.caption-text-modal',
    '.text-editor-shell',
    '.table-inline-edit-shell',
    '.editor-block',
  ])('routes formatting actions through the nearest %s surface', (surfaceClass) => {
    const button = {} as HTMLButtonElement;
    const surface = {
      querySelector: (selector: string) => selector === '[data-rich-action="bold"]' ? button : null,
    };
    const editable = {
      closest: (selector: string) => selector.includes(surfaceClass) ? surface : null,
    } as unknown as HTMLElement;

    expect(findRichTextActionButton(editable, 'bold')).toBe(button);
  });

  it('does not route formatting outside a recognized rich-text surface', () => {
    const editable = { closest: () => null } as unknown as HTMLElement;

    expect(findRichTextActionButton(editable, 'italic')).toBeNull();
  });

  it('detects an open HVY modal before desktop search handling', () => {
    const openRoot = { querySelector: (selector: string) => selector === '.modal-root' ? {} : null } as unknown as ParentNode;
    const closedRoot = { querySelector: () => null } as unknown as ParentNode;

    expect(hasOpenHvyModal(openRoot)).toBe(true);
    expect(hasOpenHvyModal(closedRoot)).toBe(false);
  });

  it('keeps search close-button styling scoped away from generic HVY remove controls', () => {
    const css = readFileSync(new URL('./styles/search.css', import.meta.url), 'utf8');

    expect(css).not.toContain('.hvy-document-host .remove-x');
    expect(css).not.toContain('.hvy-document-host .hvy-embed-layout .remove-x');
  });
});
