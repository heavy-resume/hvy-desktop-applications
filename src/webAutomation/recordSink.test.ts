import { describe, expect, it } from 'vitest';
import { createMemoryItemStore, createRecordSink, updateItemFields } from './recordSink';
import type { CollectedRecord } from './records';

function record(key: string, values: Record<string, unknown>, state: CollectedRecord['state'] = 'ok'): CollectedRecord {
  return { key, url: key, values, provenance: { sourceUrl: key, collectedAt: 1 }, state };
}

describe('record sink', () => {
  it('keep: appends new items, skips known good ones, and retries failed ones', () => {
    const store = createMemoryItemStore();
    const sink = createRecordSink(store, { onExisting: 'keep', keepGoodOnFailure: true });
    expect(sink.onRecord(record('a', { title: 'A' }))).toBe('appended');
    expect(sink.onRecord(record('b', {}, 'no_pattern'))).toBe('appended');
    expect(sink.isKnown('a')).toBe(true);
    expect(sink.isKnown('b')).toBe(false);
    expect(sink.onRecord(record('a', { title: 'Changed' }))).toBe('kept');
    expect(store.get('a')?.fields).toEqual({ title: 'A' });
    expect(sink.onRecord(record('b', { title: 'B' }))).toBe('refreshed');
    expect(store.get('b')).toMatchObject({ state: 'ok', fields: { title: 'B' } });
  });

  it('refresh: rewrites only owned fields, so other glue keeps its fields', () => {
    const store = createMemoryItemStore();
    const sink = createRecordSink(store, { onExisting: 'refresh', keepGoodOnFailure: true, ownedFields: ['title', 'body'] });
    sink.onRecord(record('a', { title: 'Old', body: 'One', tracking: 'x' }));
    expect(store.get('a')?.fields).toEqual({ title: 'Old', body: 'One' });
    updateItemFields(store, 'a', { status: 'done', rating: 'strong' });
    expect(sink.isKnown('a')).toBe(false);

    expect(sink.onRecord(record('a', { title: 'New', body: 'Two' }))).toBe('refreshed');
    expect(store.get('a')?.fields).toEqual({ title: 'New', body: 'Two', status: 'done', rating: 'strong' });
  });

  it('never lets a failed record replace a good item unless configured to', () => {
    const keeping = createMemoryItemStore();
    const keepSink = createRecordSink(keeping, { onExisting: 'refresh', keepGoodOnFailure: true });
    keepSink.onRecord(record('a', { title: 'Good' }));
    expect(keepSink.onRecord(record('a', {}, 'no_pattern'))).toBe('kept');
    expect(keeping.get('a')?.state).toBe('ok');

    const replacing = createMemoryItemStore();
    const replaceSink = createRecordSink(replacing, { onExisting: 'refresh', keepGoodOnFailure: false });
    replaceSink.onRecord(record('a', { title: 'Good' }));
    expect(replaceSink.onRecord({ ...record('a', {}, 'no_pattern'), problem: 'Gone.' })).toBe('refreshed');
    expect(replacing.get('a')).toMatchObject({ state: 'no_pattern', problem: 'Gone.', fields: { title: 'Good' } });
  });
});
