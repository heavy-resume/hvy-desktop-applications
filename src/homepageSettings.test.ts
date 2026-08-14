import { describe, expect, it } from 'vitest';
import { defaultAppSettings, includedDocuments, normalizeHomepageSetting } from './backend';

describe('homepage settings', () => {
  it('defaults existing settings to the included Galaxy guide', () => {
    expect(defaultAppSettings().homepage).toEqual({ kind: 'included', id: 'hvy-galaxy-guide' });
    expect(normalizeHomepageSetting(undefined)).toEqual({ kind: 'included', id: 'hvy-galaxy-guide' });
  });

  it('supports every included document by stable id', () => {
    expect(includedDocuments.map((document) => document.id)).toEqual(['hvy-galaxy-guide', 'hvy-guide']);
    expect(normalizeHomepageSetting({ kind: 'included', id: 'hvy-guide' })).toEqual({ kind: 'included', id: 'hvy-guide' });
  });

  it('normalizes file and disabled homepage choices', () => {
    expect(normalizeHomepageSetting({ kind: 'file', path: '  /tmp/home.hvy  ' })).toEqual({ kind: 'file', path: '/tmp/home.hvy' });
    expect(normalizeHomepageSetting({ kind: 'none' })).toEqual({ kind: 'none' });
  });

  it('falls back when an included id or file path is invalid', () => {
    expect(normalizeHomepageSetting({ kind: 'included', id: 'missing' })).toEqual({ kind: 'included', id: 'hvy-galaxy-guide' });
    expect(normalizeHomepageSetting({ kind: 'file', path: '   ' })).toEqual({ kind: 'included', id: 'hvy-galaxy-guide' });
  });
});
