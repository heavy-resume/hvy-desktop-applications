import { describe, expect, it } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand, executeHvyCliCommandSync } from '../../../heavy-file-format/src/cli-core';
import { deserializeDocument, serializeDocument } from '../../../heavy-file-format/src/serialization';
import { createCliItemStore, itemComponentId, validateCliItemStore } from './cliItemStore';
import { buildListingDocument, LISTING_LIST_PATH, LISTING_STORE_CONFIG } from '../test/webAutomation/listingDocument';
import { createRecordSink, updateItemFields } from './recordSink';

const record = (key: string, values: Record<string, unknown>) => ({
  key, url: key, values, provenance: { sourceUrl: key, collectedAt: 1, patternId: 'p' }, state: 'ok' as const,
});

describe('CLI item store', () => {
  it('builds a valid listing document headless', async () => {
    const document = buildListingDocument();
    expect(validateCliItemStore(document, LISTING_STORE_CONFIG)).toEqual([]);
    const lint = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');
    expect(lint.output).toContain('No lint issues');
  });

  it('writes records as template items and reads them back', () => {
    const document = buildListingDocument();
    const store = createCliItemStore(document, LISTING_STORE_CONFIG);
    const sink = createRecordSink(store, { onExisting: 'refresh', keepGoodOnFailure: true, ownedFields: ['title', 'company', 'location', 'description'] });
    sink.onRecord(record('https://jobs.test/1', { title: 'Engineer', company: 'Acme', location: 'Remote', description: 'Build things | with care.\nTwo lines.', ignored: 'x' }));
    sink.onRecord(record('https://jobs.test/2', { title: 'Designer', company: 'Globex', description: 'Design things.' }));

    expect(store.list().map((item) => item.key)).toEqual(['https://jobs.test/1', 'https://jobs.test/2']);
    expect(store.get('https://jobs.test/1')).toMatchObject({
      url: 'https://jobs.test/1',
      state: 'ok',
      provenance: { patternId: 'p' },
      fields: { title: 'Engineer', company: 'Acme', location: 'Remote', description: 'Build things | with care.\nTwo lines.' },
    });
    expect(store.get('https://jobs.test/1')?.fields.ignored).toBeUndefined();
    const row = JSON.parse(executeHvyCliCommandSync(document, `cat ${LISTING_LIST_PATH}/${itemComponentId('https://jobs.test/1')}/expandable-stub/summary/tableRows.json`).output);
    expect(row[0].cells[0]).toBe('[Engineer](https://jobs.test/1)');
  });

  it('keeps derived sort and group keys in step when result fields are written', () => {
    const document = buildListingDocument();
    const store = createCliItemStore(document, LISTING_STORE_CONFIG);
    createRecordSink(store).onRecord(record('https://jobs.test/1', { title: 'Engineer', description: 'Build things.' }));
    updateItemFields(store, 'https://jobs.test/1', { rating: 'strong', evaluation: 'ready', reason: 'Strong overlap.' });

    const item = JSON.parse(executeHvyCliCommandSync(document, `cat ${LISTING_LIST_PATH}/${itemComponentId('https://jobs.test/1')}/${LISTING_STORE_CONFIG.componentName}.json`).output);
    expect(item).toMatchObject({ sortKeys: { Rating: 'strong' }, groupKeys: { Evaluation: 'ready' } });
    expect(store.get('https://jobs.test/1')?.fields).toMatchObject({ title: 'Engineer', rating: 'strong', evaluation: 'ready', reason: 'Strong overlap.' });
  });

  it('survives a save and reload', () => {
    const document = buildListingDocument();
    const store = createCliItemStore(document, LISTING_STORE_CONFIG);
    createRecordSink(store).onRecord(record('https://jobs.test/1', { title: 'Engineer', company: 'Acme', description: 'Build things.' }));
    updateItemFields(store, 'https://jobs.test/1', { rating: 'strong' });

    const reloaded = deserializeDocument(serializeDocument(document), '.hvy');
    const reloadedStore = createCliItemStore(reloaded, LISTING_STORE_CONFIG);
    expect(reloadedStore.list()).toEqual(store.list());
    expect(serializeDocument(reloaded)).toBe(serializeDocument(document));
  });

  it('reports bindings the template cannot satisfy', () => {
    const document = buildListingDocument();
    expect(validateCliItemStore(document, {
      ...LISTING_STORE_CONFIG,
      componentName: 'missing-item',
    })).toEqual([`${LISTING_LIST_PATH} does not list "missing-item" items.`, 'The document has no reusable component "missing-item".']);
    expect(validateCliItemStore(document, {
      ...LISTING_STORE_CONFIG,
      fields: {
        notes: { kind: 'text', path: 'expandable-content/notes/text.txt' },
        stage: { kind: 'cell', path: 'expandable-stub/summary/tableRows.json', row: 0, column: 3, annotation: { kind: 'group', key: 'Stage' } },
      },
    })).toEqual([
      'Field "notes" points at expandable-content/notes/text.txt, which the template does not have.',
      'Field "stage" uses group key "Stage", which the template does not define.',
    ]);
  });
});
