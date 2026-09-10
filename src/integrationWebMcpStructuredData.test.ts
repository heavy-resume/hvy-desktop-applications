import { describe, expect, it } from 'vitest';
import { analyzeWebMcpStructuredData, webMcpExtractionRecords, webMcpRecordSetAtPath } from './integrationWebMcpStructuredData';

describe('WebMCP structured data analysis', () => {
  it('rejects plain text results', () => {
    expect(analyzeWebMcpStructuredData('The operation completed.')).toEqual({
      kind: 'unsupported',
      reason: 'not-json',
    });
  });

  it.each([null, true, 42, '"a JSON string"'])('rejects JSON values that cannot represent records: %j', (value) => {
    expect(analyzeWebMcpStructuredData(value)).toEqual({
      kind: 'unsupported',
      reason: 'not-record-shaped',
    });
  });

  it('accepts a single object as one record', () => {
    expect(analyzeWebMcpStructuredData({ id: 'account-1', name: 'Primary account', active: true })).toEqual({
      kind: 'single-record',
      candidate: {
        path: '',
        records: [{ id: 'account-1', name: 'Primary account', active: true }],
        fields: [
          { name: 'id', presentIn: 1, valueKinds: ['string'] },
          { name: 'name', presentIn: 1, valueKinds: ['string'] },
          { name: 'active', presentIn: 1, valueKinds: ['boolean'] },
        ],
      },
    });
  });

  it('accepts JSON text containing a record array', () => {
    expect(analyzeWebMcpStructuredData('[{"id":"one"},{"id":"two"}]')).toMatchObject({
      kind: 'record-sets',
      candidates: [{ path: '', records: [{ id: 'one' }, { id: 'two' }] }],
    });
  });

  it('summarizes fields across type A and type B record variants', () => {
    const result = analyzeWebMcpStructuredData([
      { type: 'article', id: 'a', title: 'An article' },
      { type: 'video', id: 'b', duration: 120 },
    ]);

    expect(result).toEqual({
      kind: 'record-sets',
      candidates: [{
        path: '',
        records: [
          { type: 'article', id: 'a', title: 'An article' },
          { type: 'video', id: 'b', duration: 120 },
        ],
        fields: [
          { name: 'type', presentIn: 2, valueKinds: ['string'] },
          { name: 'id', presentIn: 2, valueKinds: ['string'] },
          { name: 'title', presentIn: 1, valueKinds: ['string'] },
          { name: 'duration', presentIn: 1, valueKinds: ['number'] },
        ],
      }],
    });
  });

  it('finds a record array inside a response envelope', () => {
    const result = analyzeWebMcpStructuredData({
      requestId: 'request-1',
      data: { items: [{ id: 1, label: 'First' }, { id: 2, label: 'Second' }] },
    });

    expect(result).toMatchObject({
      kind: 'record-sets',
      candidates: [{
        path: '/data/items',
        records: [{ id: 1, label: 'First' }, { id: 2, label: 'Second' }],
      }],
    });
  });

  it('returns each possible record collection instead of guessing between them', () => {
    const result = analyzeWebMcpStructuredData({
      people: [{ id: 'person-1' }],
      teams: [{ id: 'team-1', members: 3 }],
    });

    expect(result).toMatchObject({
      kind: 'record-sets',
      candidates: [
        { path: '/people', records: [{ id: 'person-1' }] },
        { path: '/teams', records: [{ id: 'team-1', members: 3 }] },
      ],
    });
  });

  it('preserves an empty array as a valid record collection', () => {
    expect(analyzeWebMcpStructuredData({ items: [] })).toEqual({
      kind: 'record-sets',
      candidates: [{ path: '/items', records: [], fields: [] }],
    });
  });

  it.each([
    [[{ id: 'one' }, 'not a record']],
    [['one', 'two']],
  ])('rejects root arrays that do not contain only records: %j', (value) => {
    expect(analyzeWebMcpStructuredData(value)).toEqual({
      kind: 'unsupported',
      reason: 'not-record-shaped',
    });
  });

  it('resolves a selected collection and maps its fields to extraction records', () => {
    const analysis = analyzeWebMcpStructuredData({ data: { items: [{ id: 7, title: 'Seventh', ignored: true }] } });
    const selected = webMcpRecordSetAtPath(analysis, '/data/items');

    expect(selected).not.toBeNull();
    expect(webMcpExtractionRecords(selected!, [
      { name: 'id', label: 'Identifier' },
      { name: 'title', label: 'Title' },
    ])).toEqual([{ targets: [
      { label: 'Identifier', value: 7 },
      { label: 'Title', value: 'Seventh' },
    ] }]);
    expect(webMcpRecordSetAtPath(analysis, '/missing')).toBeNull();
  });
});
