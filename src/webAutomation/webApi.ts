import { reviewAuthorization, type AuthorizationReview } from './authorization';
import type { Clock } from './clock';
import { documentInputLinks, documentTextInputs, endpointTimeoutMs, onlyInput, readJsonPointer, resolveEndpointRequest, type ApiEndpointDefinition } from './endpoints';
import { readServedDocument, type ServedDocumentDefinition } from './servedDocuments';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { WebAutomationError } from './errors';
import type { AutomationEmit } from './events';
import type { BrowserHost, HostResponse } from './host';
import type { WorkerScheduler } from './scheduler';
import type { SessionService } from './session';
import type { AutomationSettingsStore } from './settings';

export const DEFAULT_SIGNED_OUT_STATUSES = [401];

export interface SessionDefinition {
  loginUrl: string;
  /** Exact origin + path that signals the site's login finished. Only a successful probe counts. */
  completeUrl: string;
  probe: {
    endpointId: string;
    signedOutStatuses?: number[];
  };
  logoutEndpointId?: string;
  loginAllowedOrigins?: string[];
}

/** The document snapshot stored in a galaxy.web-api block. Contains no profile, cookie, or account data. */
export interface WebApiCapability {
  capabilityId: string;
  name: string;
  pageUrl: string;
  /** Page the API worker parks on; defaults to pageUrl. */
  apiPageUrl?: string;
  session?: SessionDefinition;
  endpoints: ApiEndpointDefinition[];
  /** Origins a served document may be read from (for example, a storage bucket), besides the page's own. */
  readOrigins?: string[];
  /**
   * Built from what the service publishes about itself (serviceManifests.ts): the permissions this document was
   * granted, in the service's words. Its endpoints are the ones those permissions grant, and the sign-in's.
   */
  published?: { permissions: PublishedPermission[] };
}

/** A permission a service publishes: what it lets a document do, in the service's words. */
export interface PublishedPermission {
  id: string;
  description: string;
  /** One of its endpoints is not a GET: it can change data on the site as the user. */
  changesData: boolean;
}

/** A stable key for the call (a queue entry's), sent in the endpoint's idempotency header. */
export interface CallOptions {
  idempotencyKey?: string;
  /** Someone is waiting on the answer (an account check): it goes ahead of queued background calls. */
  interactive?: boolean;
}


export interface WebApiResult {
  status: number;
  body: unknown;
}

/**
 * What the user approves for a service, by category so a review names what
 * changed. Which document's text is sent is part of `endpoints`: each
 * document-text input declares the endpoint that serves it.
 */
export function webApiAuthorizationParts(capability: WebApiCapability): Record<string, unknown> {
  // A published service owns what its permissions do: the user approves the service, the permissions asked for, and
  // the sites files are read from. Its endpoints may change within a permission without asking again.
  if (capability.published) {
    return {
      service: capabilityOrigin(capability),
      permissions: capability.published.permissions.map((permission) => permission.id).sort(),
      reads: [...(capability.readOrigins ?? [])].sort(),
    };
  }
  return {
    page: { pageUrl: capability.pageUrl, apiPageUrl: capability.apiPageUrl ?? null },
    session: capability.session ?? null,
    endpoints: capability.endpoints
      .map((endpoint) => ({ id: endpoint.id, method: endpoint.method, path: endpoint.path, inputSchema: endpoint.inputSchema, idempotency: endpoint.idempotency ?? null, servesDocument: endpoint.servesDocument ?? null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    reads: [...(capability.readOrigins ?? [])].sort(),
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

  call(capability: WebApiCapability, profileId: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>, options: CallOptions = {}): Promise<HostResponse> {
    const pageUrl = capability.apiPageUrl ?? capability.pageUrl;
    const request = resolveEndpointRequest(pageUrl, endpoint, input, options);
    return this.deps.scheduler.run({ profileId, kind: 'api', label: `${capability.name}: ${endpoint.name}`, interactive: options.interactive }, async (lease) => {
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

}

export class WebApiService {
  constructor(private readonly deps: {
    transport: ApiTransport;
    sessions: SessionService;
    settings: AutomationSettingsStore;
    createId(): string;
    /** Reads a served document's file (host.fetchFile). */
    fetchFile(url: string, options: { maxBytes: number }): Promise<Uint8Array>;
    /** The text a document contributes to an input: the reference Markdown export. */
    exportDocumentText(document: VisualDocument): string;
  }) {}

  authorizationParts(capability: WebApiCapability): Record<string, unknown> {
    return webApiAuthorizationParts(capability);
  }

  /** Whether the document may use the site in this profile (the document's, as it names it). */
  review(documentPath: string, capability: WebApiCapability, profileId: string): AuthorizationReview {
    return reviewAuthorization(
      this.deps.settings.get().authorizations,
      documentPath,
      capability.capabilityId,
      this.authorizationParts(capability),
      profileId,
    );
  }

  /**
   * Fills document-text inputs the caller did not supply. Each declares the
   * endpoint that serves its document (`x-hvy-document-endpoint`), the input
   * holding the document's ID, and the input its revision fills. The document
   * is opened when the call runs, so the text and its back reference always
   * come from the same response.
   */
  private async withDocumentInputs(capability: WebApiCapability, profileId: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const filled = { ...input };
    for (const name of documentTextInputs(endpoint)) {
      if (filled[name] !== undefined) continue;
      const { endpointId, idInput, revisionInput } = documentInputLinks(endpoint, name);
      const documentId = idInput ? filled[idInput] : undefined;
      if (!endpointId || documentId === undefined || documentId === '') {
        throw new WebAutomationError('invalid_request', `"${name}" needs a document ID in "${idInput ?? '(none declared)'}".`);
      }
      const served = await this.openServedDocument(capability, profileId, endpointId, documentId);
      filled[name] = this.deps.exportDocumentText(served.document);
      if (revisionInput && served.revision !== null) filled[revisionInput] = served.revision;
    }
    return filled;
  }

  /** Asks the endpoint that serves a document for it, and opens it: fetched from the read URL it names, and decrypted. */
  private async openServedDocument(capability: WebApiCapability, profileId: string, endpointId: string, documentId: unknown) {
    const serving = findEndpoint(capability, endpointId);
    if (!serving.servesDocument) throw new WebAutomationError('invalid_request', `"${serving.name}" does not serve a document.`);
    const response = await this.send(capability, profileId, serving, { [onlyInput(serving)]: documentId });
    return readServedDocument(
      { fetchFile: (url, options) => this.deps.fetchFile(url, options) },
      serving as ApiEndpointDefinition & { servesDocument: ServedDocumentDefinition },
      response.body,
      [capabilityOrigin(capability), ...(capability.readOrigins ?? [])],
    );
  }

  /**
   * Opens a document the site serves (an endpoint with `servesDocument`), for Galaxy's own use: what it reads from it
   * goes only where Galaxy sends it, never to the calling script.
   */
  async openDocument(documentPath: string, capability: WebApiCapability, profileId: string, endpointId: string, documentId: string): Promise<VisualDocument> {
    this.requireReviewed(documentPath, capability, profileId);
    return (await this.openServedDocument(capability, profileId, endpointId, documentId)).document;
  }

  private requireReviewed(documentPath: string, capability: WebApiCapability, profileId: string): void {
    const review = this.review(documentPath, capability, profileId);
    if (review.reason !== 'authorized') {
      throw new WebAutomationError('not_authorized', `"${capability.name}" must be reviewed before it can run (${review.reason}).`);
    }
  }

  async call(documentPath: string, capability: WebApiCapability, profileId: string, endpointId: string, input: Record<string, unknown>, options: CallOptions = {}): Promise<WebApiResult> {
    this.requireReviewed(documentPath, capability, profileId);
    const endpoint = findEndpoint(capability, endpointId);
    // An endpoint whose key is not derived from inputs gets a fresh key per direct call; queued calls bring their own.
    const idempotencyKey = options.idempotencyKey ?? (endpoint.idempotency && !endpoint.idempotency.fromInputs ? this.deps.createId() : undefined);
    const response = await this.send(capability, profileId, endpoint, await this.withDocumentInputs(capability, profileId, endpoint, input), { idempotencyKey });
    return { status: response.status, body: response.body };
  }

  /** Sends one request in the profile and turns sign-out and error statuses into errors. */
  private async send(capability: WebApiCapability, profileId: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>, options: CallOptions = {}): Promise<HostResponse> {
    const response = await this.deps.transport.call(capability, profileId, endpoint, input, options);
    if (signedOutStatuses(capability).includes(response.status)) {
      this.deps.sessions.markSignedOut(capability, profileId);
      throw new WebAutomationError('not_authenticated', `Sign in to ${capability.name} again.`, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = endpoint.errorMessagePointer ? readJsonPointer(response.body, endpoint.errorMessagePointer) : null;
      throw new WebAutomationError('http_error', typeof detail === 'string' && detail ? detail : `"${endpoint.name}" returned ${response.status}.`, response.status);
    }
    return response;
  }
}
