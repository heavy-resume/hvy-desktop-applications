// Heavy Resume contract checks over the generic web automation layer.
// Run with: npx vitest run scratch/heavy-resume
import { afterEach, describe, expect, it } from 'vitest';
import { readCollectionBlockConfig, readWebApiBlockConfig, WEB_AUTOMATION_SCHEMA_VERSION } from '../../src/webAutomation/configs';
import { createMockFlow, EVALUATE_QUEUE, type MockFlow } from '../../src/test/webAutomation/flow';
import { ATS_ORIGIN } from '../../src/test/webAutomation/sites';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { mockHeavyResume, heavyResumeCapability, heavyResumeCollection, RESUME_PHRASE, SECOND_HEAVY_RESUME_SESSION, storedResume, type MockHeavyResumeState } from './heavyResume.fixture';

const ACME = `${ATS_ORIGIN}/acme/jobs`;
const acmeJob = (slug: string) => `${ATS_ORIGIN}/acme/jobs/${slug}`;

let flow: MockFlow<MockHeavyResumeState> | null = null;

afterEach((context) => {
  if (context.task.result?.state === 'fail' && flow) console.log(`Timeline:\n${flow.print()}`);
  flow = null;
});

async function signedIn(): Promise<MockFlow<MockHeavyResumeState>> {
  flow = createMockFlow({ api: mockHeavyResume });
  const boards = heavyResumeCollection([ACME]);
  flow.bindProfiles(boards);
  flow.approve();
  await flow.signIn();
  await flow.completeLogin();
  await flow.collect(boards);
  return flow;
}

describe('Heavy Resume job search', () => {
  it('ships a valid galaxy.web-api snapshot', () => {
    const result = readWebApiBlockConfig({ schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, ...structuredClone(heavyResumeCapability), mcp: { endpointIds: ['files'] } });
    expect(result).toEqual({ ok: true, value: { capability: heavyResumeCapability, mcp: { endpointIds: ['files'] } } });
    const collection = heavyResumeCollection([ACME]);
    expect(readCollectionBlockConfig({ schemaVersion: WEB_AUTOMATION_SCHEMA_VERSION, ...structuredClone(collection) }))
      .toEqual({ ok: true, value: { collection, mcp: { collect: false } } });
  });

  it('signs in through the extension login handoff and writes job-fit results to cards', async () => {
    const current = await signedIn();
    expect(current.automation.getState().sessions[0]).toMatchObject({ status: 'signed-in', accountName: 'Pat Example' });
    await current.evaluate([acmeJob('eng-1'), acmeJob('eng-2')]);
    expect(current.item(acmeJob('eng-1'))?.fields).toMatchObject({ evaluation: 'ready', fit: 'great', fitReason: 'Strong TypeScript overlap.' });
    expect(current.item(acmeJob('eng-2'))?.fields).toMatchObject({ evaluation: 'ready', fit: 'fair' });
    expect(current.item(acmeJob('eng-1'))?.fields.resultUrl).toMatch(/\/reports\/report-\d$/);
    // The resume Heavy Resume stores, opened from GCS when each report is created.
    expect(current.service.lastResumeText).toContain(RESUME_PHRASE);
    expect(current.print()).toContain('download storage.mock-gcs.test/heavy-resume-files/resume-1.hvy');
  });

  it('retries a quota 429 with the same idempotency key (resume, revision, URL)', async () => {
    const current = await signedIn();
    current.service.rateLimitNextCreates = 1;
    await current.evaluate([acmeJob('eng-1')]);
    expect(current.service.createCalls).toBe(2);
    expect(current.service.reports.size).toBe(1);
    expect(current.service.reportsByKey.size).toBe(1);
  });

  it('lets a different Heavy Resume account sign in without review: the approval is for the profile and configuration', async () => {
    const current = await signedIn();
    expect((await current.callEndpoint('files')).body).toMatchObject({ primaryResumeId: 'resume-1' });
    await current.signOut();
    await current.signIn();
    await current.completeLogin(SECOND_HEAVY_RESUME_SESSION);
    await current.evaluate([acmeJob('eng-1')]);
    expect(current.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
  });

  it('evaluates against the resume Heavy Resume stores: opened, checked, decrypted in memory, sent as Markdown with its revision', async () => {
    const current = await signedIn();
    await current.evaluate([acmeJob('eng-1')]);

    expect(current.item(acmeJob('eng-1'))?.fields).toMatchObject({ evaluation: 'ready', fit: 'great' });
    expect(current.service.resumeOpens).toBe(1);
    expect(current.service.lastResumeText).toContain(RESUME_PHRASE);
    // The reference Markdown export, as the extension sends, not the walk tool's labelled text.
    expect(current.service.lastResumeText).toMatch(/^# /);
    expect(current.service.lastResumeText).not.toContain('Component:');
    expect(current.service.lastResumeRevision).toBe(bytesToHex(sha256((await storedResume()).bytes)));
    expect(current.print()).toContain('download storage.mock-gcs.test/heavy-resume-files/resume-1.hvy');
  });

  it('gets 409 when the resume was saved again after it was opened, and succeeds when retried', async () => {
    const current = await signedIn();
    current.service.savedRevisionOverride = 'f'.repeat(64);
    await current.evaluate([acmeJob('eng-1')]);
    expect(current.listQueue(EVALUATE_QUEUE)[0]).toMatchObject({ status: 'failed', lastError: 'The resume changed since it was opened.' });

    // UI: queue reader, "Retry": the resume is opened again, so text and revision are current.
    current.service.savedRevisionOverride = null;
    await current.retryQueueEntry(EVALUATE_QUEUE, acmeJob('eng-1'));
    expect(current.item(acmeJob('eng-1'))?.fields.evaluation).toBe('ready');
    expect(current.service.resumeOpens).toBe(2);
  });
});
