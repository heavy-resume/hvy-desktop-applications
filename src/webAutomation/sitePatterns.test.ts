import { describe, expect, it } from 'vitest';
import { globMatches, resolveSitePattern, validateFingerprint, validateScopeRule, type SitePatternDefinition, type SitePatternScopeRule } from './sitePatterns';

function pattern(id: string, appliesTo: SitePatternScopeRule[], role: SitePatternDefinition['role'] = 'detail'): SitePatternDefinition {
  return { id, name: id, role, appliesTo, fields: [], minimumConfidence: 0.8, version: 1 };
}

describe('site pattern scope', () => {
  it('matches globs within and across path segments', () => {
    expect(globMatches('/*/jobs/*', '/acme/jobs/eng-1')).toBe(true);
    expect(globMatches('/*/jobs/*', '/acme/team/jobs/eng-1')).toBe(false);
    expect(globMatches('/**/jobs/*', '/acme/team/jobs/eng-1')).toBe(true);
    expect(globMatches('/CandidatePortal/*.aspx', '/CandidatePortal/Jobs.aspx')).toBe(true);
  });

  it('rejects over-broad wildcards and generic-only fingerprints', () => {
    expect(validateScopeRule({ target: 'page', host: '*' })).toMatch(/wildcard/);
    expect(validateScopeRule({ target: 'page', host: '*.com' })).toMatch(/registrable/);
    expect(validateScopeRule({ target: 'page', host: 'acme.*.com' })).toMatch(/leading/);
    expect(validateScopeRule({ target: 'page', host: '*.myworkdayjobs.com', path: '/*/job/*' })).toBeNull();
    expect(validateFingerprint([{ kind: 'form-field', name: '__VIEWSTATE' }, { kind: 'attribute', name: 'id', value: 'ctl00_' }])).toMatch(/specific/);
    expect(validateFingerprint([{ kind: 'form-field', name: '__VIEWSTATE' }, { kind: 'resource', path: '/ClientResources/*' }])).toBeNull();
  });

  it('prefers exact hosts and longer paths, and reports ties as ambiguous', () => {
    const wildcard = pattern('wildcard', [{ target: 'page', host: '*.myworkdayjobs.com' }]);
    const exact = pattern('exact', [{ target: 'page', host: 'acme.wd5.myworkdayjobs.com' }]);
    const exactPath = pattern('exact-path', [{ target: 'page', host: 'acme.wd5.myworkdayjobs.com', path: '/en-US/*/job/*' }]);
    const url = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123';
    expect(resolveSitePattern([wildcard, exact], 'detail', { url })).toMatchObject({ kind: 'match', pattern: { id: 'exact' } });
    expect(resolveSitePattern([wildcard, exact, exactPath], 'detail', { url })).toMatchObject({ kind: 'match', pattern: { id: 'exact-path' } });
    const twin = pattern('twin', [{ target: 'page', host: 'acme.wd5.myworkdayjobs.com' }]);
    expect(resolveSitePattern([exact, twin], 'detail', { url })).toMatchObject({ kind: 'ambiguous' });
    expect(resolveSitePattern([exact], 'listing', { url })).toEqual({ kind: 'none' });
  });

  it('falls back from page rules to frame rules to fingerprints', () => {
    const embedded = pattern('greenhouse', [{ target: 'frame', host: 'boards.greenhouse.io', path: '/embed/*' }]);
    const platform = pattern('talentsuite', [{ target: 'fingerprint', signals: [{ kind: 'resource', path: '/ClientResources/*' }] }]);
    const careers = 'https://www.acme.test/careers';
    expect(resolveSitePattern([embedded, platform], 'detail', { url: careers, frames: [{ src: 'https://boards.greenhouse.io/embed/job_app?token=1' }] }))
      .toMatchObject({ kind: 'match', via: 'frame', frameSrc: 'https://boards.greenhouse.io/embed/job_app?token=1' });
    expect(resolveSitePattern([embedded, platform], 'detail', { url: careers, fingerprintMatches: { talentsuite: 1 } }))
      .toMatchObject({ kind: 'match', via: 'fingerprint', pattern: { id: 'talentsuite' } });
    expect(resolveSitePattern([embedded, platform], 'detail', { url: careers })).toEqual({ kind: 'none' });
  });
});
