import { afterEach, describe, expect, it } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../../../heavy-file-format/src/cli-core';
import { deserializeDocument, serializeDocument } from '../../../heavy-file-format/src/serialization';
import { createCliItemStore } from './cliItemStore';
import { LISTING_STORE_CONFIG } from '../test/webAutomation/listingDocument';
import { ANALYSIS_ORIGIN, analysisServiceCapability, analysisServiceManifest, mockAnalysisService, SECOND_ACCOUNT_SESSION, SOURCE_DOCUMENT_PHRASE } from '../test/webAutomation/analysisService';
import { buildSearchDocument } from '../test/webAutomation/listingDocument';
import { readWebAutomationBlocks } from './documentBlocks';
import { loadPublishedService } from './serviceManifests';
import { readWebApiBlockConfig, WEB_API_PLUGIN_ID, WEB_COLLECTION_PLUGIN_ID } from './configs';
import { createMockFlow, DOCUMENT_PATH, EVALUATE_QUEUE, mockQueueBlocks, type MockFlow } from '../test/webAutomation/flow';
import { ignoredProfileContexts } from './profileContexts';
import { SESSION_CHECK_TIMEOUT_MS } from './session';
import { readSiteSetupText, siteSetupText } from './siteSetups';
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
    expect(session).toMatchObject({ status: 'signed-in' });
    expect(flow.host.isUserWindowVisible('service')).toBe(false);

    const run = await flow.collect(boards);
    expect(run).toMatchObject({ status: 'done', page: 2, collected: 5, problems: 0 });
    const cards = flow.items.list();
    expect(cards.map((card) => card.key).sort()).toEqual(['data-1', 'eng-1', 'eng-2', 'eng-3', 'pm-1'].map(acmeJob).sort());
    expect(flow.item(acmeJob('eng-1'))).toMatchObject({ state: 'ok', provenance: { patternId: 'ats-detail' }, fields: { company: 'Acme', title: 'Senior Engineer' } });
    expect(flow.print()).toMatch(/delay \d+\.\ds before boards\.mock-ats\.test/);
    // Both list pages are read before any job's page, and the run never goes back to a list.
    const timeline = flow.print();
    expect(timeline.indexOf('start-1: page 2, 5 found, 0 already listed')).toBeLessThan(timeline.indexOf('record ok'));
    expect(timeline).not.toContain('← back');
    expect(run.startPages['start-1']).toMatchObject({ status: 'done', pages: 2, found: 5, known: 0, toCollect: 5, read: 5, collected: 5, problems: 0, current: null });

    await flow.evaluate([acmeJob('eng-1'), acmeJob('eng-2'), acmeJob('pm-1')]);
    expect(flow.item(acmeJob('eng-1'))?.fields).toMatchObject({ evaluation: 'ready', rating: 'strong' });
    expect(flow.item(acmeJob('eng-2'))?.fields).toMatchObject({ evaluation: 'ready', rating: 'partial' });
    // The service's stored source document is opened when each call runs, and never copied into the queue.
    expect(flow.service.lastSourceText).toContain(SOURCE_DOCUMENT_PHRASE);
    expect(flow.print()).toContain('fetch file storage.mock-storage.test/bucket/source-1');
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

  it('3. pattern reuse: a second company on the same ATS needs no setup', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/globex/jobs`]);
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${ATS_ORIGIN}/globex/jobs/eng-1`)).toMatchObject({ provenance: { patternId: 'ats-detail' }, fields: { company: 'Globex' } });
  });

  it('4. no pattern: a start page nothing reads is the start page\'s problem, not an item', async () => {
    const boards = listingCollection([`${UNKNOWN_ORIGIN}/openings/7`]);
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 0, problems: 1, startPageProblems: { 'start-1': 'No pattern for jobs.unknown.test.' } });
    expect(flow!.item(`${UNKNOWN_ORIGIN}/openings/7`)).toBeNull();
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

  it('5a. a sign-in screen or human check shown as an ordinary page: the run asks a person, then carries on', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/wonka/jobs`]);
    await signedInFlow(boards);
    const paused = await flow!.collect(boards);
    expect(paused).toMatchObject({ status: 'needs-attention', attention: { reason: 'unexpected-page', url: `${ATS_ORIGIN}/wonka/jobs/eng-1?utm_source=board` } });
    expect(paused.startPages['start-1']).toMatchObject({ status: 'collecting', read: 0, toCollect: 2 });

    flow!.solveChallenge(ATS_ORIGIN);
    const resumed = await flow!.resumeAttention(paused.runId);
    // Signed in once, the profile's session reads the other job too.
    expect(resumed).toMatchObject({ status: 'done', collected: 2, problems: 0, attention: null });
  });

  it('5b. start pages: one left out of collecting all is skipped, and still collects on its own', async () => {
    const globex = `${ATS_ORIGIN}/globex/jobs`;
    const base = listingCollection([ACME, globex]);
    const boards = { ...base, startPages: base.startPages.map((page) => (page.url === globex ? { ...page, included: false as const } : page)) };
    await signedInFlow(boards);
    const all = await flow!.collect(boards);
    expect(Object.keys(all.startPages)).toEqual(['start-1']);
    expect(all.startPages['start-1']).toMatchObject({ status: 'done', collected: 5 });
    expect(flow!.item(`${globex}/eng-1`)).toBeNull();

    const one = await flow!.collect(boards, [globex]);
    expect(Object.keys(one.startPages)).toEqual(['start-2']);
    expect(one.startPages['start-2']).toMatchObject({ status: 'done', pages: 1 });
    expect(flow!.item(`${globex}/eng-1`)).toMatchObject({ fields: { company: 'Globex' } });
  });

  it('6. SPA listing: the list is read before its items, so a listing that going back would not restore is never needed again', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/hooli/jobs`]);
    await signedInFlow(boards);
    const run = await flow!.collect(boards);
    expect(run).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.print()).not.toContain('← back');
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

  it('8. sign-out mid-queue: the queue pauses, and signing in again resumes it', async () => {
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
    await flow!.settle();
    expect(flow!.print()).toContain(`${EVALUATE_QUEUE}: signed in again, resuming`);
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

  it('10. concurrency: API calls never wait for a run, two pages share a site and a third waits, different origins run in parallel', async () => {
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

    // Two workers on one site at once (their loads there take turns: scheduler.test.ts); a third page there waits.
    const sameOrigin = listingCollection([`${ATS_ORIGIN}/globex/jobs`, `${ATS_ORIGIN}/hooli/jobs`, `${ATS_ORIGIN}/wonka/jobs`]);
    flow!.approve();
    await flow!.collect(sameOrigin);
    const shared = flow!.print().split('run-2 started')[1];
    const starts = [...shared.matchAll(/start: Listings: boards\.mock-ats\.test/g)].map((match) => match.index!);
    const firstFinish = shared.indexOf('finish: Listings: boards.mock-ats.test');
    expect(starts).toHaveLength(3);
    expect(starts[1]).toBeLessThan(firstFinish);
    expect(starts[2]).toBeGreaterThan(firstFinish);

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
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    const single = await flow!.extract(boards, `${ATS_ORIGIN}/acme/jobs/eng-1?utm_campaign=mail#apply`);
    expect(single).toMatchObject({ status: 'done', collected: 1 });
    expect(flow!.item(`${ATS_ORIGIN}/acme/jobs/eng-1`)?.provenance.patternId).toBe('ats-detail');

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
    expect(flow!.automation.getState().sessions[0]).toMatchObject({ status: 'signed-in' });
    expect((await flow!.callEndpoint('session')).body).toEqual({ account: { id: 'a-2', name: 'Sam Other' } });
    expect(flow!.reviewWebApi()).toMatchObject({ reason: 'authorized' });
    expect((await flow!.callEndpoint('profile')).status).toBe(200);
  });

  it('19. site setups in the block: pasted setups apply on re-run, but fingerprints never widen where a run may go', async () => {
    const mixed = listingCollection([`${UNKNOWN_ORIGIN}/openings/7`, `${SIDE_PANE_ORIGIN}/search`, `${INITRODE_ORIGIN}/Portal/Jobs.aspx`]);
    await signedInFlow(mixed);
    const before = await flow!.collect(mixed);
    expect(before).toMatchObject({ status: 'done', collected: 0, problems: 3 });

    const pasted = readSiteSetupText(siteSetupText([
      { id: 'pane', name: 'Side pane board', from: { name: 'Publisher', version: 1 }, patterns: [sidePaneListingPattern, sidePaneDetailPattern] },
      { id: 'talent-suite', name: 'TalentSuite', patterns: [talentSuiteListingPattern, talentSuiteDetailPattern] },
    ]))!;
    const after = await flow!.collect(flow!.addSiteSetups(mixed, ...pasted));
    expect(after).toMatchObject({ status: 'done', collected: 2 });
    expect(flow!.item(`${SIDE_PANE_ORIGIN}/view/1`)).toMatchObject({ state: 'ok', provenance: { patternId: 'pane-detail' } });
    expect(flow!.print()).toContain(`skip out of scope ${INITRODE_HOSTED_ORIGIN}/Portal/Job.aspx?id=11`);
    expect(after.startPageProblems).toEqual({ 'start-1': 'No pattern for jobs.unknown.test.' });
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

  it('24. saved, then closed mid-call: the call finishes, its result waits, and arrives when the document opens again', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    const release = flow!.host.holdRequests('/api/analyses');
    await flow!.evaluate([acmeJob('eng-1')], { settle: false });
    await flow!.clock.runUntil(() => flow!.listQueue(EVALUATE_QUEUE)[0]?.status === 'running');

    // UI: File > Save, then the document closed while the call is in flight.
    flow!.save();
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

  it('25. saved mid-call, then the app restarts: the saved entry is resent with the same idempotency key after Resume', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    const release = flow!.host.holdRequests('/api/analyses');
    await flow!.evaluate([acmeJob('eng-1')], { settle: false });
    await flow!.clock.runUntil(() => flow!.listQueue(EVALUATE_QUEUE)[0]?.status === 'running');
    const { idempotencyKey } = flow!.listQueue(EVALUATE_QUEUE)[0];

    // UI: File > Save. The queue block keeps the running entry and its key.
    expect(flow!.save()).toContain(idempotencyKey);
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
    expect(flow!.print()).toContain('fetch file storage.mock-storage.test/bucket/source-1');
    expect(flow!.print()).toContain('(no credentials)');
  });

  it('27. served source: a URL outside the read origins is never fetched, and altered bytes are rejected', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);

    flow!.service.servedUrlOverride = 'http://192.168.1.1/admin';
    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/not a secure origin/) });
    flow!.service.servedUrlOverride = 'https://elsewhere.test/bucket/source-1';
    await flow!.retryQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/does not list as a read origin/) });
    expect(flow!.print()).not.toContain('fetch file ');

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

  it('31. a script hears when the account signs in or out, and a handler with the same key replaces the earlier one', async () => {
    flow = createMockFlow();
    flow.bindProfiles(listingCollection([ACME]));
    flow.approve();
    const replaced: string[] = [];
    const heard: string[] = [];
    flow.automation.onSessionChange(flow.api.capability, 'resume-list', (state) => replaced.push(state.status));
    flow.automation.onSessionChange(flow.api.capability, 'resume-list', (state) => heard.push(state.status));

    await flow.signIn();
    await flow.completeLogin();
    await flow.signOut();
    expect(heard).toEqual(['pending-login', 'signed-in', 'signed-out']);
    expect(replaced).toEqual([]);

    // Closing the document drops its scripts' handlers.
    flow.closeDocument();
    await flow.signIn();
    expect(heard).toHaveLength(3);
  });

  it('31c. who is signed in is not part of the sign-in check: a script that shows it asks the service', async () => {
    flow = createMockFlow();
    flow.bindProfiles(listingCollection([ACME]));
    flow.approve();
    const heard: string[] = [];
    flow.automation.onSessionChange(flow.api.capability, 'account-line', (state) => heard.push(state.status));
    await flow.signIn();
    await flow.completeLogin();
    expect(heard).toEqual(['pending-login', 'signed-in']);
    expect(flow.automation.getState().sessions[0]).not.toHaveProperty('accountName');
    // A document script that shows the name, on hearing "signed-in", calls the service's own account endpoint.
    expect((await flow.callEndpoint('session')).body).toEqual({ account: { id: 'a-1', name: 'Pat Example' } });
  });

  it('31a. a profile still signed in from an earlier run is heard on its first account check', async () => {
    flow = createMockFlow();
    flow.bindProfiles(listingCollection([ACME]));
    flow.approve();
    await flow.signIn();
    await flow.completeLogin();
    // The profile keeps its cookies across the restart (as a persistent browser profile does); the saved account
    // summary is gone.
    flow.restartApp();
    flow.settings.update((settings) => ({ ...settings, accounts: {} }));
    const heard: string[] = [];
    flow.automation.onSessionChange(flow.api.capability, 'resume-list', (state) => heard.push(state.status));
    expect(heard).toEqual([]);
    await flow.probe();
    expect(heard).toEqual(['signed-in']);
  });

  it('31b. a script that registers after the account check still hears that it is signed in', async () => {
    flow = createMockFlow();
    flow.bindProfiles(listingCollection([ACME]));
    flow.approve();
    await flow.signIn();
    await flow.completeLogin();
    const heard: string[] = [];
    flow.automation.onSessionChange(flow.api.capability, 'resume-list', (state) => heard.push(state.status));
    expect(heard).toEqual(['signed-in']);
  });

  it('32. a delayed entry waits its turn, and its context comes back with the result without reaching the service', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    const job = flow!.item(acmeJob('eng-1'))!;
    const results: unknown[] = [];
    flow!.automation.onQueueResult(EVALUATE_QUEUE, (result) => results.push(result));
    const startedAt = flow!.clock.now();
    flow!.automation.enqueue(EVALUATE_QUEUE, job.key, flow!.api.createInput(job), { delayMs: 8_000, context: { polls: 2 } });

    await flow!.advance(7_000);
    expect(flow!.service.createCalls).toBe(0);
    await flow!.settle();
    expect(flow!.clock.now() - startedAt).toBeGreaterThanOrEqual(8_000);
    // The endpoint refuses unknown inputs, so a completed call also shows the context was not sent.
    expect(results).toMatchObject([{ key: job.key, status: 'done', context: { polls: 2 } }]);
  });

  it('30. quitting without saving: the queue comes back as of the last save, which keeps no delivered results', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'done', delivered: true });

    // UI: File > Save. A delivered result is already in the item, so the queue block keeps nothing.
    expect(flow!.save()).not.toContain('"state"');
    await flow!.evaluate([acmeJob('eng-2')], { settle: false });
    expect(flow!.listQueue(EVALUATE_QUEUE)).toHaveLength(2);

    // The app quits before the document is saved again: the second entry is lost with it.
    flow!.restartApp();
    expect(flow!.listQueue(EVALUATE_QUEUE)).toEqual([]);
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ awaitingResume: false });
  });
  it('33. browser profiles: a web profile context sets its section or container\'s, the file\'s covers the rest, and a name this machine lacks is chosen again', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    // The file's profile is Boards; the service's block sits in a container whose web profile context names Service
    // (a home page's work mail, say).
    expect(flow!.automation.profileOf(boards.capabilityId)).toEqual({ id: 'boards', name: 'Boards' });
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toEqual({ id: 'service', name: 'Service' });
    // Both are in the saved file, so they reopen with it.
    expect(flow!.save()).toMatch(/metadata:\n\s+galaxy:\n\s+web_profile: Boards/);
    flow!.restartApp();
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toEqual({ id: 'service', name: 'Service' });

    const container = () => flow!.document.sections.flatMap((section) => section.blocks).find((block) => block.schema.id === 'service-profile')!;
    const context = () => container().schema.containerBlocks!.find((block) => block.schema.id === 'profile')!;
    // A second context beside it sets nothing, and lint says so.
    const second = structuredClone(context());
    second.schema.id = 'second-profile';
    second.schema.pluginConfig = { ...second.schema.pluginConfig, profile: 'Boards' };
    container().schema.containerBlocks!.push(second);
    expect(ignoredProfileContexts(flow!.document)).toEqual([second]);
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toEqual({ id: 'service', name: 'Service' });
    expect((await executeHvyCliCommand(flow!.document, createHvyCliSession(), 'hvy lint')).output).toContain('Another web profile context comes first');
    container().schema.containerBlocks!.splice(container().schema.containerBlocks!.indexOf(second), 1);

    // UI: the context's "Change profile…", Boards: the service follows it, and is asked about again there.
    flow!.chooseContextProfile('Boards');
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toEqual({ id: 'boards', name: 'Boards' });
    expect(flow!.reviewWebApi()).toMatchObject({ reason: 'profile-changed' });
    flow!.chooseContextProfile('Service');

    // A copy from another machine names a profile this one has no profile called: nothing runs until one is chosen.
    context().schema.pluginConfig = { ...context().schema.pluginConfig, profile: 'Work' };
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toBeNull();
    await expect(flow!.probe()).rejects.toThrow(/Choose a browser profile for "Mock Analysis"/);

    // The context removed: the block uses the file's profile, and the service is asked about again before it is used
    // there.
    container().schema.containerBlocks!.splice(container().schema.containerBlocks!.indexOf(context()), 1);
    expect(flow!.automation.profileOf(flow!.api.capability.capabilityId)).toEqual({ id: 'boards', name: 'Boards' });
    expect(flow!.reviewWebApi()).toMatchObject({ reason: 'profile-changed' });
  });
  it('34. limits: each page reads up to its own limits, or the default limits when it sets none', async () => {
    const globex = `${ATS_ORIGIN}/globex/jobs`;
    // Defaults: one list page and one new job from each page. Acme sets its own: two pages, four new jobs.
    const boards = listingCollection([ACME, globex], { maxPages: 1, maxItems: 1 });
    const limited = { ...boards, startPages: boards.startPages.map((page) => (page.url === ACME ? { ...page, maxPages: 2, maxItems: 4 } : page)) };
    await signedInFlow(limited);
    const run = await flow!.collect(limited);
    expect(run.startPages['start-1']).toMatchObject({ pages: 2, toCollect: 4, collected: 4 });
    expect(run.startPages['start-2']).toMatchObject({ pages: 1, toCollect: 1, collected: 1 });
  });
  it('35. two pages on one site both need you: the run asks about one, then the other, and neither is lost', async () => {
    const boards = listingCollection([`${ATS_ORIGIN}/initech/jobs`, `${ATS_ORIGIN}/cyberdyne/jobs`]);
    await signedInFlow(boards);
    // Two workers are on the site at once, and both are challenged.
    const first = await flow!.collect(boards);
    expect(first).toMatchObject({ status: 'needs-attention', attention: { reason: 'challenge' } });
    // While the user hasn't got to it, the other worker's turn at the site comes and it is challenged too; it waits to
    // ask until the first is dealt with.
    await flow!.advance(10_000);
    expect(flow!.print()).toMatch(/→ boards\.mock-ats\.test\/cyberdyne\/jobs/);
    expect(flow!.automation.getState().runs[0].attention?.url).toBe(first.attention!.url);
    flow!.solveChallenge(ATS_ORIGIN);
    const second = await flow!.resumeAttention(first.runId);
    expect(second).toMatchObject({ status: 'needs-attention', attention: { reason: 'challenge' } });
    expect(second.attention!.url).not.toBe(first.attention!.url);
    const done = await flow!.resumeAttention(first.runId);
    expect(done).toMatchObject({ status: 'done', collected: 2, attention: null });
  });
  it('36. a list page of items already listed ends a page that stops there; one that keeps going reads on', async () => {
    // Acme lists three jobs, then two more on its second page. A first run reads only the first page.
    await signedInFlow(listingCollection([ACME], { maxPages: 1 }));
    await flow!.collect(listingCollection([ACME], { maxPages: 1 }));
    // Its first page is now all known: stopping there leaves the second page unread.
    const stopping = await flow!.collect(listingCollection([ACME], { stopAtKnownPage: true }));
    expect(stopping.startPages['start-1']).toMatchObject({ pages: 1, known: 3, collected: 0 });
    expect(flow!.print()).toContain('start-1: every item on page 1 is already listed, so the rest are too');
    // The page's own choice wins over the default: it keeps going, and reads the second page.
    const base = listingCollection([ACME], { stopAtKnownPage: true });
    const keepsGoing = { ...base, startPages: base.startPages.map((page) => ({ ...page, stopAtKnownPage: false })) };
    const read = await flow!.collect(keepsGoing);
    expect(read.startPages['start-1']).toMatchObject({ pages: 2, known: 3, collected: 2 });
  });
  it('37. the queue\'s entries: one runs now while the rest stay paused, and a failed one is dismissed', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    flow!.pauseQueue(EVALUATE_QUEUE);
    await flow!.evaluate([acmeJob('eng-1'), acmeJob('eng-2'), acmeJob('eng-3')]);

    // UI: "Run now" on the last: it runs on its own, and the queue stays paused.
    await flow!.runQueueEntryNext(EVALUATE_QUEUE, acmeJob('eng-3'));
    expect(flow!.item(acmeJob('eng-3'))?.fields.evaluation).toBe('ready');
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ paused: true });
    expect(flow!.listQueue(EVALUATE_QUEUE).filter((entry) => entry.status === 'queued').map((entry) => entry.key)).toEqual([acmeJob('eng-1'), acmeJob('eng-2')].map((url) => flow!.item(url)!.key));

    // UI: "Resume". The service turns the first away every time, so it fails; UI: its "Dismiss".
    flow!.service.rateLimitNextCreates = 99;
    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.listQueue(EVALUATE_QUEUE).find((entry) => entry.key === flow!.item(acmeJob('eng-1'))!.key)).toMatchObject({ status: 'failed' });
    flow!.cancelQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(flow!.listQueue(EVALUATE_QUEUE).find((entry) => entry.key === flow!.item(acmeJob('eng-1'))!.key)).toMatchObject({ status: 'cancelled' });
  });
  it('38. queued work for a service with no browser profile chosen waits for one instead of failing', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    await flow!.collect(boards);
    // The service's context names a profile this machine has no profile called.
    flow!.chooseContextProfile('Work');
    await flow!.evaluate([acmeJob('eng-1')]);
    expect(flow!.automation.getState().queues[EVALUATE_QUEUE]).toMatchObject({ paused: true, pauseReason: 'no_profile' });
    expect(flow!.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'queued', attempts: 0 });

    // UI: the context's "Change profile…", then the queue's "Resume".
    flow!.chooseContextProfile('Service');
    await flow!.resumeQueue(EVALUATE_QUEUE);
    expect(flow!.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
  });
  it('39. an account check that gets no answer ends in an error, never waiting past its deadline, and can be checked again', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    // After a restart nothing is known about the account; the service does not answer.
    flow!.restartApp();
    flow!.settings.update((settings) => ({ ...settings, accounts: {} }));
    const release = flow!.host.holdRequests('/api/session');
    const startedAt = flow!.clock.now();
    let checked: { status: string; error: string | null } | null = null;
    void flow!.probe().then((state) => {
      checked = state;
    });
    await flow!.clock.runUntil(() => checked !== null);
    expect(flow!.clock.now() - startedAt).toBeLessThanOrEqual(SESSION_CHECK_TIMEOUT_MS);
    // The request's own limit answers first here; the deadline covers waits before it (its turn, the page loading).
    expect(checked).toMatchObject({ status: 'unknown', error: '"Session" timed out after 15s.' });

    // UI: "Check again", once the service answers.
    release();
    expect(await flow!.probe()).toMatchObject({ status: 'signed-in', error: null });
  });
  it('40. an account check stuck before its request (its worker never ready) ends in an error at its deadline', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    flow!.restartApp();
    flow!.settings.update((settings) => ({ ...settings, accounts: {} }));
    // The new app's first worker window never finishes opening.
    flow!.host.createWorker = () => new Promise<string>(() => undefined);
    const startedAt = flow!.clock.now();
    let checked: { status: string; error: string | null } | null = null;
    void flow!.probe().then((state) => {
      checked = state;
    });
    await flow!.clock.runUntil(() => checked !== null);
    expect(flow!.clock.now() - startedAt).toBe(SESSION_CHECK_TIMEOUT_MS);
    expect(checked).toMatchObject({ status: 'unknown', error: 'Couldn’t reach Mock Analysis: no answer within 45s.' });
  });
  it('41. a link to a site the document\'s web plugins use opens in Galaxy\'s browser window, in their profile', async () => {
    const boards = listingCollection([ACME]);
    await signedInFlow(boards);
    // The flow's collection is not in the document; only its web API block is.
    const report = `${new URL(flow!.api.capability.pageUrl).origin}/analyses/1`;
    expect(flow!.openLink(report)).toBe(true);
    await flow!.settle();
    expect(flow!.host.isUserWindowVisible('service')).toBe(true);
    expect(flow!.print()).toContain('user window (service) → ');
    // Anywhere else opens in the default browser, as before.
    expect(flow!.openLink('https://elsewhere.test/page')).toBe(false);
  });
  it('42. a service that publishes what documents may do: the block asks for permissions, and gets only their endpoints', async () => {
    // The document names the service and one of its permissions; the service's published file says what that allows.
    flow = createMockFlow({
      document: { build: () => buildSearchDocument({ webApi: { capabilityId: 'analysis', service: ANALYSIS_ORIGIN, permissions: ['analyses'] }, queues: mockQueueBlocks(mockAnalysisService()) }) },
    });
    const fetchFile = (url: string, limits: { maxBytes: number }) => flow!.host.fetchFile(url, limits);
    await loadPublishedService(ANALYSIS_ORIGIN, fetchFile, true);
    const capability = () => readWebAutomationBlocks(flow!.document).webApis[0].config.capability!;
    expect(capability().endpoints.map((endpoint) => endpoint.id).sort()).toEqual(['create-analysis', 'get-analysis', 'logout', 'open-source', 'session']);
    expect(capability().published).toEqual({ permissions: [{ id: 'analyses', description: 'Analyze texts against your stored documents', changesData: true }] });

    flow.bindProfiles(listingCollection([ACME]), capability());
    flow.approve(capability());
    await flow.signIn(capability());
    await flow.completeLogin();
    expect(flow.automation.getState().sessions[0]).toMatchObject({ status: 'signed-in' });
    // Not one of the permissions it asked for: the block has no such endpoint.
    await expect(flow.callEndpoint('profile', {}, capability())).rejects.toThrow(/has no endpoint "profile"/);

    // The service changes an endpoint within the granted permission: it owns that, so nothing is asked again.
    const endpoints = flow.service.published.endpoints as Array<Record<string, unknown>>;
    flow.service.published = { ...flow.service.published, endpoints: endpoints.map((endpoint) => (endpoint.id === 'get-analysis' ? { ...endpoint, description: 'Reads an analysis.' } : endpoint)) };
    await loadPublishedService(ANALYSIS_ORIGIN, fetchFile, true);
    expect(flow.reviewWebApi(capability())).toMatchObject({ reason: 'authorized' });

    // The document asks for another permission: approved again, naming what changed.
    const block = readWebAutomationBlocks(flow.document).webApis[0].block;
    block.schema.pluginConfig = { ...block.schema.pluginConfig, permissions: ['analyses', 'account'] };
    expect(flow.reviewWebApi(capability())).toMatchObject({ reason: 'capability-changed', changedCategories: ['permissions'] });

    // A permission the service does not offer is refused, naming it.
    block.schema.pluginConfig = { ...block.schema.pluginConfig, permissions: ['analyses', 'billing'] };
    expect(readWebApiBlockConfig(block.schema.pluginConfig)).toEqual({ ok: false, errors: ['app.mock-analysis.test’s published file offers no permission "billing".'] });
  });
  it('43. a service\'s published file that could not be read: the block says why, and reads it on Try again', async () => {
    flow = createMockFlow({
      document: { build: () => buildSearchDocument({ webApi: { capabilityId: 'analysis', service: ANALYSIS_ORIGIN, permissions: ['analyses'] }, queues: mockQueueBlocks(mockAnalysisService()) }) },
    });
    // The service serves something that is not its published file.
    flow.service.published = ['not', 'an', 'object'] as unknown as Record<string, unknown>;
    expect(await flow.automation.fetchPublishedService(ANALYSIS_ORIGIN, true)).toEqual({ status: 'failed', error: 'Its published file is not a JSON object.' });
    // The block says why.
    expect(readWebApiBlockConfig({ schemaVersion: 1, capabilityId: 'analysis', service: ANALYSIS_ORIGIN, permissions: ['analyses'] })).toEqual({
      ok: false,
      errors: ['Couldn’t read app.mock-analysis.test’s published file: Its published file is not a JSON object.'],
    });

    // The service fixes it; UI: "Try again".
    flow.service.published = analysisServiceManifest();
    expect(await flow.automation.fetchPublishedService(ANALYSIS_ORIGIN, true)).toMatchObject({ status: 'loaded' });
    expect(readWebAutomationBlocks(flow.document).webApis[0].config.capability?.published?.permissions.map((permission) => permission.id)).toEqual(['analyses']);
    expect(flow.print()).toContain('read app.mock-analysis.test’s published file');
  });
});
