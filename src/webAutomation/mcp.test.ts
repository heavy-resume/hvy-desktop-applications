import { describe, expect, it } from 'vitest';
import { createMockFlow, DOCUMENT_PATH } from '../test/webAutomation/flow';
import { analysisServiceCapability } from '../test/webAutomation/analysisService';
import { ATS_ORIGIN, listingCollection } from '../test/webAutomation/sites';
import { listMcpWebCapabilities, McpWebHandler, type McpDocument } from './mcp';

async function setup(exposed: string[] = ['profile', 'create-analysis'], collect = true) {
  const flow = createMockFlow();
  const boards = listingCollection([`${ATS_ORIGIN}/globex/jobs`, `${ATS_ORIGIN}/initech/jobs`]);
  flow.bindProfiles(boards);
  flow.approve();
  await flow.signIn();
  await flow.completeLogin();
  const documents = (): McpDocument[] => [{
    documentPath: DOCUMENT_PATH,
    automation: flow.automation,
    webApis: [{ capability: analysisServiceCapability, mcp: { endpointIds: exposed } }],
    collections: [{ collection: boards, mcp: { collect }, sink: flow.sink }],
  }];
  return { flow, documents, handler: new McpWebHandler(documents) };
}

async function settled<T>(flow: ReturnType<typeof createMockFlow>, promise: Promise<T>): Promise<T> {
  let outcome: { value?: T; error?: unknown } | null = null;
  promise.then((value) => { outcome = { value }; }, (error: unknown) => { outcome = { error }; });
  await flow.clock.runUntil(() => outcome !== null);
  const result = outcome as { value?: T; error?: unknown } | null;
  if (result && 'error' in result) throw result.error;
  return result!.value as T;
}

describe('MCP web capabilities', () => {
  it('lists only exposed capabilities, filtered by access level', async () => {
    const { documents } = await setup();
    expect(listMcpWebCapabilities(documents(), 'off')).toEqual([]);
    const read = listMcpWebCapabilities(documents(), 'read');
    expect(read.map((item) => (item.kind === 'api' ? item.endpointId : item.kind))).toEqual(['profile', 'collection']);
    const actions = listMcpWebCapabilities(documents(), 'actions');
    expect(actions.find((item) => item.kind === 'api' && item.endpointId === 'create-analysis')).toMatchObject({ method: 'POST', filledFromDocuments: ['sourceText'] });
  });

  it('enforces access and exposure on calls and labels results as untrusted', async () => {
    const { flow, handler } = await setup();
    await expect(handler.invoke({ operation: 'call', path: DOCUMENT_PATH, capabilityId: 'analysis', endpointId: 'profile' }, 'off')).rejects.toThrow(/disabled/);
    await expect(handler.invoke({ operation: 'call', path: DOCUMENT_PATH, capabilityId: 'analysis', endpointId: 'get-analysis', input: { id: 'x' } }, 'actions')).rejects.toThrow(/not exposed/);
    await expect(handler.invoke({ operation: 'call', path: DOCUMENT_PATH, capabilityId: 'analysis', endpointId: 'create-analysis', input: {} }, 'read')).rejects.toThrow(/action access/);
    await expect(handler.invoke({ operation: 'call', path: '/elsewhere.hvy', capabilityId: 'analysis', endpointId: 'profile' }, 'read')).rejects.toThrow(/not open/);
    const files = await settled(flow, handler.invoke({ operation: 'call', path: DOCUMENT_PATH, capabilityId: 'analysis', endpointId: 'profile' }, 'read'));
    expect(files).toMatchObject({ untrustedContent: true, origin: 'https://app.mock-analysis.test', value: { status: 200 } });
  });

  it('starts collections and reports progress, including when a run needs attention', async () => {
    const { flow, handler } = await setup();
    const { runId } = await handler.invoke({ operation: 'collect', path: DOCUMENT_PATH, capabilityId: 'listings' }, 'read') as { runId: string };
    await flow.settle();
    const status = await handler.invoke({ operation: 'collect-status', path: DOCUMENT_PATH, runId }, 'read');
    expect(status).toMatchObject({
      untrustedContent: true,
      value: { status: 'needs-attention', attention: { reason: 'challenge' }, collected: 2 },
    });
    expect((status as { value: { records: Array<{ key: string }> } }).value.records.map((item) => item.key)).toEqual([
      `${ATS_ORIGIN}/globex/jobs/eng-1`,
      `${ATS_ORIGIN}/globex/jobs/ops-1`,
    ]);
  });

  it('refuses collections that are not exposed', async () => {
    const { handler } = await setup(['profile'], false);
    await expect(handler.invoke({ operation: 'collect', path: DOCUMENT_PATH, capabilityId: 'listings' }, 'actions')).rejects.toThrow(/not exposed/);
  });
});
