import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveColorThemeColors, getPaletteById, nativeWindowTheme } from './colorTheme';
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
  it('uses the unified light HVY palette for the default color theme', () => {
    const colors = effectiveColorThemeColors({});

    expect(colors['--hvy-bg']).toBe('#f5f9ff');
    expect(colors['--hvy-surface']).toBe('#ffffff');
    expect(colors['--hvy-button-bg']).toBe('#4a8fab');
    expect(colors['--hvy-border']).toBe('#ced9e2');
  });

  it('matches native window chrome to the theme background', () => {
    expect(nativeWindowTheme({ '--hvy-bg': '#0f1720' })).toBe('dark');
    expect(nativeWindowTheme({ '--hvy-bg': 'rgb(40, 40, 45)' })).toBe('dark');
    expect(nativeWindowTheme({ '--hvy-bg': '#f5f9ff' })).toBe('light');
  });

  it('offers the built-in HVY dark defaults as an explicit palette', () => {
    const palette = getPaletteById('default-dark');

    expect(palette?.name).toBe('Default (Dark)');
    expect(palette?.colors['--hvy-bg']).toBe('#0f1720');
    expect(palette?.colors['--hvy-surface']).toBe('#17222d');
    expect(palette?.colors['--hvy-button-bg']).toBe('#2d6a8a');
    expect(palette?.colors['--hvy-border']).toBe('#3a4655');
    expect(palette?.colors['--hvy-border-input']).toBe('#46576a');
  });

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

  it('uses the document theme border for web capability blocks', () => {
    const css = readFileSync(new URL('./plugins/webCapabilities.css', import.meta.url), 'utf8');

    expect(css).toContain('border: 1px solid var(--hvy-border, #c9c3b8)');
    expect(css).not.toContain('--hvy-border-color');
  });

  it('activates a new document mount before applying its color theme', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const activateMount = source.indexOf('state.document.mounted = mounted;');
    const applyTheme = source.indexOf("measureDebug('load', 'mountCurrentDocument:applyColorTheme'");

    expect(activateMount).toBeGreaterThan(-1);
    expect(applyTheme).toBeGreaterThan(activateMount);
  });
});
