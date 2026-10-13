import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import { registerHostPlugin } from '../../../heavy-file-format/src/plugins/registry';
import { createScriptingPluginsApi } from '../../../heavy-file-format/src/plugins/scripting/plugin-apis';
import type { HvyPluginInput } from '../../../heavy-file-format/src/plugins/types';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { createCliItemStore } from './cliItemStore';
import type { RecordConsumer } from './collection';
import { QUEUE_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID } from './configs';
import { readWebAutomationBlocks } from './documentBlocks';
import { createWebAutomation, type WebAutomationRuntime } from './entryPoints';
import { WebAutomationError } from './errors';
import { createRecordSink } from './recordSink';
import {
  collectionScriptingMethods,
  queueScriptingMethods,
  webApiScriptingMethods,
  type DocumentAutomationLookup,
  type DocumentAutomationResolver,
} from './scripting';

const openDocuments = new WeakMap<object, DocumentAutomationLookup>();

/** Plugin methods find their document's automation through the raw document they are called with. */
export const resolveDocumentAutomation: DocumentAutomationResolver = (ctx) => {
  const lookup = openDocuments.get(ctx.rawDocument);
  if (!lookup) throw new WebAutomationError('invalid_request', 'Web automation is not open for this document.');
  return lookup;
};

const metadata = (id: string) => ({ id, version: '0.1.0', hvyApiVersion: '0.1' });

/** The scripting side of the web automation plugins. Renderers are added with the UI. */
export const WEB_AUTOMATION_PLUGINS: HvyPluginInput[] = [
  { ...metadata(WEB_API_PLUGIN_ID), displayName: 'Web API', scripting: { methods: webApiScriptingMethods(resolveDocumentAutomation) } },
  { ...metadata(WEB_COLLECTION_PLUGIN_ID), displayName: 'Web Collection', scripting: { methods: collectionScriptingMethods(resolveDocumentAutomation) } },
  { ...metadata(QUEUE_PLUGIN_ID), displayName: 'Queue', scripting: { methods: queueScriptingMethods(resolveDocumentAutomation) } },
];

export function registerWebAutomationPlugins(): void {
  for (const plugin of WEB_AUTOMATION_PLUGINS) registerHostPlugin(plugin);
}

/**
 * Opens a document's web automation from its own blocks: queues open with
 * their saved state and call their targets through doc.plugins.call, and
 * collection outputs are wired to record sinks over the document.
 */
// UI: document opened in the document pane.
export function openDocumentAutomation(runtime: WebAutomationRuntime, options: { documentPath: string; document: VisualDocument }) {
  const { document } = options;
  const blocks = readWebAutomationBlocks(document);
  const plugins = createScriptingPluginsApi(document, { allowAsync: true, requireDocumentPermission: false });
  const automation = createWebAutomation(runtime, {
    documentPath: options.documentPath,
    callPlugin: (pluginId, method, args) => plugins.call(pluginId, method, args as JsonObject),
  });
  const sinks = new Map<string, RecordConsumer>();
  for (const { config } of blocks.collections) {
    if (config.output) sinks.set(config.collection.capabilityId, createRecordSink(createCliItemStore(document, config.output.store), config.output.policy));
  }
  const lookup: DocumentAutomationLookup = {
    automation,
    webApi: (capabilityId) => blocks.webApis.find(({ config }) => config.capability.capabilityId === capabilityId)?.config.capability ?? null,
    collection: (capabilityId) => blocks.collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.config.collection ?? null,
    sink: (capabilityId) => sinks.get(capabilityId) ?? null,
  };
  openDocuments.set(document, lookup);
  for (const { config } of blocks.queues) automation.openQueue(config.queueId, config.target, config.config, config.state ?? undefined);

  return {
    automation,
    blocks,
    lookup,

    // UI: document save. Queue state travels with the document in its block.
    saveQueues(): void {
      for (const { block, config } of blocks.queues) {
        const state = automation.persistedQueue(config.queueId);
        if (state) block.schema.pluginConfig = { ...block.schema.pluginConfig, state: state as unknown as JsonObject };
      }
    },

    // UI: document closed or replaced in the document pane.
    close(): void {
      automation.closeDocument();
      openDocuments.delete(document);
    },
  };
}

export type DocumentAutomation = ReturnType<typeof openDocumentAutomation>;
