import { executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../../../../heavy-file-format/src/cli-core';
import { deserializeDocument } from '../../../../heavy-file-format/src/serialization';
import type { VisualDocument } from '../../../../heavy-file-format/src/types';
import type { CliItemStoreConfig } from '../cliItemStore';

export const LISTING_LIST_PATH = '/body/listings/listing-list';
export const LISTING_COMPONENT = 'listing-item';

/**
 * Where a listing item's fields live. The stub is a header-less one-row table
 * (linked title, company, sortable rating, groupable status); the content
 * holds the longer fields and a hidden record component.
 */
export const LISTING_STORE_CONFIG: CliItemStoreConfig = {
  listPath: LISTING_LIST_PATH,
  componentName: LISTING_COMPONENT,
  recordPath: 'expandable-content/item-record/text.txt',
  fields: {
    title: { kind: 'cell', path: 'expandable-stub/summary/tableRows.json', row: 0, column: 0, linkTo: 'url' },
    company: { kind: 'cell', path: 'expandable-stub/summary/tableRows.json', row: 0, column: 1 },
    rating: { kind: 'cell', path: 'expandable-stub/summary/tableRows.json', row: 0, column: 2, annotation: { kind: 'sort', key: 'Rating' } },
    evaluation: { kind: 'cell', path: 'expandable-stub/summary/tableRows.json', row: 0, column: 3, annotation: { kind: 'group', key: 'Evaluation' } },
    location: { kind: 'text', path: 'expandable-content/location/text.txt' },
    description: { kind: 'text', path: 'expandable-content/description/text.txt' },
    reason: { kind: 'text', path: 'expandable-content/reason/text.txt' },
  },
};

function run(document: VisualDocument, command: string): void {
  executeHvyCliCommandSync(document, command);
}

/** Inserts a host plugin block through the CLI and writes its configuration. */
export function insertPluginBlock(document: VisualDocument, sectionPath: string, id: string, pluginId: string, pluginConfig: Record<string, unknown>): void {
  run(document, `hvy insert -1 plugin ${sectionPath} ${id} ${pluginId}`);
  writeHvyVirtualFileSync(document, `${sectionPath}/${id}/plugin.json`, JSON.stringify({ id, plugin: pluginId, pluginConfig }));
}

/** Declares plugins in the document header with the scripting permission, so the document's scripts may call them. */
export function declareScriptingPlugins(document: VisualDocument, pluginIds: string[]): void {
  const header = executeHvyCliCommandSync(document, 'cat /header.yaml').output.trimEnd();
  const declarations = pluginIds.map((id) => `  - id: ${id}\n    permissions:\n      - scripting`).join('\n');
  writeHvyVirtualFileSync(document, '/header.yaml', `${header}\nplugins:\n${declarations}\n`);
}

/**
 * A complete search document: the listing list plus a setup section holding
 * the web API, collection (with its output), and queue blocks.
 */
export function buildSearchDocument(blocks: {
  webApi: object;
  collection?: object;
  queues: Array<Record<string, unknown> & { queueId: string }>;
}): VisualDocument {
  const document = buildListingDocument();
  declareScriptingPlugins(document, ['galaxy.web-api', 'galaxy.web-collection', 'galaxy.queue']);
  run(document, 'hvy insert -1 section /body setup Setup');
  insertPluginBlock(document, '/body/setup', 'service', 'galaxy.web-api', { schemaVersion: 1, ...blocks.webApi });
  if (blocks.collection) insertPluginBlock(document, '/body/setup', 'collection', 'galaxy.web-collection', { schemaVersion: 1, ...blocks.collection });
  blocks.queues.forEach((queue, index) => insertPluginBlock(document, '/body/setup', `queue-${index + 1}`, 'galaxy.queue', { schemaVersion: 1, ...queue }));
  return document;
}

/**
 * Builds an empty listing document headless with the reference implementation's
 * CLI: the same commands an author or agent would run.
 */
export function buildListingDocument(): VisualDocument {
  const document = deserializeDocument('---\nhvy_version: 0.1\ntitle: Listings\n---\n', '.hvy');
  const card = `/templates/components/${LISTING_COMPONENT}`;
  run(document, 'hvy insert -1 section /body listings Listings');
  run(document, `hvy insert -1 component-list /body/listings --id listing-list`);
  run(document, `hvy insert -1 expandable /templates/components --id ${LISTING_COMPONENT}`);
  run(document, `hvy insert -1 table ${card}/schema/expandable-stub --id summary`);
  for (const id of ['location', 'description', 'reason', 'item-record']) {
    run(document, `hvy insert -1 text ${card}/schema/expandable-content --id ${id}`);
  }
  writeHvyVirtualFileSync(document, `${card}/schema/expandable-stub/summary/tableColumns.json`, JSON.stringify(['Title', 'Company', 'Rating', 'Evaluation']));
  writeHvyVirtualFileSync(document, `${card}/schema/expandable-stub/summary/tableRows.json`, JSON.stringify([{ cells: [
    '{% title %}',
    '{% company %}',
    '<!--hvy:sort-value {"key":"Rating"}-->{% rating %}<!--/hvy:sort-value-->',
    '<!--hvy:group-value {"key":"Evaluation"}-->{% evaluation %}<!--/hvy:group-value-->',
  ] }]));
  run(document, `sed -i 's/"tableShowHeader": true/"tableShowHeader": false/' ${card}/schema/expandable-stub/summary/table.json`);
  run(document, `sed -i 's/"editorOnly": false/"editorOnly": true/' ${card}/schema/expandable-content/item-record/text.json`);
  writeHvyVirtualFileSync(document, `${card}/definition.json`, JSON.stringify({
    name: LISTING_COMPONENT,
    baseType: 'expandable',
    sortValueDefs: { Rating: { type: 'text' } },
    groupValueDefs: { Evaluation: { type: 'text' } },
  }));
  run(document, `sed -i 's/"componentListComponent": "[^"]*"/"componentListComponent": "${LISTING_COMPONENT}"/' ${LISTING_LIST_PATH}/component-list.json`);
  run(document, `sed -i 's/"componentListDefaultSortKey": "[^"]*"/"componentListDefaultSortKey": "Rating"/' ${LISTING_LIST_PATH}/component-list.json`);
  return document;
}
