import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export const WEB_MCP_TOOL_PLUGIN_ID = 'hvy.webmcp-tool';
export const WEB_MCP_SCHEMA_VERSION = 1;

export interface IntegrationWebMcpToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
  consequentialHint: boolean;
}

export interface IntegrationWebMcpToolDescriptor {
  origin: string;
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: IntegrationWebMcpToolAnnotations;
}

export interface IntegrationWebMcpApproval {
  schemaVersion: 1;
  capabilityId: string;
  integrationId: string;
  pageId: string;
  profileId: string;
  descriptor: IntegrationWebMcpToolDescriptor;
  descriptorHash: string;
  scriptingEnabled: boolean;
  mcpExposed: boolean;
  approvedAt: string;
}

export type IntegrationWebMcpApprovals = Record<string, IntegrationWebMcpApproval>;

export interface WebMcpToolCapabilityConfig {
  schemaVersion: 1;
  capabilityId: string;
  name: string;
  description: string;
  page: { name: string; url: string; allowedOrigins: string[] };
  tool: IntegrationWebMcpToolDescriptor;
  source?: { integrationId: string; pageId: string };
  mcp: { exposed: boolean };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return { type: 'object', properties: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTrustworthyWebMcpOrigin(origin: string): boolean {
  const url = new URL(origin);
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]' || url.hostname.startsWith('127.'));
}

export function normalizeWebMcpToolDescriptor(value: unknown): IntegrationWebMcpToolDescriptor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  let origin = typeof item.origin === 'string' ? item.origin.trim() : '';
  try { origin = new URL(origin).origin; } catch { return null; }
  if (!name || !description || !/^[A-Za-z0-9_.-]{1,128}$/.test(name) || !isTrustworthyWebMcpOrigin(origin)) return null;
  const inputSchema = jsonObject(item.inputSchema);
  if (!inputSchema) return null;
  const annotations = item.annotations && typeof item.annotations === 'object' && !Array.isArray(item.annotations)
    ? item.annotations as Record<string, unknown>
    : {};
  return {
    origin,
    name,
    ...(typeof item.title === 'string' && item.title.trim() ? { title: item.title.trim() } : {}),
    description,
    inputSchema,
    annotations: {
      readOnlyHint: annotations.readOnlyHint === true,
      untrustedContentHint: annotations.untrustedContentHint === true,
      consequentialHint: annotations.consequentialHint === true,
    },
  };
}

export function webMcpDescriptorHash(descriptor: IntegrationWebMcpToolDescriptor): string {
  return `webmcp-sha256-${bytesToHex(sha256(new TextEncoder().encode(stableJson(descriptor))))}`;
}

export function normalizeIntegrationWebMcpApprovals(value: unknown): IntegrationWebMcpApprovals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const descriptor = normalizeWebMcpToolDescriptor(item.descriptor);
    const capabilityId = typeof item.capabilityId === 'string' ? item.capabilityId.trim() : key.trim();
    const integrationId = typeof item.integrationId === 'string' ? item.integrationId.trim() : '';
    const pageId = typeof item.pageId === 'string' ? item.pageId.trim() : '';
    const profileId = typeof item.profileId === 'string' ? item.profileId.trim() : '';
    const approvedAt = typeof item.approvedAt === 'string' ? item.approvedAt.trim() : '';
    if (!descriptor || !capabilityId || !integrationId || !pageId || !profileId || !approvedAt) return [];
    const approval: IntegrationWebMcpApproval = {
      schemaVersion: WEB_MCP_SCHEMA_VERSION,
      capabilityId,
      integrationId,
      pageId,
      profileId,
      descriptor,
      descriptorHash: webMcpDescriptorHash(descriptor),
      scriptingEnabled: item.scriptingEnabled === true,
      mcpExposed: item.mcpExposed === true,
      approvedAt,
    };
    return [[capabilityId, approval]];
  }));
}

export function approveIntegrationWebMcpTool(
  approvals: IntegrationWebMcpApprovals,
  input: Omit<IntegrationWebMcpApproval, 'schemaVersion' | 'descriptorHash' | 'approvedAt'> & { approvedAt?: string },
): IntegrationWebMcpApprovals {
  const descriptor = normalizeWebMcpToolDescriptor(input.descriptor);
  if (!descriptor) throw new Error('The page returned an invalid WebMCP tool descriptor.');
  return {
    ...approvals,
    [input.capabilityId]: {
      ...input,
      schemaVersion: WEB_MCP_SCHEMA_VERSION,
      descriptor,
      descriptorHash: webMcpDescriptorHash(descriptor),
      approvedAt: input.approvedAt ?? new Date().toISOString(),
    },
  };
}

export function approvalMatchesDescriptor(approval: IntegrationWebMcpApproval, descriptor: IntegrationWebMcpToolDescriptor): boolean {
  return approval.descriptorHash === webMcpDescriptorHash(descriptor);
}

export function webMcpToolsForContext(
  approvals: IntegrationWebMcpApprovals,
  integrationId: string,
  pageId: string,
  profileId: string,
  liveTools?: IntegrationWebMcpToolDescriptor[],
): IntegrationWebMcpToolDescriptor[] {
  if (liveTools !== undefined) return liveTools;
  return Object.values(approvals)
    .filter((approval) => approval.integrationId === integrationId && approval.pageId === pageId && approval.profileId === profileId)
    .map((approval) => approval.descriptor);
}

export function webMcpCapabilityId(integrationId: string, pageId: string, profileId: string, descriptor: IntegrationWebMcpToolDescriptor): string {
  const value = `${integrationId}\0${pageId}\0${profileId}\0${descriptor.origin}\0${descriptor.name}`;
  return `webmcp-${bytesToHex(sha256(new TextEncoder().encode(value))).slice(0, 32)}`;
}

export function readWebMcpToolCapabilityConfig(value: unknown): WebMcpToolCapabilityConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const tool = normalizeWebMcpToolDescriptor(item.tool);
  const page = item.page && typeof item.page === 'object' && !Array.isArray(item.page) ? item.page as Record<string, unknown> : null;
  const capabilityId = typeof item.capabilityId === 'string' ? item.capabilityId.trim() : '';
  if (item.schemaVersion !== WEB_MCP_SCHEMA_VERSION || !tool || !page || !capabilityId) return null;
  const url = typeof page.url === 'string' ? page.url.trim() : '';
  try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
  const source = item.source && typeof item.source === 'object' && !Array.isArray(item.source) ? item.source as Record<string, unknown> : null;
  return {
    schemaVersion: WEB_MCP_SCHEMA_VERSION,
    capabilityId,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : tool.title ?? tool.name,
    description: typeof item.description === 'string' ? item.description.trim() : tool.description,
    page: {
      name: typeof page.name === 'string' && page.name.trim() ? page.name.trim() : new URL(url).hostname,
      url: new URL(url).href,
      allowedOrigins: Array.isArray(page.allowedOrigins)
        ? [...new Set(page.allowedOrigins.filter((origin): origin is string => typeof origin === 'string'))]
        : [new URL(url).origin],
    },
    tool,
    ...(source && typeof source.integrationId === 'string' && typeof source.pageId === 'string'
      ? { source: { integrationId: source.integrationId, pageId: source.pageId } }
      : {}),
    mcp: { exposed: Boolean(item.mcp && typeof item.mcp === 'object' && !Array.isArray(item.mcp) && (item.mcp as Record<string, unknown>).exposed === true) },
  };
}
