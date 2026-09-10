import { describe, expect, it, vi } from 'vitest';

vi.mock('./hvy', () => ({ serializeHvy: vi.fn() }));

import { relocatedDocumentHistoryRecord, type HistoryRecord } from './documentHistory';

describe('relocatedDocumentHistoryRecord', () => {
  it('moves the history identity without losing versions or revision bytes', () => {
    const documentBytes = new Blob(['revision']);
    const versions = [{ id: 'version-1', createdAt: '2026-01-01T00:00:00.000Z' }] as HistoryRecord['versions'];
    const record: HistoryRecord = {
      path: '/workspace/folder/draft.hvy',
      name: 'draft.hvy',
      documentBytes,
      versions,
    };

    const relocated = relocatedDocumentHistoryRecord(
      record,
      '/workspace/folder/draft 2.hvy',
      'draft 2.hvy',
    );

    expect(relocated).toEqual({
      ...record,
      path: '/workspace/folder/draft 2.hvy',
      name: 'draft 2.hvy',
    });
    expect(relocated.documentBytes).toBe(documentBytes);
    expect(relocated.versions).toBe(versions);
  });
});
