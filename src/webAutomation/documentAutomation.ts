import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import { createConditionallyAllowedPlugin, loadConditionallyAllowedPlugin } from '../../../heavy-file-format/src/plugins/authorization/conditional-plugin';
import { getPluginAuthorizationMode, setPluginAuthorized } from '../../../heavy-file-format/src/plugins/authorization/plugin-authorization-policy';
import { getHostPlugins, registerHostPlugin } from '../../../heavy-file-format/src/plugins/registry';
import { createScriptingPluginsApi } from '../../../heavy-file-format/src/plugins/scripting/plugin-apis';
import type { HvyPlugin, HvyPluginFactory } from '../../../heavy-file-format/src/plugins/types';
import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../../heavy-file-format/src/state';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';
import { createCliItemStore } from './cliItemStore';
import { QUEUE_PLUGIN_ID, SCHEDULE_PLUGIN_ID, SIMILARITY_PLUGIN_ID, WEB_API_PLUGIN_ID, WEB_AUTOMATION_PLUGIN_VERSION, WEB_COLLECTION_PLUGIN_ID, WEB_PROFILE_CONTEXT_PLUGIN_ID } from './configs';
import { readWebAutomationBlocks } from './documentBlocks';
import { settingsText, storedSettings } from './blockSettings';
import { createWebAutomation, type WebAutomationRuntime } from './entryPoints';
import { WebAutomationError } from './errors';
import { contextProfileName, profileContextFor } from './profileContexts';
import { documentProfileName } from './profiles';
import { createRecordSink } from './recordSink';
import { recordKey } from './records';
import { recognizeAddress } from './siteSetups';
import { publishedServices } from './serviceManifests';
import { createSqlRecordConsumer, useDocumentDatabase, type OpenedDatabase } from './sqlSink';
import { visitBlocks } from '../../../heavy-file-format/src/block-traversal';
import { capabilityOrigin } from './webApi';
import type { ScheduledDocument } from './scheduleSettings';
// Registers the blocks' checks with hvy lint.
import './lint';
import {
  collectionScriptingMethods,
  queueScriptingMethods,
  scheduleScriptingMethods,
  similarityScriptingMethods,
  webApiScriptingMethods,
  type DocumentAutomationLookup,
  type DocumentAutomationResolver,
} from './scripting';

const openDocuments = new WeakMap<object, { lookup: DocumentAutomationLookup; adoptActiveRuntime(): void }>();

/** How long a collection's records are gathered before the document is told of them and redraws (once for all). */
const RECORD_BATCH_MS = 5000;
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
  schedule: HvyPluginFactory;
}

/**
 * The web automation plugins. The ones that reach the web are conditional
 * registrations: a document gets their implementation only after the user
 * allows the plugin in that file (the reference implementation's per-file
 * plugin authorization). The queue and similarity reach nothing themselves (similarity reaches the web only through a
 * web API block, under its approval), so they need no authorization.
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
  const schedule: HvyPlugin = {
    ...metadata(SCHEDULE_PLUGIN_ID, 'Schedule'),
    ...(readers ? { create: readers.schedule } : {}),
    scripting: { methods: scheduleScriptingMethods(resolveDocumentAutomation) },
  };
  return [
    createConditionallyAllowedPlugin({ ...metadata(WEB_API_PLUGIN_ID, 'Web API'), load: async () => webApi }),
    createConditionallyAllowedPlugin({ ...metadata(WEB_COLLECTION_PLUGIN_ID, 'Web Collection'), load: async () => collection }),
    // Runs the document's scripts on a timer once the user turns its jobs on: allowed per file, as the web plugins are.
    createConditionallyAllowedPlugin({ ...metadata(SCHEDULE_PLUGIN_ID, 'Schedule'), load: async () => schedule }),
    {
      ...metadata(QUEUE_PLUGIN_ID, 'Queue'),
      ...(readers ? { create: readers.queue } : {}),
      scripting: { methods: queueScriptingMethods(resolveDocumentAutomation) },
    },
    {
      ...metadata(SIMILARITY_PLUGIN_ID, 'Similarity'),
      scripting: { methods: similarityScriptingMethods(resolveDocumentAutomation) },
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
  /**
   * The document's key: what its queues, what its handlers heard, and its service approvals are kept by. Galaxy gives its
   * file reference (webAutomation/app.ts), which a rename or move leaves as it is; empty for a document not saved yet.
   */
  documentPath(): string;
  document: VisualDocument;
  stateRuntime: StateRuntime;
  /**
   * The document changed outside a script: a record sink wrote items into the component-list at `listPath`. The host
   * redraws that list in the document's state runtime.
   */
  onDocumentChange?(stateRuntime: StateRuntime, listPath: string): void;
  /** The document's database changed outside a script: a record sink wrote rows into one of its tables. */
  onDatabaseChange?(stateRuntime: StateRuntime): void;
  /** A block's settings changed outside its reader (when a collection's start pages were last checked). */
  onSettingsChange?(stateRuntime: StateRuntime): void;
  /** One of the document's scripts ran a callback (a queue's result, a finished call): it may have written to it. */
  onScriptRan?(): void;
  /** The default browser, outside Galaxy (the app's): where an item a script asks to open there is opened. */
  openInBrowser?(url: string): Promise<void>;
  /** What the user chose for this document's scheduled jobs (app settings), for its scripts' schedule status. */
  scheduled?(): ScheduledDocument | null;
}) {
  const { document } = options;
  let stateRuntime = options.stateRuntime;
  const blocks = readWebAutomationBlocks(document);
  const plugins = createScriptingPluginsApi(document, { allowAsync: true, requireDocumentPermission: false });
  const isPluginAuthorized = (pluginId: string) => getPluginAuthorizationMode(document, registration(pluginId), stateRuntime) === 'enabled';
  // While a scheduled job runs the document, no one is there for the runs it starts (`setUnattended`).
  let unattended = false;
  const automation = createWebAutomation(runtime, {
    unattended: () => unattended,
    scriptRan: () => options.onScriptRan?.(),
    documentPath: options.documentPath,
    isPluginAuthorized,
    webApiOrigin: (capabilityId) => {
      const capability = readWebAutomationBlocks(document).webApis.find(({ config }) => config.capabilityId === capabilityId)?.config.capability;
      return capability ? capabilityOrigin(capability) : null;
    },
    // The profile of the web profile context around the instance, or the file's. Read when used: choosing one writes
    // it into the document.
    profileName: (capabilityId) => {
      const { webApis, collections } = readWebAutomationBlocks(document);
      const block = webApis.find(({ config }) => config.capabilityId === capabilityId)?.block
        ?? collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.block;
      return profileNameIn(document, block ? profileContextFor(document, block) : null);
    },
    linkOwner: (url) => {
      const origin = new URL(url).origin;
      const { webApis, collections } = readWebAutomationBlocks(document);
      return webApis.find(({ config }) => config.capability && capabilityOrigin(config.capability) === origin)?.config.capabilityId
        ?? collections.find(({ config }) => config.collection.startPages.some((page) => new URL(page.url).origin === origin))?.config.collection.capabilityId
        ?? null;
    },
    // Kept in the collection's block, with each page: it travels with the file, and the document is unsaved until then.
    startPagesChecked: (capabilityId, startPageIds, at) => {
      const block = readWebAutomationBlocks(document).collections.find(({ config }) => config.collection.capabilityId === capabilityId)?.block;
      if (!block) return;
      const settings = storedSettings(block);
      const pages = Array.isArray(settings.startPages) ? settings.startPages as Array<Record<string, unknown>> : [];
      block.text = settingsText({ ...settings, startPages: pages.map((page) => (startPageIds.includes(String(page.id)) ? { ...page, checkedAt: at } : page)) });
      options.onSettingsChange?.(stateRuntime);
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
  // A fresh copy of the document's database for each use, in the document's own state runtime, as its scripts' doc.db is:
  // the reference implementation tells the live document (whose table views reload) by it.
  const openDatabase = async (): Promise<OpenedDatabase> => {
    // Loaded when first used, as the reference implementation loads its database runtime.
    const { createScriptingDbRuntime } = await import('../../../heavy-file-format/src/plugins/db-table');
    const runtime = await runWithStateRuntime(stateRuntime, () => createScriptingDbRuntime(document));
    return {
      api: {
        query: (sql, params) => runWithStateRuntime(stateRuntime, () => runtime.api.query(sql, params)),
        execute: (sql, params) => runWithStateRuntime(stateRuntime, () => runtime.api.execute(sql, params)),
      },
      dispose: runtime.dispose,
    };
  };
  const scheduleBlock = () => readWebAutomationBlocks(document).schedules[0] ?? null;
  const lookup: DocumentAutomationLookup = {
    automation,
    documentPath: () => options.documentPath(),
    schedule: () => scheduleBlock()?.config ?? null,
    // Kept in the schedule block, as a collection's start pages keep when they were last checked: it goes with the file.
    setSchedulePauses: (paused) => {
      const schedule = scheduleBlock();
      if (!schedule || JSON.stringify(schedule.config.paused) === JSON.stringify(paused)) return;
      const { state: _previous, ...settings } = storedSettings(schedule.block);
      schedule.block.text = settingsText(Object.keys(paused).length ? { ...settings, state: { paused } } : settings);
      options.onSettingsChange?.(stateRuntime);
    },
    scheduled: () => options.scheduled?.() ?? null,
    webApi: (capabilityId) => readWebAutomationBlocks(document).webApis.find(({ config }) => config.capabilityId === capabilityId)?.config.capability ?? null,
    collection: (capabilityId) => collectionBlock(capabilityId)?.collection ?? null,
    database: (use) => useDocumentDatabase(document, openDatabase, use),
    databaseChanged: () => options.onDatabaseChange?.(stateRuntime),
    openInBrowser: async (capabilityId, url, givenKey) => {
      const definition = collectionBlock(capabilityId)?.collection;
      // Its record's key: given, for an item its address doesn't key (one opened without a link), else its address's, as
      // the site that reads it tells addresses apart.
      const site = definition ? recognizeAddress(definition, url)?.site : null;
      const key = givenKey ?? (definition ? recordKey(definition.key ?? { kind: 'url' }, url, {}, { ignoredQueryParameters: definition.ignoredQueryParameters, keepUrlFragment: site?.keepUrlFragment === true }) : null);
      const fields = key ? await lookup.sink(capabilityId)?.fieldsOf?.(key) : null;
      // A key given opens only its own record's address.
      const held = fields && (!givenKey || fields.url === url) ? fields : null;
      if (!held) throw new WebAutomationError('not_authorized', 'Only an item this collection collected opens in the default browser.');
      if (!options.openInBrowser) throw new WebAutomationError('invalid_request', 'This app has no default browser to open it in.');
      await options.openInBrowser(url);
    },
    sink: (capabilityId) => {
      const output = collectionBlock(capabilityId)?.output;
      if (!output) return null;
      const { store, policy } = output;
      // The records written are told to the document's on_records handlers, which decide what to read again, and the
      // document redraws. Not once per record: each redraw runs the document's scripts, which usually draw every record
      // again, so a run that writes many (a board's fifty jobs, each with its description) would keep the app busy
      // drawing. The records written within RECORD_BATCH_MS of the first are told together, and the rest when the run
      // ends.
      if ('kind' in store) {
        let written: string[] = [];
        let batching = false;
        const tell = () => {
          // A batch names each record once: listed, then read, it was written twice.
          const keys = [...new Set(written)];
          written = [];
          if (!keys.length) return;
          options.onDatabaseChange?.(stateRuntime);
          automation.recordsWritten(capabilityId, keys);
        };
        const consumer = createSqlRecordConsumer(document, openDatabase, store, policy, (key) => {
          written.push(key);
          if (batching) return;
          batching = true;
          void runtime.clock.sleep(RECORD_BATCH_MS).then(() => {
            batching = false;
            tell();
          });
        });
        return {
          ...consumer,
          reading: (key) => automation.itemReading(capabilityId, key),
          close: async () => {
            try {
              await consumer.close?.();
            } finally {
              tell();
            }
          },
        };
      }
      const sink = createRecordSink(createCliItemStore(document, store), policy);
      return {
        onRecord: (record) => {
          sink.onRecord(record);
          options.onDocumentChange?.(stateRuntime, store.listPath);
          automation.recordsWritten(capabilityId, [record.key]);
        },
        isKnown: sink.isKnown,
        fieldsOf: sink.fieldsOf,
        provenanceOf: sink.provenanceOf,
        reading: (key) => automation.itemReading(capabilityId, key),
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
  // A web API block that uses a service's published file has its capability once the file is fetched: fetched as the
  // document opens (again if it failed before), and the readers redraw when it arrives.
  visitBlocks(document.sections, (block) => {
    const service = block.schema.plugin === WEB_API_PLUGIN_ID ? storedSettings(block).service : undefined;
    if (typeof service !== 'string' || !publishedServices.enabled) return;
    let origin: string;
    try {
      origin = new URL(service).origin;
    } catch {
      // Not an address: the block's own check says so.
      return;
    }
    void automation.fetchPublishedService(origin);
  });

  return {
    automation,
    blocks,
    lookup,

    // UI: a web plugin's block, "Allow in this file" (the reference implementation's plugin authorization prompt).
    authorizePlugin(pluginId: string): void {
      setPluginAuthorized(document, registration(pluginId), true, stateRuntime);
    },

    // Scheduled jobs: a job running the document makes the runs it starts unattended, until the user takes the tab over.
    setUnattended(on: boolean): void {
      unattended = on;
    },

    // UI: a web plugin's block shows the prompt or its reader.
    pluginAuthorization(pluginId: string): 'prompt' | 'enabled' | 'hidden' {
      return getPluginAuthorizationMode(document, registration(pluginId), stateRuntime);
    },

    // Document save: just before the app serializes the document, each queue block takes the queue's state.
    // Queue progress is not a document edit until then, so it adds no undo entries.
    saveQueues(): void {
      for (const { block, config } of blocks.queues) {
        const { state: _previous, ...settings } = storedSettings(block);
        const state = automation.savedQueueState(config.queueId);
        block.text = settingsText(state.entries.length || state.paused ? { ...settings, state } : settings);
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

/** The profile a block uses, by name: its web profile context's, or the file's outside one. */
export function profileNameIn(document: VisualDocument, context: VisualBlock | null): string | null {
  return context ? contextProfileName(context) : documentProfileName(document.meta);
}
