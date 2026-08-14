import type { IntegrationProfileDefinition } from './integrationRegistry';
import { integrationPageExpectedOrigins } from './integrationRegistry';
import type { IntegrationPageReadyChecks } from './integrationRegistry';
import { openIntegrationPage } from './integrationBrowser';
import {
  isWebCapabilityAuthorized,
  type WebCapabilityAuthorizations,
  type WebCapabilityConfig,
  type WebCommandCapabilityConfig,
  type WebRecordsCapabilityConfig,
} from './webCapabilities';

export interface WebCapabilityExecutionContext {
  documentPath: string;
  profile: IntegrationProfileDefinition;
  authorizations: WebCapabilityAuthorizations;
  foreground?: boolean;
  readyChecks?: IntegrationPageReadyChecks;
}

export interface WebRecordsExecutionResult {
  records: unknown[];
  diagnostics?: unknown;
  page?: { origin?: string; pathname?: string };
}

export interface WebCommandExecutionResult {
  status: string;
  reason?: string;
  commandId?: string;
}

type PendingOperation = {
  kind: 'records' | 'command';
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingOperations = new Map<string, PendingOperation>();
const profileQueues = new Map<string, Promise<unknown>>();
const BACKGROUND_OPERATION_TIMEOUT_MS = 60_000;
const INTERACTIVE_OPERATION_TIMEOUT_MS = 10 * 60_000;

export class WebCapabilityAuthorizationError extends Error {
  constructor(message = 'This web capability has not been authorized for the selected browser profile.') {
    super(message);
    this.name = 'WebCapabilityAuthorizationError';
  }
}

function assertAuthorized(config: WebCapabilityConfig, context: WebCapabilityExecutionContext): void {
  if (!isWebCapabilityAuthorized(
    context.authorizations,
    context.documentPath,
    config,
    context.profile.id,
  )) throw new WebCapabilityAuthorizationError();
}

function enqueueForProfile<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileQueues.get(profileId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  profileQueues.set(profileId, current);
  void current.finally(() => {
    if (profileQueues.get(profileId) === current) profileQueues.delete(profileId);
  }).catch(() => undefined);
  return current;
}

function waitForResult<T>(requestId: string, kind: PendingOperation['kind'], timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOperations.delete(requestId);
      reject(new Error('The web capability timed out while waiting for the page.'));
    }, timeoutMs);
    pendingOperations.set(requestId, {
      kind,
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
    });
  });
}

async function openForOperation(
  config: WebCapabilityConfig,
  context: WebCapabilityExecutionContext,
  extraction: unknown,
): Promise<void> {
  await openIntegrationPage(
    config.page.url,
    config.page.allowedOrigins,
    context.profile.id,
    context.profile.browserStoreId,
    false,
    extraction,
    context.foreground ?? true,
    context.profile.name,
  );
}

export async function executeWebRecordsCapability(
  config: WebRecordsCapabilityConfig,
  context: WebCapabilityExecutionContext,
): Promise<WebRecordsExecutionResult> {
  assertAuthorized(config, context);
  return enqueueForProfile(context.profile.id, async () => {
    const requestId = crypto.randomUUID();
    const result = waitForResult<WebRecordsExecutionResult>(
      requestId,
      'records',
      context.foreground === false ? BACKGROUND_OPERATION_TIMEOUT_MS : INTERACTIVE_OPERATION_TIMEOUT_MS,
    );
    try {
      await openForOperation(config, context, {
        kind: 'pattern-extraction',
        pattern: config.record.pattern,
        context: {
          mode: 'hvy-capability',
          webCapabilityRequestId: requestId,
          capabilityId: config.capabilityId,
          expectedOrigin: new URL(config.page.url).origin,
          expectedOrigins: integrationPageExpectedOrigins({ ...config.page, readyChecks: context.readyChecks ?? config.page.readyChecks }),
          readyChecks: context.readyChecks ?? config.page.readyChecks,
        },
      });
    } catch (error) {
      rejectPendingOperation(requestId, error);
    }
    return result;
  });
}

async function executeCommand(
  config: WebCommandCapabilityConfig | WebRecordsCapabilityConfig,
  command: WebCommandCapabilityConfig['command'],
  context: WebCapabilityExecutionContext,
  inputs: Record<string, string>,
  recordParent?: string,
): Promise<WebCommandExecutionResult> {
  assertAuthorized(config, context);
  return enqueueForProfile(context.profile.id, async () => {
    const requestId = crypto.randomUUID();
    const result = waitForResult<WebCommandExecutionResult>(
      requestId,
      'command',
      context.foreground === false ? BACKGROUND_OPERATION_TIMEOUT_MS : INTERACTIVE_OPERATION_TIMEOUT_MS,
    );
    try {
      await openForOperation(config, context, {
        kind: 'command-execution',
        context: {
          expectedOrigin: new URL(config.page.url).origin,
          expectedOrigins: integrationPageExpectedOrigins({ ...config.page, readyChecks: context.readyChecks ?? config.page.readyChecks }),
          webCapabilityRequestId: requestId,
        },
        payload: {
          requestId,
          pattern: 'record' in config
            ? config.record.pattern
            : { minimumConfidence: 0.8, parents: [], targets: [] },
          command,
          inputs,
          readyChecks: context.readyChecks ?? config.page.readyChecks,
          ...(recordParent ? { recordParent } : {}),
        },
      });
    } catch (error) {
      rejectPendingOperation(requestId, error);
    }
    return result;
  });
}

export function executeWebPageCommandCapability(
  config: WebCommandCapabilityConfig,
  context: WebCapabilityExecutionContext,
  inputs: Record<string, string> = {},
): Promise<WebCommandExecutionResult> {
  return executeCommand(config, config.command, context, inputs);
}

export function executeWebRecordCommandCapability(
  config: WebRecordsCapabilityConfig,
  commandId: string,
  recordParent: string,
  context: WebCapabilityExecutionContext,
  inputs: Record<string, string> = {},
): Promise<WebCommandExecutionResult> {
  const command = config.record.commands.find((candidate) => candidate.id === commandId);
  if (!command) return Promise.reject(new Error(`The web capability does not define command ${commandId}.`));
  return executeCommand(config, command, context, inputs, recordParent);
}

function rejectPendingOperation(requestId: string, error: unknown): void {
  const pending = pendingOperations.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingOperations.delete(requestId);
  pending.reject(error instanceof Error ? error : new Error(String(error)));
}

export function handleWebCapabilityIntegrationResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const context = result.context && typeof result.context === 'object' && !Array.isArray(result.context)
    ? result.context as Record<string, unknown>
    : null;
  const requestId = result.kind === 'integration-command-result'
    ? result.requestId
    : context?.webCapabilityRequestId;
  if (typeof requestId !== 'string') return false;
  const pending = pendingOperations.get(requestId);
  if (!pending) return false;
  if ((pending.kind === 'records' && result.kind !== 'integration-extraction')
    || (pending.kind === 'command' && result.kind !== 'integration-command-result')) return false;
  clearTimeout(pending.timeout);
  pendingOperations.delete(requestId);
  if (pending.kind === 'records') {
    if (result.status === 'not-ready') {
      pending.reject(new Error(typeof result.message === 'string' ? result.message : 'The expected web page is not ready.'));
      return true;
    }
    pending.resolve({
      records: Array.isArray(result.records) ? result.records : [],
      ...(result.diagnostics !== undefined ? { diagnostics: result.diagnostics } : {}),
      ...(result.page && typeof result.page === 'object' ? { page: result.page } : {}),
    });
  } else if (result.status === 'executed') {
    pending.resolve({ status: 'executed', commandId: result.commandId });
  } else if (result.status === 'not-ready') {
    pending.reject(new Error(typeof result.message === 'string' ? result.message : 'The expected web page is not ready.'));
  } else {
    const failedStep = typeof result.stepIndex === 'number' ? ` at step ${result.stepIndex + 1}` : '';
    pending.reject(new Error(`Command stopped${failedStep}: ${String(result.reason ?? result.status ?? 'target not found').replaceAll('_', ' ')}`));
  }
  return true;
}
