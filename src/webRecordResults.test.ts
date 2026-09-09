import { describe, expect, it } from 'vitest';
import { clearWebRecordResults, getWebRecordResults, hasWebRecordResults, setWebRecordResults } from './webRecordResults';

describe('web record result cache', () => {
  it('retains results across mounts of the same document and isolates other documents and blocks', () => {
    const document = {};
    const otherDocument = {};
    const records = [{ targets: [{ label: 'Subject', value: 'Hello' }] }];

    expect(hasWebRecordResults(document, 'records-block')).toBe(false);
    setWebRecordResults(document, 'records-block', records);

    expect(hasWebRecordResults(document, 'records-block')).toBe(true);
    expect(getWebRecordResults(document, 'records-block')).toBe(records);
    expect(getWebRecordResults(document, 'other-block')).toEqual([]);
    expect(getWebRecordResults(otherDocument, 'records-block')).toEqual([]);
  });

  it('keeps the previous result until an explicit refresh replaces it', () => {
    const document = {};
    setWebRecordResults(document, 'records-block', ['first']);
    expect(getWebRecordResults(document, 'records-block')).toEqual(['first']);

    setWebRecordResults(document, 'records-block', ['refreshed']);
    expect(getWebRecordResults(document, 'records-block')).toEqual(['refreshed']);

    clearWebRecordResults(document);
    expect(hasWebRecordResults(document, 'records-block')).toBe(false);
  });
});
