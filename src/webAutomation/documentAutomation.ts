import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import { createConditionallyAllowedPlugin, loadConditionallyAllowedPlugin } from '../../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import { getPluginAuthorizationMode, setPluginAuthorized } from '../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import { getHostPlugins, registerHostPlugin } from '../../../heavy-file-format/src/plugins/registry';
import { createScriptingPluginsApi } from '../../../heavy-file-format/src/plugins/scripting/plugin-apis';
import type { HvyPlugin, HvyPluginFactory } from '../../../heavy-file-format/src/plugins/types';
import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../../heavy-file-format/src/state';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { createCliItemStore } from './cliItemStore';
import { QUEUE_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_AUTOMATION_PLUGIN_VERSION, WEB_COLLECTION_PLUGIN_ID, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';
import { readWebAutomationBlocks } from './documentBlocks';
import { createWebAutomation, type WebAutomationRuntime } from './entryPoints';
import { WebAutomationError } from './errors';
import { contextProfileName, profileContextFor } from './profileContexts';
import { documentProfileName } from './profiles';
import { createRecordSink } from './recordSink';
import { capabilityOrigin } from './webApi';
// Registers the blocks' checks with hvy lint.
import './lint';
import {
  collectionScriptingMethods,
  queueScriptingMethods,
  webApiScriptingMethods,
  type DocumentAutomationLookup,
  type DocumentAutomationResolver,
} from './scripting';

const openDocuments = new WeakMap<object, { lookup: DocumentAutomationLookup; adoptActiveRuntime(): void }>();
let openOnDemand: ((rawDocument: object) => DocumentAutomationLookup) | null = null;

/**
 * How the app opens a document's automation: the first time one of the
 * document's web automation plugins renders or is called from a script.
 * Both run inside the document's state runtime, which the app's mount
 * otherwise keeps private.
 */
export function setDocumentAutomationOpener(opener: (rawDocument: object) => DocumentAutomationLookup): void {
  openOnDemand = opener;
}

/** Plugin methods find their document's automation through the raw document they are called with. */
export const resolveDocumentAutomation: DocumentAutomationResolver = (ctx) => {
  const open = openDocuments.get(ctx.rawDocument);
  // Remounting a document gives it a new state runtime; its automation follows the document there.
  open?.adoptActiveRuntime();
  const lookup = open?.lookup ?? openOnDemand?.(ctx.rawDocument);
  if (!lookup) throw new WebAutomationError('invalid_request', 'Web automation is not open for this document.');
  return lookup;
};

const metadata = (id: string, displayName: string) => ({ id, version: WEB_AUTOMATION_PLUGIN_VERSION, hvyApiVersion: '0.1', displayName });

/** Readers for the blocks. The app supplies them; headless runs use the plugins without. */
export interface WebAutomationReaders {
  webApi: HvyPluginFactory;
  collection: HvyPluginFactory;
  queue: HvyPluginFactory;
  profileContext: HvyPluginFactory;
}

/**
 * The web automation plugins. The ones that reach the web are conditional
 * registrations: a document gets their implementation only after the user
 * allows the plugin in that file (the reference implementation's per-file
 * plugin authorization). The queue reaches nothing itself, so it needs no
 * authorization.
 */
export function createWebAutomationPlugins(readers?: WebAutomationReaders): HvyPlugin[] {
  const webApi: HvyPlugin = {
    ...metadata(WEB_API_PLUGIN_ID, 'Web API'),
    ...(readers ? { create: readers.webApi } : {}),
    scripting: { methods: webApiScriptingMethods(resolveDocumentAutomation) },
  };
  const collection: HvyPlugin = {
    ...metadata(WEB_COLLECTION_PLUGIN_ID, 'Web Collection'),
    ...(readers ? { create: readers.collection } : {}),
    scripting: { methods: collectionScriptingMethods(resolveDocumentAutomation) },
  };
  return [
    createConditionallyAllowedPlugin({ ...metadata(WEB_API_PLUGIN_ID, 'Web API'), load: async () => webApi }),
    createConditionallyAllowedPlugin({ ...metadata(WEB_COLLECTION_PLUGIN_ID, 'Web Collection'), load: async () => collection }),
    {
      ...metadata(QUEUE_PLUGIN_ID, 'Queue'),
      ...(readers ? { create: readers.queue } : {}),
      scripting: { methods: queueScriptingMethods(resolveDocumentAutomation) },
    },
    // Names a browser profile for the web plugins around it; it reaches nothing itself.
    {
      ...metadata(WEB_PROFILE_CONTEXT_PLUGIN_ID, 'Web Profile Context'),
      ...(readers ? { create: readers.profileContext } : {}),
    },
  ];
}

export const WEB_AUTOMATION_PLUGINS: HvyPlugin[] = createWebAutomationPlugins();

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
 * the state saved in their blocks (or reattach, if the app still holds them
 * from an earlier open) and call their targets through
 * doc.plugins.call, and collection outputs are wired to record sinks over
 * the document. `stateRuntime` is the document's app state, which holds its
 * plugin authorizations.
 */
// UI: document opened in the document pane.
export function openDocumentAutomation(runtime: WebAutomationRuntime, options: {
  /** The document's current path: it changes when the document is renamed or moved. */
  documentPath(): string;
  document: VisualDocument;
  stateRuntime: StateRuntime;
  /**
   * The document changed outside a script: a record sink wrote items into the component-list at `listPath`. The host
   * redraws that list in the document's state runtime.
   */
  onDocumentChange?(stateRuntime: StateRuntime, listPath: string): void;
}) {
  const { document } = options;
  let stateRuntime = options.stateRuntime;
  const blocks = readWebAutomationBlocks(document);
  const plugins = createScriptingPluginsApi(document, { allowAsync: true, requireDocumentPermission: false });
  const isPluginAuthorized = (pluginId: string) => getPluginAuthorizationMode(document, registration(pluginId), stateRuntime) === 'enabled';
  const automation = createWebAutomation(runtime, {
    documentPath: options.documentPath,
    isPluginAuthorized,
    webApiOrigin: (capabilityId) => {
      const capability = readWebAutomationBlocks(document).webApis.find(({ config }) => config.capability.capabilityId === capabilityId)?.config.capability;
      return capability ? capabilityOrigin(capability) : null;
    },
    // The profile of the web profile context around the instance, or the file's. Read when used: choosing one writes
    // it into the document.
    profileName: (capabilityId) => {
      const { webApis, collections } = readWebAutomationBlocks(document);
      const block = webApis.find(({ config }) => config.capability.capabilityId === capabilityId)?.block
        ?? collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.block;
      const context = block ? profileContextFor(document, block) : null;
      return context ? contextProfileName(context) : documentProfileName(document.meta);
    },
    callPlugin: (pluginId, method, args) => {
      // A queue's target plugin not allowed in this file pauses the queue for review rather than failing entries.
      if (pluginId !== QUEUE_PLUGIN_ID && !isPluginAuthorized(pluginId)) {
        throw new WebAutomationError('not_authorized', `Allow ${registration(pluginId).displayName} in this file before it is used.`);
      }
      return runWithStateRuntime(stateRuntime, () => plugins.call(pluginId, method, args as JsonObject));
    },
  });
  // Blocks are read when used, not when the document opened: a block's configuration changes while it is open (start
  // pages added in the reader, site setups saved into it, the AI editing plugin.json).
  const collectionBlock = (capabilityId: string) => readWebAutomationBlocks(document).collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.config ?? null;
  const lookup: DocumentAutomationLookup = {
    automation,
    webApi: (capabilityId) => readWebAutomationBlocks(document).webApis.find(({ config }) => config.capability.capabilityId === capabilityId)?.config.capability ?? null,
    collection: (capabilityId) => collectionBlock(capabilityId)?.collection ?? null,
    sink: (capabilityId) => {
      const output = collectionBlock(capabilityId)?.output;
      if (!output) return null;
      const sink = createRecordSink(createCliItemStore(document, output.store), output.policy);
      return {
        onRecord: (record) => {
          sink.onRecord(record);
          options.onDocumentChange?.(stateRuntime, output.store.listPath);
        },
        isKnown: sink.isKnown,
      };
    },
  };
  openDocuments.set(document, {
    lookup,
    adoptActiveRuntime: () => {
      const active = getActiveStateRuntime();
      if (active.state.document === document) stateRuntime = active;
    },
  });
  for (const { config } of blocks.queues) automation.openQueue(config.queueId, config.target, config.config, config.state);

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

    // Document save: just before the app serializes the document, each queue block takes the queue's state.
    // Queue progress is not a document edit until then, so it adds no undo entries.
    saveQueues(): void {
      for (const { block, config } of blocks.queues) {
        const { state: _previous, ...pluginConfig } = block.schema.pluginConfig;
        const state = automation.savedQueueState(config.queueId);
        block.schema.pluginConfig = state.entries.length || state.paused
          ? { ...pluginConfig, state: state as unknown as JsonObject }
          : pluginConfig;
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
