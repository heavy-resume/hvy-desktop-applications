import type { CliItemStoreConfig, ItemFieldBinding } from './cliItemStore';
import { RECORD_URL_FIELD, type CollectionDefinition, type CollectionField, type CollectionSite, type StartPage } from './collection';
import { documentInputLinks, documentTextInputs, MAX_ENDPOINT_TIMEOUT_MS, type ApiEndpointDefinition } from './endpoints';
import { DEFAULT_QUEUE_CONFIG, type QueueConfig, type QueueEntry, type QueueEntryStatus, type QueueState } from './queue';
import type { ServedDocumentDefinition } from './servedDocuments';
import type { RecordSinkConfig } from './recordSink';
import { validateScopeRule, type SitePatternDefinition } from './sitePatterns';
import type { SessionDefinition, WebApiCapability } from './webApi';

export const WEB_API_PLUGIN_ID = 'galaxy.web-api';
export const WEB_COLLECTION_PLUGIN_ID = 'galaxy.web-collection';
export const QUEUE_PLUGIN_ID = 'galaxy.queue';
/** Sets the browser profile for the web plugins in its section or container (profileContexts.ts). */
export const WEB_PROFILE_CONTEXT_PLUGIN_ID = 'galaxy.web-profile-context';
/** The version a document's plugin authorization is recorded against; a new version asks again. */
export const WEB_AUTOMATION_PLUGIN_VERSION = '0.1.0';
export const WEB_AUTOMATION_SCHEMA_VERSION = 1;

/** The most a collection reads from one start page: list pages, and new items. */
export const LIMIT_BOUNDS = { maxPages: 50, maxItems: 500 } as const;

export type ConfigResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** MCP exposure is stored beside the snapshot and is not part of what the user approves for the document. */
export interface WebApiBlockConfig {
  capability: WebApiCapability;
  mcp: { endpointIds: string[] };
}

export interface CollectionBlockConfig {
  collection: CollectionDefinition;
  mcp: { collect: boolean };
  /** Where the collection's records go: a component-list in this document, and the record sink's policy. */
  output?: { store: CliItemStoreConfig; policy: RecordSinkConfig };
}

function readFieldBinding(name: string, value: unknown, errors: string[]): ItemFieldBinding | null {
  if (!isRecord(value) || !text(value.path)) {
    errors.push(`Output field "${name}" needs a path.`);
    return null;
  }
  const source = value.source === 'collected' ? { source: 'collected' as const } : {};
  if (value.kind === 'text') return { kind: 'text', path: text(value.path), ...source };
  if (value.kind === 'form-field') {
    if (!text(value.label)) {
      errors.push(`Output field "${name}" needs the label of the form field it fills.`);
      return null;
    }
    return { kind: 'form-field', path: text(value.path), label: text(value.label) };
  }
  if (value.kind !== 'cell' && value.kind !== 'annotated') {
    errors.push(`Output field "${name}" must be a text, cell, annotated, or form-field binding.`);
    return null;
  }
  const annotationKind: 'sort' | 'group' | null = isRecord(value.annotation) && (value.annotation.kind === 'sort' || value.annotation.kind === 'group') ? value.annotation.kind : null;
  const annotation: { kind: 'sort' | 'group'; key: string } | undefined = annotationKind && isRecord(value.annotation) && text(value.annotation.key)
    ? { kind: annotationKind, key: text(value.annotation.key) }
    : undefined;
  if (value.kind === 'annotated') {
    // A value inside a line of text: the sort or group annotation it fills is required.
    if (!annotation) {
      errors.push(`Output field "${name}" needs the sort or group value it fills.`);
      return null;
    }
    return { kind: 'annotated', path: text(value.path), annotation, ...(text(value.linkTo) ? { linkTo: text(value.linkTo) } : {}), ...source };
  }
  return {
    kind: 'cell',
    path: text(value.path),
    row: Math.round(number(value.row, 0, 0, 1_000)),
    column: Math.round(number(value.column, 0, 0, 1_000)),
    ...(annotation ? { annotation } : {}),
    ...(text(value.linkTo) ? { linkTo: text(value.linkTo) } : {}),
  };
}

function readOutput(value: unknown, errors: string[]): CollectionBlockConfig['output'] {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isRecord(value.store)) {
    errors.push('The output needs a store.');
    return undefined;
  }
  const store = value.store;
  const listPath = text(store.listPath);
  const componentName = text(store.componentName);
  const recordPath = text(store.recordPath);
  if (!listPath.startsWith('/body/')) errors.push('The output list must be a path under /body.');
  if (!componentName) errors.push('The output needs a reusable component name.');
  if (!recordPath) errors.push('The output needs a record path.');
  const fields = Object.fromEntries(Object.entries(isRecord(store.fields) ? store.fields : {})
    .flatMap(([name, binding]) => {
      const read = readFieldBinding(name, binding, errors);
      return read ? [[name, read]] : [];
    }));
  const policy = isRecord(value.policy) ? value.policy : {};
  const ownedFields = Array.isArray(policy.ownedFields) ? strings(policy.ownedFields) : undefined;
  if (ownedFields?.some((field) => !(field in fields))) errors.push('The output owns fields that have no place in the template.');
  return {
    store: { listPath, componentName, recordPath, fields },
    policy: {
      onExisting: policy.onExisting === 'refresh' ? 'refresh' : 'keep',
      keepGoodOnFailure: policy.keepGoodOnFailure !== false,
      ...(ownedFields ? { ownedFields } : {}),
    },
  };
}

export interface QueueBlockConfig {
  queueId: string;
  target: { pluginId: string; method: string; args: Record<string, unknown> };
  config: QueueConfig;
  /** The queue as of the document's last save, or null when it has never held entries. */
  state: QueueState | null;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** HTTPS, or HTTP on a loopback host for local development. */
function trustworthyUrl(value: unknown): URL | null {
  try {
    const url = new URL(text(value));
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.');
    if (url.username || url.password) return null;
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url : null;
  } catch {
    return null;
  }
}

const POINTER = /^(\/[^\/]*)+$/;

function pointer(value: unknown): string | null {
  const candidate = text(value);
  return POINTER.test(candidate) ? candidate : null;
}

/** An endpoint whose response serves a document: JSON pointers to its URL, checks, keys, and revision. */
function readServedDocument(value: unknown, label: string, inputs: string[], errors: string[]): ServedDocumentDefinition | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !pointer(value.urlPointer)) {
    errors.push(`Endpoint "${label}" serves a document but has no URL pointer.`);
    return undefined;
  }
  if (inputs.length !== 1) errors.push(`Endpoint "${label}" serves a document, so it must take exactly one input, the document ID.`);
  const optional = (name: 'extensionPointer' | 'byteLengthPointer' | 'sha256Pointer' | 'keyringPointer') => {
    if (value[name] === undefined) return {};
    const parsed = pointer(value[name]);
    if (!parsed) errors.push(`Endpoint "${label}" has an invalid ${name}.`);
    return parsed ? { [name]: parsed } : {};
  };
  const revision = (Array.isArray(value.revision) ? value.revision : []).flatMap((entry) => {
    const parsed = isRecord(entry) ? pointer(entry.pointer) : null;
    if (!parsed) {
      errors.push(`Endpoint "${label}" has an invalid revision pointer.`);
      return [];
    }
    return [{ pointer: parsed, ...(text(entry.prefix) ? { prefix: text(entry.prefix) } : {}) }];
  });
  return {
    urlPointer: pointer(value.urlPointer)!,
    ...optional('extensionPointer'),
    ...optional('byteLengthPointer'),
    ...optional('sha256Pointer'),
    ...optional('keyringPointer'),
    ...(revision.length ? { revision } : {}),
  };
}

function readEndpoint(value: unknown, errors: string[]): ApiEndpointDefinition | null {
  if (!isRecord(value)) {
    errors.push('An endpoint must be an object.');
    return null;
  }
  const id = text(value.id);
  const method = text(value.method).toUpperCase();
  const path = text(value.path);
  const label = id || '(unnamed)';
  if (!id) errors.push('An endpoint needs an id.');
  if (!METHODS.has(method)) errors.push(`Endpoint "${label}" has an unsupported method.`);
  if (!path.startsWith('/') || path.startsWith('//')) errors.push(`Endpoint "${label}" must use a same-origin path.`);
  const inputSchema = isRecord(value.inputSchema) ? value.inputSchema : { type: 'object', properties: {} };
  const properties = isRecord(inputSchema.properties) ? Object.keys(inputSchema.properties) : [];
  for (const parameter of path.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    if (!properties.includes(parameter[1])) errors.push(`Endpoint "${label}" uses {${parameter[1]}} but does not declare it as an input.`);
  }
  let idempotency: ApiEndpointDefinition['idempotency'];
  if (isRecord(value.idempotency)) {
    const header = text(value.idempotency.header);
    const fromInputs = strings(value.idempotency.fromInputs);
    if (!/^[A-Za-z0-9-]+$/.test(header)) errors.push(`Endpoint "${label}" has an invalid idempotency header.`);
    if (fromInputs.some((name) => !properties.includes(name))) errors.push(`Endpoint "${label}" derives its idempotency key from undeclared inputs.`);
    idempotency = fromInputs.length ? { header, fromInputs } : { header };
  }
  const servesDocument = readServedDocument(value.servesDocument, label, properties, errors);
  for (const [name, schema] of Object.entries(isRecord(inputSchema.properties) ? inputSchema.properties : {})) {
    if (!isRecord(schema)) continue;
    for (const link of ['x-hvy-document-id', 'x-hvy-document-revision']) {
      if (schema[link] !== undefined && !properties.includes(text(schema[link]))) errors.push(`Endpoint "${label}" input "${name}" links ${link} to an undeclared input.`);
    }
  }
  if (!id || !METHODS.has(method)) return null;
  return {
    id,
    name: text(value.name) || id,
    description: text(value.description),
    method: method as ApiEndpointDefinition['method'],
    path,
    inputSchema,
    ...(idempotency ? { idempotency } : {}),
    ...(servesDocument ? { servesDocument } : {}),
    ...(text(value.errorMessagePointer) ? { errorMessagePointer: text(value.errorMessagePointer) } : {}),
    ...(value.timeoutMs !== undefined ? { timeoutMs: number(value.timeoutMs, 15_000, 1_000, MAX_ENDPOINT_TIMEOUT_MS) } : {}),
  };
}

function readSession(value: unknown, origin: string, endpoints: ApiEndpointDefinition[], errors: string[]): SessionDefinition | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !isRecord(value.probe)) {
    errors.push('The sign-in definition needs a probe.');
    return undefined;
  }
  const loginUrl = trustworthyUrl(value.loginUrl);
  const completeUrl = trustworthyUrl(value.completeUrl);
  if (!loginUrl || loginUrl.origin !== origin) errors.push('The login URL must be on the page origin.');
  if (!completeUrl || completeUrl.origin !== origin) errors.push('The completion URL must be on the page origin.');
  const probeId = text(value.probe.endpointId);
  const probe = endpoints.find((endpoint) => endpoint.id === probeId);
  if (!probe || probe.method !== 'GET') errors.push('The session probe must be a GET endpoint of this block.');
  const logoutEndpointId = text(value.logoutEndpointId);
  if (logoutEndpointId && !endpoints.some((endpoint) => endpoint.id === logoutEndpointId)) errors.push('The logout endpoint is not defined.');
  const loginAllowedOrigins = strings(value.loginAllowedOrigins).flatMap((candidate) => {
    const url = trustworthyUrl(candidate);
    if (!url) errors.push(`"${candidate}" is not an allowed login origin.`);
    return url ? [url.origin] : [];
  });
  const signedOutStatuses = Array.isArray(value.probe.signedOutStatuses)
    ? value.probe.signedOutStatuses.filter((status): status is number => Number.isInteger(status) && status >= 400 && status < 600)
    : undefined;
  return {
    loginUrl: loginUrl?.href ?? '',
    completeUrl: completeUrl?.href ?? '',
    probe: {
      endpointId: probeId,
      ...(signedOutStatuses?.length ? { signedOutStatuses } : {}),
    },
    ...(logoutEndpointId ? { logoutEndpointId } : {}),
    ...(loginAllowedOrigins.length ? { loginAllowedOrigins } : {}),
  };
}

export function readWebApiBlockConfig(value: unknown): ConfigResult<WebApiBlockConfig> {
  const errors: string[] = [];
  if (!isRecord(value) || value.schemaVersion !== WEB_AUTOMATION_SCHEMA_VERSION) return { ok: false, errors: ['Unsupported web API block configuration.'] };
  const capabilityId = text(value.capabilityId);
  if (!capabilityId) errors.push('The block needs a capability id.');
  const pageUrl = trustworthyUrl(value.pageUrl);
  if (!pageUrl) return { ok: false, errors: [...errors, 'The page URL must use HTTPS.'] };
  const apiPageUrl = value.apiPageUrl === undefined ? null : trustworthyUrl(value.apiPageUrl);
  if (value.apiPageUrl !== undefined && apiPageUrl?.origin !== pageUrl.origin) errors.push('The API page must be on the page origin.');
  const endpoints = (Array.isArray(value.endpoints) ? value.endpoints : []).flatMap((endpoint) => readEndpoint(endpoint, errors) ?? []);
  const ids = endpoints.map((endpoint) => endpoint.id);
  if (new Set(ids).size !== ids.length) errors.push('Endpoint ids must be unique.');
  const session = readSession(value.session, pageUrl.origin, endpoints, errors);
  for (const endpoint of endpoints) {
    for (const name of documentTextInputs(endpoint)) {
      const { endpointId, idInput } = documentInputLinks(endpoint, name);
      if (!endpoints.find((candidate) => candidate.id === endpointId)?.servesDocument) {
        errors.push(`Endpoint "${endpoint.id}" input "${name}" must name an endpoint of this block that serves a document.`);
      }
      if (!idInput) errors.push(`Endpoint "${endpoint.id}" input "${name}" must name the input holding the document ID.`);
    }
  }
  const readOrigins = strings(value.readOrigins).flatMap((origin) => {
    const parsed = trustworthyUrl(origin);
    if (!parsed) errors.push(`Read origin "${origin}" must use HTTPS (or HTTP on a loopback host).`);
    return parsed ? [parsed.origin] : [];
  });
  const exposed = strings(isRecord(value.mcp) ? value.mcp.endpointIds : []);
  if (exposed.some((id) => !ids.includes(id))) errors.push('MCP exposes an endpoint that is not defined.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      capability: {
        capabilityId,
        name: text(value.name) || pageUrl.hostname,
        pageUrl: pageUrl.href,
        allowedOrigins: [...new Set([pageUrl.origin, ...strings(value.allowedOrigins).flatMap((origin) => trustworthyUrl(origin)?.origin ?? [])])],
        ...(apiPageUrl ? { apiPageUrl: apiPageUrl.href } : {}),
        ...(session ? { session } : {}),
        endpoints,
        ...(readOrigins.length ? { readOrigins: [...new Set(readOrigins)] } : {}),
      },
      mcp: { endpointIds: exposed },
    },
  };
}

function readPattern(value: unknown, errors: string[]): SitePatternDefinition | null {
  if (!isRecord(value)) {
    errors.push('A pattern must be an object.');
    return null;
  }
  const id = text(value.id);
  const label = id || '(unnamed)';
  const role = value.role === 'listing' || value.role === 'detail' ? value.role : null;
  if (!id) errors.push('A pattern needs an id.');
  if (!role) errors.push(`Pattern "${label}" needs a role.`);
  const appliesTo = Array.isArray(value.appliesTo) ? value.appliesTo as SitePatternDefinition['appliesTo'] : [];
  if (!appliesTo.length) errors.push(`Pattern "${label}" needs at least one scope rule.`);
  for (const rule of appliesTo) {
    const problem = isRecord(rule) ? validateScopeRule(rule) : 'A scope rule must be an object.';
    if (problem) errors.push(`Pattern "${label}": ${problem}`);
  }
  const fields = (Array.isArray(value.fields) ? value.fields : []).flatMap((field) => {
    if (!isRecord(field) || !text(field.id)) return [];
    return [{ id: text(field.id), kind: field.kind === 'link' ? 'link' as const : 'text' as const }];
  });
  const linkFieldId = text(value.linkFieldId);
  if (role === 'listing' && !fields.some((field) => field.id === linkFieldId && field.kind === 'link')) {
    errors.push(`Listing pattern "${label}" needs a link field.`);
  }
  if (!id || !role) return null;
  return {
    id,
    name: text(value.name) || id,
    role,
    appliesTo,
    fields,
    minimumConfidence: number(value.minimumConfidence, 0.8, 0.5, 1),
    ...(linkFieldId ? { linkFieldId } : {}),
    ...(text(value.paginationCommandId) ? { paginationCommandId: text(value.paginationCommandId) } : {}),
    ...(text(value.itemCommandId) ? { itemCommandId: text(value.itemCommandId) } : {}),
    ...(value.matcher !== undefined ? { matcher: value.matcher } : {}),
    ...(text(value.siteId) ? { siteId: text(value.siteId) } : {}),
    ...(value.source !== undefined ? { source: value.source } : {}),
    version: number(value.version, 1, 1, Number.MAX_SAFE_INTEGER),
  };
}

const FIELD_ID = /^[a-z][a-z0-9_-]*$/;

/** The configured fields. Ids are what patterns, start pages, keys, and the output refer to, so they must be unique. */
function readCollectionFields(value: unknown, errors: string[]): CollectionField[] {
  const fields = (Array.isArray(value) ? value : []).flatMap((field): CollectionField[] => {
    const id = isRecord(field) ? text(field.id) : '';
    if (!isRecord(field) || !FIELD_ID.test(id) || id === RECORD_URL_FIELD) {
      errors.push(`"${id || '(unnamed)'}" is not a field id: use lowercase letters, digits, "-" or "_", and not "${RECORD_URL_FIELD}".`);
      return [];
    }
    if (field.kind !== undefined && field.kind !== 'text' && field.kind !== 'long-text') errors.push(`Field "${id}" has an unknown kind.`);
    return [{
      id,
      label: text(field.label) || id,
      kind: field.kind === 'long-text' ? 'long-text' : 'text',
      ...(field.required === true ? { required: true } : {}),
      ...(typeof field.minLength === 'number' ? { minLength: number(field.minLength, 0, 0, 100_000) } : {}),
    }];
  });
  const ids = fields.map((field) => field.id);
  for (const id of ids.filter((candidate, index) => ids.indexOf(candidate) !== index)) errors.push(`Field id "${id}" is used twice.`);
  return fields;
}

/** Start pages: unique ids, trustworthy addresses, and fixed values only for configured fields. */
function readStartPages(value: unknown, fieldIds: Set<string>, errors: string[]): StartPage[] {
  const pages = (Array.isArray(value) ? value : []).flatMap((page): StartPage[] => {
    if (!isRecord(page)) return [];
    const id = text(page.id);
    const url = trustworthyUrl(page.url);
    if (!id) errors.push('A start page needs an id.');
    if (!url) errors.push(`"${text(page.url)}" is not an HTTPS start page.`);
    const values = Object.fromEntries(Object.entries(isRecord(page.values) ? page.values : {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
      .map(([field, fixed]) => [field, fixed.trim()]));
    for (const field of Object.keys(values).filter((field) => !fieldIds.has(field))) {
      errors.push(`Start page "${text(page.url)}" fills "${field}", which is not one of the fields.`);
    }
    // Its own limits, where it has them; the collection's are its defaults.
    const limits = Object.fromEntries((['maxPages', 'maxItems'] as const).flatMap((limit) => (typeof page[limit] === 'number' ? [[limit, number(page[limit], 1, 1, LIMIT_BOUNDS[limit])]] : [])));
    return id && url ? [{ id, url: url.href, ...(Object.keys(values).length ? { values } : {}), ...(page.included === false ? { included: false as const } : {}), ...limits, ...(typeof page.stopAtKnownPage === 'boolean' ? { stopAtKnownPage: page.stopAtKnownPage } : {}) }] : [];
  });
  const ids = pages.map((page) => page.id);
  for (const id of ids.filter((candidate, index) => ids.indexOf(candidate) !== index)) errors.push(`Start page id "${id}" is used twice.`);
  return pages;
}

/** Site setups: unique ids, each named; a publisher's version is a whole number. */
function readSites(value: unknown, errors: string[]): CollectionSite[] {
  const sites = (Array.isArray(value) ? value : []).flatMap((site): CollectionSite[] => {
    const id = isRecord(site) ? text(site.id) : '';
    if (!isRecord(site) || !id) {
      errors.push('A site setup needs an id.');
      return [];
    }
    const from = isRecord(site.from) && text(site.from.name) ? { name: text(site.from.name), version: number(site.from.version, 1, 1, Number.MAX_SAFE_INTEGER) } : null;
    return [{ id, name: text(site.name) || id, ...(from ? { from } : {}) }];
  });
  const ids = sites.map((site) => site.id);
  for (const id of ids.filter((candidate, index) => ids.indexOf(candidate) !== index)) errors.push(`Site setup id "${id}" is used twice.`);
  return sites;
}

/** A pattern fills only configured fields, and its Next and item commands are its own. */
function checkPatternReferences(pattern: SitePatternDefinition, fieldIds: Set<string>, errors: string[]): void {
  for (const field of pattern.fields.filter((candidate) => candidate.kind === 'text' && !fieldIds.has(candidate.id))) {
    errors.push(`Pattern "${pattern.name}" fills "${field.id}", which is not one of the fields.`);
  }
  const commands = isRecord(pattern.matcher) && isRecord(pattern.matcher.commands) ? pattern.matcher.commands : null;
  for (const commandId of [pattern.paginationCommandId, pattern.itemCommandId]) {
    if (commandId && commands && !(commandId in commands)) errors.push(`Pattern "${pattern.name}" runs command "${commandId}", which it does not have.`);
  }
}

export function readCollectionBlockConfig(value: unknown): ConfigResult<CollectionBlockConfig> {
  const errors: string[] = [];
  if (!isRecord(value) || value.schemaVersion !== WEB_AUTOMATION_SCHEMA_VERSION) return { ok: false, errors: ['Unsupported collection block configuration.'] };
  const capabilityId = text(value.capabilityId);
  if (!capabilityId) errors.push('The block needs a capability id.');
  const fields = readCollectionFields(value.fields, errors);
  const fieldIds = new Set(fields.map((field) => field.id));
  const startPages = readStartPages(value.startPages, fieldIds, errors);
  const sites = readSites(value.sites, errors);
  const patterns = (Array.isArray(value.patterns) ? value.patterns : []).flatMap((pattern) => readPattern(pattern, errors) ?? []);
  const ids = patterns.map((pattern) => pattern.id);
  if (new Set(ids).size !== ids.length) errors.push('Pattern ids must be unique.');
  for (const pattern of patterns) checkPatternReferences(pattern, fieldIds, errors);
  const siteIds = new Set(sites.map((site) => site.id));
  for (const pattern of patterns.filter((candidate) => candidate.siteId && !siteIds.has(candidate.siteId))) {
    errors.push(`Pattern "${pattern.name}" belongs to site setup "${pattern.siteId}", which is not one of the site setups.`);
  }
  let key: CollectionDefinition['key'];
  if (isRecord(value.key)) {
    if (value.key.kind === 'url') key = { kind: 'url' };
    else if (value.key.kind === 'field' && text(value.key.field)) key = { kind: 'field', field: text(value.key.field) };
    else if (value.key.kind === 'fields' && strings(value.key.fields).length) key = { kind: 'fields', fields: strings(value.key.fields) };
    else errors.push('The record key must be the URL, a field, or a list of fields.');
  }
  const keyFields = key?.kind === 'field' ? [key.field] : key?.kind === 'fields' ? key.fields : [];
  for (const field of keyFields.filter((id) => !fieldIds.has(id))) errors.push(`The record key uses "${field}", which is not one of the fields.`);
  const ignoredQueryParameters = Array.isArray(value.ignoredQueryParameters) ? strings(value.ignoredQueryParameters) : undefined;
  const output = readOutput(value.output, errors);
  // The template has start pages other glue fills (results, notes); records may write only the fields they own.
  for (const name of (output?.policy.ownedFields ?? []).filter((name) => name !== RECORD_URL_FIELD && !fieldIds.has(name))) {
    errors.push(`Records may write "${name}", which is not one of the fields.`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      collection: {
        capabilityId,
        name: text(value.name) || 'Collection',
        ...(text(value.itemName) ? { itemName: text(value.itemName) } : {}),
        fields,
        startPages,
        sites,
        patterns,
        maxPages: number(value.maxPages, 5, 1, LIMIT_BOUNDS.maxPages),
        maxItems: number(value.maxItems, 50, 1, LIMIT_BOUNDS.maxItems),
        ...(value.stopAtKnownPage === true ? { stopAtKnownPage: true } : {}),
        followLinksToOtherSites: value.followLinksToOtherSites === true,
        ...(key ? { key } : {}),
        ...(ignoredQueryParameters ? { ignoredQueryParameters } : {}),
      },
      mcp: { collect: isRecord(value.mcp) && value.mcp.collect === true },
      ...(output ? { output } : {}),
    },
  };
}

/** A web profile context: the browser profile, by name, for the web plugins in its section or container. */
export interface ProfileContextBlockConfig {
  /** Not named yet until the user chooses one. */
  profile?: string;
}

export function readProfileContextBlockConfig(value: unknown): ConfigResult<ProfileContextBlockConfig> {
  // A context just inserted has an empty configuration: it names no profile yet, and its reader asks for one.
  if (!isRecord(value) || (value.schemaVersion !== undefined && value.schemaVersion !== WEB_AUTOMATION_SCHEMA_VERSION)) {
    return { ok: false, errors: ['Unsupported web profile context configuration.'] };
  }
  return { ok: true, value: text(value.profile) ? { profile: text(value.profile) } : {} };
}

export function readQueueBlockConfig(value: unknown): ConfigResult<QueueBlockConfig> {
  if (!isRecord(value) || value.schemaVersion !== WEB_AUTOMATION_SCHEMA_VERSION) return { ok: false, errors: ['Unsupported queue block configuration.'] };
  const errors: string[] = [];
  const queueId = text(value.queueId);
  const target = isRecord(value.target) ? value.target : {};
  const pluginId = text(target.pluginId);
  const method = text(target.method);
  if (!queueId) errors.push('The queue needs an id.');
  if (!pluginId || !method) errors.push('The queue needs a target plugin and method.');
  if (pluginId === QUEUE_PLUGIN_ID) errors.push('A queue cannot target another queue.');
  const config = isRecord(value.config) ? value.config : {};
  const retry = isRecord(config.retry) ? config.retry : {};
  const defaults = DEFAULT_QUEUE_CONFIG;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      queueId,
      target: { pluginId, method, args: isRecord(target.args) ? target.args : {} },
      config: {
        concurrency: Math.round(number(config.concurrency, defaults.concurrency, 1, 4)),
        minIntervalMs: number(config.minIntervalMs, defaults.minIntervalMs, 0, 3_600_000),
        jitterMs: number(config.jitterMs, defaults.jitterMs, 0, 600_000),
        retry: {
          statuses: Array.isArray(retry.statuses) ? retry.statuses.filter((status): status is number => Number.isInteger(status)) : defaults.retry.statuses,
          codes: Array.isArray(retry.codes) ? strings(retry.codes) : defaults.retry.codes,
          maxAttempts: Math.round(number(retry.maxAttempts, defaults.retry.maxAttempts, 1, 10)),
          baseDelayMs: number(retry.baseDelayMs, defaults.retry.baseDelayMs, 1_000, 3_600_000),
          maxDelayMs: number(retry.maxDelayMs, defaults.retry.maxDelayMs, 1_000, 86_400_000),
        },
      },
      state: readQueueState(value.state),
    },
  };
}

const QUEUE_ENTRY_STATUSES = new Set<QueueEntryStatus>(['queued', 'running', 'waiting-retry', 'done', 'failed', 'cancelled']);

/** Reads the queue state saved in a block, dropping malformed entries rather than failing. */
function readQueueState(value: unknown): QueueState | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const entries = value.entries.flatMap((raw): QueueEntry[] => {
    if (!isRecord(raw) || !text(raw.key) || !text(raw.idempotencyKey) || !QUEUE_ENTRY_STATUSES.has(raw.status as QueueEntryStatus)) return [];
    return [{
      key: text(raw.key),
      input: raw.input ?? null,
      ...(raw.context === undefined ? {} : { context: raw.context }),
      idempotencyKey: text(raw.idempotencyKey),
      status: raw.status as QueueEntryStatus,
      attempts: Number.isInteger(raw.attempts) ? Number(raw.attempts) : 0,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
      result: raw.result ?? null,
      nextAttemptAt: typeof raw.nextAttemptAt === 'number' ? raw.nextAttemptAt : null,
      delivered: raw.delivered === true,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    }];
  });
  return {
    entries,
    paused: value.paused === true,
    pauseReason: typeof value.pauseReason === 'string' ? value.pauseReason : null,
    awaitingResume: false,
  };
}
