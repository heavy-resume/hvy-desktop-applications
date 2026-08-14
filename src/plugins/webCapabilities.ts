import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPlugin, HvyPluginContext, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
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
  WEB_COMMAND_PLUGIN_ID,
  WEB_RECORDS_PLUGIN_ID,
  type WebCapabilityConfig,
  type WebCapabilityAuthorizationReview,
  type WebCommandCapabilityConfig,
  type WebRecordsCapabilityConfig,
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
  const documentPath = state.document?.path ?? '';
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
  const path = state.document?.path ?? '';
  const profileId = getWebCapabilityProfileBinding(
    state.appSettings.webCapabilityProfileBindings,
    path,
    config.capabilityId,
  );
  return state.integrationRegistry.profiles.find((profile) => profile.id === profileId) ?? null;
}

async function persistProfileBinding(config: WebCapabilityConfig, profileId: string): Promise<void> {
  const path = state.document?.path ?? '';
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
  if (!profile || !state.document?.path) return;
  const review = reviewWebCapabilityAuthorization(
    state.appSettings.webCapabilityAuthorizations,
    state.document.path,
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
    ['Document', state.document.name],
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
        state.document!.path,
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
  select.appendChild(empty);
  for (const integration of state.integrationRegistry.integrations) {
    for (const page of integration.pages) {
      const definitions = kind === 'records'
        ? integration.actions.filter((action) => action.pageIds.includes(page.id) && action.pattern)
        : page.commands ?? [];
      for (const definition of definitions) {
        const option = document.createElement('option');
        option.value = JSON.stringify({ integrationId: integration.id, pageId: page.id, definitionId: definition.id });
        option.textContent = `${page.name} — ${definition.name}`;
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

function createRecordsInstance(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-web-capability';
  let records: unknown[] = [];
  let pending = false;
  let error = '';
  const sync = () => {
    const config = readWebRecordsCapabilityConfig(ctx.block.schema.pluginConfig);
    root.replaceChildren();
    if (ctx.mode === 'editor') root.appendChild(buildDefinitionEditor(ctx, 'records'));
    if (!config) {
      const empty = document.createElement('p');
      empty.textContent = 'Choose a saved web record definition to make this block interactive.';
      root.appendChild(empty);
      return;
    }
    const heading = document.createElement('strong');
    heading.textContent = config.name;
    const description = document.createElement('p');
    description.textContent = config.description || `Reads ${config.page.name}.`;
    root.append(heading, description, buildProfileControls(config, sync));
    const profile = selectedProfile(config);
    if (profile) {
      const authorized = isWebCapabilityAuthorized(state.appSettings.webCapabilityAuthorizations, state.document?.path ?? '', config, profile.id);
      if (!authorized) {
        const review = button('Review and allow');
        review.addEventListener('click', () => openAuthorizationModal(config, sync));
        root.appendChild(review);
      } else {
        const fetch = button(pending ? 'Fetching…' : 'Fetch records', true);
        fetch.disabled = pending;
        fetch.addEventListener('click', () => {
          pending = true;
          error = '';
          sync();
          void executeWebRecordsCapability(config, {
            documentPath: state.document?.path ?? '',
            profile,
            authorizations: state.appSettings.webCapabilityAuthorizations,
            readyChecks: localReadyChecks(config),
          }).then((result) => {
            records = result.records;
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
    records.forEach((record, index) => {
      const article = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = `Item ${index + 1}`;
      article.appendChild(title);
      const candidate = record && typeof record === 'object' ? record as { parent?: unknown; targets?: unknown } : {};
      const targets = Array.isArray(candidate.targets) ? candidate.targets : [];
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
                documentPath: state.document?.path ?? '',
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
  return { element: root, refresh: sync };
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
      const authorized = isWebCapabilityAuthorized(state.appSettings.webCapabilityAuthorizations, state.document?.path ?? '', config, profile.id);
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
            documentPath: state.document?.path ?? '',
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
