import { describe, expect, it } from 'vitest';
import { createFauxFlow, EVALUATE_QUEUE } from './faux/flow';
import { analysisServiceCapability } from './faux/analysisService';
import { ATS_ORIGIN, listingCollection } from './faux/sites';
import { collectionScriptingMethods, queueScriptingMethods, webApiScriptingMethods, type DocumentAutomationResolver } from './scripting';

async function setup() {
  const flow = createFauxFlow();
  const boards = listingCollection([`${ATS_ORIGIN}/acme/jobs`, `${ATS_ORIGIN}/globex/jobs`]);
  flow.bindProfiles(boards);
  flow.approve();
  await flow.signIn();
  await flow.completeLogin();
  const resolve: DocumentAutomationResolver = () => ({
    automation: flow.automation,
    webApi: (id) => (id === analysisServiceCapability.capabilityId ? analysisServiceCapability : null),
    collection: (id) => (id === boards.capabilityId ? boards : null),
    sink: (id) => (id === boards.capabilityId ? flow.sink : null),
  });
  return { flow, boards, resolve, ctx: { rawDocument: {} } };
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
    expect(settled).toMatchObject({ status: 'signed-in', accountName: 'Pat Example' });
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
      on_record: (record: Record<string, unknown>) => items.push(String(record.key)),
      on_complete: (result: Record<string, unknown>) => done.push(result),
    }, ctx);
    await flow.clock.runUntil(() => done.length === 1);
    expect(items).toEqual([`${ATS_ORIGIN}/globex/jobs/eng-1`, `${ATS_ORIGIN}/globex/jobs/ops-1`]);
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
    expect(() => queue.on_result({ queueId: EVALUATE_QUEUE }, ctx)).toThrow(/handler/);
  });
});
