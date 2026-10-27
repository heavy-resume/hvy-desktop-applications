import type { RecordConsumer } from './collection';
import type { CollectionBlockConfig, WebApiBlockConfig } from './configs';
import { documentTextInputs } from './endpoints';
import type { WebAutomation } from './entryPoints';
import { WebAutomationError } from './errors';
import type { CollectedRecord } from './records';
import type { WebApiCapability } from './webApi';

export type McpIntegrationAccess = 'off' | 'read' | 'actions';

/** One open document and the web automation blocks it contains. MCP never opens documents itself. */
export interface McpDocument {
  documentPath: string;
  automation: WebAutomation;
  /** Web API blocks whose capability is known (a published service's once its file is fetched). */
  webApis: Array<{ capability: WebApiCapability; mcp: WebApiBlockConfig['mcp'] }>;
  /** Collection blocks, each with the record sink the document wires it to (if any). */
  collections: Array<CollectionBlockConfig & { sink?: RecordConsumer }>;
}

export type McpWebCapability =
  | { documentPath: string; kind: 'api'; capabilityId: string; name: string; endpointId: string; method: string; description: string; inputSchema: Record<string, unknown>; filledFromDocuments: string[] }
  | { documentPath: string; kind: 'collection'; capabilityId: string; name: string; startUrls: string[] };

export type McpWebRequest =
  | { operation: 'call'; path: string; capabilityId: string; endpointId: string; input?: Record<string, unknown> }
  | { operation: 'collect'; path: string; capabilityId: string; startUrls?: string[] }
  | { operation: 'collect-status'; path: string; runId: string };

/** Site-originated data is third-party text; agents must treat it as data, never as instructions. */
export interface UntrustedResult<T> {
  untrustedContent: true;
  origin: string;
  value: T;
}

const MAX_FIELD_CHARS = 8_000;

function requireAccess(access: McpIntegrationAccess): void {
  if (access === 'off') throw new WebAutomationError('not_authorized', 'Web integration access is disabled in MCP Settings.');
}

function findDocument(documents: McpDocument[], path: string): McpDocument {
  const document = documents.find((candidate) => candidate.documentPath === path);
  if (!document) throw new WebAutomationError('invalid_request', `${path} is not open in Galaxy.`);
  return document;
}

export function listMcpWebCapabilities(documents: McpDocument[], access: McpIntegrationAccess): McpWebCapability[] {
  if (access === 'off') return [];
  return documents.flatMap((document) => [
    ...document.webApis.flatMap(({ capability, mcp }) => capability.endpoints
      .filter((endpoint) => mcp.endpointIds.includes(endpoint.id) && (access === 'actions' || endpoint.method === 'GET'))
      .map((endpoint): McpWebCapability => ({
        documentPath: document.documentPath,
        kind: 'api',
        capabilityId: capability.capabilityId,
        name: `${capability.name}: ${endpoint.name}`,
        endpointId: endpoint.id,
        method: endpoint.method,
        description: endpoint.description,
        inputSchema: endpoint.inputSchema,
        filledFromDocuments: documentTextInputs(endpoint),
      }))),
    ...document.collections
      .filter(({ mcp }) => mcp.collect)
      .map(({ collection }): McpWebCapability => ({
        documentPath: document.documentPath,
        kind: 'collection',
        capabilityId: collection.capabilityId,
        name: collection.name,
        startUrls: collection.startPages.map((page) => page.url),
      })),
  ]);
}

export class McpWebHandler {
  /** runId → records MCP has seen from that run. */
  private readonly runRecords = new Map<string, CollectedRecord[]>();

  constructor(private readonly documents: () => McpDocument[]) {}

  async invoke(request: McpWebRequest, access: McpIntegrationAccess): Promise<unknown> {
    requireAccess(access);
    const document = findDocument(this.documents(), request.path);
    if (request.operation === 'call') return this.call(document, request, access);
    if (request.operation === 'collect') return this.collect(document, request);
    return this.collectStatus(document, request.runId);
  }

  private async call(document: McpDocument, request: Extract<McpWebRequest, { operation: 'call' }>, access: McpIntegrationAccess): Promise<UntrustedResult<unknown>> {
    const block = document.webApis.find(({ capability }) => capability.capabilityId === request.capabilityId);
    const endpoint = block?.capability.endpoints.find((candidate) => candidate.id === request.endpointId);
    if (!block || !endpoint || !block.mcp.endpointIds.includes(endpoint.id)) {
      throw new WebAutomationError('not_authorized', 'This endpoint is not exposed through MCP.');
    }
    if (access === 'read' && endpoint.method !== 'GET') {
      throw new WebAutomationError('not_authorized', 'This endpoint changes data and requires MCP integration action access.');
    }
    const result = await document.automation.callEndpoint(block.capability, endpoint.id, request.input ?? {});
    return { untrustedContent: true, origin: new URL(block.capability.pageUrl).origin, value: result };
  }

  private collect(document: McpDocument, request: Extract<McpWebRequest, { operation: 'collect' }>): { runId: string } {
    const block = document.collections.find(({ collection }) => collection.capabilityId === request.capabilityId);
    if (!block?.mcp.collect) throw new WebAutomationError('not_authorized', 'This collection is not exposed through MCP.');
    const records: CollectedRecord[] = [];
    const run = document.automation.startCollection(block.collection, {
      // Records still go to the document's own sink, so MCP-started runs land where UI-started ones do.
      onRecord: (record) => {
        records.push(record);
        block.sink?.onRecord(record);
      },
      isKnown: (key) => block.sink?.isKnown?.(key) ?? false,
    }, request.startUrls);
    this.runRecords.set(run.runId, records);
    run.done.catch(() => undefined);
    return { runId: run.runId };
  }

  private collectStatus(document: McpDocument, runId: string): UntrustedResult<unknown> {
    const state = document.automation.getState();
    const run = state.runs.find((candidate) => candidate.runId === runId);
    const records = this.runRecords.get(runId);
    if (!run || !records) throw new WebAutomationError('invalid_request', `Unknown collection run ${runId}.`);
    const items = records.map((record) => ({
      key: record.key,
      state: record.state,
      problem: record.problem ?? null,
      values: Object.fromEntries(Object.entries(record.values).map(([name, value]) => [
        name,
        typeof value === 'string' && value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}…` : value,
      ])),
    }));
    return {
      untrustedContent: true,
      origin: 'collected web pages',
      value: { status: run.status, attention: run.attention ? { reason: run.attention.reason, url: run.attention.url } : null, collected: run.collected, problems: run.problems, records: items },
    };
  }
}
