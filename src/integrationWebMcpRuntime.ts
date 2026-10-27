import type { IntegrationPageDefinition, IntegrationProfileDefinition } from './integrationRegistry';
import { approvalMatchesDescriptor, type IntegrationWebMcpApproval, type IntegrationWebMcpToolDescriptor } from './integrationWebMcp';
import { controlIntegrationBrowser, isIntegrationBrowserOpen, openIntegrationPage } from './integrationBrowser';
import { enqueueWebCapabilityForProfile } from './webCapabilityQueue';
import { disableIntegrationWebMcpApproval } from './integrationWebMcpApprovalStore';
import { answerBrowserRequest, failBrowserRequest, waitForBrowserAnswer } from './browserRequests';

type OperationKind = 'tools' | 'result';
const TIMEOUT_MS = 60_000;

function waitFor<T>(requestId: string, kind: OperationKind, profileId: string, capabilityId?: string, signal?: AbortSignal): Promise<T> {
  return waitForBrowserAnswer<T>(requestId, {
    profileId,
    accepts: (result) => String(result.kind).startsWith('integration-webmcp-'),
    answer: (result) => {
      if (result.kind === 'integration-webmcp-error') {
        if (result.code === 'WebMcpDescriptorChangedError' && capabilityId) disableIntegrationWebMcpApproval(capabilityId);
        throw new Error(typeof result.message === 'string' ? result.message : 'The WebMCP operation failed.');
      }
      if (kind === 'tools' && result.kind === 'integration-webmcp-tools') return (Array.isArray(result.tools) ? result.tools : []) as T;
      if (kind === 'result' && result.kind === 'integration-webmcp-result') {
        const descriptor = result.descriptor as IntegrationWebMcpToolDescriptor;
        return { value: result.value, isJson: result.isJson === true, descriptor } as T;
      }
      throw new Error('The page returned an unexpected WebMCP response.');
    },
    timeoutMs: TIMEOUT_MS,
    timeoutMessage: 'The WebMCP operation timed out while waiting for the page.',
    signal,
    abortMessage: 'The WebMCP operation was cancelled.',
    // Only an invocation runs on the page until it is cancelled.
    onStop: kind === 'result' ? () => void controlIntegrationBrowser('cancel-webmcp-tool', profileId, { requestId }).catch(() => undefined) : undefined,
  });
}

async function dispatch(
  page: IntegrationPageDefinition,
  profile: IntegrationProfileDefinition,
  command: 'discover-webmcp-tools' | 'invoke-webmcp-tool',
  payload: Record<string, unknown>,
  openIfClosed: boolean,
  foreground: boolean,
  integrationId?: string,
): Promise<void> {
  const browserOpen = await isIntegrationBrowserOpen(profile.id);
  if (!browserOpen && !openIfClosed) throw new Error(`The browser profile “${profile.name}” is closed. Open it in Galaxy before running this WebMCP tool.`);
  await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, {
    kind: command === 'discover-webmcp-tools' ? 'webmcp-discovery' : 'webmcp-invocation',
    payload: { ...payload, waitForTools: true },
    context: { expectedOrigin: new URL(page.url).origin },
  }, foreground, profile.name, integrationId, page.id);
}

export function discoverIntegrationWebMcpTools(
  page: IntegrationPageDefinition,
  profile: IntegrationProfileDefinition,
): Promise<IntegrationWebMcpToolDescriptor[]> {
  return enqueueWebCapabilityForProfile(profile.id, async () => {
    const requestId = crypto.randomUUID();
    const result = waitFor<IntegrationWebMcpToolDescriptor[]>(requestId, 'tools', profile.id);
    try { await dispatch(page, profile, 'discover-webmcp-tools', { requestId, fromOrigins: page.allowedOrigins, focusMainOnResult: true }, true, false); }
    catch (error) { failBrowserRequest(requestId, error); }
    return result;
  });
}

export function invokeIntegrationWebMcpTool(
  approval: IntegrationWebMcpApproval,
  page: IntegrationPageDefinition,
  profile: IntegrationProfileDefinition,
  args: Record<string, unknown>,
  foreground = false,
  signal?: AbortSignal,
  openIfClosed = foreground,
): Promise<unknown> {
  return enqueueWebCapabilityForProfile(profile.id, async () => {
    signal?.throwIfAborted();
    const requestId = crypto.randomUUID();
    const result = waitFor<unknown>(requestId, 'result', profile.id, approval.capabilityId, signal);
    try {
      await dispatch(page, profile, 'invoke-webmcp-tool', {
        requestId,
        focusMainOnResult: foreground,
        name: approval.descriptor.name,
        origin: approval.descriptor.origin,
        descriptor: approval.descriptor,
        arguments: args,
        fromOrigins: page.allowedOrigins,
      }, openIfClosed, foreground, approval.integrationId);
    } catch (error) { failBrowserRequest(requestId, error); }
    return result;
  });
}

export function handleIntegrationWebMcpResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return answerBrowserRequest(value);
}

export function assertLiveWebMcpDescriptor(approval: IntegrationWebMcpApproval, value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new Error('The page returned an invalid WebMCP response.');
  const result = value as { value?: unknown; descriptor?: IntegrationWebMcpToolDescriptor };
  if (!result.descriptor || !approvalMatchesDescriptor(approval, result.descriptor)) {
    disableIntegrationWebMcpApproval(approval.capabilityId);
    throw new Error('The WebMCP tool changed and must be reviewed again.');
  }
  return result.value;
}
