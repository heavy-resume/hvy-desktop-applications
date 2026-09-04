import type { IntegrationPageDefinition, IntegrationProfileDefinition } from './integrationRegistry';
import { approvalMatchesDescriptor, type IntegrationWebMcpApproval, type IntegrationWebMcpToolDescriptor } from './integrationWebMcp';
import { controlIntegrationBrowser, isIntegrationBrowserOpen, openIntegrationPage } from './integrationBrowser';
import { enqueueWebCapabilityForProfile } from './webCapabilityQueue';
import { disableIntegrationWebMcpApproval } from './integrationWebMcpApprovalStore';

type PendingOperation = {
  kind: 'tools' | 'result';
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  capabilityId?: string;
  cleanupAbort?: () => void;
};

const pending = new Map<string, PendingOperation>();
const TIMEOUT_MS = 60_000;

function waitFor<T>(requestId: string, kind: PendingOperation['kind'], profileId?: string, capabilityId?: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      signal?.removeEventListener('abort', abort);
      if (profileId) void controlIntegrationBrowser('cancel-webmcp-tool', profileId, { requestId }).catch(() => undefined);
      reject(new Error('The WebMCP operation timed out while waiting for the page.'));
    }, TIMEOUT_MS);
    const abort = () => {
      if (!pending.has(requestId)) return;
      if (profileId) void controlIntegrationBrowser('cancel-webmcp-tool', profileId, { requestId }).catch(() => undefined);
      rejectPending(requestId, signal?.reason instanceof Error ? signal.reason : new Error('The WebMCP operation was cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(requestId, { kind, resolve: (value) => resolve(value as T), reject, timeout, capabilityId, cleanupAbort: () => signal?.removeEventListener('abort', abort) });
    if (signal?.aborted) abort();
  });
}

async function dispatch(
  page: IntegrationPageDefinition,
  profile: IntegrationProfileDefinition,
  command: 'discover-webmcp-tools' | 'invoke-webmcp-tool',
  payload: Record<string, unknown>,
  openIfClosed: boolean,
  foreground: boolean,
): Promise<void> {
  const browserOpen = await isIntegrationBrowserOpen(profile.id);
  if (!browserOpen && !openIfClosed) throw new Error(`The browser profile “${profile.name}” is closed. Open it in Galaxy before running this WebMCP tool.`);
  await openIntegrationPage(page.url, page.allowedOrigins, profile.id, profile.browserStoreId, false, {
    kind: command === 'discover-webmcp-tools' ? 'webmcp-discovery' : 'webmcp-invocation',
    payload: { ...payload, waitForTools: true },
    context: { expectedOrigin: new URL(page.url).origin },
  }, foreground, profile.name);
}

export function discoverIntegrationWebMcpTools(
  page: IntegrationPageDefinition,
  profile: IntegrationProfileDefinition,
): Promise<IntegrationWebMcpToolDescriptor[]> {
  return enqueueWebCapabilityForProfile(profile.id, async () => {
    const requestId = crypto.randomUUID();
    const result = waitFor<IntegrationWebMcpToolDescriptor[]>(requestId, 'tools');
    try { await dispatch(page, profile, 'discover-webmcp-tools', { requestId, fromOrigins: page.allowedOrigins, focusMainOnResult: true }, true, false); }
    catch (error) { rejectPending(requestId, error); }
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
      }, openIfClosed, foreground);
    } catch (error) { rejectPending(requestId, error); }
    return result;
  });
}

function rejectPending(requestId: string, error: unknown): void {
  const operation = pending.get(requestId);
  if (!operation) return;
  clearTimeout(operation.timeout);
  operation.cleanupAbort?.();
  pending.delete(requestId);
  operation.reject(error instanceof Error ? error : new Error(String(error)));
}

export function handleIntegrationWebMcpResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (typeof result.requestId !== 'string' || !String(result.kind).startsWith('integration-webmcp-')) return false;
  const operation = pending.get(result.requestId);
  if (!operation) return false;
  clearTimeout(operation.timeout);
  operation.cleanupAbort?.();
  pending.delete(result.requestId);
  if (result.kind === 'integration-webmcp-error') {
    if (result.code === 'WebMcpDescriptorChangedError' && operation.capabilityId) disableIntegrationWebMcpApproval(operation.capabilityId);
    operation.reject(new Error(typeof result.message === 'string' ? result.message : 'The WebMCP operation failed.'));
  } else if (operation.kind === 'tools' && result.kind === 'integration-webmcp-tools') {
    operation.resolve(Array.isArray(result.tools) ? result.tools : []);
  } else if (operation.kind === 'result' && result.kind === 'integration-webmcp-result') {
    const descriptor = result.descriptor as IntegrationWebMcpToolDescriptor;
    operation.resolve({ value: result.value, isJson: result.isJson === true, descriptor });
  } else {
    operation.reject(new Error('The page returned an unexpected WebMCP response.'));
  }
  return true;
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
