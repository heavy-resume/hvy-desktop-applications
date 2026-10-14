import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import { createConditionallyAllowedPlugin, loadConditionallyAllowedPlugin } from '../../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import { getPluginAuthorizationMode, setPluginAuthorized } from '../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import { getHostPlugins, registerHostPlugin } from '../../../heavy-file-format/src/plugins/registry';
import { createScriptingPluginsApi } from '../../../heavy-file-format/src/plugins/scripting/plugin-apis';
import type { HvyPlugin } from '../../../heavy-file-format/src/plugins/types';
import { runWithStateRuntime, type StateRuntime } from '../../../heavy-file-format/src/state';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { createCliItemStore } from './cliItemStore';
import type { RecordConsumer } from './collection';
import { QUEUE_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_AUTOMATION_PLUGIN_VERSION, WEB_COLLECTION_PLUGIN_ID } from './configs';
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

const metadata = (id: string, displayName: string) => ({ id, version: WEB_AUTOMATION_PLUGIN_VERSION, hvyApiVersion: '0.1', displayName });

/** The scripting side of the web automation plugins. Renderers are added with the UI. */
const implementations: Record<string, HvyPlugin> = {
  [WEB_API_PLUGIN_ID]: { ...metadata(WEB_API_PLUGIN_ID, 'Web API'), scripting: { methods: webApiScriptingMethods(resolveDocumentAutomation) } },
  [WEB_COLLECTION_PLUGIN_ID]: { ...metadata(WEB_COLLECTION_PLUGIN_ID, 'Web Collection'), scripting: { methods: collectionScriptingMethods(resolveDocumentAutomation) } },
};

/**
 * The plugins that reach the web are conditional registrations: a document
 * gets their implementation only after the user allows the plugin in that
 * file (the reference implementation's per-file plugin authorization). The
 * queue reaches nothing itself, so it needs no authorization.
 */
export const WEB_AUTOMATION_PLUGINS: HvyPlugin[] = [
  createConditionallyAllowedPlugin({ ...metadata(WEB_API_PLUGIN_ID, 'Web API'), load: async () => implementations[WEB_API_PLUGIN_ID] }),
  createConditionallyAllowedPlugin({ ...metadata(WEB_COLLECTION_PLUGIN_ID, 'Web Collection'), load: async () => implementations[WEB_COLLECTION_PLUGIN_ID] }),
  { ...metadata(QUEUE_PLUGIN_ID, 'Queue'), scripting: { methods: queueScriptingMethods(resolveDocumentAutomation) } },
];

/**
 * Registers the plugins, and loads the conditional implementations up front:
 * they ship with Galaxy, and loading grants nothing; a document still gets an
 * implementation only once the plugin is allowed in that file.
 */
export async function registerWebAutomationPlugins(): Promise<void> {
  for (const plugin of WEB_AUTOMATION_PLUGINS) registerHostPlugin(plugin);
  // The registry keeps its own normalized copy of each registration, and implementations load against that copy.
  const ids = new Set(WEB_AUTOMATION_PLUGINS.map((plugin) => plugin.id));
  const registered = getHostPlugins().filter((plugin) => ids.has(plugin.id) && plugin.authorization === 'required');
  await Promise.all(registered.map((plugin) => loadConditionallyAllowedPlugin(plugin)));
}

function registration(pluginId: string): HvyPlugin {
  const plugin = WEB_AUTOMATION_PLUGINS.find((candidate) => candidate.id === pluginId);
  if (!plugin) throw new WebAutomationError('invalid_request', `${pluginId} is not a web automation plugin.`);
  return plugin;
}

/**
 * Opens a document's web automation from its own blocks: queues open with
 * their state from the app's queue store (or reattach, if work from an
 * earlier open is still finishing) and call their targets through
 * doc.plugins.call, and collection outputs are wired to record sinks over
 * the document. `stateRuntime` is the document's app state, which holds its
 * plugin authorizations.
 */
// UI: document opened in the document pane.
export function openDocumentAutomation(runtime: WebAutomationRuntime, options: {
  documentPath: string;
  document: VisualDocument;
  stateRuntime: StateRuntime;
  /** The document changed outside a script (a record sink wrote items); the host rerenders. */
  onDocumentChange?(): void;
}) {
  const { document, stateRuntime } = options;
  const blocks = readWebAutomationBlocks(document);
  const plugins = createScriptingPluginsApi(document, { allowAsync: true, requireDocumentPermission: false });
  const isPluginAuthorized = (pluginId: string) => getPluginAuthorizationMode(document, registration(pluginId), stateRuntime) === 'enabled';
  const automation = createWebAutomation(runtime, {
    documentPath: options.documentPath,
    isPluginAuthorized,
    callPlugin: (pluginId, method, args) => {
      // A queue's target plugin not allowed in this file pauses the queue for review rather than failing entries.
      if (pluginId !== QUEUE_PLUGIN_ID && !isPluginAuthorized(pluginId)) {
        throw new WebAutomationError('not_authorized', `Allow ${registration(pluginId).displayName} in this file before it is used.`);
      }
      return runWithStateRuntime(stateRuntime, () => plugins.call(pluginId, method, args as JsonObject));
    },
  });
  const sinks = new Map<string, RecordConsumer>();
  for (const { config } of blocks.collections) {
    if (!config.output) continue;
    const sink = createRecordSink(createCliItemStore(document, config.output.store), config.output.policy);
    sinks.set(config.collection.capabilityId, {
      onRecord: (record) => {
        sink.onRecord(record);
        options.onDocumentChange?.();
      },
      isKnown: sink.isKnown,
    });
  }
  const lookup: DocumentAutomationLookup = {
    automation,
    webApi: (capabilityId) => blocks.webApis.find(({ config }) => config.capability.capabilityId === capabilityId)?.config.capability ?? null,
    collection: (capabilityId) => blocks.collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.config.collection ?? null,
    sink: (capabilityId) => sinks.get(capabilityId) ?? null,
  };
  openDocuments.set(document, lookup);
  for (const { config } of blocks.queues) automation.openQueue(config.queueId, config.target, config.config);

  return {
    automation,
    blocks,
    lookup,

    // UI: a web plugin's block, "Allow in this file" (the reference implementation's plugin authorization prompt).
    authorizePlugin(pluginId: string): void {
      setPluginAuthorized(document, registration(pluginId), true, stateRuntime);
    },

    // UI: a web plugin's block shows the prompt or its reader.
    pluginAuthorization(pluginId: string): 'prompt' | 'enabled' | 'hidden' {
      return getPluginAuthorizationMode(document, registration(pluginId), stateRuntime);
    },

    // UI: document closed or replaced in the document pane.
    close(): void {
      automation.closeDocument();
      openDocuments.delete(document);
    },
  };
}

export type DocumentAutomation = ReturnType<typeof openDocumentAutomation>;
