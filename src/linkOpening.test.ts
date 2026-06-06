import { describe, expect, it } from 'vitest';
import { externalHttpUrlFromHref, shouldOpenExternalLinkForClick } from './linkOpening';

const leftClick = {
  altKey: false,
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe('shouldOpenExternalLinkForClick', () => {
  it('opens links on ordinary viewer clicks', () => {
    expect(shouldOpenExternalLinkForClick('viewer', leftClick)).toBe(true);
  });

  it('opens editor links only on platform-modified clicks', () => {
    expect(shouldOpenExternalLinkForClick('editor', leftClick)).toBe(false);
    expect(shouldOpenExternalLinkForClick('editor', { ...leftClick, metaKey: true })).toBe(true);
    expect(shouldOpenExternalLinkForClick('advanced', { ...leftClick, ctrlKey: true })).toBe(true);
  });

  it('ignores non-primary or alternate modified clicks', () => {
    expect(shouldOpenExternalLinkForClick('viewer', { ...leftClick, button: 1 })).toBe(false);
    expect(shouldOpenExternalLinkForClick('viewer', { ...leftClick, altKey: true })).toBe(false);
    expect(shouldOpenExternalLinkForClick('viewer', { ...leftClick, shiftKey: true })).toBe(false);
  });
});

describe('externalHttpUrlFromHref', () => {
  it('normalizes external http and https links', () => {
    expect(externalHttpUrlFromHref(' https://example.com/docs ')).toBe('https://example.com/docs');
    expect(externalHttpUrlFromHref('http://example.com')).toBe('http://example.com/');
  });

  it('ignores internal and unsupported links', () => {
    expect(externalHttpUrlFromHref('#section')).toBeNull();
    expect(externalHttpUrlFromHref('/relative')).toBeNull();
    expect(externalHttpUrlFromHref('mailto:hello@example.com')).toBeNull();
    expect(externalHttpUrlFromHref('not a url')).toBeNull();
  });
});
