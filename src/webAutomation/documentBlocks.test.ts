import { describe, expect, it } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../../../heavy-file-format/src/cli-core';
import { deserializeDocument, serializeDocument } from '../../../heavy-file-format/src/serialization';
import { checkWebAutomationDocument, readWebAutomationBlocks } from './documentBlocks';
import { analysisServiceCapability } from './faux/analysisService';
import { buildSearchDocument, LISTING_STORE_CONFIG } from './faux/listingDocument';
import { ATS_ORIGIN, listingCollection } from './faux/sites';

const webApi = { ...structuredClone(analysisServiceCapability), mcp: { endpointIds: ['profile'] } };
const collection = {
  ...structuredClone(listingCollection([`${ATS_ORIGIN}/acme/jobs`])),
  output: { store: LISTING_STORE_CONFIG, policy: { onExisting: 'keep', keepGoodOnFailure: true, ownedFields: ['title', 'company', 'location', 'description'] } },
};
const queues = [
  { queueId: 'evaluate', target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'analysis', endpointId: 'create-analysis' } } },
  { queueId: 'status', target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'analysis', endpointId: 'get-analysis' } } },
];

describe('web automation blocks in a document', () => {
  it('reads every block from a document built with the CLI, and finds nothing wrong', async () => {
    const document = buildSearchDocument({ webApi, collection, queues });
    const blocks = readWebAutomationBlocks(document);
    expect(blocks.problems).toEqual([]);
    expect(blocks.webApis.map(({ blockId }) => blockId)).toEqual(['service']);
    expect(blocks.collections[0].config.output?.store.componentName).toBe('listing-item');
    expect(blocks.queues.map(({ config }) => config.queueId)).toEqual(['evaluate', 'status']);
    expect(checkWebAutomationDocument(document)).toEqual([]);

    const reloaded = deserializeDocument(serializeDocument(document), '.hvy');
    expect(checkWebAutomationDocument(reloaded)).toEqual([]);
    expect((await executeHvyCliCommand(reloaded, createHvyCliSession(), 'hvy lint')).output).toContain('No lint issues');
  });

  it('names what is wrong across blocks and templates', () => {
    const document = buildSearchDocument({
      webApi: { ...webApi, pageUrl: 'http://app.faux-analysis.test/' },
      collection: {
        ...collection,
        output: { ...collection.output, store: { ...LISTING_STORE_CONFIG, componentName: 'missing-item' }, policy: { ownedFields: ['title', 'salary'] } },
      },
      queues: [
        { queueId: 'evaluate', target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'analysis', endpointId: 'create-analysis' } } },
        { queueId: 'evaluate', target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'other', endpointId: 'x' } } },
      ],
    });
    expect(checkWebAutomationDocument(document)).toEqual([
      'service: The page URL must use HTTPS.',
      'collection: The output owns fields that have no place in the template.',
      'Queue id "evaluate" is used by more than one block.',
      'queue-1: the queue targets "analysis", which no web API block in this document defines.',
      'queue-2: the queue targets "other", which no web API block in this document defines.',
    ]);
  });

  it('checks the output against the template', () => {
    const document = buildSearchDocument({
      webApi,
      collection: { ...collection, output: { ...collection.output, store: { ...LISTING_STORE_CONFIG, componentName: 'missing-item' } } },
      queues: [{ queueId: 'evaluate', target: { pluginId: 'galaxy.web-api', method: 'call', args: { capabilityId: 'analysis', endpointId: 'create-report' } } }],
    });
    expect(checkWebAutomationDocument(document)).toEqual([
      'collection: /body/listings/listing-list does not list "missing-item" items.',
      'collection: The document has no reusable component "missing-item".',
      'queue-1: "analysis" has no endpoint "create-report".',
    ]);
  });
});
