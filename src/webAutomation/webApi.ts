import { getWebCapabilityProfileBinding } from '../webCapabilities';
import { pinAuthorizationAccount, reviewAuthorization, type AuthorizationReview } from './authorization';
import type { Clock } from './clock';
import { documentTextInputs, endpointTimeoutMs, readJsonPointer, resolveEndpointRequest, type ApiEndpointDefinition } from './endpoints';
import { WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, HostResponse } from './host';
import type { WorkerScheduler } from './scheduler';
import type { SessionService } from './session';
import { accountKey, type AutomationSettingsStore } from './settings';

export const DEFAULT_SIGNED_OUT_STATUSES = [401];

export interface SessionDefinition {
  loginUrl: string;
  /** Exact origin + path that signals the site's login finished. Only a successful probe counts. */
  completeUrl: string;
  probe: {
    endpointId: string;
    signedOutStatuses?: number[];
    accountNamePointer?: string;
    accountIdPointer?: string;
  };
  logoutEndpointId?: string;
  loginAllowedOrigins?: string[];
}

/** The document snapshot stored in a galaxy.web-api block. Contains no profile, cookie, or account data. */
export interface WebApiCapability {
  capabilityId: string;
  name: string;
  pageUrl: string;
  allowedOrigins: string[];
  /** Page the API worker parks on; defaults to pageUrl. */
  apiPageUrl?: string;
  session?: SessionDefinition;
  endpoints: ApiEndpointDefinition[];
}

export interface WebApiResult {
  status: number;
  body: unknown;
}

/**
 * What the user approves. `documentInputs` are the local document bindings
 * whose text will be sent; they are part of the approval, so changing which
 * document is sent requires review.
 */
export function webApiAuthorizationParts(capability: WebApiCapability, documentInputs: Record<string, string> = {}): Record<string, unknown> {
  return {
    page: { pageUrl: capability.pageUrl, apiPageUrl: capability.apiPageUrl ?? null, allowedOrigins: [...capability.allowedOrigins].sort() },
    session: capability.session ?? null,
    endpoints: capability.endpoints
      .map((endpoint) => ({ id: endpoint.id, method: endpoint.method, path: endpoint.path, inputSchema: endpoint.inputSchema, idempotency: endpoint.idempotency ?? null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    documents: Object.fromEntries(Object.entries(documentInputs).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function capabilityOrigin(capability: WebApiCapability): string {
  return new URL(capability.pageUrl).origin;
}

export function findEndpoint(capability: WebApiCapability, endpointId: string): ApiEndpointDefinition {
  const endpoint = capability.endpoints.find((candidate) => candidate.id === endpointId);
  if (!endpoint) throw new WebAutomationError('invalid_request', `"${capability.name}" has no endpoint "${endpointId}".`);
  return endpoint;
}

export function signedOutStatuses(capability: WebApiCapability): number[] {
  return capability.session?.probe.signedOutStatuses ?? DEFAULT_SIGNED_OUT_STATUSES;
}

/** Runs one endpoint request in the profile's API worker. Does not check authorization. */
export class ApiTransport {
  private readonly locations = new Map<string, string>();

  constructor(private readonly deps: { scheduler: WorkerScheduler; host: BrowserHost; clock: Clock; emit: AutomationEmit }) {}

  call(capability: WebApiCapability, profileId: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>): Promise<HostResponse> {
    const pageUrl = capability.apiPageUrl ?? capability.pageUrl;
    const request = resolveEndpointRequest(pageUrl, endpoint, input);
    return this.deps.scheduler.run({ profileId, kind: 'api', label: `${capability.name}: ${endpoint.name}` }, async (lease) => {
      const origin = new URL(pageUrl).origin;
      const current = this.locations.get(lease.workerId);
      if (!current || new URL(current).origin !== origin) {
        const location = await this.deps.host.navigate(lease.workerId, pageUrl);
        this.locations.set(lease.workerId, location.url);
      }
      this.deps.emit('api', `${request.method} ${new URL(request.url).pathname}`, { workerId: lease.workerId });
      const controller = new AbortController();
      const timeoutMs = endpointTimeoutMs(endpoint);
      const timeout = this.deps.clock.sleep(timeoutMs, controller.signal).then(() => {
        throw new WebAutomationError('http_error', `"${endpoint.name}" timed out after ${timeoutMs / 1000}s.`, 0);
      });
      try {
        const response = await Promise.race([this.deps.host.request(lease.workerId, request), timeout]);
        this.deps.emit('api', `→ ${response.status}`, { workerId: lease.workerId });
        return response;
      } finally {
        controller.abort();
        timeout.catch(() => undefined);
      }
    });
  }

  /** Runs a WebMCP tool on a specific page (such as a document editor) in the profile's API worker. */
  invokeWebMcpTool(profileId: string, pageUrl: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.deps.scheduler.run({ profileId, kind: 'api', label: `WebMCP ${name}` }, async (lease) => {
      if (this.locations.get(lease.workerId) !== new URL(pageUrl).href) {
        const location = await this.deps.host.navigate(lease.workerId, pageUrl);
        this.locations.set(lease.workerId, location.url);
      }
      return this.deps.host.invokeWebMcpTool(lease.workerId, { name, arguments: args });
    });
  }
}

export class WebApiService {
  constructor(private readonly deps: {
    transport: ApiTransport;
    sessions: SessionService;
    settings: AutomationSettingsStore;
    /** Reads a document-text source (a workspace path or `webmcp:<page URL>`) as text, using the profile for remote pages. */
    readDocumentText(source: string, profileId: string): Promise<string>;
  }) {}

  profileFor(documentPath: string, capability: WebApiCapability): string {
    const profileId = getWebCapabilityProfileBinding(this.deps.settings.get().profileBindings, documentPath, capability.capabilityId);
    if (!profileId) throw new WebAutomationError('no_profile', `Choose a profile for "${capability.name}".`);
    return profileId;
  }

  documentInputs(documentPath: string, capability: WebApiCapability): Record<string, string> {
    return this.deps.settings.get().documentInputBindings[documentPath]?.[capability.capabilityId] ?? {};
  }

  authorizationParts(documentPath: string, capability: WebApiCapability): Record<string, unknown> {
    return webApiAuthorizationParts(capability, this.documentInputs(documentPath, capability));
  }

  review(documentPath: string, capability: WebApiCapability): AuthorizationReview {
    const profileId = this.profileFor(documentPath, capability);
    return reviewAuthorization(
      this.deps.settings.get().authorizations,
      documentPath,
      capability.capabilityId,
      this.authorizationParts(documentPath, capability),
      profileId,
      this.currentAccountId(capability, profileId),
    );
  }

  /** Fills document-text inputs the caller did not supply from the bound documents. */
  private async withDocumentInputs(documentPath: string, capability: WebApiCapability, profileId: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const filled = { ...input };
    const bindings = this.documentInputs(documentPath, capability);
    for (const name of documentTextInputs(endpoint)) {
      if (filled[name] !== undefined) continue;
      const source = bindings[`${endpoint.id}.${name}`];
      if (!source) throw new WebAutomationError('invalid_request', `Choose a document for "${name}" in "${capability.name}".`);
      filled[name] = await this.deps.readDocumentText(source, profileId);
    }
    return filled;
  }

  private currentAccountId(capability: WebApiCapability, profileId: string): string | undefined {
    return this.deps.settings.get().accounts[accountKey(capabilityOrigin(capability), profileId)]?.accountId;
  }

  async call(documentPath: string, capability: WebApiCapability, endpointId: string, input: Record<string, unknown>): Promise<WebApiResult> {
    const profileId = this.profileFor(documentPath, capability);
    const review = this.review(documentPath, capability);
    if (review.reason !== 'authorized') {
      throw new WebAutomationError('not_authorized', `"${capability.name}" must be reviewed before it can run (${review.reason}).`);
    }
    const endpoint = findEndpoint(capability, endpointId);
    const response = await this.deps.transport.call(capability, profileId, endpoint, await this.withDocumentInputs(documentPath, capability, profileId, endpoint, input));
    if (signedOutStatuses(capability).includes(response.status)) {
      this.deps.sessions.markSignedOut(capability, profileId);
      throw new WebAutomationError('not_authenticated', `Sign in to ${capability.name} again.`, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = endpoint.errorMessagePointer ? readJsonPointer(response.body, endpoint.errorMessagePointer) : null;
      throw new WebAutomationError('http_error', typeof detail === 'string' && detail ? detail : `"${endpoint.name}" returned ${response.status}.`, response.status);
    }
    const accountId = this.currentAccountId(capability, profileId);
    if (accountId) {
      this.deps.settings.update((settings) => ({
        ...settings,
        authorizations: pinAuthorizationAccount(settings.authorizations, documentPath, capability.capabilityId, accountId),
      }));
    }
    return { status: response.status, body: response.body };
  }
}
