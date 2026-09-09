import { describe, expect, it, vi } from 'vitest';
import {
  clearWebRecordResults,
  getWebRecordResults,
  hasWebRecordResults,
  setWebRecordResults,
  subscribeWebRecordResults,
} from './webRecordResults';

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

  it('retains reusable-template results for a viewer instance with the same capability', () => {
    const templateEditorDocument = {};
    const viewerDocument = {};

    setWebRecordResults(templateEditorDocument, 'records-capability', ['editor-result'], 'document-session');

    expect(getWebRecordResults(viewerDocument, 'records-capability', 'document-session')).toEqual(['editor-result']);
    clearWebRecordResults(viewerDocument);
    expect(hasWebRecordResults(templateEditorDocument, 'records-capability', 'document-session')).toBe(false);
  });

  it('notifies a remounted view when an earlier fetch finishes', () => {
    const templateEditorDocument = {};
    const viewerDocument = {};
    const refresh = vi.fn();
    const unsubscribe = subscribeWebRecordResults(viewerDocument, 'records-capability', refresh, 'document-session');

    setWebRecordResults(templateEditorDocument, 'records-capability', ['late-result'], 'document-session');

    expect(refresh).toHaveBeenCalledOnce();
    expect(getWebRecordResults(viewerDocument, 'records-capability', 'document-session')).toEqual(['late-result']);
    unsubscribe();
  });
});
