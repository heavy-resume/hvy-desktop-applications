import { describe, expect, it } from 'vitest';
import { documentProfileName, resolveProfile, withDocumentProfile } from './profiles';

const personal = { id: 'p-1', name: 'Personal' };
const work = { id: 'p-2', name: 'Work' };

describe('browser profiles a document names', () => {
  it('uses the profile with that name, or the only profile when the document names none', () => {
    expect(resolveProfile('Work', [personal, work])).toBe(work);
    expect(resolveProfile(null, [personal])).toBe(personal);
    // The user chooses: a name this machine has no profile for, or no name among several.
    expect(resolveProfile('Work', [personal])).toBeNull();
    expect(resolveProfile(null, [personal, work])).toBeNull();
  });

  it('keeps the file\'s profile in the front matter\'s application metadata, beside what else is there', () => {
    const metadata = withDocumentProfile({ 'com.example.records': { record_id: 'abc' }, galaxy: { other: 1 } }, 'Work');
    expect(metadata).toEqual({ 'com.example.records': { record_id: 'abc' }, galaxy: { other: 1, web_profile: 'Work' } });
    expect(documentProfileName({ metadata })).toBe('Work');
    expect(documentProfileName({})).toBeNull();
  });
});
