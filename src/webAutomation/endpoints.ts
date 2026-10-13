import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { stableJson } from '../webCapabilities';
import { WebAutomationError } from './errors';
import type { HostRequest } from './host';

export interface ApiEndpointDefinition {
  id: string;
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Same-origin path template, e.g. /api/v1/reports/{id}. */
  path: string;
  /** JSON Schema object; its properties are the only accepted inputs. */
  inputSchema: Record<string, unknown>;
  idempotency?: { header: string; fromInputs: string[] };
  errorMessagePointer?: string;
  timeoutMs?: number;
}

export const DEFAULT_ENDPOINT_TIMEOUT_MS = 15_000;
export const MAX_ENDPOINT_TIMEOUT_MS = 60_000;

const PATH_PARAMETER = /\{([A-Za-z0-9_]+)\}/g;

export function isConsequentialEndpoint(endpoint: ApiEndpointDefinition): boolean {
  return endpoint.method !== 'GET';
}

export function endpointTimeoutMs(endpoint: ApiEndpointDefinition): number {
  return Math.min(Math.max(endpoint.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS, 1), MAX_ENDPOINT_TIMEOUT_MS);
}

function declaredInputs(endpoint: ApiEndpointDefinition): Set<string> {
  const properties = endpoint.inputSchema.properties;
  return new Set(properties && typeof properties === 'object' && !Array.isArray(properties) ? Object.keys(properties) : []);
}

/** Inputs declared with `"x-hvy-source": "document-text"`, filled from a document the user picks. */
export function documentTextInputs(endpoint: ApiEndpointDefinition): string[] {
  const properties = endpoint.inputSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>)
    .filter(([, schema]) => Boolean(schema) && typeof schema === 'object' && (schema as Record<string, unknown>)['x-hvy-source'] === 'document-text')
    .map(([name]) => name);
}

export function idempotencyKey(endpoint: ApiEndpointDefinition, input: Record<string, unknown>): string | null {
  if (!endpoint.idempotency) return null;
  const source = endpoint.idempotency.fromInputs.map((name) => [name, input[name]]);
  return `hvy-${bytesToHex(sha256(new TextEncoder().encode(`${endpoint.id}\0${stableJson(source)}`))).slice(0, 32)}`;
}

/** Resolves an endpoint and its inputs into a request locked to the page origin. */
export function resolveEndpointRequest(pageUrl: string, endpoint: ApiEndpointDefinition, input: Record<string, unknown>): HostRequest {
  const origin = new URL(pageUrl).origin;
  if (!endpoint.path.startsWith('/') || endpoint.path.startsWith('//')) {
    throw new WebAutomationError('invalid_request', `Endpoint "${endpoint.id}" must use a same-origin path.`);
  }
  const declared = declaredInputs(endpoint);
  const unknown = Object.keys(input).filter((name) => !declared.has(name));
  if (unknown.length) {
    throw new WebAutomationError('invalid_request', `Endpoint "${endpoint.id}" does not accept: ${unknown.join(', ')}.`);
  }
  const pathNames = new Set<string>();
  const path = endpoint.path.replace(PATH_PARAMETER, (_match, name: string) => {
    const value = input[name];
    if (value === undefined || value === null || value === '') {
      throw new WebAutomationError('invalid_request', `Endpoint "${endpoint.id}" needs "${name}".`);
    }
    pathNames.add(name);
    return encodeURIComponent(String(value));
  });
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) {
    throw new WebAutomationError('invalid_request', `Endpoint "${endpoint.id}" resolved outside ${origin}.`);
  }
  const bodyInput = Object.fromEntries(Object.entries(input).filter(([name]) => !pathNames.has(name)));
  const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'DELETE';
  if (!hasBody && Object.keys(bodyInput).length) {
    throw new WebAutomationError('invalid_request', `Endpoint "${endpoint.id}" only accepts path inputs.`);
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  const key = idempotencyKey(endpoint, input);
  if (key && endpoint.idempotency) headers[endpoint.idempotency.header] = key;
  return {
    url: url.href,
    method: endpoint.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(bodyInput) } : {}),
  };
}

export function readJsonPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  return pointer.split('/').slice(1).reduce<unknown>((current, rawSegment) => {
    if (!current || typeof current !== 'object') return undefined;
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    return (current as Record<string, unknown>)[segment];
  }, value);
}
