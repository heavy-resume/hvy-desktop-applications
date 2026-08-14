import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { visitBlocksInList } from '../../heavy-file-format/src/section-ops';
import type { JsonObject } from '../../heavy-file-format/src/hvy/types';
import type { VisualDocument } from './hvy';
import type {
  IntegrationActionDefinition,
  IntegrationCommandDefinition,
  IntegrationInteractionStepDefinition,
  IntegrationPageDefinition,
  IntegrationPageReadyChecks,
} from './integrationRegistry';
import { actionPatternPayload, integrationPageReadyChecks, matcherSnapshot } from './integrationRegistry';

export const WEB_RECORDS_PLUGIN_ID = 'hvy.web-records';
export const WEB_COMMAND_PLUGIN_ID = 'hvy.web-command';
export const WEB_CAPABILITY_SCHEMA_VERSION = 1;

export interface WebCapabilityPageSnapshot {
  name: string;
  url: string;
  allowedOrigins: string[];
  readyChecks: IntegrationPageReadyChecks;
}

export interface WebCapabilitySource {
  integrationId: string;
  pageId: string;
  actionId?: string;
  commandId?: string;
}

export interface WebRecordsCapabilityConfig {
  schemaVersion: 1;
  capabilityId: string;
  name: string;
  description: string;
  page: WebCapabilityPageSnapshot;
  record: {
    id: string;
    name: string;
    version: number;
    resultSchema: Record<string, unknown>;
    permissions: Array<'dom:read' | 'image:read'>;
    pattern: NonNullable<ReturnType<typeof actionPatternPayload>>;
    commands: IntegrationCommandDefinition[];
  };
  source?: WebCapabilitySource;
  mcp: {
    exposeRead: boolean;
    commandIds: string[];
  };
}

export interface WebCommandCapabilityConfig {
  schemaVersion: 1;
  capabilityId: string;
  name: string;
  description: string;
  page: WebCapabilityPageSnapshot;
  command: IntegrationCommandDefinition;
  source?: WebCapabilitySource;
  mcp: {
    exposed: boolean;
  };
}

export type WebCapabilityConfig = WebRecordsCapabilityConfig | WebCommandCapabilityConfig;
export type WebCapabilityKind = 'records' | 'command';

export interface WebCapabilityDescriptor {
  pluginId: typeof WEB_RECORDS_PLUGIN_ID | typeof WEB_COMMAND_PLUGIN_ID;
  blockId: string;
  kind: WebCapabilityKind;
  config: WebCapabilityConfig;
}

export interface WebCapabilityApprovalSummary {
  schemaVersion: 1;
  kind: WebCapabilityKind;
  name: string;
  pageUrl: string;
  allowedOrigins: string[];
  fieldLabels: string[];
  commands: Array<{ id: string; name: string; gesture: string; scope: string; inputs: Array<{ id: string; name: string; required: boolean }> }>;
}

export interface WebCapabilityAuthorizationRecord {
  capabilityId: string;
  profileId: string;
  capabilityHash: string;
  summary: WebCapabilityApprovalSummary;
  authorizedAt: string;
}

export type WebCapabilityProfileBindings = Record<string, Record<string, string>>;
export type WebCapabilityAuthorizations = Record<string, Record<string, WebCapabilityAuthorizationRecord>>;

export type WebCapabilityAuthorizationReason =
  | 'first-use'
  | 'profile-changed'
  | 'document-identity-changed'
  | 'authorization-cleared'
  | 'authorization-format-changed'
  | 'capability-changed';

export interface WebCapabilityAuthorizationReview {
  reason: WebCapabilityAuthorizationReason;
  changedCategories: Array<'page' | 'origins' | 'records' | 'commands'>;
  currentHash: string;
  currentSummary: WebCapabilityApprovalSummary;
  existing: WebCapabilityAuthorizationRecord | null;
}

export function normalizeWebCapabilityProfileBindings(value: unknown): WebCapabilityProfileBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([documentPath, bindings]) => {
    const path = documentPath.trim();
    if (!path || !bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return [];
    const normalized = Object.fromEntries(Object.entries(bindings as Record<string, unknown>)
      .flatMap(([capabilityId, profileId]) => {
        const capability = capabilityId.trim();
        const profile = typeof profileId === 'string' ? profileId.trim() : '';
        return capability && profile ? [[capability, profile]] : [];
      }));
    return Object.keys(normalized).length ? [[path, normalized]] : [];
  }));
}

export function normalizeWebCapabilityAuthorizations(value: unknown): WebCapabilityAuthorizations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([documentPath, authorizations]) => {
    const path = documentPath.trim();
    if (!path || !authorizations || typeof authorizations !== 'object' || Array.isArray(authorizations)) return [];
    const normalized = Object.fromEntries(Object.entries(authorizations as Record<string, unknown>)
      .flatMap(([capabilityId, authorization]) => {
        if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return [];
        const record = authorization as Record<string, unknown>;
        const capability = capabilityId.trim();
        const profileId = typeof record.profileId === 'string' ? record.profileId.trim() : '';
        const capabilityHash = typeof record.capabilityHash === 'string' ? record.capabilityHash.trim() : '';
        const authorizedAt = typeof record.authorizedAt === 'string' ? record.authorizedAt.trim() : '';
        const summaryValue = record.summary;
        if (!capability || !profileId || !capabilityHash || !authorizedAt || !summaryValue || typeof summaryValue !== 'object' || Array.isArray(summaryValue)) return [];
        const summary = summaryValue as Record<string, unknown>;
        if (summary.schemaVersion !== WEB_CAPABILITY_SCHEMA_VERSION || (summary.kind !== 'records' && summary.kind !== 'command')) return [];
        const pageUrl = typeof summary.pageUrl === 'string' ? summary.pageUrl.trim() : '';
        const name = typeof summary.name === 'string' ? summary.name.trim() : '';
        if (!pageUrl || !name) return [];
        const commands = Array.isArray(summary.commands)
          ? summary.commands.flatMap((command) => {
            if (!command || typeof command !== 'object' || Array.isArray(command)) return [];
            const item = command as Record<string, unknown>;
            const id = typeof item.id === 'string' ? item.id.trim() : '';
            const commandName = typeof item.name === 'string' ? item.name.trim() : '';
            const gesture = typeof item.gesture === 'string' ? item.gesture.trim() : '';
            const scope = typeof item.scope === 'string' ? item.scope.trim() : '';
            const inputs = Array.isArray(item.inputs) ? item.inputs.flatMap((input) => {
              if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
              const definition = input as Record<string, unknown>;
              const inputId = typeof definition.id === 'string' ? definition.id.trim() : '';
              const inputName = typeof definition.name === 'string' ? definition.name.trim() : '';
              return inputId && inputName ? [{ id: inputId, name: inputName, required: definition.required !== false }] : [];
            }) : [];
            return id && commandName && gesture && scope ? [{ id, name: commandName, gesture, scope, inputs }] : [];
          })
          : [];
        const normalizedRecord: WebCapabilityAuthorizationRecord = {
          capabilityId: capability,
          profileId,
          capabilityHash,
          authorizedAt,
          summary: {
            schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
            kind: summary.kind,
            name,
            pageUrl,
            allowedOrigins: uniqueStrings(summary.allowedOrigins).sort(),
            fieldLabels: uniqueStrings(summary.fieldLabels).sort(),
            commands: commands.sort((left, right) => left.id.localeCompare(right.id)),
          },
        };
        return [[capability, normalizedRecord]];
      }));
    return Object.keys(normalized).length ? [[path, normalized]] : [];
  }));
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

function normalizeReadyChecks(value: unknown, pageUrl: URL): IntegrationPageReadyChecks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { urlMode: 'strict-url', urlValue: pageUrl.href, elements: [] };
  }
  const record = value as Record<string, unknown>;
  const urlMode = record.urlMode === 'strict-domain' || record.urlMode === 'domain-regex' ? record.urlMode : 'strict-url';
  const urlValue = typeof record.urlValue === 'string' && record.urlValue.trim()
    ? record.urlValue.trim()
    : urlMode === 'strict-url' ? pageUrl.href : pageUrl.hostname;
  const elements = Array.isArray(record.elements) ? record.elements.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const check = value as Record<string, unknown>;
    const id = typeof check.id === 'string' ? check.id.trim() : '';
    const name = typeof check.name === 'string' ? check.name.trim() : '';
    const snapshot = matcherSnapshot(check.snapshot);
    const shape = snapshot && typeof snapshot === 'object'
      ? (snapshot as { selected?: { shape?: unknown } }).selected?.shape
      : null;
    if (!id || !shape) return [];
    return [{
      id,
      name: name || 'Page landmark',
      snapshot,
      ...(typeof check.expectedValue === 'string' && check.expectedValue.trim()
        ? { expectedValue: check.expectedValue.trim() }
        : {}),
    }];
  }) : [];
  return { urlMode, urlValue, elements };
}

function portableReadyChecks(page: IntegrationPageDefinition): IntegrationPageReadyChecks {
  const checks = normalizeReadyChecks(integrationPageReadyChecks(page), new URL(page.url));
  return { ...checks, elements: checks.elements.map(({ expectedValue: _expectedValue, ...check }) => check) };
}

function normalizePage(value: unknown): WebCapabilityPageSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const urlValue = typeof record.url === 'string' ? record.url.trim() : '';
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const allowedOrigins = uniqueStrings(record.allowedOrigins).filter((origin) => {
    try {
      return new URL(origin).origin === origin && new URL(origin).protocol === 'https:';
    } catch {
      return false;
    }
  });
  if (!allowedOrigins.includes(url.origin)) allowedOrigins.unshift(url.origin);
  return { name: name || url.hostname, url: url.href, allowedOrigins, readyChecks: normalizeReadyChecks(record.readyChecks, url) };
}

function normalizeCommand(value: unknown, scope: 'page' | 'record'): IntegrationCommandDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!id || !name || record.scope !== scope || !Array.isArray(record.steps) || !record.steps.length) return null;
  const inputs = Array.isArray(record.inputs) ? record.inputs.flatMap((rawInput) => {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return [];
    const input = rawInput as Record<string, unknown>;
    const inputId = typeof input.id === 'string' ? input.id.trim() : '';
    const inputName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!inputId || !inputName) return [];
    return [{ id: inputId, name: inputName, required: input.required !== false }];
  }) : [];
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length) return null;
  const inputIds = new Set(inputs.map((input) => input.id));
  const steps = record.steps.flatMap<IntegrationInteractionStepDefinition>((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return [];
    const step = rawStep as Record<string, unknown>;
    if (step.gesture !== 'click' && step.gesture !== 'double-click' && step.gesture !== 'right-click' && step.gesture !== 'type') return [];
    if (step.gesture === 'type' && (typeof step.inputId !== 'string' || !inputIds.has(step.inputId))) return [];
    return [{
      gesture: step.gesture,
      target: matcherSnapshot(step.target),
      ...(step.gesture === 'type' ? { inputId: step.inputId as string } : {}),
      ...(typeof step.fromState === 'string' ? { fromState: step.fromState } : {}),
      ...(typeof step.toState === 'string' ? { toState: step.toState } : {}),
    }];
  });
  if (steps.length !== record.steps.length) return null;
  return {
    id,
    name,
    scope,
    ...(inputs.length ? { inputs } : {}),
    steps,
  };
}

function normalizeSource(value: unknown): WebCapabilitySource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const integrationId = typeof record.integrationId === 'string' ? record.integrationId.trim() : '';
  const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : '';
  if (!integrationId || !pageId) return undefined;
  return {
    integrationId,
    pageId,
    ...(typeof record.actionId === 'string' && record.actionId.trim() ? { actionId: record.actionId.trim() } : {}),
    ...(typeof record.commandId === 'string' && record.commandId.trim() ? { commandId: record.commandId.trim() } : {}),
  };
}

function portablePattern(value: unknown): WebRecordsCapabilityConfig['record']['pattern'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.parents) || !Array.isArray(record.targets)) return null;
  const targets = record.targets.flatMap((target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return [];
    const item = target as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const cardinality: 'list' | 'single' | null = item.cardinality === 'list' ? 'list' : item.cardinality === 'single' ? 'single' : null;
    if (!label || !cardinality || !item.snapshot) return [];
    return [{
      label,
      cardinality,
      optional: item.optional === true,
      snapshot: matcherSnapshot(item.snapshot),
      snapshots: (Array.isArray(item.snapshots) ? item.snapshots : [item.snapshot]).map(matcherSnapshot),
      negativeSnapshots: (Array.isArray(item.negativeSnapshots) ? item.negativeSnapshots : []).map(matcherSnapshot),
      exampleSnapshots: (Array.isArray(item.exampleSnapshots) ? item.exampleSnapshots : []).map((snapshot) => (
        snapshot === null ? null : matcherSnapshot(snapshot)
      )),
    }];
  });
  if (targets.length !== record.targets.length) return null;
  return {
    minimumConfidence: typeof record.minimumConfidence === 'number' && Number.isFinite(record.minimumConfidence)
      ? record.minimumConfidence
      : 0.85,
    parents: record.parents.map(matcherSnapshot),
    targets,
  };
}

export function createWebRecordsCapabilityConfig(
  integrationId: string,
  page: IntegrationPageDefinition,
  action: IntegrationActionDefinition,
  capabilityId: string = crypto.randomUUID(),
): WebRecordsCapabilityConfig {
  const pattern = actionPatternPayload(action);
  if (!pattern) throw new Error('The record definition does not contain an executable pattern.');
  const copiedPattern = portablePattern(pattern);
  if (!copiedPattern) throw new Error('The record definition does not contain a valid portable pattern.');
  return {
    schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    name: action.name,
    description: action.description,
    page: {
      name: page.name,
      url: new URL(page.url).href,
      allowedOrigins: [...new Set(page.allowedOrigins)],
      readyChecks: portableReadyChecks(page),
    },
    record: {
      id: action.id,
      name: action.name,
      version: action.version,
      resultSchema: structuredClone(action.resultSchema),
      permissions: [...action.permissions],
      pattern: copiedPattern,
      commands: (action.commands ?? []).flatMap((command) => {
        const normalized = normalizeCommand(command, 'record');
        return normalized ? [normalized] : [];
      }),
    },
    source: { integrationId, pageId: page.id, actionId: action.id },
    mcp: { exposeRead: false, commandIds: [] },
  };
}

export function createWebCommandCapabilityConfig(
  integrationId: string,
  page: IntegrationPageDefinition,
  command: IntegrationCommandDefinition,
  capabilityId: string = crypto.randomUUID(),
): WebCommandCapabilityConfig {
  const normalized = normalizeCommand(command, 'page');
  if (!normalized) throw new Error('The page command is not a supported one-step command.');
  return {
    schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    name: command.name,
    description: `${command.name} on ${page.name}`,
    page: {
      name: page.name,
      url: new URL(page.url).href,
      allowedOrigins: [...new Set(page.allowedOrigins)],
      readyChecks: portableReadyChecks(page),
    },
    command: normalized,
    source: { integrationId, pageId: page.id, commandId: command.id },
    mcp: { exposed: false },
  };
}

export function readWebRecordsCapabilityConfig(value: unknown): WebRecordsCapabilityConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== WEB_CAPABILITY_SCHEMA_VERSION) return null;
  const capabilityId = typeof record.capabilityId === 'string' ? record.capabilityId.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const page = normalizePage(record.page);
  const rawDefinition = record.record;
  if (!capabilityId || !name || !page || !rawDefinition || typeof rawDefinition !== 'object' || Array.isArray(rawDefinition)) return null;
  const definition = rawDefinition as Record<string, unknown>;
  const id = typeof definition.id === 'string' ? definition.id.trim() : '';
  const pattern = portablePattern(definition.pattern);
  if (!id || !pattern) return null;
  const commands = Array.isArray(definition.commands)
    ? definition.commands.flatMap((command) => {
      const normalized = normalizeCommand(command, 'record');
      return normalized ? [normalized] : [];
    })
    : [];
  const mcp = record.mcp && typeof record.mcp === 'object' && !Array.isArray(record.mcp)
    ? record.mcp as Record<string, unknown>
    : {};
  const exposedCommandIds = uniqueStrings(mcp.commandIds).filter((commandId) => commands.some((command) => command.id === commandId));
  return {
    schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    name,
    description: typeof record.description === 'string' ? record.description.trim() : '',
    page,
    record: {
      id,
      name: typeof definition.name === 'string' && definition.name.trim() ? definition.name.trim() : name,
      version: typeof definition.version === 'number' && Number.isFinite(definition.version) ? definition.version : 1,
      resultSchema: definition.resultSchema && typeof definition.resultSchema === 'object' && !Array.isArray(definition.resultSchema)
        ? structuredClone(definition.resultSchema as Record<string, unknown>)
        : {},
      permissions: uniqueStrings(definition.permissions).filter((permission): permission is 'dom:read' | 'image:read' => permission === 'dom:read' || permission === 'image:read'),
      pattern,
      commands,
    },
    ...(normalizeSource(record.source) ? { source: normalizeSource(record.source) } : {}),
    mcp: {
      exposeRead: mcp.exposeRead === true,
      commandIds: mcp.exposeRead === true ? exposedCommandIds : [],
    },
  };
}

export function readWebCommandCapabilityConfig(value: unknown): WebCommandCapabilityConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== WEB_CAPABILITY_SCHEMA_VERSION) return null;
  const capabilityId = typeof record.capabilityId === 'string' ? record.capabilityId.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const page = normalizePage(record.page);
  const command = normalizeCommand(record.command, 'page');
  if (!capabilityId || !name || !page || !command) return null;
  const mcp = record.mcp && typeof record.mcp === 'object' && !Array.isArray(record.mcp)
    ? record.mcp as Record<string, unknown>
    : {};
  return {
    schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    name,
    description: typeof record.description === 'string' ? record.description.trim() : '',
    page,
    command,
    ...(normalizeSource(record.source) ? { source: normalizeSource(record.source) } : {}),
    mcp: { exposed: mcp.exposed === true },
  };
}

export function readWebCapabilityConfig(pluginId: string, value: unknown): WebCapabilityConfig | null {
  if (pluginId === WEB_RECORDS_PLUGIN_ID) return readWebRecordsCapabilityConfig(value);
  if (pluginId === WEB_COMMAND_PLUGIN_ID) return readWebCommandCapabilityConfig(value);
  return null;
}

export function findWebCapabilities(document: VisualDocument): WebCapabilityDescriptor[] {
  const descriptors: WebCapabilityDescriptor[] = [];
  const visit = (sections: VisualDocument['sections']): void => {
    for (const section of sections) {
      visitBlocksInList(section.blocks, (block) => {
        const pluginId = block.schema.plugin;
        if (block.schema.component !== 'plugin' || (pluginId !== WEB_RECORDS_PLUGIN_ID && pluginId !== WEB_COMMAND_PLUGIN_ID)) return;
        const config = readWebCapabilityConfig(pluginId, block.schema.pluginConfig);
        if (!config) return;
        descriptors.push({
          pluginId,
          blockId: block.id,
          kind: pluginId === WEB_RECORDS_PLUGIN_ID ? 'records' : 'command',
          config,
        });
      });
      visit(section.children);
    }
  };
  visit(document.sections);
  return descriptors;
}

export function webCapabilityApprovalSummary(config: WebCapabilityConfig): WebCapabilityApprovalSummary {
  const records = 'record' in config;
  const commands = records ? config.record.commands : [config.command];
  return {
    schemaVersion: WEB_CAPABILITY_SCHEMA_VERSION,
    kind: records ? 'records' : 'command',
    name: config.name,
    pageUrl: config.page.url,
    allowedOrigins: [...config.page.allowedOrigins].sort(),
    fieldLabels: records ? config.record.pattern.targets.map((target) => target.label).sort() : [],
    commands: commands.map((command) => ({
      id: command.id,
      name: command.name,
      gesture: command.steps.map((step) => step.gesture).join(' → '),
      scope: command.scope,
      inputs: (command.inputs ?? []).map((input) => ({ ...input })),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function canonicalCapabilityValue(config: WebCapabilityConfig): JsonObject {
  if ('record' in config) {
    return {
      schemaVersion: config.schemaVersion,
      capabilityId: config.capabilityId,
      page: config.page,
      record: config.record,
    };
  }
  return {
    schemaVersion: config.schemaVersion,
    capabilityId: config.capabilityId,
    page: config.page,
    command: config.command,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function webCapabilityHash(config: WebCapabilityConfig): string {
  return `web-sha256-${bytesToHex(sha256(new TextEncoder().encode(stableJson(canonicalCapabilityValue(config)))))}`;
}

export function webCapabilityBindingKey(documentPath: string): string {
  return documentPath.trim();
}

export function getWebCapabilityProfileBinding(
  bindings: WebCapabilityProfileBindings,
  documentPath: string,
  capabilityId: string,
): string | null {
  return bindings[webCapabilityBindingKey(documentPath)]?.[capabilityId] ?? null;
}

export function setWebCapabilityProfileBinding(
  bindings: WebCapabilityProfileBindings,
  documentPath: string,
  capabilityId: string,
  profileId: string | null,
): WebCapabilityProfileBindings {
  const key = webCapabilityBindingKey(documentPath);
  if (!key) return bindings;
  const nextForDocument = { ...(bindings[key] ?? {}) };
  if (profileId) nextForDocument[capabilityId] = profileId;
  else delete nextForDocument[capabilityId];
  const next = { ...bindings };
  if (Object.keys(nextForDocument).length > 0) next[key] = nextForDocument;
  else delete next[key];
  return next;
}

export function reviewWebCapabilityAuthorization(
  authorizations: WebCapabilityAuthorizations,
  documentPath: string,
  config: WebCapabilityConfig,
  profileId: string,
): WebCapabilityAuthorizationReview {
  const currentHash = webCapabilityHash(config);
  const currentSummary = webCapabilityApprovalSummary(config);
  const existing = authorizations[webCapabilityBindingKey(documentPath)]?.[config.capabilityId] ?? null;
  if (!existing) {
    return { reason: 'first-use', changedCategories: [], currentHash, currentSummary, existing: null };
  }
  if (existing.profileId !== profileId) {
    return { reason: 'profile-changed', changedCategories: [], currentHash, currentSummary, existing };
  }
  if (existing.summary?.schemaVersion !== WEB_CAPABILITY_SCHEMA_VERSION) {
    return { reason: 'authorization-format-changed', changedCategories: [], currentHash, currentSummary, existing };
  }
  if (existing.capabilityHash === currentHash) {
    return { reason: 'first-use', changedCategories: [], currentHash, currentSummary, existing };
  }
  const changedCategories: WebCapabilityAuthorizationReview['changedCategories'] = [];
  if (existing.summary.pageUrl !== currentSummary.pageUrl) changedCategories.push('page');
  if (stableJson(existing.summary.allowedOrigins) !== stableJson(currentSummary.allowedOrigins)) changedCategories.push('origins');
  if (stableJson(existing.summary.fieldLabels) !== stableJson(currentSummary.fieldLabels)) changedCategories.push('records');
  if (stableJson(existing.summary.commands) !== stableJson(currentSummary.commands)) changedCategories.push('commands');
  return { reason: 'capability-changed', changedCategories, currentHash, currentSummary, existing };
}

export function isWebCapabilityAuthorized(
  authorizations: WebCapabilityAuthorizations,
  documentPath: string,
  config: WebCapabilityConfig,
  profileId: string,
): boolean {
  const existing = authorizations[webCapabilityBindingKey(documentPath)]?.[config.capabilityId];
  return Boolean(existing && existing.profileId === profileId && existing.capabilityHash === webCapabilityHash(config));
}

export function authorizeWebCapabilityRecord(
  authorizations: WebCapabilityAuthorizations,
  documentPath: string,
  config: WebCapabilityConfig,
  profileId: string,
): WebCapabilityAuthorizations {
  const key = webCapabilityBindingKey(documentPath);
  if (!key) return authorizations;
  return {
    ...authorizations,
    [key]: {
      ...(authorizations[key] ?? {}),
      [config.capabilityId]: {
        capabilityId: config.capabilityId,
        profileId,
        capabilityHash: webCapabilityHash(config),
        summary: webCapabilityApprovalSummary(config),
        authorizedAt: new Date().toISOString(),
      },
    },
  };
}
