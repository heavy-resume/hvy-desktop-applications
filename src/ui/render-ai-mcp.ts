import { builtInPlugins } from 'virtual:hvy-built-in-plugins';
import type { HvyDocumentSearchMode, SearchFilterMode } from '../../../heavy-file-format/src/search/types';
import { aiEmbeddingDefaultModel, aiEmbeddingProviderPreset, aiEmbeddingProviderPresets, aiEmbeddingProvidersForMode, aiProviderDefaultModel, aiProviderPreset, aiProviderPresets, type AiEmbeddingProviderMode } from '../aiProviders';
import { generateMcpBearerToken, normalizeHomepageSetting, type AiActionConfig, type AiActionKey, type AiActionSettings, type AiProviderConfig, type AiSettings, type AppSettings, type ImageAttachmentMaxDimensions, type McpClientInstallTarget, type McpSettings } from '../backend';
import type { HvyMode } from '../hvy';
import { type AppState } from '../state';
import { normalizeWebCapabilityAuthorizations, normalizeWebCapabilityProfileBindings } from '../webCapabilities';
import { normalizeIntegrationWebMcpApprovals } from '../integrationWebMcp';
import { copyIcon, eyeIcon } from './render-shell';
import { escapeAttr, escapeHtml } from './shared';

export const DEFAULT_AI_MAX_CONTEXT_CHARS = 40_000;

export const AI_MIN_CONTEXT_CHARS = 1_000;

export const AI_MAX_CONTEXT_CHARS = 750_000;

export const AI_CONTEXT_STEP_CHARS = 1_000;

export const DEFAULT_MAX_CONCURRENT_SEMANTIC_FILTERS = 3;

export const MIN_MAX_CONCURRENT_SEMANTIC_FILTERS = 1;

export const MAX_MAX_CONCURRENT_SEMANTIC_FILTERS = 16;

export const DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSION = 1080;

export const MIN_IMAGE_ATTACHMENT_DIMENSION = 1;

export const MAX_IMAGE_ATTACHMENT_DIMENSION = 16_384;

export const DEFAULT_DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024;

export const MIN_DEBUG_LOG_MAX_BYTES = 1024;

export function renderAiSettingsDialog(state: AppState): string {
  if (!state.aiSettingsDialogOpen) {
    return '';
  }
  const settings = state.aiSettingsDraft ?? state.aiSettings;
  const selectedProviderId = state.aiSettingsSelectedProviderId ?? settings.activeProviderId;
  const providerConfig = aiProviderConfig(settings, selectedProviderId);
  const provider = aiProviderPreset(selectedProviderId);
  const maxContextChars = normalizeAiMaxContextChars(settings.maxContextChars);
  const maxConcurrentSemanticFilters = normalizeMaxConcurrentSemanticFilters(settings.maxConcurrentSemanticFilters);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog" data-form="ai-settings">
        <h2>LLM Settings</h2>
        <p class="dialog-note">Configure providers once, then choose the provider and model each action should use.</p>
        <textarea class="hvy-galaxy-textarea" name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <input class="hvy-galaxy-input" name="selectedProviderId" type="hidden" value="${escapeAttr(selectedProviderId)}">
        <div class="ai-provider-picker" aria-label="Configured AI providers">
          <span>Providers</span>
          <div>
            ${aiProviderPresets.map((option) => `
              <button
                type="button"
                class="hvy-galaxy-button ${option.id === selectedProviderId ? 'is-active' : ''}"
                data-action="select-ai-provider"
                data-provider-id="${escapeAttr(option.id)}"
                aria-pressed="${option.id === selectedProviderId ? 'true' : 'false'}"
              >${escapeHtml(option.name)}</button>
            `).join('')}
          </div>
        </div>
        <button type="button" class="hvy-galaxy-button provider-docs-link" data-action="provider-docs" data-provider-docs data-url="${escapeAttr(provider.docsUrl)}">Setup instructions</button>
        <input class="hvy-galaxy-input" name="activeProviderId" type="hidden" value="${escapeAttr(settings.activeProviderId)}">
        <label class="checkbox-row ai-default-provider-row">
          <input class="hvy-galaxy-input"
            name="defaultProvider"
            type="checkbox"
            data-action="set-default-ai-provider"
            ${selectedProviderId === settings.activeProviderId ? 'checked' : ''}
          >
          <span>Use ${escapeHtml(provider.name)} as the default provider</span>
        </label>
        <div class="ai-provider-fields">
          <label>
            <span>Base URL</span>
            <input class="hvy-galaxy-input" name="baseUrl" type="url" value="${escapeAttr(providerConfig.baseUrl)}" placeholder="${escapeAttr(provider.baseUrl || 'http://127.0.0.1:8000/v1')}" required>
          </label>
        </div>
        <label>
          <span>API Key</span>
          <input class="hvy-galaxy-input" name="apiKey" type="password" value="${escapeAttr(providerConfig.apiKey)}" placeholder="${escapeAttr(provider.apiKeyPlaceholder)}">
        </label>
        <label class="ai-range-field">
          <span>Maximum import chunk size</span>
          <input class="hvy-galaxy-input"
            name="maxContextChars"
            data-field="max-context-chars"
            type="range"
            min="${AI_MIN_CONTEXT_CHARS}"
            max="${AI_MAX_CONTEXT_CHARS}"
            step="${AI_CONTEXT_STEP_CHARS}"
            value="${escapeAttr(String(maxContextChars))}"
          >
          <output data-role="max-context-chars-output">${escapeHtml(formatAiMaxContextChars(maxContextChars))}</output>
        </label>
        <label>
          <span>Max concurrent semantic filters</span>
          <input class="hvy-galaxy-input"
            name="maxConcurrentSemanticFilters"
            type="number"
            min="${MIN_MAX_CONCURRENT_SEMANTIC_FILTERS}"
            max="${MAX_MAX_CONCURRENT_SEMANTIC_FILTERS}"
            step="1"
            value="${escapeAttr(String(maxConcurrentSemanticFilters))}"
          >
        </label>
        ${renderEmbeddingSettingsField(settings)}
        <div class="ai-task-grid">
          ${renderActionConfigField('chat', 'Chat / Q&A', settings)}
          ${renderActionConfigField('edit', 'Document and component edit', settings)}
          ${renderActionConfigField('importPlanning', 'Import planning', settings)}
          ${renderActionConfigField('importWriting', 'Import writing', settings)}
          ${renderActionConfigField('importCleanup', 'Import cleanup', settings)}
          ${renderActionConfigField('semanticFilter', 'Semantic search', settings)}
          ${renderActionConfigField('compaction', 'Compaction', settings)}
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-ai-settings">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

export function renderAiSettingsDiscardDialog(state: AppState): string {
  if (!state.aiSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog ai-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="aiSettingsDiscardTitle">
        <h2 id="aiSettingsDiscardTitle">Discard LLM Settings Changes?</h2>
        <p class="dialog-note">Your unsaved provider and model changes will be lost.</p>
        <div class="dialog-actions">
          <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-ai-settings-changes">Discard Changes</button>
          <button class="hvy-galaxy-button" type="button" data-action="keep-editing-ai-settings">Keep Editing</button>
        </div>
      </section>
    </div>`;
}

export function renderMcpSettingsDialog(state: AppState): string {
  if (!state.mcpSettingsDialogOpen) {
    return '';
  }
  const settings = state.mcpSettingsDraft ?? state.mcpSettings;
  const status = state.mcpServerStatus;
  const endpointUrl = status.url ?? mcpConnectionUrl(settings);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog wide-dialog mcp-settings-dialog" data-form="mcp-settings">
        <h2>MCP Settings</h2>
        <p class="dialog-note">Let local AI agents search workspaces and edit HVY files through the low-context HVY CLI surface.</p>
        <textarea class="hvy-galaxy-textarea" name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        <div class="mcp-settings-grid mcp-settings-grid--global">
          <label>
            <span>Write access</span>
            <select class="hvy-galaxy-select" name="writeAccess">
              <option value="searchOnly" ${settings.writeAccess === 'searchOnly' ? 'selected' : ''}>Search only</option>
              <option value="hvyCliEdits" ${settings.writeAccess === 'hvyCliEdits' ? 'selected' : ''}>CLI based editor</option>
              <option value="createImportSave" ${settings.writeAccess === 'createImportSave' ? 'selected' : ''}>Full access</option>
            </select>
          </label>
          <label>
            <span>Web capability access</span>
            <select class="hvy-galaxy-select" name="integrationAccess">
              <option value="off" ${settings.integrationAccess === 'off' ? 'selected' : ''}>Off</option>
              <option value="read" ${settings.integrationAccess === 'read' ? 'selected' : ''}>Read exposed records</option>
              <option value="actions" ${settings.integrationAccess === 'actions' ? 'selected' : ''}>Read and run exposed actions</option>
            </select>
          </label>
        </div>
        <div class="mcp-config-preview">
          <div class="mcp-config-header">
            <span>Connection config</span>
            <div class="segmented-control mcp-transport-tabs" role="tablist" aria-label="MCP transport">
              <button type="button" class="hvy-galaxy-button is-active" data-action="select-mcp-transport" data-transport="stdio" data-transport-tab="stdio" role="tab" aria-selected="true">STDIO</button>
              <button class="hvy-galaxy-button" type="button" data-action="select-mcp-transport" data-transport="http" data-transport-tab="http" role="tab" aria-selected="false">Streamable HTTP</button>
            </div>
          </div>
          <section class="mcp-config-panel" data-transport-panel="stdio">
            <div class="mcp-setup-grid">
              ${renderMcpReadonlyField('Command to launch', state.mcpStdioLaunchConfig.command)}
              ${renderMcpReadonlyField('Command line arguments', formatShellArgs(state.mcpStdioLaunchConfig.args) || '(none)')}
              ${renderMcpReadonlyField('Working directory', state.mcpStdioLaunchConfig.workingDirectory)}
            </div>
            <div class="mcp-install-list">
              ${state.mcpClientInstallStatus.map((client) => {
    const installDisabled = state.busy || !client.configExists || !client.executableExists;
    const removeDisabled = state.busy || !client.configExists || !client.installed;
    const restoreDisabled = state.busy || !client.latestBackupPath;
    const actionLabel = client.installed ? `Refresh ${client.label}` : `Install for ${client.label}`;
    return `
                  <article class="mcp-install-card${client.installed ? ' is-installed' : ''}">
                    <div>
                      <strong>${escapeHtml(client.label)}</strong>
                      <span>${escapeHtml(client.message)}</span>
                      <small>${escapeHtml(client.configPath)}</small>
                      ${client.latestBackupLabel ? `<small>Latest backup: ${escapeHtml(client.latestBackupLabel)}</small>` : ''}
                    </div>
                    <div class="mcp-install-actions">
                      <button class="hvy-galaxy-button" type="button" data-action="install-mcp-client" data-target="${escapeAttr(client.target)}" ${installDisabled ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
                      <button type="button" class="hvy-galaxy-button ghost" data-action="remove-mcp-client" data-target="${escapeAttr(client.target)}" ${removeDisabled ? 'disabled' : ''}>Remove</button>
                      <button type="button" class="hvy-galaxy-button ghost" data-action="restore-mcp-client-backup" data-target="${escapeAttr(client.target)}" ${restoreDisabled ? 'disabled' : ''}>Restore Latest</button>
                    </div>
                  </article>`;
  }).join('')}
            </div>
          </section>
          <section class="mcp-config-panel" data-transport-panel="http" hidden>
            <div class="mcp-status-card" data-state="${status.running ? 'running' : 'stopped'}">
              <div>
                <strong>${status.running ? 'Running' : 'Stopped'}</strong>
                <span>${escapeHtml(status.message)}</span>
                ${renderMcpReadonlyField('URL', endpointUrl, 'mcp-url', 'copy-mcp-url', status.running ? 'true' : 'false')}
                ${status.lastError ? `<small>${escapeHtml(status.lastError)}</small>` : ''}
              </div>
              <div class="mcp-status-actions">
                <button class="hvy-galaxy-button" type="button" data-action="start-mcp-server" ${status.running || state.busy ? 'disabled' : ''}>Start</button>
                <button class="hvy-galaxy-button" type="button" data-action="stop-mcp-server" ${!status.running || state.busy ? 'disabled' : ''}>Stop</button>
                <button class="hvy-galaxy-button" type="button" data-action="restart-mcp-server" ${state.busy ? 'disabled' : ''}>Restart</button>
              </div>
            </div>
            <label class="checkbox-row">
              <input class="hvy-galaxy-input" name="startAutomatically" type="checkbox" ${settings.startAutomatically ? 'checked' : ''}>
              <span>Start automatically with HVY Galaxy</span>
            </label>
            <div class="mcp-settings-grid">
              <label>
                <span>Port</span>
                <input class="hvy-galaxy-input" name="port" data-field="mcp-port" type="number" min="1" max="65535" step="1" value="${escapeAttr(String(settings.port ?? 8794))}">
              </label>
              <label class="mcp-token-field">
                <span>Bearer token</span>
                <div class="mcp-token-control">
                  <input class="hvy-galaxy-input" name="bearerToken" data-field="mcp-token" type="password" value="${escapeAttr(settings.bearerToken)}" autocomplete="off" spellcheck="false">
                  <button type="button" class="hvy-galaxy-button icon-button" data-action="toggle-mcp-token" title="Show bearer token" aria-label="Show bearer token">${eyeIcon()}</button>
                  <button type="button" class="hvy-galaxy-button icon-button" data-action="copy-mcp-token" title="Copy bearer token" aria-label="Copy bearer token">${copyIcon()}</button>
                  <button class="hvy-galaxy-button" type="button" data-action="generate-mcp-token">Generate</button>
                </div>
              </label>
            </div>
            <div class="mcp-setup-grid">
              ${renderMcpReadonlyField('Connection URL', endpointUrl, 'mcp-http-url')}
            </div>
          </section>
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-mcp-settings">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

export function renderMcpReadonlyField(
  label: string,
  value: string,
  role?: string,
  copyAction = 'copy-mcp-value',
  running?: string,
): string {
  return `
    <div class="mcp-copy-field" data-copy-label="${escapeAttr(label)}">
      <span>${escapeHtml(label)}</span>
      <span class="mcp-copy-control">
        <input class="hvy-galaxy-input"
          type="text"
          readonly
          aria-label="${escapeAttr(label)}"
          value="${escapeAttr(value)}"
          ${role ? `data-role="${escapeAttr(role)}"` : ''}
          ${running ? `data-running="${escapeAttr(running)}"` : ''}
          spellcheck="false"
        >
        <button type="button" class="hvy-galaxy-button icon-button" data-action="${escapeAttr(copyAction)}" title="Copy ${escapeAttr(label)}" aria-label="Copy ${escapeAttr(label)}">${copyIcon()}</button>
      </span>
    </div>`;
}

export function renderMcpSettingsDiscardDialog(state: AppState): string {
  if (!state.mcpSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog mcp-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="mcpSettingsDiscardTitle">
        <h2 id="mcpSettingsDiscardTitle">Discard MCP Settings Changes?</h2>
        <p class="dialog-note">Your unsaved MCP server changes will be lost.</p>
        <div class="dialog-actions">
          <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-mcp-settings-changes">Discard Changes</button>
          <button class="hvy-galaxy-button" type="button" data-action="keep-editing-mcp-settings">Keep Editing</button>
        </div>
      </section>
    </div>`;
}

export function readMcpSettingsForm(data: FormData): McpSettings {
  const parsed = parseMcpSettings(String(data.get('settingsJson') ?? ''));
  const portValue = Number(data.get('port') ?? '');
  const writeAccess = data.get('writeAccess');
  const integrationAccess = data.get('integrationAccess');
  const bearerToken = String(data.get('bearerToken') ?? '').trim();
  return {
    ...(parsed ?? {
      startAutomatically: false,
      port: 8794,
      writeAccess: 'hvyCliEdits',
      integrationAccess: 'off',
      bearerToken: generateMcpBearerToken(),
    }),
    startAutomatically: data.get('startAutomatically') === 'on',
    port: Number.isInteger(portValue) && portValue > 0 && portValue <= 65535 ? portValue : 8794,
    writeAccess: isMcpWriteAccess(writeAccess) ? writeAccess : 'hvyCliEdits',
    integrationAccess: isMcpIntegrationAccess(integrationAccess) ? integrationAccess : 'off',
    bearerToken,
  };
}

export function parseMcpSettings(value: string): McpSettings | null {
  try {
    const parsed = JSON.parse(value) as McpSettings;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function isMcpWriteAccess(value: FormDataEntryValue | null): value is McpSettings['writeAccess'] {
  return value === 'searchOnly' || value === 'hvyCliEdits' || value === 'createImportSave';
}

export function isMcpIntegrationAccess(value: FormDataEntryValue | null): value is McpSettings['integrationAccess'] {
  return value === 'off' || value === 'read' || value === 'actions';
}

export function isMcpClientInstallTarget(value: string | undefined): value is McpClientInstallTarget {
  return value === 'codex' || value === 'claude';
}

export function updateMcpConnectionPreview(form: HTMLFormElement): void {
  const settings = readMcpSettingsForm(new FormData(form));
  const nextUrl = mcpConnectionUrl(settings);
  const httpUrl = form.querySelector<HTMLInputElement>('[data-role="mcp-http-url"]');
  if (httpUrl) httpUrl.value = nextUrl;
}

export function updateMcpUrlPreview(form: HTMLFormElement): void {
  const url = form.querySelector<HTMLInputElement>('[data-role="mcp-url"]');
  if (!url || url.dataset.running === 'true') return;
  url.value = mcpConnectionUrl(readMcpSettingsForm(new FormData(form)));
}

export function formatShellArgs(args: string[]): string {
  return args.map(shellQuoteArg).join(' ');
}

export function shellQuoteArg(arg: string): string {
  if (arg.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function mcpConnectionUrl(settings: McpSettings): string {
  return `http://127.0.0.1:${settings.port ?? 8794}/mcp`;
}

export function renderActionConfigField(action: AiActionKey, label: string, settings: AiSettings): string {
  const config = settings.actions[action];
  const effectiveProviderId = config.providerId && config.providerId !== 'default' ? config.providerId : settings.activeProviderId;
  const provider = aiProviderPreset(effectiveProviderId);
  const model = aiActionModelForProvider(config, effectiveProviderId, action);
  const modelsByProvider = aiActionModelsByProvider(config, effectiveProviderId, model);
  return `
    <fieldset class="ai-action-config">
      <legend>${escapeHtml(label)}</legend>
      <textarea class="hvy-galaxy-textarea" name="${action}ModelsByProvider" hidden>${escapeHtml(JSON.stringify(modelsByProvider))}</textarea>
      <label>
        <span>Provider</span>
        <select class="hvy-galaxy-select" name="${action}ProviderId" data-field="ai-action-provider" data-action-key="${escapeAttr(action)}" data-effective-provider-id="${escapeAttr(effectiveProviderId)}">
          <option value="default" ${config.providerId === 'default' ? 'selected' : ''}>Default (${escapeHtml(provider.name)})</option>
          ${aiProviderPresets.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === config.providerId ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Model</span>
        <input class="hvy-galaxy-input" name="${action}Model" type="text" value="${escapeAttr(model)}" placeholder="${escapeAttr(provider.modelPlaceholder)}" autocomplete="off" spellcheck="false">
      </label>
    </fieldset>`;
}

export function renderEmbeddingSettingsField(settings: AiSettings): string {
  const config = settings.embeddings;
  const effectiveProviderId = aiEmbeddingProviderPresets.some((preset) => preset.id === config.providerId)
    ? config.providerId
    : 'openai';
  const embeddingProvider = aiEmbeddingProviderPreset(effectiveProviderId);
  const mode = embeddingProvider.mode;
  const provider = aiProviderPreset(effectiveProviderId);
  const model = config.modelsByProvider?.[effectiveProviderId]?.trim() || config.model || aiEmbeddingDefaultModel(effectiveProviderId);
  const modelsByProvider = { ...(config.modelsByProvider ?? {}), [effectiveProviderId]: model };
  const presetModelIds = new Set(embeddingProvider.models.map((option) => option.id));
  const isCustomModel = !presetModelIds.has(model);
  const showCustomDimensions = isCustomModel || config.dimensions !== null && config.dimensions !== undefined;
  const providerOptions = aiEmbeddingProvidersForMode(mode);
  const controls = config.enabled ? `
      <div class="ai-embedding-mode">
        <span>Mode</span>
        <div class="segmented-control" role="group" aria-label="Embedding mode">
          ${(['cloud', 'local'] as const).map((option) => `
            <button
              type="button"
              class="hvy-galaxy-button ${option === mode ? 'is-active' : ''}"
              data-action="select-embedding-mode"
              data-embedding-mode="${escapeAttr(option)}"
              aria-pressed="${option === mode ? 'true' : 'false'}"
            >${option === 'cloud' ? 'Cloud' : 'Local'}</button>
          `).join('')}
        </div>
      </div>
      <label>
        <span>Provider</span>
        <select class="hvy-galaxy-select" name="embeddingProviderId" data-field="ai-embedding-provider" data-effective-provider-id="${escapeAttr(effectiveProviderId)}">
          ${providerOptions.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === effectiveProviderId ? 'selected' : ''}>${escapeHtml(aiProviderPreset(option.id).name)}</option>`).join('')}
        </select>
      </label>
      <p class="ai-embedding-warning${effectiveProviderId === 'openai' ? ' is-hidden' : ''}">Untested</p>
      <label>
        <span>Model</span>
        <select class="hvy-galaxy-select" name="embeddingModelPreset" data-field="ai-embedding-model-preset">
          ${embeddingProvider.models.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === model ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          <option value="custom" ${isCustomModel ? 'selected' : ''}>Custom</option>
        </select>
      </label>
      <label class="ai-embedding-custom-model${isCustomModel ? '' : ' is-hidden'}">
        <span>Custom model</span>
        <input class="hvy-galaxy-input" name="embeddingModel" type="text" value="${escapeAttr(isCustomModel ? model : '')}" placeholder="${escapeAttr(embeddingProvider.modelPlaceholder || provider.modelPlaceholder)}" autocomplete="off" spellcheck="false">
      </label>
      <details class="ai-embedding-advanced">
        <summary>Advanced</summary>
        ${showCustomDimensions ? `
          <label>
            <span>Custom dimensions</span>
            <input class="hvy-galaxy-input" name="embeddingDimensions" type="number" min="1" step="1" value="${escapeAttr(config.dimensions ? String(config.dimensions) : '')}" placeholder="model default">
          </label>
        ` : ''}
        <label>
          <span>Batch size</span>
          <input class="hvy-galaxy-input" name="embeddingBatchSize" type="number" min="1" max="256" step="1" value="${escapeAttr(String(config.batchSize || 8))}">
        </label>
      </details>
  ` : '';
  return `
    <fieldset class="ai-action-config ai-embedding-config">
      <legend>Embeddings</legend>
      <textarea class="hvy-galaxy-textarea" name="embeddingModelsByProvider" hidden>${escapeHtml(JSON.stringify(modelsByProvider))}</textarea>
      <label class="checkbox-row">
        <input class="hvy-galaxy-input" name="embeddingsEnabled" data-field="embeddings-enabled" type="checkbox" ${config.enabled ? 'checked' : ''}>
        <span>Use embeddings</span>
      </label>
      ${controls}
    </fieldset>`;
}

export function readAppSettingsForm(data: FormData, currentPath = ''): AppSettings {
  const parsedSettings = parseAppSettings(String(data.get('settingsJson') ?? ''));
  const visiblePluginPolicies = Object.fromEntries(
    [...data.entries()]
      .filter(([key, value]) => key.startsWith('pluginPolicy:') && ['disabled', 'enabled', 'conditional'].includes(String(value)))
      .map(([key, value]) => [key.slice('pluginPolicy:'.length), String(value) as 'disabled' | 'enabled' | 'conditional'])
  );
  const pluginPolicies = { ...parsedSettings.pluginPolicies };
  for (const [key, policy] of Object.entries(visiblePluginPolicies)) {
    if (builtInPlugins.some((plugin) => plugin.id === key)
      && policy === 'enabled'
      && !(key in parsedSettings.pluginPolicies)) {
      continue;
    }
    pluginPolicies[key] = policy;
  }
  const visiblePluginKeys = new Set(Object.keys(visiblePluginPolicies));
  const acceptedForCurrentFile = [...data.keys()]
    .filter((key) => key.startsWith('pluginAccepted:'))
    .map((key) => key.slice('pluginAccepted:'.length));
  const existingAcceptances = parsedSettings.pluginAcceptances[currentPath] ?? [];
  const nextCurrentAcceptances = [
    ...existingAcceptances.filter((key) => !visiblePluginKeys.has(key)),
    ...acceptedForCurrentFile,
  ];
  const pluginAcceptances = currentPath && visiblePluginKeys.size > 0
    ? {
      ...parsedSettings.pluginAcceptances,
      ...(nextCurrentAcceptances.length > 0 || currentPath in parsedSettings.pluginAcceptances
        ? { [currentPath]: nextCurrentAcceptances }
        : {}),
    }
    : parsedSettings.pluginAcceptances;
  const homepageSelection = String(data.get('homepageSelection') ?? '');
  const homepage = homepageSelection.startsWith('included:')
    ? normalizeHomepageSetting({ kind: 'included', id: homepageSelection.slice('included:'.length) })
    : homepageSelection === 'file'
      ? normalizeHomepageSetting({ kind: 'file', path: String(data.get('homepagePath') ?? '') })
      : homepageSelection === 'none'
        ? { kind: 'none' as const }
        : parsedSettings.homepage;
  return {
    ...parsedSettings,
    homepage,
    imageAttachmentMaxDimensions: data.has('imageAttachmentMaxWidth') || data.has('imageAttachmentMaxHeight')
      ? normalizeImageAttachmentMaxDimensions({
        width: data.get('imageAttachmentMaxWidth'),
        height: data.get('imageAttachmentMaxHeight'),
      })
      : parsedSettings.imageAttachmentMaxDimensions,
    debugSemanticSearch: data.has('debugSemanticSearch') || data.has('debugLogMaxMegabytes')
      ? data.get('debugSemanticSearch') === 'on'
      : parsedSettings.debugSemanticSearch,
    debugLogMaxBytes: data.has('debugLogMaxMegabytes')
      ? normalizeDebugLogMaxBytes(Number(data.get('debugLogMaxMegabytes')) * 1024 * 1024)
      : parsedSettings.debugLogMaxBytes,
    pluginPolicies,
    pluginAcceptances,
  };
}

export function readDebugLogSettingsControls(root: HTMLElement, current: AppSettings): AppSettings {
  const debugSemanticSearch = root.querySelector<HTMLInputElement>('input[name="debugSemanticSearch"]');
  const debugLogMaxMegabytes = root.querySelector<HTMLInputElement>('input[name="debugLogMaxMegabytes"]');
  return {
    ...current,
    debugSemanticSearch: debugSemanticSearch?.checked === true,
    debugLogMaxBytes: normalizeDebugLogMaxBytes(Number(debugLogMaxMegabytes?.value) * 1024 * 1024),
  };
}

export function parseAppSettings(value: string): AppSettings {
  try {
    const parsed = JSON.parse(value) as Partial<AppSettings>;
    return {
      homepage: normalizeHomepageSetting(parsed.homepage),
      imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(parsed.imageAttachmentMaxDimensions),
      powerScriptingAllowedFiles: Array.isArray(parsed.powerScriptingAllowedFiles)
        ? parsed.powerScriptingAllowedFiles.filter((path): path is string => typeof path === 'string')
        : [],
      powerScriptAcceptances: parsed.powerScriptAcceptances && typeof parsed.powerScriptAcceptances === 'object'
        ? parsed.powerScriptAcceptances
        : {},
      powerScriptAcceptanceScripts: parsed.powerScriptAcceptanceScripts && typeof parsed.powerScriptAcceptanceScripts === 'object'
        ? parsed.powerScriptAcceptanceScripts
        : {},
      debugSemanticSearch: parsed.debugSemanticSearch === true,
      debugLogMaxBytes: normalizeDebugLogMaxBytes(parsed.debugLogMaxBytes),
      pluginPolicies: parsed.pluginPolicies && typeof parsed.pluginPolicies === 'object' ? parsed.pluginPolicies : {},
      pluginAcceptances: parsed.pluginAcceptances && typeof parsed.pluginAcceptances === 'object' ? parsed.pluginAcceptances : {},
      webCapabilityProfileBindings: normalizeWebCapabilityProfileBindings(parsed.webCapabilityProfileBindings),
      webCapabilityAuthorizations: normalizeWebCapabilityAuthorizations(parsed.webCapabilityAuthorizations),
      integrationWebMcpApprovals: normalizeIntegrationWebMcpApprovals(parsed.integrationWebMcpApprovals),
    };
  } catch {
    return {
      homepage: { kind: 'included', id: 'hvy-galaxy-guide' },
      imageAttachmentMaxDimensions: normalizeImageAttachmentMaxDimensions(null),
      powerScriptingAllowedFiles: [],
      powerScriptAcceptances: {},
      powerScriptAcceptanceScripts: {},
      debugSemanticSearch: false,
      debugLogMaxBytes: DEFAULT_DEBUG_LOG_MAX_BYTES,
      pluginPolicies: {},
      pluginAcceptances: {},
      webCapabilityProfileBindings: {},
      webCapabilityAuthorizations: {},
      integrationWebMcpApprovals: {},
    };
  }
}

export function readAiSettingsForm(data: FormData): AiSettings {
  const selectedProviderId = String(data.get('selectedProviderId') ?? data.get('activeProviderId') ?? '').trim() || 'openai';
  const parsed = parseAiSettings(String(data.get('settingsJson') ?? ''));
  const activeProviderId = data.get('defaultProvider') === 'on'
    ? selectedProviderId
    : String(data.get('activeProviderId') ?? parsed?.activeProviderId ?? selectedProviderId).trim() || selectedProviderId;
  const current: AiProviderConfig = {
    provider: selectedProviderId,
    baseUrl: String(data.get('baseUrl') ?? '').trim(),
    apiKey: String(data.get('apiKey') ?? '').trim(),
  };
  const settings = parsed ?? {
    activeProviderId,
    providers: [],
    actions: readActionSettings(data, activeProviderId),
  };
  const providers = [...settings.providers.filter((provider) => provider.provider !== selectedProviderId), current];
  return {
    activeProviderId,
    providers,
    actions: readActionSettings(data, activeProviderId),
    embeddings: readEmbeddingSettings(data, parsed, activeProviderId),
    maxContextChars: normalizeAiMaxContextChars(data.get('maxContextChars')),
    maxConcurrentSemanticFilters: normalizeMaxConcurrentSemanticFilters(data.get('maxConcurrentSemanticFilters')),
  };
}

export function readEmbeddingSettings(data: FormData, parsed: AiSettings | null, fallbackProviderId: string): AiSettings['embeddings'] {
  const parsedProviderId = parsed?.embeddings?.providerId ?? fallbackProviderId;
  const providerInput = String(data.get('embeddingProviderId') ?? parsedProviderId).trim() || parsedProviderId;
  const providerId = aiEmbeddingProviderPresets.some((preset) => preset.id === providerInput) ? providerInput : 'openai';
  const modelsByProvider = parseAiActionModelsByProvider(String(data.get('embeddingModelsByProvider') ?? ''));
  const modelPreset = String(data.get('embeddingModelPreset') ?? '').trim();
  const modelInput = modelPreset && modelPreset !== 'custom'
    ? modelPreset
    : String(data.get('embeddingModel') ?? '').trim();
  const model = modelInput || modelsByProvider[providerId] || aiEmbeddingDefaultModel(providerId);
  modelsByProvider[providerId] = model;
  return {
    enabled: data.get('embeddingsEnabled') === 'on',
    providerId,
    model,
    modelsByProvider,
    dimensions: normalizeEmbeddingDimensions(data.get('embeddingDimensions')),
    batchSize: normalizeEmbeddingBatchSize(data.get('embeddingBatchSize')),
  };
}

export function parseAiSettings(value: string): AiSettings | null {
  try {
    const parsed = JSON.parse(value) as AiSettings;
    return Array.isArray(parsed.providers) && parsed.actions
      ? normalizeAiSettingsForForm(parsed)
      : null;
  } catch {
    return null;
  }
}

export function readActionSettings(data: FormData, fallbackProviderId: string): AiActionSettings {
  return {
    chat: readActionConfig(data, 'chat', fallbackProviderId),
    edit: readActionConfig(data, 'edit', fallbackProviderId),
    importPlanning: readActionConfig(data, 'importPlanning', fallbackProviderId),
    importWriting: readActionConfig(data, 'importWriting', fallbackProviderId),
    importCleanup: readActionConfig(data, 'importCleanup', fallbackProviderId),
    semanticFilter: readActionConfig(data, 'semanticFilter', fallbackProviderId),
    compaction: readActionConfig(data, 'compaction', fallbackProviderId),
  };
}

export function readActionConfig(data: FormData, action: AiActionKey, fallbackProviderId: string) {
  const providerId = String(data.get(`${action}ProviderId`) ?? fallbackProviderId).trim() || fallbackProviderId;
  const effectiveProviderId = providerId === 'default' ? fallbackProviderId : providerId;
  const modelsByProvider = parseAiActionModelsByProvider(String(data.get(`${action}ModelsByProvider`) ?? ''));
  const previousDefaultProviderId = String(data.get('activeProviderId') ?? '').trim();
  const modelInput = String(data.get(`${action}Model`) ?? '').trim();
  if (providerId === 'default' && previousDefaultProviderId && previousDefaultProviderId !== fallbackProviderId && modelInput) {
    modelsByProvider[previousDefaultProviderId] = modelInput;
  }
  const model = providerId === 'default' && previousDefaultProviderId && previousDefaultProviderId !== fallbackProviderId
    ? modelsByProvider[effectiveProviderId] || aiProviderDefaultModel(effectiveProviderId, action)
    : modelInput || aiProviderDefaultModel(effectiveProviderId, action);
  modelsByProvider[effectiveProviderId] = model;
  return {
    providerId,
    model,
    modelsByProvider,
  };
}

export function normalizeAiSettingsForForm(settings: AiSettings): AiSettings {
  const activeProviderId = settings.activeProviderId || 'openai';
  return {
    ...settings,
    activeProviderId,
    maxContextChars: normalizeAiMaxContextChars(settings.maxContextChars),
    maxConcurrentSemanticFilters: normalizeMaxConcurrentSemanticFilters(
      settings.maxConcurrentSemanticFilters ?? (settings as Partial<AiSettings> & { workspaceFilterFileConcurrency?: number }).workspaceFilterFileConcurrency
    ),
    actions: {
      chat: normalizeAiActionConfigForForm(settings.actions.chat, activeProviderId, 'chat'),
      edit: normalizeAiActionConfigForForm(settings.actions.edit, activeProviderId, 'edit'),
      importPlanning: normalizeAiActionConfigForForm(settings.actions.importPlanning, activeProviderId, 'importPlanning'),
      importWriting: normalizeAiActionConfigForForm(settings.actions.importWriting, activeProviderId, 'importWriting'),
      importCleanup: normalizeAiActionConfigForForm(settings.actions.importCleanup, activeProviderId, 'importCleanup'),
      semanticFilter: normalizeAiActionConfigForForm(settings.actions.semanticFilter, activeProviderId, 'semanticFilter'),
      compaction: normalizeAiActionConfigForForm(settings.actions.compaction, activeProviderId, 'compaction'),
    },
    embeddings: normalizeEmbeddingSettingsForForm(settings.embeddings, activeProviderId),
  };
}

export function normalizeEmbeddingSettingsForForm(settings: AiSettings['embeddings'] | undefined, activeProviderId: string): AiSettings['embeddings'] {
  const requestedProviderId = settings?.providerId?.trim() || activeProviderId || 'openai';
  const providerId = aiEmbeddingProviderPresets.some((preset) => preset.id === requestedProviderId) ? requestedProviderId : 'openai';
  const model = settings?.model?.trim() || settings?.modelsByProvider?.[providerId]?.trim() || aiEmbeddingDefaultModel(providerId);
  return {
    enabled: settings?.enabled === true,
    providerId,
    model,
    modelsByProvider: {
      ...(settings?.modelsByProvider ?? {}),
      [providerId]: model,
      openai: settings?.modelsByProvider?.openai?.trim() || aiEmbeddingDefaultModel('openai'),
    },
    dimensions: normalizeEmbeddingDimensions(settings?.dimensions),
    batchSize: normalizeEmbeddingBatchSize(settings?.batchSize),
  };
}

export function normalizeAiActionConfigForForm(config: AiActionConfig | undefined, activeProviderId: string, action: AiActionKey): AiActionConfig {
  const providerId = config?.providerId?.trim() || 'default';
  const effectiveProviderId = providerId === 'default' ? activeProviderId : providerId;
  const model = config?.model?.trim() || aiProviderDefaultModel(effectiveProviderId, action);
  return {
    providerId,
    model,
    modelsByProvider: aiActionModelsByProvider(config, effectiveProviderId, model),
  };
}

export function aiActionModelsByProvider(config: AiActionConfig | undefined, effectiveProviderId: string, model: string): Record<string, string> {
  const modelsByProvider = { ...(config?.modelsByProvider ?? {}) };
  modelsByProvider[effectiveProviderId] = model;
  return modelsByProvider;
}

export function aiActionModelForProvider(config: AiActionConfig, providerId: string, action: AiActionKey): string {
  return config.modelsByProvider?.[providerId]?.trim() || aiProviderDefaultModel(providerId, action);
}

export function parseAiActionModelsByProvider(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([providerId, model]) => [providerId.trim(), String(model).trim()])
        .filter(([providerId, model]) => providerId && model)
    );
  } catch {
    return {};
  }
}

export function syncAiActionModelForProvider(select: HTMLSelectElement): void {
  const form = select.closest<HTMLFormElement>('form[data-form="ai-settings"]');
  const fieldset = select.closest<HTMLFieldSetElement>('.ai-action-config');
  const action = select.dataset.actionKey as AiActionKey | undefined;
  const modelInput = fieldset?.querySelector<HTMLInputElement>('input[name$="Model"]');
  const modelsInput = fieldset?.querySelector<HTMLTextAreaElement>('textarea[name$="ModelsByProvider"]');
  if (!form || !fieldset || !action || !modelInput || !modelsInput) return;
  const activeProviderId = String(new FormData(form).get('activeProviderId') ?? '').trim() || 'openai';
  const providerId = select.value === 'default' ? activeProviderId : select.value;
  const modelsByProvider = parseAiActionModelsByProvider(modelsInput.value);
  const previousProviderId = select.dataset.effectiveProviderId || activeProviderId;
  const previousModel = modelInput.value.trim();
  if (previousProviderId && previousModel) {
    modelsByProvider[previousProviderId] = previousModel;
  }
  const provider = aiProviderPreset(providerId);
  modelInput.value = modelsByProvider[providerId] || aiProviderDefaultModel(providerId, action);
  modelInput.placeholder = provider.modelPlaceholder;
  select.dataset.effectiveProviderId = providerId;
  modelsInput.value = JSON.stringify(modelsByProvider);
}

export function syncAiEmbeddingModelForProvider(select: HTMLSelectElement): void {
  const form = select.closest<HTMLFormElement>('form[data-form="ai-settings"]');
  const fieldset = select.closest<HTMLFieldSetElement>('.ai-embedding-config');
  const modelSelect = fieldset?.querySelector<HTMLSelectElement>('select[name="embeddingModelPreset"]');
  const modelInput = fieldset?.querySelector<HTMLInputElement>('input[name="embeddingModel"]');
  const modelsInput = fieldset?.querySelector<HTMLTextAreaElement>('textarea[name="embeddingModelsByProvider"]');
  const dimensionsInput = fieldset?.querySelector<HTMLInputElement>('input[name="embeddingDimensions"]');
  if (!form || !fieldset || !modelSelect || !modelInput || !modelsInput) return;
  const modelsByProvider = parseAiActionModelsByProvider(modelsInput.value);
  const previousProviderId = select.dataset.effectiveProviderId || 'openai';
  const previousModel = selectedEmbeddingModel(modelSelect, modelInput);
  if (previousProviderId && previousModel) {
    modelsByProvider[previousProviderId] = previousModel;
  }
  const providerId = select.value;
  const provider = aiEmbeddingProviderPreset(providerId);
  const model = modelsByProvider[providerId] || aiEmbeddingDefaultModel(providerId);
  modelSelect.innerHTML = [
    ...provider.models.map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}</option>`),
    '<option value="custom">Custom</option>',
  ].join('');
  if (provider.models.some((option) => option.id === model)) {
    modelSelect.value = model;
    modelInput.value = '';
  } else {
    modelSelect.value = 'custom';
    modelInput.value = model;
  }
  modelInput.placeholder = provider.modelPlaceholder;
  modelInput.closest('label')?.classList.toggle('is-hidden', modelSelect.value !== 'custom');
  fieldset.querySelector<HTMLElement>('.ai-embedding-warning')?.classList.toggle('is-hidden', providerId === 'openai');
  if (dimensionsInput) dimensionsInput.value = '';
  select.dataset.effectiveProviderId = providerId;
  modelsInput.value = JSON.stringify(modelsByProvider);
}

export function syncAiEmbeddingCustomModelInput(select: HTMLSelectElement): void {
  const fieldset = select.closest<HTMLFieldSetElement>('.ai-embedding-config');
  const providerSelect = fieldset?.querySelector<HTMLSelectElement>('select[name="embeddingProviderId"]');
  const modelInput = fieldset?.querySelector<HTMLInputElement>('input[name="embeddingModel"]');
  const modelsInput = fieldset?.querySelector<HTMLTextAreaElement>('textarea[name="embeddingModelsByProvider"]');
  if (!fieldset || !providerSelect || !modelInput || !modelsInput) return;
  const provider = aiEmbeddingProviderPreset(providerSelect.value);
  const isCustom = select.value === 'custom';
  modelInput.closest('label')?.classList.toggle('is-hidden', !isCustom);
  if (isCustom) {
    modelInput.placeholder = provider.modelPlaceholder;
    modelInput.focus();
  } else {
    modelInput.value = '';
    const modelsByProvider = parseAiActionModelsByProvider(modelsInput.value);
    modelsByProvider[providerSelect.value] = select.value;
    modelsInput.value = JSON.stringify(modelsByProvider);
  }
}

export function selectedEmbeddingModel(modelSelect: HTMLSelectElement, modelInput: HTMLInputElement): string {
  return modelSelect.value === 'custom' ? modelInput.value.trim() : modelSelect.value.trim();
}

export function isAiEmbeddingProviderMode(value: unknown): value is AiEmbeddingProviderMode {
  return value === 'cloud' || value === 'local';
}

export function normalizeAiMaxContextChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_MAX_CONTEXT_CHARS;
  const stepped = Math.round(parsed / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
  return Math.min(AI_MAX_CONTEXT_CHARS, Math.max(AI_MIN_CONTEXT_CHARS, stepped));
}

export function normalizeMaxConcurrentSemanticFilters(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CONCURRENT_SEMANTIC_FILTERS;
  return Math.min(MAX_MAX_CONCURRENT_SEMANTIC_FILTERS, Math.max(MIN_MAX_CONCURRENT_SEMANTIC_FILTERS, Math.round(parsed)));
}

export function normalizeEmbeddingDimensions(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

export function normalizeEmbeddingBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8;
  return Math.min(256, Math.max(1, Math.floor(parsed)));
}

export function normalizeImageAttachmentMaxDimensions(value: unknown): ImageAttachmentMaxDimensions {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { width?: unknown; height?: unknown }
    : {};
  return {
    width: normalizeImageAttachmentDimension(record.width),
    height: normalizeImageAttachmentDimension(record.height),
  };
}

export function normalizeImageAttachmentDimension(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSION;
  return Math.min(MAX_IMAGE_ATTACHMENT_DIMENSION, Math.max(MIN_IMAGE_ATTACHMENT_DIMENSION, Math.floor(parsed)));
}

export function normalizeDebugLogMaxBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEBUG_LOG_MAX_BYTES;
  return Math.max(MIN_DEBUG_LOG_MAX_BYTES, Math.round(parsed));
}

export function debugLogMaxMegabytes(bytes: number): number {
  return Math.max(1, Math.round(normalizeDebugLogMaxBytes(bytes) / 1024 / 1024));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function syncAiMaxContextCharsOutput(input: HTMLInputElement): void {
  const output = input
    .closest<HTMLElement>('.ai-range-field')
    ?.querySelector<HTMLOutputElement>('[data-role="max-context-chars-output"]');
  if (output) {
    output.value = formatAiMaxContextChars(input.value);
    output.textContent = output.value;
  }
  syncAiRangeFill(input);
}

export function syncAiRangeFields(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[data-field="max-context-chars"]').forEach(syncAiMaxContextCharsOutput);
}

export function syncAiRangeFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const range = max - min;
  const progress = Number.isFinite(range) && range > 0
    ? Math.min(1, Math.max(0, (value - min) / range))
    : 0;
  const thumbSize = Number.parseFloat(getComputedStyle(input).getPropertyValue('--range-thumb-size')) || 18;
  const width = input.getBoundingClientRect().width;
  const fillEnd = (thumbSize / 2) + progress * Math.max(0, width - thumbSize);
  input.style.setProperty('--range-fill-end', `${fillEnd}px`);
}

export function formatAiMaxContextChars(value: unknown): string {
  return `${new Intl.NumberFormat().format(normalizeAiMaxContextChars(value))} chars`;
}

export function aiProviderConfig(settings: AiSettings, providerId: string): AiProviderConfig {
  const preset = aiProviderPreset(providerId);
  return settings.providers.find((provider) => provider.provider === providerId) ?? {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
  };
}

export function isHvyMode(value: string | undefined): value is HvyMode {
  return value === 'viewer' || value === 'ai' || value === 'editor' || value === 'hvy' || value === 'advanced';
}

export function isWorkspaceFilterMode(value: string | undefined): value is HvyDocumentSearchMode {
  return value === 'keyword' || value === 'semantic' || value === 'embedding';
}

export function isWorkspaceFilterBehavior(value: string | undefined): value is SearchFilterMode {
  return value === 'deprioritize' || value === 'hide';
}
