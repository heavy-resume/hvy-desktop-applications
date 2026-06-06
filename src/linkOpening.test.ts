import { describe, expect, it } from 'vitest';
import { externalHttpUrlFromHref, mailtoLinkFromHref, shouldOpenExternalLinkForClick } from './linkOpening';

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

describe('mailtoLinkFromHref', () => {
  it('extracts the email address while preserving the mailto URL', () => {
    expect(mailtoLinkFromHref(' mailto:hello@example.com?subject=Hi ')).toEqual({
      url: 'mailto:hello@example.com?subject=Hi',
      emailAddress: 'hello@example.com',
    });
    expect(mailtoLinkFromHref('mailto:hello%2Bdocs@example.com')).toEqual({
      url: 'mailto:hello%2Bdocs@example.com',
      emailAddress: 'hello+docs@example.com',
    });
  });

  it('ignores non-mailto and empty mailto links', () => {
    expect(mailtoLinkFromHref('https://example.com')).toBeNull();
    expect(mailtoLinkFromHref('mailto:?subject=Hi')).toBeNull();
    expect(mailtoLinkFromHref('not a url')).toBeNull();
  });
});
