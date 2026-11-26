import { describe, expect, it } from 'vitest';
import { createMockFlow, EVALUATE_QUEUE } from '../test/webAutomation/flow';
import { analysisServiceCapability } from '../test/webAutomation/analysisService';
import { ATS_ORIGIN, listingCollection } from '../test/webAutomation/sites';
import { createScriptingDbRuntime } from '../../../heavy-file-format/src/plugins/db-table';
import { deserializeDocument } from '../../../heavy-file-format/src/serialization';
import { collectionScriptingMethods, queueScriptingMethods, scheduleScriptingMethods, webApiScriptingMethods, type DocumentAutomationResolver } from './scripting';
import { insertPluginBlock } from '../test/webAutomation/listingDocument';
import { executeHvyCliCommandSync } from '../../../heavy-file-format/src/cli-core';
import { SCHEDULE_PLUGIN_ID } from './configs';
import { readWebAutomationBlocks } from './documentBlocks';
import { getDocumentScriptingSession } from '../../../heavy-file-format/src/plugins/scripting/scripting-session';

async function setup() {
  const flow = createMockFlow();
  const boards = listingCollection([`${ATS_ORIGIN}/acme/jobs`, `${ATS_ORIGIN}/globex/jobs`]);
  flow.bindProfiles(boards);
  flow.approve();
  await flow.signIn();
  await flow.completeLogin();
  // A document's own database, as the app gives the methods.
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const { api: db } = await createScriptingDbRuntime(document);
  const resolve: DocumentAutomationResolver = () => ({
    automation: flow.automation,
    webApi: (id) => (id === analysisServiceCapability.capabilityId ? analysisServiceCapability : null),
    collection: (id) => (id === boards.capabilityId ? boards : null),
    sink: (id) => (id === boards.capabilityId ? flow.sink : null),
    database: async (use) => use(db),
    databaseChanged: () => undefined,
    openInBrowser: async () => undefined,
    documentPath: () => '',
    schedule: () => null,
    setSchedulePauses: () => undefined,
    scheduled: () => null,
  });
  return { flow, boards, resolve, ctx: { rawDocument: {}, session: getDocumentScriptingSession(document) } };
}

describe('scripting methods', () => {
  it('returns a queued job synchronously for sandboxed scripts and reports through callbacks', async () => {
    const { flow, resolve, ctx } = await setup();
    const api = webApiScriptingMethods(resolve);
    const reports: Array<Record<string, unknown>> = [];
    const job = api.call({ capabilityId: 'analysis', endpointId: 'profile', on_complete: (result: Record<string, unknown>) => reports.push(result) }, ctx);
    expect(job).toMatchObject({ status: 'queued' });
    await flow.clock.runUntil(() => reports.length === 1);
    expect(reports[0]).toMatchObject({ status: 'completed', result: { status: 200, body: { defaultSourceId: 'source-1' } } });

    flow.expireSession();
    const failures: Array<Record<string, unknown>> = [];
    api.call({ capabilityId: 'analysis', endpointId: 'profile', on_complete: () => undefined, on_error: (result: Record<string, unknown>) => failures.push(result) }, ctx);
    await flow.clock.runUntil(() => failures.length === 1);
    expect(failures[0]).toMatchObject({ status: 'failed', code: 'not_authenticated' });
  });

  it('lets power scripts await the same methods', async () => {
    const { flow, resolve, ctx } = await setup();
    let settled: unknown = null;
    void (webApiScriptingMethods(resolve).session({ capabilityId: 'analysis' }, ctx) as Promise<unknown>).then((value) => {
      settled = value;
    });
    await flow.clock.runUntil(() => settled !== null);
    expect(settled).toMatchObject({ status: 'signed-in' });
  });

  it('collects with per-item callbacks and only from approved start URLs', async () => {
    const { flow, resolve, ctx } = await setup();
    const collection = collectionScriptingMethods(resolve);
    expect(() => collection.collect({ capabilityId: 'listings', startUrls: ['https://elsewhere.test/jobs'] }, ctx)).toThrow(/approved start URL/);

    const items: string[] = [];
    const done: Array<Record<string, unknown>> = [];
    collection.collect({
      capabilityId: 'listings',
      startUrls: [`${ATS_ORIGIN}/globex/jobs`],
      on_record: (record: Record<string, unknown>) => items.push(`${String(record.state)} ${String(record.key)}`),
      on_complete: (result: Record<string, unknown>) => done.push(result),
    }, ctx);
    await flow.clock.runUntil(() => done.length === 1);
    // Each job as its list shows it, then as its page is read.
    expect(items).toEqual([`listed ${ATS_ORIGIN}/globex/jobs/eng-1`, `listed ${ATS_ORIGIN}/globex/jobs/ops-1`, `ok ${ATS_ORIGIN}/globex/jobs/eng-1`, `ok ${ATS_ORIGIN}/globex/jobs/ops-1`]);
    expect(done[0]).toMatchObject({ status: 'completed', result: { status: 'done', collected: 2 } });
  });

  it('drives the queue: enqueue, de-duplicate, list, and deliver results to on_result', async () => {
    const { flow, resolve, ctx } = await setup();
    await flow.collect(listingCollection([`${ATS_ORIGIN}/acme/jobs`, `${ATS_ORIGIN}/globex/jobs`]));
    const queue = queueScriptingMethods(resolve);
    const results: Array<Record<string, unknown>> = [];
    queue.on_result({ queueId: EVALUATE_QUEUE, handler: (result: Record<string, unknown>) => results.push(result) }, ctx);
    const input = { sourceText: 'TypeScript', url: `${ATS_ORIGIN}/acme/jobs/eng-1`, text: 'A TypeScript role building systems.' };
    expect(queue.enqueue({ queueId: EVALUATE_QUEUE, key: 'eng-1', input }, ctx)).toEqual({ added: true });
    expect(queue.enqueue({ queueId: EVALUATE_QUEUE, key: 'eng-1', input }, ctx)).toEqual({ added: false });
    await flow.clock.runUntil(() => results.length === 1);
    expect(results[0]).toMatchObject({ key: 'eng-1', status: 'done', result: { body: { status: 'pending' } } });
    expect(queue.list({ queueId: EVALUATE_QUEUE }, ctx)).toEqual([expect.objectContaining({ key: 'eng-1', status: 'done' })]);
    // An entry cancelled before it runs is delivered too, once, so the script can put back what it marked as queued.
    queue.pause({ queueId: EVALUATE_QUEUE }, ctx);
    queue.enqueue({ queueId: EVALUATE_QUEUE, key: 'eng-2', input, context: { row: 2 } }, ctx);
    queue.cancel({ queueId: EVALUATE_QUEUE, key: 'eng-2' }, ctx);
    queue.cancel({ queueId: EVALUATE_QUEUE, key: 'eng-2' }, ctx);
    expect(results.slice(1)).toEqual([{ key: 'eng-2', context: { row: 2 }, status: 'cancelled' }]);
    expect(() => queue.on_result({ queueId: EVALUATE_QUEUE }, ctx)).toThrow(/handler/);
  });
  it('collects only the pages due when asked, as the block\'s Fetch due does', async () => {
    const { flow, boards, resolve, ctx } = await setup();
    const now = new Date(flow.clock.now()).toISOString();
    const pages = { ...boards, startPages: [{ id: 'fresh', url: `${ATS_ORIGIN}/acme/jobs`, checkedAt: now }, { id: 'never', url: `${ATS_ORIGIN}/globex/jobs` }] };
    const collection = collectionScriptingMethods((context) => ({ ...resolve(context), collection: () => pages }));
    const done: Array<Record<string, unknown>> = [];
    collection.collect({ capabilityId: 'listings', due: true, on_complete: (result: Record<string, unknown>) => done.push(result) }, ctx);
    await flow.clock.runUntil(() => done.length === 1);
    expect(Object.keys((done[0].result as { startPages: object }).startPages)).toEqual(['never']);
  });

  it('lets a script lower the limits, a page\'s own included, but not raise them', async () => {
    const { flow, boards, resolve, ctx } = await setup();
    const limited = { ...boards, startPages: [{ id: 'start-1', url: `${ATS_ORIGIN}/acme/jobs`, maxPages: 2, maxItems: 4 }] };
    const collection = collectionScriptingMethods((context) => ({ ...resolve(context), collection: () => limited }));
    const done: Array<Record<string, unknown>> = [];
    collection.collect({ capabilityId: 'listings', maxItems: 2, maxPages: 9, on_complete: (result: Record<string, unknown>) => done.push(result) }, ctx);
    await flow.clock.runUntil(() => done.length === 1);
    expect(done[0]).toMatchObject({ status: 'completed', result: { status: 'done', collected: 2, startPages: { 'start-1': { pages: 1 } } } });
  });
});

describe('schedule scripting methods', () => {
  /** The flow's document with a schedule block of two jobs: what its scripts reach, and how often it was changed. */
  function scheduled() {
    let changes = 0;
    const flow = createMockFlow({ document: { changed: () => { changes += 1; } } });
    insertPluginBlock(flow.document, '/body/setup', 'schedule', SCHEDULE_PLUGIN_ID, {
      schemaVersion: 1,
      jobs: [{ id: 'fetch', name: 'Fetch', script: 'fetch', everyMinutes: 60 }, { id: 'tidy', name: 'Tidy', script: 'tidy', everyMinutes: 60 }],
      scripts: { fetch: '', tidy: '' },
    });
    const schedule = scheduleScriptingMethods(() => flow.lookup);
    const ctx = { rawDocument: flow.document, session: getDocumentScriptingSession(flow.document) };
    const paused = () => readWebAutomationBlocks(flow.document).schedules[0].config.paused;
    return { flow, schedule, ctx, paused, changes: () => changes };
  }

  it('pauses a job or every job into the block, with its reason, and resumes them', () => {
    const { flow, schedule, ctx, paused, changes } = scheduled();
    schedule.pause({ job: 'fetch', reason: 'Out of credits' }, ctx);
    expect(paused()).toEqual({ fetch: 'Out of credits' });
    // Written into the block's text, so it goes with the file; the document is unsaved until then.
    expect(executeHvyCliCommandSync(flow.document, 'cat /body/setup/schedule/plugin.txt').output).toContain('"Out of credits"');
    expect(changes()).toBe(1);
    // The same pause again changes nothing.
    schedule.pause({ job: 'fetch', reason: 'Out of credits' }, ctx);
    expect(changes()).toBe(1);

    schedule.pause({ reason: 'Away' }, ctx);
    expect(paused()).toEqual({ fetch: 'Out of credits', '*': 'Away' });
    expect((schedule.status({}, ctx) as Array<{ id: string; paused: string | null; on: boolean; next: string | null }>).map(({ id, paused: reason, on, next }) => ({ id, reason, on, next })))
      .toEqual([{ id: 'fetch', reason: 'Out of credits', on: false, next: null }, { id: 'tidy', reason: 'Away', on: false, next: null }]);

    // Resuming one job lifts its own pause; a pause of every job still holds it.
    schedule.resume({ job: 'fetch' }, ctx);
    expect(paused()).toEqual({ '*': 'Away' });
    schedule.resume({}, ctx);
    expect(paused()).toEqual({});
    expect(executeHvyCliCommandSync(flow.document, 'cat /body/setup/schedule/plugin.txt').output).not.toContain('"state"');
  });

  it('refuses a pause without a reason, and a job the block doesn\'t have', () => {
    const { schedule, ctx, paused } = scheduled();
    expect(() => schedule.pause({ job: 'fetch' }, ctx)).toThrow('pause needs a reason');
    expect(() => schedule.pause({ job: 'gone', reason: 'x' }, ctx)).toThrow('no job "gone"');
    expect(() => schedule.resume({ job: 'gone' }, ctx)).toThrow('no job "gone"');
    expect(paused()).toEqual({});
  });
});
