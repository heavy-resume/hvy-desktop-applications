import { queueWebCapabilityScriptOperation, type WebCapabilityScriptCallback } from '../plugins/webCapabilityScripting';
import type { CollectedRecord } from './records';
import type { CollectionDefinition, RecordConsumer } from './collection';
import type { WebAutomation } from './entryPoints';
import { WebAutomationError } from './errors';
import type { WebApiCapability } from './webApi';

/** The subset of HvyPluginScriptingContext these methods use. */
export interface ScriptingContext {
  rawDocument: object;
}

export type ScriptingMethod = (args: Record<string, unknown>, ctx: ScriptingContext) => unknown;

/** Finds the open document's automation and the block snapshots it contains. */
export interface DocumentAutomationLookup {
  automation: WebAutomation;
  webApi(capabilityId: string): WebApiCapability | null;
  collection(capabilityId: string): CollectionDefinition | null;
  /** The record sink a collection block's output is wired to, if it has one. */
  sink(capabilityId: string): RecordConsumer | null;
}

export type DocumentAutomationResolver = (ctx: ScriptingContext) => DocumentAutomationLookup;

function callback(value: unknown): WebCapabilityScriptCallback | null {
  return typeof value === 'function' ? value as WebCapabilityScriptCallback : null;
}

/**
 * Sandboxed scripts may only call synchronous methods: with `on_complete`
 * the call returns `{ jobId, status: 'queued' }` and reports later. Power
 * scripts may omit the callbacks and await the promise.
 */
function operation(args: Record<string, unknown>, run: () => Promise<unknown>): unknown {
  const onComplete = callback(args.on_complete);
  if (!onComplete) return run();
  return queueWebCapabilityScriptOperation(run, { onComplete, onError: callback(args.on_error) });
}

function input(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function required<T>(value: T | null, message: string): T {
  if (!value) throw new WebAutomationError('invalid_request', message);
  return value;
}

export function webApiScriptingMethods(resolve: DocumentAutomationResolver): Record<string, ScriptingMethod> {
  const capability = (lookup: DocumentAutomationLookup, args: Record<string, unknown>) => required(
    lookup.webApi(String(args.capabilityId ?? '')),
    `This document has no web API block "${String(args.capabilityId ?? '')}".`,
  );
  return {
    session: (args, ctx) => {
      const lookup = resolve(ctx);
      return operation(args, () => lookup.automation.probeSession(capability(lookup, args)));
    },
    call: (args, ctx) => {
      const lookup = resolve(ctx);
      // A queue passes its entry's stable idempotency key, so a retried call never creates a second result.
      const idempotencyKey = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined;
      return operation(args, () => lookup.automation.callEndpoint(capability(lookup, args), String(args.endpointId ?? ''), input(args.input), { idempotencyKey }));
    },
    /**
     * Calls `handler` with `{ status }` whenever the account this
     * document uses there signs in or out. Registered by a form's initial
     * script; the same `key` replaces an earlier handler.
     */
    on_session: (args, ctx) => {
      const lookup = resolve(ctx);
      const handler = required(callback(args.handler), 'on_session needs a handler function.');
      lookup.automation.onSessionChange(capability(lookup, args), String(args.key ?? 'default'), (state) => handler({ status: state.status }));
      return null;
    },
    /** Opens the site's login window. Scripts cannot complete a sign-in. */
    sign_in: (args, ctx) => {
      const lookup = resolve(ctx);
      return operation(args, () => lookup.automation.beginSignIn(capability(lookup, args)));
    },
  };
}

/**
 * A script consumes records through `on_record`, and may pass `known_keys`
 * so the run skips pages it already has. Without `on_record`, records go to
 * the block's output sink.
 */
function consumer(lookup: DocumentAutomationLookup, args: Record<string, unknown>): RecordConsumer {
  const onRecord = callback(args.on_record);
  if (!onRecord) {
    return required(lookup.sink(String(args.capabilityId ?? '')), 'Pass on_record, or give the collection block an output.');
  }
  const known = new Set(Array.isArray(args.known_keys) ? args.known_keys.map(String) : []);
  return {
    onRecord: (record: CollectedRecord) => {
      onRecord(record as unknown as Record<string, unknown>);
    },
    isKnown: (key) => known.has(key),
  };
}

export function collectionScriptingMethods(resolve: DocumentAutomationResolver): Record<string, ScriptingMethod> {
  const collection = (lookup: DocumentAutomationLookup, args: Record<string, unknown>) => required(
    lookup.collection(String(args.capabilityId ?? '')),
    `This document has no collection block "${String(args.capabilityId ?? '')}".`,
  );
  return {
    collect: (args, ctx) => {
      const lookup = resolve(ctx);
      const base = collection(lookup, args);
      // Scripts choose among the block's start pages by address; new sites go through the block and its review. Without a
      // choice, every start page included in collecting runs.
      const approved = base.startPages.map((page) => page.url);
      const startUrls = Array.isArray(args.startUrls) ? args.startUrls.map(String) : base.startPages.filter((page) => page.included !== false).map((page) => page.url);
      const unapproved = startUrls.filter((url) => !approved.includes(url));
      if (unapproved.length) throw new WebAutomationError('invalid_request', `Not an approved start URL: ${unapproved.join(', ')}.`);
      // A script may only lower the limits: the defaults, and each page's own.
      const lower = (limit: 'maxPages' | 'maxItems', value: number) => (typeof args[limit] === 'number' ? Math.min(args[limit], value) : value);
      const definition: CollectionDefinition = {
        ...base,
        maxPages: lower('maxPages', base.maxPages),
        maxItems: lower('maxItems', base.maxItems),
        startPages: base.startPages.map((page) => ({
          ...page,
          ...(page.maxPages !== undefined ? { maxPages: lower('maxPages', page.maxPages) } : {}),
          ...(page.maxItems !== undefined ? { maxItems: lower('maxItems', page.maxItems) } : {}),
        })),
      };
      return operation(args, () => lookup.automation.startCollection(definition, consumer(lookup, args), startUrls).done);
    },
    extract: (args, ctx) => {
      const lookup = resolve(ctx);
      return operation(args, () => lookup.automation.extractItem(collection(lookup, args), String(args.url ?? ''), consumer(lookup, args)).done);
    },
    stop: (args, ctx) => {
      resolve(ctx).automation.stopCollection(String(args.runId ?? ''));
      return null;
    },
  };
}

export function queueScriptingMethods(resolve: DocumentAutomationResolver): Record<string, ScriptingMethod> {
  const queueId = (args: Record<string, unknown>) => String(args.queueId ?? '');
  return {
    // `delay_ms` holds the entry back, such as a status check backing off while a report is pending. `context` is the
    // script's own bookkeeping: handed back with the result, never sent to the target.
    enqueue: (args, ctx) => resolve(ctx).automation.enqueue(queueId(args), String(args.key ?? ''), args.input ?? null, {
      ...(typeof args.delay_ms === 'number' ? { delayMs: args.delay_ms } : {}),
      ...(args.context === undefined ? {} : { context: args.context }),
    }),
    status: (args, ctx) => resolve(ctx).automation.listQueue(queueId(args)).find((entry) => entry.key === String(args.key ?? '')) ?? null,
    list: (args, ctx) => resolve(ctx).automation.listQueue(queueId(args)),
    cancel: (args, ctx) => {
      resolve(ctx).automation.cancelQueueEntry(queueId(args), String(args.key ?? ''));
      return null;
    },
    retry: (args, ctx) => {
      resolve(ctx).automation.retryQueueEntry(queueId(args), String(args.key ?? ''));
      return null;
    },
    pause: (args, ctx) => {
      resolve(ctx).automation.pauseQueue(queueId(args));
      return null;
    },
    resume: (args, ctx) => {
      resolve(ctx).automation.resumeQueue(queueId(args));
      return null;
    },
    /** Registered by the document's load script; results survive reloads, callbacks do not. */
    on_result: (args, ctx) => {
      const handler = required(callback(args.handler), 'on_result needs a handler function.');
      resolve(ctx).automation.onQueueResult(queueId(args), (result) => handler(result as unknown as Record<string, unknown>));
      return null;
    },
  };
}
