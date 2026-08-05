export interface IntegrationPageDefinition {
  id: string;
  name: string;
  url: string;
  allowedOrigins: string[];
  editable: boolean;
}

export interface IntegrationActionDefinition {
  id: string;
  integrationId: string;
  name: string;
  description: string;
  pageIds: string[];
  script: string;
  resultSchema: Record<string, unknown>;
  permissions: Array<'dom:read' | 'image:read'>;
  version: number;
  status?: 'draft' | 'ready';
  examples?: unknown[];
  anchors?: unknown[];
  pattern?: IntegrationActionPatternDefinition;
  commands?: IntegrationCommandDefinition[];
}

export interface IntegrationCommandDefinition {
  id: string;
  name: string;
  scope: 'page' | 'record';
  steps: IntegrationInteractionStepDefinition[];
}

export interface IntegrationInteractionStepDefinition {
  gesture: 'click' | 'right-click';
  target: unknown;
  fromState?: string;
  toState?: string;
}

export interface IntegrationActionFieldDefinition {
  id: string;
  label: string;
  cardinality: 'single' | 'list';
  optional: boolean;
  snapshot: unknown;
  snapshots?: unknown[];
  negativeSnapshots?: unknown[];
}

export interface IntegrationActionPatternDefinition {
  recordLabel: string;
  minimumConfidence: number;
  parents: unknown[];
  fields: IntegrationActionFieldDefinition[];
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  profileProviderId: string;
  editable: boolean;
  pages: IntegrationPageDefinition[];
  actions: IntegrationActionDefinition[];
}

export interface IntegrationProfileDefinition {
  id: string;
  name: string;
  providerId: string;
  browserStoreId: string;
}

export interface IntegrationRegistry {
  version: 1;
  integrations: IntegrationDefinition[];
  profiles: IntegrationProfileDefinition[];
}

export interface InspectionPrivacyRule {
  path: string;
  action: 'label' | 'remove';
  label?: string;
}

const STORAGE_KEY = 'hvy-galaxy-integration-registry-v1';

export function defaultIntegrationRegistry(): IntegrationRegistry {
  return {
    version: 1,
    profiles: [{
      id: 'default-google',
      name: 'Personal',
      providerId: 'google',
      browserStoreId: 'default-google',
    }],
    integrations: [{
      id: 'google-workspace',
      name: 'Google Workspace',
      profileProviderId: 'google',
      editable: false,
      pages: [
        { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', allowedOrigins: ['https://mail.google.com', 'https://accounts.google.com'], editable: false },
        { id: 'google-calendar', name: 'Google Calendar', url: 'https://calendar.google.com/', allowedOrigins: ['https://calendar.google.com', 'https://accounts.google.com'], editable: false },
      ],
      actions: [],
    }],
  };
}

export function loadIntegrationRegistry(): IntegrationRegistry {
  const fallback = defaultIntegrationRegistry();
  const value = localStorage.getItem(STORAGE_KEY);
  if (!value) return fallback;
  const saved = JSON.parse(value) as IntegrationRegistry;
  const custom = saved.integrations.filter((integration) => integration.editable);
  const savedGoogle = saved.integrations.find((integration) => integration.id === 'google-workspace');
  fallback.integrations[0].actions = savedGoogle?.actions ?? [];
  const profiles = (saved.profiles ?? fallback.profiles).map((profile) => (
    profile.id === 'default-google' && profile.name === 'Google account'
      ? { ...profile, name: 'Personal' }
      : profile
  ));
  return { version: 1, integrations: [...fallback.integrations, ...custom], profiles };
}

export function saveIntegrationRegistry(registry: IntegrationRegistry): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
}

export function matcherSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const selected = (value as { selected?: { shape?: unknown; relativePath?: unknown } }).selected;
  return {
    selected: {
      shape: selected?.shape,
      relativePath: selected?.relativePath ?? null,
    },
  };
}

export function actionPatternPayload(action: IntegrationActionDefinition): { minimumConfidence: number; parents: unknown[]; targets: Array<{ label: string; cardinality: 'single' | 'list'; optional: boolean; snapshot: unknown; snapshots: unknown[]; negativeSnapshots: unknown[] }> } | null {
  if (!action.pattern) return null;
  return {
    minimumConfidence: action.pattern.minimumConfidence ?? 0.85,
    parents: action.pattern.parents,
    targets: action.pattern.fields.map((field) => ({ label: field.label, cardinality: field.cardinality, optional: field.optional ?? false, snapshot: field.snapshot, snapshots: field.snapshots?.length ? field.snapshots : [field.snapshot], negativeSnapshots: field.negativeSnapshots ?? [] })),
  };
}

export function commandExecutionPayload(action: IntegrationActionDefinition, command: IntegrationCommandDefinition, recordParent?: string): { pattern: NonNullable<ReturnType<typeof actionPatternPayload>>; command: IntegrationCommandDefinition; recordParent?: string } | null {
  const pattern = actionPatternPayload(action);
  if (!pattern || command.steps.length !== 1) return null;
  return { pattern, command, ...(recordParent ? { recordParent } : {}) };
}

export function createCustomPageIntegration(name: string, urlValue: string): IntegrationDefinition {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:') throw new Error('Integration pages must use HTTPS.');
  const id = `custom-${crypto.randomUUID()}`;
  return {
    id,
    name: name.trim(),
    profileProviderId: id,
    editable: true,
    pages: [{ id: `${id}-page`, name: name.trim(), url: url.href, allowedOrigins: [url.origin], editable: true }],
    actions: [],
  };
}

export function createIntegrationProfile(providerId: string, name: string): IntegrationProfileDefinition {
  const id = `profile-${crypto.randomUUID()}`;
  return { id, name: name.trim(), providerId, browserStoreId: crypto.randomUUID() };
}

export function jsonPathFor(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function applyInspectionPrivacyRules(value: unknown, rules: InspectionPrivacyRule[]): unknown {
  const rulesByPath = new Map(rules.map((rule) => [rule.path, rule]));
  const transform = (current: unknown, path: string): unknown => {
    const rule = rulesByPath.get(path);
    if (rule?.action === 'remove') return undefined;
    if (rule?.action === 'label') return `{{${(rule.label || 'REDACTED').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}}}`;
    if (Array.isArray(current)) {
      return current.map((item, index) => transform(item, jsonPathFor(path, index))).filter((item) => item !== undefined);
    }
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current)
        .map(([key, item]) => [key, transform(item, jsonPathFor(path, key))] as const)
        .filter((entry) => entry[1] !== undefined));
    }
    return current;
  };
  return transform(value, '');
}

export function matchingInspectionPrivacyRules(value: unknown, path: string, action: 'label' | 'remove', label?: string): InspectionPrivacyRule[] {
  const parts = path.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let selected = value;
  for (const part of parts) {
    if (!selected || typeof selected !== 'object') return [{ path, action, label }];
    selected = (selected as Record<string, unknown>)[part];
  }
  if (selected !== null && typeof selected === 'object') return [{ path, action, label }];
  const matches: InspectionPrivacyRule[] = [];
  const visit = (current: unknown, currentPath: string) => {
    if (current === selected) matches.push({ path: currentPath, action, label });
    if (Array.isArray(current)) current.forEach((item, index) => visit(item, jsonPathFor(currentPath, index)));
    else if (current && typeof current === 'object') Object.entries(current).forEach(([key, item]) => visit(item, jsonPathFor(currentPath, key)));
  };
  visit(value, '');
  return matches;
}

export function selectedInspectionContent(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const selected = (value as { selected?: unknown }).selected;
  if (!selected || typeof selected !== 'object') return '';
  const item = selected as Record<string, unknown>;
  for (const key of ['directText', 'accessibleName', 'descendantText']) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }
  const image = item.image;
  if (image && typeof image === 'object' && typeof (image as Record<string, unknown>).alt === 'string') {
    return String((image as Record<string, unknown>).alt);
  }
  return '';
}
