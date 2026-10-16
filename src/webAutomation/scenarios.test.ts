import { afterEach, describe, expect, it } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../../../heavy-file-format/src/cli-core';
import { deserializeDocument, serializeDocument } from '../../../heavy-file-format/src/serialization';
import { createCliItemStore } from './cliItemStore';
import { LISTING_STORE_CONFIG } from '../test/webAutomation/listingDocument';
import { analysisServiceCapability, SECOND_ACCOUNT_SESSION, SOURCE_DOCUMENT_PHRASE } from '../test/webAutomation/analysisService';
import { WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID } from './configs';
import { createMockFlow, DOCUMENT_PATH, EVALUATE_QUEUE, type MockFlow } from '../test/webAutomation/flow';
import {
  ATS_ORIGIN,
  atsDetailPattern,
  atsListingPattern,
  atsListingWithFramePattern,
  listingCollection,
  CAREERS_ORIGIN,
  INITRODE_HOSTED_ORIGIN,
  INITRODE_ORIGIN,
  SIDE_PANE_ORIGIN,
  sidePaneDetailPattern,
  sidePaneListingPattern,
  talentSuiteDetailPattern,
  talentSuiteListingPattern,
  VANDELAY_ORIGIN,
  JSON_ONLY_ORIGIN,
  OTHER_ATS_ORIGIN,
  otherAtsDetailPattern,
  otherAtsListingPattern,
  UNKNOWN_ORIGIN,
} from '../test/webAutomation/sites';

const ACME = `${ATS_ORIGIN}/acme/jobs`;
const acmeJob = (slug: string) => `${ATS_ORIGIN}/acme/jobs/${slug}`;

let flow: MockFlow | null = null;

afterEach((context) => {
  if (context.task.result?.state === 'fail' && flow) console.log(`Timeline:\n${flow.print()}`);
  flow = null;
});

async function signedInFlow(collection = listingCollection([ACME])): Promise<MockFlow> {
  flow = createMockFlow();
  flow.bindProfiles(collection);
  flow.approve();
  await flow.signIn();
  await flow.completeLogin();
  return flow;
}

describe('mock integration: job search flow', () => {
  it('1. happy path: sign in, collect two pages, evaluate, write results back', async () => {
    flow = createMockFlow();
    const boards = listingCollection([ACME]);
    flow.bindProfiles(boards);
    flow.approve();

    expect((await flow.probe()).status).toBe('signed-out');
    await flow.signIn();
    expect(flow.host.isUserWindowVisible('service')).toBe(true);
    await flow.completeLogin();
    const session = flow.automation.getState().sessions[0];
    expect(session).toMatchObject({ status: 'signed-in', accountName: 'Pat Example' });
    expect(flow.host.isUserWindowVisible('service')).toBe(false);

    const run = await flow.collect(boards);
    expect(run).toMatchObject({ status: 'done', page: 2, collected: 5, problems: 0 });
    const cards = flow.items.list();
    expect(cards.map((card) => card.key).sort()).toEqual(['data-1', 'eng-1', 'eng-2', 'eng-3', 'pm-1'].map(acmeJob).sort());
    expect(flow.item(acmeJob('eng-1'))).toMatchObject({ state: 'ok', provenance: { patternId: 'ats-detail' }, fields: { company: 'Acme', title: 'Senior Engineer' } });
    expect(flow.print()).toMatch(/delay \d+\.\ds before boards\.mock-ats\.test/);
    expect(flow.print()).toContain('← back to boards.mock-ats.test/acme/jobs');

    await flow.evaluate([acmeJob('eng-1'), acmeJob('eng-2'), acmeJob('pm-1')]);
    expect(flow.item(acmeJob('eng-1'))?.fields).toMatchObject({ evaluation: 'ready', rating: 'strong' });
    expect(flow.item(acmeJob('eng-2'))?.fields).toMatchObject({ evaluation: 'ready', rating: 'partial' });
    // The service's stored source document is opened when each call runs, and never copied into the queue.
    expect(flow.service.lastSourceText).toContain(SOURCE_DOCUMENT_PHRASE);
    expect(flow.print()).toContain('download storage.mock-storage.test/bucket/source-1');
    expect(flow.listQueue(EVALUATE_QUEUE).every((entry) => !('sourceText' in (entry.input as Record<string, unknown>)))).toBe(true);
    expect(flow.item(acmeJob('pm-1'))?.fields.resultUrl).toMatch(/\/analyses\/analysis-\d$/);
  });

  it('2. re-run: known postings are skipped and user-owned fields survive', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    flow!.items.put({ ...flow!.item(acmeJob('eng-1'))!, fields: { ...flow!.item(acmeJob('eng-1'))!.fields, status: 'applied', notes: 'Recruiter call Friday' } });

    const rerun = await flow!.collect(boards);
    expect(rerun).toMatchObject({ status: 'done', collected: 0, skipped: 5 });
    expect(flow!.item(acmeJob('eng-1'))?.fields).toMatchObject({ status: 'applied', notes: 'Recruiter call Friday' });
    const secondRun = flow!.print().split('run-2 started')[1];
    expect(secondRun).not.toContain('→ boards.mock-ats.test/acme/jobs/eng-1');
    expect(secondRun).toContain('skip known https://boards.mock-ats.test/acme/jobs/eng-1');
  });

  it('3. pattern reuse: a second company on the same ATS needs no teaching', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/globex/jobs`]);
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${ATS_ORIGIN}/globex/jobs/eng-1`)).toMatchObject({ provenance: { patternId: 'ats-detail' }, fields: { company: 'Globex' } });
  });

  it('4. no pattern and JSON-LD: unknown pages become visible card states, JSON-LD needs no teaching', async () => {
    const boards = listingCollection([`${UNKNOWN_ORIGIN}/openings/7`, `${JSON_ONLY_ORIGIN}/jobs/42`], { jsonLd: { type: 'JobPosting' } });
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 1, problems: 1 });
    expect(flow!.item(`${UNKNOWN_ORIGIN}/openings/7`)).toMatchObject({ state: 'no_pattern', problem: 'No pattern for jobs.unknown.test.' });
    expect(flow!.item(`${JSON_ONLY_ORIGIN}/jobs/42`)).toMatchObject({
      state: 'ok',
      provenance: { patternId: 'json-ld:JobPosting' },
      fields: { title: 'Staff Engineer', company: 'Json Co', location: 'Austin, TX', description: 'Lead the TypeScript platform.\nMentor engineers' },
    });
  });

  it('5. challenge: the run pauses for attention, the user solves it, and the run resumes', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/initech/jobs`]);
    await signedInFlow(boards);
    const paused = await flow!.collect(boards);
    expect(paused).toMatchObject({ status: 'needs-attention', attention: { reason: 'challenge' } });

    await flow!.showAttention(paused.runId);
    expect(flow!.host.isWorkerVisible(paused.attention!.workerId)).toBe(true);
    flow!.solveChallenge(ATS_ORIGIN);
    const resumed = await flow!.resumeAttention(paused.runId);
    expect(resumed).toMatchObject({ status: 'done', collected: 1, attention: null });
    expect(flow!.host.isWorkerVisible(paused.attention!.workerId)).toBe(false);

    // The clearance lives in the shared profile session, so a later run is not challenged.
    const again = await flow!.collect(listingCollection([`${ATS_ORIGIN}/initech/jobs`]));
    expect(again.status).toBe('done');
  });

  it('6. SPA listing: when back navigation does not restore the listing, the run reopens it', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/hooli/jobs`]);
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.print()).toContain('listing not restored after back; reopening');
  });

  it('7. quota: a 429 retries with backoff and never creates a second report', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    flow!.service.rateLimitNextCreates = 1;

    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.item(acmeJob('eng-1'))?.fields).toMatchObject({ evaluation: 'ready', rating: 'strong' });
    expect(flow!.service.createCalls).toBe(2);
    expect(flow!.service.analyses.size).toBe(1);
    expect(flow!.print()).toMatch(/retry .*eng-1 in \d+s/);
  });

  it('8. sign-out mid-queue: the queue pauses and resumes after signing in again', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    flow!.expireSession();

    await flow!.evaluate([acmeJob('eng-1'), acmeJob('eng-2')]);
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ paused: true, pauseReason: 'not_authenticated' });
    expect(flow!.automation.getState().sessions[0].status).toBe('signed-out');
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBeUndefined();

    await flow!.signIn();
    await flow!.completeLogin();
    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
    expect(flow!.item(acmeJob('eng-2'))?.fields.evaluation).toBe('ready');
  });

  it('9. reload: queued work persists and nothing runs until Resume', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    await flow!.evaluate([acmeJob('eng-1'), acmeJob('eng-2'), acmeJob('pm-1')], { settle: false });
    flow!.reload();

    await flow!.settle();
    await flow!.advance(10 * 60_000);
    const analysesBeforeResume = flow!.service.analyses.size;
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ awaitingResume: true });
    expect(flow!.item(acmeJob('eng-2'))?.fields.evaluation).toBeUndefined();

    await flow!.resumeQueue(EVALUATE_QUEUE);
    for (const slug of ['eng-1', 'eng-2', 'pm-1']) expect(flow!.item(acmeJob(slug))?.fields.evaluation).toBe('ready');
    // The interrupted first entry re-sends the same idempotency key, so no report is duplicated.
    expect(flow!.service.analyses.size).toBe(3);
    expect(analysesBeforeResume).toBeLessThanOrEqual(1);
  });

  it('10. concurrency: API calls never wait for a run, the same origin waits, different origins run in parallel', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);

    flow!.automation.startCollection(boards, flow!.sink);
    const startedAt = flow!.clock.now();
    let probed = false;
    void flow!.probe().then(() => {
      probed = true;
    });
    await flow!.clock.runUntil(() => probed);
    expect(flow!.clock.now() - startedAt).toBeLessThan(1_000);
    expect(flow!.automation.getState().runs[0].status).toBe('running');
    await flow!.settle();

    const sameOrigin = listingCollection([`${ATS_ORIGIN}/globex/jobs`, `${ATS_ORIGIN}/hooli/jobs`]);
    flow!.approve();
    await flow!.collect(sameOrigin);
    const serial = flow!.print().split('run-2 started')[1];
    expect(serial.indexOf('finish: Listings: boards.mock-ats.test')).toBeLessThan(serial.lastIndexOf('start: Listings: boards.mock-ats.test'));

    const twoOrigins = listingCollection([`${ATS_ORIGIN}/globex/jobs`, `${OTHER_ATS_ORIGIN}/umbrella/jobs`], { patterns: [otherAtsListingPattern, otherAtsDetailPattern] });
    flow!.approve();
    await flow!.collect(twoOrigins);
    const parallel = flow!.print().split('run-3 started')[1];
    expect(parallel.indexOf('start: Listings: jobs.other-ats.test')).toBeGreaterThan(-1);
    expect(parallel.indexOf('start: Listings: jobs.other-ats.test')).toBeLessThan(parallel.indexOf('finish: Listings'));
    expect(flow!.item(`${OTHER_ATS_ORIGIN}/umbrella/jobs/eng-1`)?.state).toBe('ok');
  });

  it('11. authorization: web plugins are allowed per file, the service is approved at sign-in, and a changed configuration names what changed', async () => {
    flow = createMockFlow();
    const boards = listingCollection([ACME]);
    flow.bindProfiles(boards);
    expect(flow.pluginAuthorization(WEB_COLLECTION_PLUGIN_ID)).toBe('prompt');
    expect(flow.pluginAuthorization(WEB_API_PLUGIN_ID)).toBe('prompt');
    expect(() => flow!.automation.startCollection(boards, flow!.sink)).toThrow(/Allow Web Collection in this file/);
    await expect(flow.probe()).rejects.toMatchObject({ code: 'not_authorized' });
    expect(flow.host.workerIds()).toEqual([]);

    // Allowing the plugin is not enough for a service: what the document does with your account is approved at sign-in.
    flow.authorizePlugin(WEB_API_PLUGIN_ID);
    expect(flow.reviewWebApi()).toMatchObject({ reason: 'first-use' });
    await expect(flow.probe()).rejects.toMatchObject({ code: 'not_authorized' });

    flow.approve();
    expect(flow.pluginAuthorization(WEB_COLLECTION_PLUGIN_ID)).toBe('enabled');
    expect(flow.reviewWebApi()).toMatchObject({ reason: 'authorized' });
    const widened = { ...analysisServiceCapability, endpoints: [...analysisServiceCapability.endpoints, { ...analysisServiceCapability.endpoints[0], id: 'delete-account', method: 'DELETE' as const }] };
    expect(flow.reviewWebApi(widened)).toEqual({ capabilityId: 'analysis', reason: 'capability-changed', changedCategories: ['endpoints'] });

    // The explorer's settings (sites, patterns, following links) only shape what it reads, so changing them asks nothing.
    const run = flow.automation.startCollection({ ...boards, followLinksToOtherSites: true }, flow.sink);
    expect(await flow.stop(run.runId)).toMatchObject({ status: 'stopped' });
  });

  it('12. single posting and stop: one URL is extracted directly, and a stopped run ends cleanly', async () => {
    const boards = listingCollection([ACME, `${JSON_ONLY_ORIGIN}/jobs/42`], { jsonLd: { type: 'JobPosting' } });
    await signedInFlow(boards);
    const single = await flow!.extract(boards, `${JSON_ONLY_ORIGIN}/jobs/42?utm_campaign=mail#apply`);
    expect(single).toMatchObject({ status: 'done', collected: 1 });
    expect(flow!.item(`${JSON_ONLY_ORIGIN}/jobs/42`)?.provenance.patternId).toBe('json-ld:JobPosting');

    const challenged = listingCollection([`${ATS_ORIGIN}/initech/jobs`]);
    flow!.approve();
    const paused = await flow!.collect(challenged);
    expect(paused.status).toBe('needs-attention');
    expect(await flow!.stop(paused.runId)).toMatchObject({ status: 'stopped', collected: 0 });
  });

  it('14. side pane: cards open beside the listing, with no navigation to undo', async () => {
    const board = listingCollection([`${SIDE_PANE_ORIGIN}/search`], { patterns: [sidePaneListingPattern, sidePaneDetailPattern] });
    await signedInFlow(board);
    const run = await flow!.collect(board);
    expect(run).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${SIDE_PANE_ORIGIN}/view/2`)).toMatchObject({ provenance: { patternId: 'pane-detail' }, fields: { title: 'ML Engineer', company: 'Sidepane Inc' } });
    expect(flow!.print()).toContain('click open-card on card-1');
    expect(flow!.print()).not.toContain('← back');
  });

  it('15. embedded ATS: a careers page iframe is opened on its own and collected with the ATS patterns', async () => {
    const careers = listingCollection([`${CAREERS_ORIGIN}/careers`], { patterns: [atsListingWithFramePattern, atsDetailPattern] });
    await signedInFlow(careers);
    const run = await flow!.collect(careers);
    expect(run).toMatchObject({ status: 'done', collected: 5 });
    expect(flow!.print()).toContain(`opening frame on its own: ${ATS_ORIGIN}/acme/jobs`);
  });

  it('16. white-labeled platform: fingerprints match on any host; following links off-site is an explorer setting', async () => {
    const platform = listingCollection([`${INITRODE_ORIGIN}/Portal/Jobs.aspx`, `${VANDELAY_ORIGIN}/Portal/Jobs.aspx`], {
      patterns: [talentSuiteListingPattern, talentSuiteDetailPattern],
    });
    await signedInFlow(platform);
    const contained = await flow!.collect(platform);
    expect(contained).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${VANDELAY_ORIGIN}/Portal/Job.aspx?id=21`)).toMatchObject({ provenance: { patternId: 'talentsuite-detail' }, fields: { company: 'Vandelay' } });
    expect(flow!.print()).toContain(`skip out of scope ${INITRODE_HOSTED_ORIGIN}/Portal/Job.aspx?id=11`);

    const following = { ...platform, followLinksToOtherSites: true };
    const followed = await flow!.collect(following);
    expect(followed).toMatchObject({ status: 'done', collected: 1, skipped: 2 });
    expect(flow!.item(`${INITRODE_HOSTED_ORIGIN}/Portal/Job.aspx?id=11`)).toMatchObject({ provenance: { patternId: 'talentsuite-detail' }, fields: { company: 'Initrode' } });
  });

  it('18. account change: the service approval is for the profile and configuration, so another account signs in without review', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    expect((await flow!.callEndpoint('profile')).status).toBe(200);

    // UI: "Sign in" as someone else, which the user does knowingly in the site's own login form.
    await flow!.signOut();
    await flow!.signIn();
    await flow!.completeLogin(SECOND_ACCOUNT_SESSION);
    expect(flow!.automation.getState().sessions[0]).toMatchObject({ status: 'signed-in', accountName: 'Sam Other' });
    expect(flow!.reviewWebApi()).toMatchObject({ reason: 'authorized' });
    expect((await flow!.callEndpoint('profile')).status).toBe(200);
  });

  it('19. pattern library: a pattern taught once applies on re-run, but never widens where a run may go', async () => {
    const mixed = listingCollection([`${UNKNOWN_ORIGIN}/openings/7`, `${SIDE_PANE_ORIGIN}/search`, `${INITRODE_ORIGIN}/Portal/Jobs.aspx`]);
    await signedInFlow(mixed);
    const before = await flow!.collect(mixed);
    expect(before).toMatchObject({ status: 'done', collected: 0, problems: 3 });

    flow!.teachPatterns(sidePaneListingPattern, sidePaneDetailPattern, talentSuiteListingPattern, talentSuiteDetailPattern);
    const after = await flow!.collect(mixed);
    expect(after).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${SIDE_PANE_ORIGIN}/view/1`)).toMatchObject({ state: 'ok', provenance: { patternId: 'pane-detail' } });
    expect(flow!.print()).toContain('using library pattern "TalentSuite job list"');
    expect(flow!.print()).toContain(`skip out of scope ${INITRODE_HOSTED_ORIGIN}/Portal/Job.aspx?id=11`);
    expect(flow!.item(`${UNKNOWN_ORIGIN}/openings/7`)?.state).toBe('no_pattern');
  });

  it('20. test on another site: a pattern is checked on a second customer before relying on it', async () => {
    flow = createMockFlow();
    expect(await flow.testPattern(talentSuiteListingPattern, `${VANDELAY_ORIGIN}/Portal/Jobs.aspx`)).toMatchObject({
      scopeMatched: null, fingerprintMatched: true, confidence: 0.87, records: 2, passes: true,
    });
    expect(await flow.testPattern(atsListingWithFramePattern, `${VANDELAY_ORIGIN}/Portal/Jobs.aspx`)).toMatchObject({
      scopeMatched: false, fingerprintMatched: null, passes: false,
    });
    expect(await flow.testPattern(atsListingPattern, `${ATS_ORIGIN}/initech/jobs`)).toMatchObject({ passes: false, attention: 'challenge' });
  });

  it('21. record sinks and keys: a refresh sink revisits pages but only rewrites the fields it owns; field keys dedupe without URLs', async () => {
    flow = createMockFlow({ sink: { onExisting: 'refresh', keepGoodOnFailure: true, ownedFields: ['title', 'company', 'location', 'description', 'url'] } });
    const globex = listingCollection([`${ATS_ORIGIN}/globex/jobs`]);
    flow.bindProfiles(globex);
    flow.approve();
    await flow.collect(globex);
    const key = `${ATS_ORIGIN}/globex/jobs/eng-1`;
    flow.items.put({ ...flow.item(key)!, fields: { ...flow.item(key)!.fields, status: 'saved' } });
    const again = await flow.collect(globex);
    expect(again).toMatchObject({ collected: 2, skipped: 0 });
    expect(flow.item(key)?.fields).toMatchObject({ title: 'Backend Engineer', company: 'Globex', status: 'saved' });

    const byTitle = listingCollection([`${ATS_ORIGIN}/hooli/jobs`], { key: { kind: 'field', field: 'title' } });
    const keyed = createMockFlow();
    keyed.bindProfiles(byTitle);
    keyed.approve();
    await keyed.collect(byTitle);
    expect(keyed.items.list().map((item) => item.key).sort()).toEqual(['Engineer I', 'Engineer II']);
    expect(await keyed.collect(byTitle)).toMatchObject({ collected: 0, skipped: 2 });
  });

  it('22. into a real HVY document: items are template instances that sort by result and survive a reload', async () => {
    flow = createMockFlow({ document: { store: LISTING_STORE_CONFIG } });
    const boards = listingCollection([ACME]);
    flow.bindProfiles(boards);
    flow.approve();
    await flow.signIn();
    await flow.completeLogin();
    await flow.collect(boards);
    await flow.evaluate([acmeJob('eng-1'), acmeJob('eng-2')]);

    const saved = serializeDocument(flow.document!);
    const reloaded = deserializeDocument(saved, '.hvy');
    const store = createCliItemStore(reloaded, LISTING_STORE_CONFIG);
    expect(store.list()).toHaveLength(5);
    expect(store.get(acmeJob('eng-1'))?.fields).toMatchObject({
      title: 'Senior Engineer', company: 'Acme', location: 'Remote', rating: 'strong', evaluation: 'ready', reason: 'Strong overlap.',
    });
    expect(store.get(acmeJob('pm-1'))?.fields.rating).toBeUndefined();
    expect(saved).toContain('"sortKeys":{"Rating":"strong"}');
    expect(saved).toContain('"groupKeys":{"Evaluation":"ready"}');
    expect(saved).toContain(`[Senior Engineer](${acmeJob('eng-1')}?utm_source=board)`);
    const lint = await executeHvyCliCommand(reloaded, createHvyCliSession(), 'hvy lint');
    expect(lint.output).toContain('No lint issues');
  });

  it('13. direct calls and queue controls: endpoint call, pause, cancel, fail, retry, sign out', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);

    const files = await flow!.callEndpoint('profile');
    expect(files.body).toMatchObject({ defaultSourceId: 'source-1' });
    await expect(flow!.callEndpoint('profile', { unexpected: true })).rejects.toMatchObject({ code: 'invalid_request' });

    flow!.pauseQueue(EVALUATE_QUEUE);
    await flow!.evaluate([acmeJob('eng-1'), acmeJob('eng-2')]);
    flow!.cancelQueueEntry(EVALUATE_QUEUE, acmeJob('eng-2'));
    expect(flow!.listQueue(EVALUATE_QUEUE).map((entry) => entry.status)).toEqual(['queued', 'cancelled']);

    flow!.service.rateLimitNextCreates = 99;
    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', attempts: 4 });
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('failed');
    expect(flow!.item(acmeJob('eng-2'))?.fields.evaluation).toBeUndefined();

    flow!.service.rateLimitNextCreates = 0;
    await flow!.retryQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');

    await flow!.signOut();
    expect(flow!.automation.getState().sessions[0].status).toBe('signed-out');
    expect((await flow!.probe()).status).toBe('signed-out');
  });

  it('24. unloaded mid-call: the call finishes, its result waits, and arrives when the document opens again', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    const release = flow!.host.holdRequests('/api/analyses');
    await flow!.evaluate([acmeJob('eng-1')], { settle: false });
    await flow!.clock.runUntil(() => flow!.listQueue(EVALUATE_QUEUE)[0]?.status === 'running');

    // UI: document closed while the call is in flight. Nothing needed saving first.
    flow!.closeDocument();
    release();
    await flow!.settle();
    expect(flow!.service.analyses.size).toBe(1);
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'done', delivered: false });
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBeUndefined();

    // UI: document opened again; its load script registers on_result and the held result is delivered.
    flow!.openDocument();
    await flow!.settle();
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
    expect(flow!.service.analyses.size).toBe(1);
  });

  it('25. the app restarts mid-call: the stored entry is resent with the same idempotency key after Resume', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    const release = flow!.host.holdRequests('/api/analyses');
    await flow!.evaluate([acmeJob('eng-1')], { settle: false });
    await flow!.clock.runUntil(() => flow!.listQueue(EVALUATE_QUEUE)[0]?.status === 'running');
    const { idempotencyKey } = flow!.listQueue(EVALUATE_QUEUE)[0];

    flow!.restartApp();
    // The old app's request still reaches the service, but its response is lost with the app.
    release();
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'queued', idempotencyKey });
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ awaitingResume: true });

    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
    // The call the old app sent and the resent one share a key, so the service made one analysis.
    expect(flow!.service.analyses.size).toBe(1);
    expect([...flow!.service.analysesByKey.keys()]).toEqual([idempotencyKey]);
  });

  it('26. served source: the stored document is opened, checked, decrypted in memory, and sent with its revision', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    await flow!.evaluate([acmeJob('eng-1')]);

    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
    expect(flow!.service.sourceOpens).toBe(1);
    expect(flow!.service.lastSourceText).toContain(SOURCE_DOCUMENT_PHRASE);
    expect(flow!.service.lastSourceRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(flow!.print()).toContain('download storage.mock-storage.test/bucket/source-1');
    expect(flow!.print()).toContain('(no credentials)');
  });

  it('27. served source: a URL outside the storage origins is never fetched, and altered bytes are rejected', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);

    flow!.service.servedUrlOverride = 'http://192.168.1.1/admin';
    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/not a secure origin/) });
    flow!.service.servedUrlOverride = 'https://elsewhere.test/bucket/source-1';
    await flow!.retryQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/does not list as a storage origin/) });
    expect(flow!.print()).not.toContain('download ');

    flow!.service.servedUrlOverride = null;
    flow!.service.corruptStoredSource = true;
    await flow!.retryQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/does not match the hash/) });
    expect(flow!.service.createCalls).toBe(0);
  });

  it('28. plugin authorization: kept per file across reopening and an app restart', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    flow!.reload();
    expect(flow!.pluginAuthorization(WEB_COLLECTION_PLUGIN_ID)).toBe('enabled');
    expect(flow!.pluginAuthorization(WEB_API_PLUGIN_ID)).toBe('enabled');

    flow!.restartApp();
    expect(flow!.pluginAuthorization(WEB_COLLECTION_PLUGIN_ID)).toBe('enabled');
  });

  it('29. revoking a service approval: calls stop and queued work waits for review, while the plugin stays allowed', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    expect(flow!.settings.get().authorizations[DOCUMENT_PATH]?.analysis).toMatchObject({ name: 'Mock Analysis', profileId: 'service' });

    flow!.revokeService();
    expect(flow!.settings.get().authorizations[DOCUMENT_PATH]).toBeUndefined();
    expect(flow!.reviewWebApi()).toMatchObject({ reason: 'first-use' });
    await expect(flow!.callEndpoint('profile')).rejects.toMatchObject({ code: 'not_authorized' });
    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ paused: true, pauseReason: 'not_authorized' });
    expect(flow!.service.createCalls).toBe(0);
    expect(flow!.pluginAuthorization(WEB_API_PLUGIN_ID)).toBe('enabled');

    // UI: the "Sign in" modal asks again; allowing it lets the waiting work continue.
    flow!.approve();
    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
  });
});
