import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type {
  HvyPlugin,
  HvyPluginComponentTemplateRenderInstance,
  HvyPluginContext,
  HvyPluginInstance,
} from '../../../heavy-file-format/src/plugins/types';
import { defaultBlockSchema } from '../../../heavy-file-format/src/document-factory';
import type { ReusableTemplateVariable } from '../../../heavy-file-format/src/reusable-template-values';
import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';
import { saveAppSettings } from '../backend';
import { state } from '../state';
import { integrationPageReadyChecks } from '../integrationRegistry';
import {
  authorizeWebCapabilityRecord,
  createWebCommandCapabilityConfig,
  createWebRecordsCapabilityConfig,
  findWebCapabilities,
  getWebCapabilityProfileBinding,
  isWebCapabilityAuthorized,
  readWebCommandCapabilityConfig,
  readWebRecordsCapabilityConfig,
  reviewWebCapabilityAuthorization,
  setWebCapabilityProfileBinding,
  DEFAULT_WEB_RECORD_LIMIT,
  WEB_COMMAND_PLUGIN_ID,
  WEB_RECORDS_PLUGIN_ID,
  type WebCapabilityConfig,
  type WebCapabilityAuthorizationReview,
  type WebCommandCapabilityConfig,
  type WebRecordsCapabilityConfig,
  type WebRecordsTemplateRendering,
} from '../webCapabilities';
import {
  executeWebPageCommandCapability,
  executeWebRecordCommandCapability,
  executeWebRecordsCapability,
} from '../webCapabilityRuntime';
import {
  queueWebCapabilityScriptOperation,
  type WebCapabilityScriptCallback as ScriptCallback,
  type WebCapabilityScriptCallbacks as WebScriptCallbacks,
} from './webCapabilityScripting';
import { getWebRecordResults, hasWebRecordResults, setWebRecordResults, subscribeWebRecordResults } from '../webRecordResults';
import './webCapabilities.css';

function scriptingCallbacks(args: JsonObject): WebScriptCallbacks {
  const values = args as Record<string, unknown>;
  const onComplete = values.on_complete;
  const onError = values.on_error;
  if (typeof onComplete !== 'function') {
    throw new TypeError('The web capability scripting call requires an on_complete callback.');
  }
  if (onError !== undefined && onError !== null && typeof onError !== 'function') {
    throw new TypeError('on_error must be a callback when provided.');
  }
  return {
    onComplete: onComplete as ScriptCallback,
    onError: typeof onError === 'function' ? onError as ScriptCallback : null,
  };
}

function scriptingCapability<T extends WebCapabilityConfig>(
  document: HvyPluginContext['rawDocument'],
  capabilityIdValue: unknown,
  predicate: (config: WebCapabilityConfig) => config is T,
): T {
  const capabilityId = String(capabilityIdValue ?? '').trim();
  const config = findWebCapabilities(document)
    .map((candidate) => candidate.config)
    .find((candidate): candidate is T => candidate.capabilityId === capabilityId && predicate(candidate));
  if (!config) throw new Error(`Web capability "${capabilityId}" was not found in this document.`);
  return config;
}

function scriptingExecutionContext(config: WebCapabilityConfig) {
  const documentPath = state.document?.source.path ?? '';
  const profile = selectedProfile(config);
  if (!profile) throw new Error('Choose a browser profile for this web capability before running the script.');
  if (!isWebCapabilityAuthorized(
    state.appSettings.webCapabilityAuthorizations,
    documentPath,
    config,
    profile.id,
  )) throw new Error('Review and allow this web capability before running the script.');
  return {
    documentPath,
    profile,
    authorizations: state.appSettings.webCapabilityAuthorizations,
    foreground: false,
    readyChecks: localReadyChecks(config),
  };
}

function localReadyChecks(config: WebCapabilityConfig) {
  const source = config.source;
  if (!source) return config.page.readyChecks;
  const page = state.integrationRegistry.integrations
    .find((integration) => integration.id === source.integrationId)
    ?.pages.find((candidate) => candidate.id === source.pageId);
  return page ? integrationPageReadyChecks(page) : config.page.readyChecks;
}

function button(label: string, primary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `hvy-galaxy-button${primary ? ' primary-button' : ''}`;
  element.textContent = label;
  return element;
}

function commandInputs(args: JsonObject): Record<string, string> {
  const value = (args as Record<string, unknown>).inputs;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function openCommandInputsModal(command: WebCommandCapabilityConfig['command'], onSubmit: (inputs: Record<string, string>) => void): void {
  if (!command.inputs?.length) {
    onSubmit({});
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const form = document.createElement('form');
  form.className = 'dialog';
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  form.setAttribute('aria-label', `Run ${command.name}`);
  const title = document.createElement('h2');
  title.textContent = command.name;
  const note = document.createElement('p');
  note.textContent = 'Enter the values for this run.';
  form.append(title, note);
  for (const definition of command.inputs) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = definition.name;
    const input = definition.id.includes('body') ? document.createElement('textarea') : document.createElement('input');
    input.className = 'hvy-galaxy-input';
    input.name = definition.id;
    if (input instanceof HTMLTextAreaElement) input.rows = 6;
    input.required = definition.required;
    label.append(name, input);
    form.appendChild(label);
  }
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = button('Cancel');
  const run = button('Run', true);
  run.type = 'submit';
  cancel.addEventListener('click', () => backdrop.remove());
  actions.append(cancel, run);
  form.appendChild(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const inputs = Object.fromEntries(command.inputs!.map((definition) => [definition.id, String(new FormData(form).get(definition.id) ?? '')]));
    backdrop.remove();
    onSubmit(inputs);
  });
  backdrop.appendChild(form);
  document.body.appendChild(backdrop);
  form.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus();
}

function selectedProfile(config: WebCapabilityConfig) {
  const path = state.document?.source.path ?? '';
  const profileId = getWebCapabilityProfileBinding(
    state.appSettings.webCapabilityProfileBindings,
    path,
    config.capabilityId,
  );
  return state.integrationRegistry.profiles.find((profile) => profile.id === profileId) ?? null;
}

async function persistProfileBinding(config: WebCapabilityConfig, profileId: string): Promise<void> {
  const path = state.document?.source.path ?? '';
  const settings = {
    ...state.appSettings,
    webCapabilityProfileBindings: setWebCapabilityProfileBinding(
      state.appSettings.webCapabilityProfileBindings,
      path,
      config.capabilityId,
      profileId || null,
    ),
  };
  state.appSettings = settings;
  state.appSettings = await saveAppSettings(settings);
}

function authorizationReason(review: WebCapabilityAuthorizationReview): string {
  if (review.reason === 'profile-changed') return 'You’re seeing this again because a different browser profile is selected.';
  if (review.reason === 'capability-changed') {
    const changes = review.changedCategories.length ? review.changedCategories.join(', ') : 'its executable definition';
    return `You’re seeing this again because the capability changed (${changes}).`;
  }
  if (review.reason === 'authorization-format-changed') return 'You’re seeing this again because the authorization format changed.';
  if (review.reason === 'document-identity-changed') return 'You’re seeing this again because this is a different document or Save As copy.';
  if (review.reason === 'authorization-cleared') return 'You’re seeing this again because the previous authorization was cleared.';
  return 'You’re seeing this because this document has not used this web capability with this browser profile before.';
}

function openAuthorizationModal(config: WebCapabilityConfig, onAuthorized: () => void): void {
  const profile = selectedProfile(config);
  if (!profile || !state.document?.source.path) return;
  const review = reviewWebCapabilityAuthorization(
    state.appSettings.webCapabilityAuthorizations,
    state.document.source.path,
    config,
    profile.id,
  );
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('section');
  dialog.className = 'dialog hvy-web-authorization-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Allow ${config.name}`);
  const title = document.createElement('h2');
  title.textContent = `Allow “${config.name}”?`;
  const reason = document.createElement('p');
  reason.className = 'hvy-web-authorization-reason';
  reason.textContent = authorizationReason(review);
  const details = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Document', state.document.source.name],
    ['Browser profile', profile.name],
    ['Page', config.page.url],
    ['Allowed sites', config.page.allowedOrigins.join(', ')],
    ['Reads', 'record' in config ? config.record.pattern.targets.map((target) => target.label).join(', ') || 'Page structure' : 'No record values'],
    ['Actions', ('record' in config ? config.record.commands : [config.command]).map((command) => `${command.name}${command.inputs?.length ? ` (${command.inputs.map((input) => input.name).join(', ')})` : ''}`).join(', ') || 'None'],
  ];
  for (const [term, description] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    details.append(dt, dd);
  }
  const note = document.createElement('p');
  note.textContent = 'The profile, cookies, extracted values, and browser state stay local and are not written into the HVY document.';
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = button('Cancel');
  const allow = button('Allow capability', true);
  const close = () => backdrop.remove();
  cancel.addEventListener('click', close);
  allow.addEventListener('click', () => {
    const settings = {
      ...state.appSettings,
      webCapabilityAuthorizations: authorizeWebCapabilityRecord(
        state.appSettings.webCapabilityAuthorizations,
        state.document!.source.path,
        config,
        profile.id,
      ),
    };
    state.appSettings = settings;
    close();
    onAuthorized();
    void saveAppSettings(settings).then((saved) => {
      state.appSettings = saved;
    });
  });
  actions.append(cancel, allow);
  dialog.append(title, reason, details, note, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  allow.focus();
}

function buildProfileControls(config: WebCapabilityConfig, refresh: () => void): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-web-profile';
  const label = document.createElement('span');
  label.textContent = 'Browser profile';
  const select = document.createElement('select');
  select.className = 'hvy-galaxy-select';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Choose a profile before running';
  select.appendChild(empty);
  const active = selectedProfile(config)?.id ?? '';
  for (const profile of state.integrationRegistry.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === active;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void persistProfileBinding(config, select.value).then(refresh);
  });
  wrapper.append(label, select);
  return wrapper;
}

function buildDefinitionEditor(ctx: HvyPluginContext, kind: 'records' | 'command'): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-web-definition';
  const label = document.createElement('span');
  label.textContent = kind === 'records' ? 'Web record definition' : 'Web page command';
  const select = document.createElement('select');
  select.className = 'hvy-galaxy-select';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = kind === 'records' ? 'Choose a saved record type' : 'Choose a saved page command';
  const activeConfig = kind === 'records'
    ? readWebRecordsCapabilityConfig(ctx.block.schema.pluginConfig)
    : readWebCommandCapabilityConfig(ctx.block.schema.pluginConfig);
  const activeSource = activeConfig?.source;
  empty.selected = !activeSource;
  select.appendChild(empty);
  for (const integration of state.integrationRegistry.integrations) {
    for (const page of integration.pages) {
      const definitions = kind === 'records'
        ? integration.actions.filter((action) => action.pageIds.includes(page.id) && action.pattern)
        : page.commands ?? [];
      for (const definition of definitions) {
        const option = document.createElement('option');
        option.value = JSON.stringify({ integrationId: integration.id, pageId: page.id, definitionId: definition.id });
        option.textContent = definition.name;
        option.selected = activeSource?.integrationId === integration.id
          && activeSource.pageId === page.id
          && (kind === 'records' ? activeSource.actionId : activeSource.commandId) === definition.id;
        select.appendChild(option);
      }
    }
  }
  select.addEventListener('change', () => {
    if (!select.value) return;
    const choice = JSON.parse(select.value) as { integrationId: string; pageId: string; definitionId: string };
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === choice.integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === choice.pageId);
    if (!integration || !page) return;
    const config = kind === 'records'
      ? createWebRecordsCapabilityConfig(integration.id, page, integration.actions.find((action) => action.id === choice.definitionId)!)
      : createWebCommandCapabilityConfig(integration.id, page, page.commands!.find((command) => command.id === choice.definitionId)!);
    ctx.setConfig(config as unknown as JsonObject);
  });
  wrapper.append(label, select);
  return wrapper;
}

function renderValue(value: unknown): HTMLElement {
  const element = document.createElement('span');
  if (Array.isArray(value)) element.textContent = value.map((item) => String(item ?? '')).join(', ');
  else if (value && typeof value === 'object') element.textContent = JSON.stringify(value);
  else element.textContent = String(value ?? '');
  return element;
}

function comparableName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function defaultFieldMapping(variable: ReusableTemplateVariable, config: WebRecordsCapabilityConfig): string {
  const names = new Set([comparableName(variable.name), comparableName(variable.label)]);
  return config.record.pattern.targets.find((target) => names.has(comparableName(target.label)))?.label ?? '';
}

function defaultActionMapping(location: string, config: WebRecordsCapabilityConfig, locationCount: number): string {
  const comparableLocation = comparableName(location);
  const match = config.record.commands.find((command) => (
    comparableName(command.id) === comparableLocation || comparableName(command.name) === comparableLocation
  ));
  if (match) return match.id;
  return locationCount === 1 && config.record.commands.length === 1 ? config.record.commands[0]!.id : '';
}

function buildRecordTemplateEditor(ctx: HvyPluginContext, config: WebRecordsCapabilityConfig): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-web-template-editor';
  const templateLabel = document.createElement('label');
  templateLabel.className = 'hvy-web-template-field hvy-web-template-selection';
  const templateHeading = document.createElement('span');
  templateHeading.textContent = 'Record template';
  const templateSelect = document.createElement('select');
  templateSelect.className = 'hvy-galaxy-select';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Default record cards';
  templateSelect.appendChild(empty);
  const activeValue = config.render
    ? JSON.stringify({ template: config.render.template, flavor: config.render.flavor ?? '' })
    : '';
  let hasActiveValue = !activeValue;
  for (const template of ctx.templates.components.list()) {
    const choices = [{ template: template.name, flavor: '' }, ...template.flavors.map((flavor) => ({
      template: template.name,
      flavor: flavor.name,
    }))];
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = JSON.stringify(choice);
      option.textContent = choice.flavor ? `${choice.template} — ${choice.flavor}` : choice.template;
      option.selected = option.value === activeValue;
      hasActiveValue ||= option.selected;
      templateSelect.appendChild(option);
    }
  }
  if (!hasActiveValue && config.render) {
    const unavailable = document.createElement('option');
    unavailable.value = activeValue;
    unavailable.textContent = `${config.render.template}${config.render.flavor ? ` — ${config.render.flavor}` : ''} (unavailable)`;
    unavailable.selected = true;
    templateSelect.appendChild(unavailable);
  }
  templateSelect.addEventListener('change', () => {
    if (!templateSelect.value) {
      ctx.setConfig({ render: null });
      return;
    }
    const selection = JSON.parse(templateSelect.value) as { template: string; flavor: string };
    const flavor = selection.flavor || undefined;
    const variables = ctx.templates.components.variables({ template: selection.template, flavor });
    const locations = ctx.templates.components.locations({ template: selection.template, flavor });
    const render: WebRecordsTemplateRendering = {
      template: selection.template,
      ...(flavor ? { flavor } : {}),
      fields: Object.fromEntries(variables.flatMap((variable) => {
        const field = defaultFieldMapping(variable, config);
        return field ? [[variable.name, field]] : [];
      })),
      actions: Object.fromEntries(locations.flatMap((location) => {
        const command = defaultActionMapping(location, config, locations.length);
        return command ? [[location, command]] : [];
      })),
    };
    ctx.setConfig({ render: render as unknown as JsonObject });
  });
  templateLabel.append(templateHeading, templateSelect);
  wrapper.appendChild(templateLabel);

  if (!config.render || !hasActiveValue) return wrapper;
  const selection = { template: config.render.template, flavor: config.render.flavor };
  for (const variable of ctx.templates.components.variables(selection)) {
    const label = document.createElement('label');
    label.className = 'hvy-web-template-field';
    const heading = document.createElement('span');
    heading.textContent = variable.label;
    const select = document.createElement('select');
    select.className = 'hvy-galaxy-select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Leave empty';
    select.appendChild(none);
    for (const target of config.record.pattern.targets) {
      const option = document.createElement('option');
      option.value = target.label;
      option.textContent = target.label;
      option.selected = config.render.fields[variable.name] === target.label;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const fields = { ...config.render!.fields };
      if (select.value) fields[variable.name] = select.value;
      else delete fields[variable.name];
      ctx.setConfig({ render: { ...config.render!, fields } as unknown as JsonObject });
    });
    label.append(heading, select);
    wrapper.appendChild(label);
  }
  for (const location of ctx.templates.components.locations(selection)) {
    const label = document.createElement('label');
    label.className = 'hvy-web-template-field';
    const heading = document.createElement('span');
    heading.textContent = `Action at ${location}`;
    const select = document.createElement('select');
    select.className = 'hvy-galaxy-select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No action';
    select.appendChild(none);
    for (const command of config.record.commands) {
      const option = document.createElement('option');
      option.value = command.id;
      option.textContent = command.name;
      option.selected = config.render.actions[location] === command.id;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const actions = { ...config.render!.actions };
      if (select.value) actions[location] = select.value;
      else delete actions[location];
      ctx.setConfig({ render: { ...config.render!, actions } as unknown as JsonObject });
    });
    label.append(heading, select);
    wrapper.appendChild(label);
  }
  return wrapper;
}

function buildRecordLimitEditor(ctx: HvyPluginContext, config: WebRecordsCapabilityConfig): HTMLElement {
  const label = document.createElement('label');
  label.className = 'hvy-web-record-limit';
  const heading = document.createElement('span');
  heading.textContent = 'Limit';
  const inputHolder = document.createElement('span');
  const input = document.createElement('input');
  input.style = 'height: 1.5rem;';
  input.className = 'hvy-galaxy-input';
  input.type = 'number';
  input.min = '1';
  input.max = String(DEFAULT_WEB_RECORD_LIMIT);
  input.step = '1';
  input.required = true;
  input.value = String(config.record.limit);
  input.addEventListener('change', () => {
    const requested = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : config.record.limit;
    const limit = Math.max(1, Math.min(DEFAULT_WEB_RECORD_LIMIT, Math.floor(requested)));
    input.value = String(limit);
    ctx.setConfig({ record: { ...config.record, limit } as unknown as JsonObject });
  });
  inputHolder.append(input);
  label.append(heading, inputHolder);
  return label;
}

function templateValue(value: unknown, variable: ReusableTemplateVariable): string {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).join(variable.type === 'block' ? '\n' : ', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function recordCandidate(value: unknown): { parent?: unknown; targets?: unknown } {
  return value && typeof value === 'object' ? value as { parent?: unknown; targets?: unknown } : {};
}

export function emptyRecordTemplateReason(block: VisualBlock): string {
  if (block.schema.editorOnly) return 'the selected record template is marked Editor only';
  if (block.schema.hideIfYes.trim().toLowerCase() === 'yes') return 'the selected record template is hidden by its Hide if yes condition';
  return 'the selected record template produced no visible content';
}

function createRecordActionBlock(label: string, componentId: string): VisualBlock {
  return {
    id: crypto.randomUUID(),
    text: '',
    schema: { ...defaultBlockSchema('button'), id: componentId, buttonLabel: label },
    schemaMode: false,
  };
}

export function claimRenderedRecordActionButton(actionButton: HTMLButtonElement): void {
  actionButton.removeAttribute('data-action');
  const actionRoot = actionButton.closest<HTMLElement>('[data-hvy-button="true"]');
  actionRoot?.removeAttribute('data-hvy-button');
  if (actionRoot) actionRoot.dataset.visibleState = 'visible';
}

export function claimRenderedRecordTemplate(element: HTMLElement): void {
  element.querySelectorAll<HTMLElement>('[data-hvy-dynamic-visibility="true"]').forEach((renderedBlock) => {
    renderedBlock.removeAttribute('data-hvy-dynamic-visibility');
    renderedBlock.dataset.visibleState = 'visible';
  });
}

function createRecordsInstance(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-web-capability';
  const resultSessionKey = state.document?.versionId;
  let pending = false;
  let error = '';
  let templatePreviews: HvyPluginComponentTemplateRenderInstance[] = [];
  let subscribedResultKey = '';
  let unsubscribeRecords = () => {};
  const disposeTemplatePreviews = () => {
    templatePreviews.forEach((preview) => preview.unmount());
    templatePreviews = [];
  };
  const subscribeToResults = (resultKey: string) => {
    if (subscribedResultKey === resultKey) return;
    unsubscribeRecords();
    subscribedResultKey = resultKey;
    unsubscribeRecords = resultKey
      ? subscribeWebRecordResults(ctx.rawDocument, resultKey, sync, resultSessionKey)
      : () => {};
  };
  const sync = () => {
    disposeTemplatePreviews();
    const config = readWebRecordsCapabilityConfig(ctx.block.schema.pluginConfig);
    root.replaceChildren();
    if (ctx.mode === 'editor') root.appendChild(buildDefinitionEditor(ctx, 'records'));
    if (!config) {
      subscribeToResults('');
      const empty = document.createElement('p');
      empty.textContent = 'Choose a saved web record definition to make this block interactive.';
      root.appendChild(empty);
      return;
    }
    const resultKey = config.capabilityId;
    subscribeToResults(resultKey);
    const hasFetchedRecords = hasWebRecordResults(ctx.rawDocument, resultKey, resultSessionKey);
    const records = getWebRecordResults(ctx.rawDocument, resultKey, resultSessionKey);
    const heading = document.createElement('strong');
    heading.textContent = config.name;
    if (ctx.mode === 'reader') root.appendChild(heading);
    if (config.description) {
      const description = document.createElement('p');
      description.textContent = config.description;
      root.appendChild(description);
    }
    const profileControls = buildProfileControls(config, sync);
    if (ctx.mode === 'editor') {
      const runtimeControls = document.createElement('div');
      runtimeControls.className = 'hvy-web-runtime-controls';
      runtimeControls.append(profileControls, buildRecordLimitEditor(ctx, config));
      root.append(runtimeControls, buildRecordTemplateEditor(ctx, config));
    } else {
      root.appendChild(profileControls);
    }
    const profile = selectedProfile(config);
    if (profile) {
      const authorized = isWebCapabilityAuthorized(state.appSettings.webCapabilityAuthorizations, state.document?.source.path ?? '', config, profile.id);
      if (!authorized) {
        const review = button('Review and allow');
        review.addEventListener('click', () => openAuthorizationModal(config, sync));
        root.appendChild(review);
      } else {
        const fetch = button(pending ? 'Fetching…' : hasFetchedRecords ? 'Refresh records' : 'Fetch records', true);
        fetch.disabled = pending;
        fetch.addEventListener('click', () => {
          pending = true;
          error = '';
          sync();
          void executeWebRecordsCapability(config, {
            documentPath: state.document?.source.path ?? '',
            profile,
            authorizations: state.appSettings.webCapabilityAuthorizations,
            readyChecks: localReadyChecks(config),
          }).then((result) => {
            setWebRecordResults(ctx.rawDocument, resultKey, result.records, resultSessionKey);
          }).catch((caught: unknown) => {
            error = caught instanceof Error ? caught.message : String(caught);
          }).finally(() => {
            pending = false;
            sync();
          });
        });
        root.appendChild(fetch);
      }
    }
    if (error) {
      const message = document.createElement('p');
      message.className = 'hvy-web-error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      root.appendChild(message);
    }
    const list = document.createElement('div');
    list.className = 'hvy-web-records';
    if (hasFetchedRecords && records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hvy-web-empty';
      empty.textContent = 'The page returned no records.';
      list.appendChild(empty);
    }
    records.forEach((record, index) => {
      const candidate = recordCandidate(record);
      const targets = Array.isArray(candidate.targets) ? candidate.targets : [];
      if (config.render) {
        const selection = { template: config.render.template, flavor: config.render.flavor };
        try {
          const values = Object.fromEntries(ctx.templates.components.variables(selection).map((variable) => {
            const fieldLabel = config.render!.fields[variable.name];
            const target = targets.find((value) => value && typeof value === 'object'
              && String((value as { label?: unknown }).label ?? '') === fieldLabel);
            return [variable.name, templateValue((target as { value?: unknown } | undefined)?.value, variable)];
          }));
          const locations: Record<string, VisualBlock> = {};
          const actionBindings: Array<{ componentId: string; command: WebRecordsCapabilityConfig['record']['commands'][number] }> = [];
          if (typeof candidate.parent === 'string' && profile) {
            for (const [location, commandId] of Object.entries(config.render.actions)) {
              const command = config.record.commands.find((item) => item.id === commandId);
              if (!command) continue;
              const componentId = `web-record-action-${crypto.randomUUID()}`;
              locations[location] = createRecordActionBlock(command.name, componentId);
              actionBindings.push({ componentId, command });
            }
          }
          const preview = ctx.templates.components.render({ ...selection, values, locations });
          claimRenderedRecordTemplate(preview.element);
          if (!preview.element.querySelector('.reader-block')) {
            const message = document.createElement('p');
            message.className = 'hvy-web-error';
            message.setAttribute('role', 'status');
            message.textContent = `Item ${index + 1} is not visible because ${emptyRecordTemplateReason(preview.getBlock())}.`;
            preview.unmount();
            list.appendChild(message);
            return;
          }
          templatePreviews.push(preview);
          for (const binding of actionBindings) {
            const actionButton = preview.element.querySelector<HTMLButtonElement>(
              `[data-component-id="${CSS.escape(binding.componentId)}"] .hvy-button-component-button`,
            );
            if (actionButton) claimRenderedRecordActionButton(actionButton);
            actionButton?.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.stopImmediatePropagation();
              openCommandInputsModal(binding.command, (inputs) => {
                void executeWebRecordCommandCapability(config, binding.command.id, candidate.parent as string, {
                  documentPath: state.document?.source.path ?? '',
                  profile: profile!,
                  authorizations: state.appSettings.webCapabilityAuthorizations,
                  readyChecks: localReadyChecks(config),
                }, inputs).catch((caught: unknown) => {
                  error = caught instanceof Error ? caught.message : String(caught);
                  sync();
                });
              });
            });
          }
          list.appendChild(preview.element);
        } catch (caught: unknown) {
          const message = document.createElement('p');
          message.className = 'hvy-web-error';
          message.setAttribute('role', 'alert');
          message.textContent = `Item ${index + 1}: ${caught instanceof Error ? caught.message : String(caught)}`;
          list.appendChild(message);
        }
        return;
      }
      const article = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = `Item ${index + 1}`;
      article.appendChild(title);
      for (const target of targets) {
        if (!target || typeof target !== 'object') continue;
        const row = document.createElement('div');
        const label = document.createElement('b');
        label.textContent = `${String((target as { label?: unknown }).label ?? 'Value')}: `;
        row.append(label, renderValue((target as { value?: unknown }).value));
        article.appendChild(row);
      }
      if (typeof candidate.parent === 'string' && profile) {
        for (const command of config.record.commands) {
          const run = button(command.name);
          run.addEventListener('click', () => {
            openCommandInputsModal(command, (inputs) => {
              void executeWebRecordCommandCapability(config, command.id, candidate.parent as string, {
                documentPath: state.document?.source.path ?? '',
                profile,
                authorizations: state.appSettings.webCapabilityAuthorizations,
                readyChecks: localReadyChecks(config),
              }, inputs).catch((caught: unknown) => {
                error = caught instanceof Error ? caught.message : String(caught);
                sync();
              });
            });
          });
          article.appendChild(run);
        }
      }
      list.appendChild(article);
    });
    root.appendChild(list);
  };
  sync();
  return {
    element: root,
    refresh: sync,
    unmount: () => {
      unsubscribeRecords();
      disposeTemplatePreviews();
    },
  };
}

function createCommandInstance(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-web-capability';
  let pending = false;
  let error = '';
  const sync = () => {
    const config = readWebCommandCapabilityConfig(ctx.block.schema.pluginConfig);
    root.replaceChildren();
    if (ctx.mode === 'editor') root.appendChild(buildDefinitionEditor(ctx, 'command'));
    if (!config) {
      const empty = document.createElement('p');
      empty.textContent = 'Choose a saved page command to make this block interactive.';
      root.appendChild(empty);
      return;
    }
    const profile = selectedProfile(config);
    const heading = document.createElement('strong');
    heading.textContent = config.name;
    root.append(heading, buildProfileControls(config, sync));
    if (profile) {
      const authorized = isWebCapabilityAuthorized(state.appSettings.webCapabilityAuthorizations, state.document?.source.path ?? '', config, profile.id);
      const run = button(authorized ? (pending ? 'Running…' : config.command.name) : 'Review and allow', true);
      run.disabled = pending;
      run.addEventListener('click', () => {
        if (!authorized) {
          openAuthorizationModal(config, sync);
          return;
        }
        openCommandInputsModal(config.command, (inputs) => {
          pending = true;
          error = '';
          sync();
          void executeWebPageCommandCapability(config, {
            documentPath: state.document?.source.path ?? '',
            profile,
            authorizations: state.appSettings.webCapabilityAuthorizations,
            readyChecks: localReadyChecks(config),
          }, inputs).catch((caught: unknown) => {
            error = caught instanceof Error ? caught.message : String(caught);
          }).finally(() => {
            pending = false;
            sync();
          });
        });
      });
      root.appendChild(run);
    }
    if (error) {
      const message = document.createElement('p');
      message.className = 'hvy-web-error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      root.appendChild(message);
    }
  };
  sync();
  return { element: root, refresh: sync };
}

const metadata = (id: string) => ({ id, version: '0.1.0', hvyApiVersion: '0.1' });

export const webRecordsPlugin: HvyPlugin = {
  ...metadata(WEB_RECORDS_PLUGIN_ID),
  displayName: 'Web Records',
  create: createRecordsInstance,
  scripting: {
    methods: {
      fetch: (args, ctx) => {
        const config = scriptingCapability(
          ctx.rawDocument,
          args.capabilityId,
          (candidate): candidate is WebRecordsCapabilityConfig => 'record' in candidate,
        );
        const callbacks = scriptingCallbacks(args);
        const executionContext = scriptingExecutionContext(config);
        return queueWebCapabilityScriptOperation(
          () => executeWebRecordsCapability(config, executionContext),
          callbacks,
        );
      },
      run_command: (args, ctx) => {
        const config = scriptingCapability(
          ctx.rawDocument,
          args.capabilityId,
          (candidate): candidate is WebRecordsCapabilityConfig => 'record' in candidate,
        );
        const commandId = String(args.commandId ?? '').trim();
        const recordParent = String(args.recordParent ?? '').trim();
        if (!commandId || !recordParent) throw new Error('run_command requires commandId and recordParent.');
        const callbacks = scriptingCallbacks(args);
        const executionContext = scriptingExecutionContext(config);
        return queueWebCapabilityScriptOperation(
          () => executeWebRecordCommandCapability(config, commandId, recordParent, executionContext, commandInputs(args)),
          callbacks,
        );
      },
    },
  },
  aiHint: 'Portable web record capability. Executable selector data is in pluginConfig; browser profiles and results stay app-local.',
};

export const webCommandPlugin: HvyPlugin = {
  ...metadata(WEB_COMMAND_PLUGIN_ID),
  displayName: 'Web Command',
  create: createCommandInstance,
  scripting: {
    methods: {
      run: (args, ctx) => {
        const config = scriptingCapability(
          ctx.rawDocument,
          args.capabilityId,
          (candidate): candidate is WebCommandCapabilityConfig => 'command' in candidate,
        );
        const callbacks = scriptingCallbacks(args);
        const executionContext = scriptingExecutionContext(config);
        return queueWebCapabilityScriptOperation(
          () => executeWebPageCommandCapability(config, executionContext, commandInputs(args)),
          callbacks,
        );
      },
    },
  },
  aiHint: 'Portable web page command. Executable command data is in pluginConfig; browser profiles and authorization stay app-local.',
};
