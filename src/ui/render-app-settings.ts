import { builtInPlugins } from 'virtual:hvy-built-in-plugins';
import { includedDocuments, type WorkspaceTreeNode } from '../backend';
import { getInstalledPlugins } from '../pluginManager';
import { findFileInWorkspaces, workspaceRelativeFilePath, type AppState } from '../state';
import { findWorkspaceFileNode } from './events-workspace';
import { debugLogMaxMegabytes, isRecord, MAX_IMAGE_ATTACHMENT_DIMENSION, MIN_IMAGE_ATTACHMENT_DIMENSION, normalizeImageAttachmentMaxDimensions } from './render-ai-mcp';
import { workspaceNodeName, workspaceNodeRelativePath } from './render-workspace-dialogs';
import { displayDocumentName } from './render-workspaces';
import { escapeAttr, escapeHtml } from './shared';

export function renderDebugLogDialog(state: AppState): string {
  if (!state.debugLogDialogOpen) {
    return '';
  }
  const entries = state.debugLogEntries;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog wide-dialog debug-log-dialog" role="dialog" aria-modal="true" aria-labelledby="debugLogTitle">
        <div class="debug-log-header">
          <div>
            <h2 id="debugLogTitle">Debug Log</h2>
            <p class="dialog-note">Snapshot of recent load, close, LLM prompt, and performance events. Refresh to update.</p>
          </div>
          <div class="debug-log-actions">
            <button class="hvy-galaxy-button" type="button" data-action="refresh-debug-log">Refresh</button>
            <button class="hvy-galaxy-button" type="button" data-action="clear-debug-log">Clear</button>
          </div>
        </div>
        <div class="debug-log-settings" data-settings="debug-log">
          <label class="inline-checkbox">
            <input class="hvy-galaxy-input" name="debugSemanticSearch" type="checkbox" ${state.appSettings.debugSemanticSearch ? 'checked' : ''}>
            <span>Debug semantic search</span>
          </label>
          <label>
            <span>Maximum log size (MB)</span>
            <input class="hvy-galaxy-input" name="debugLogMaxMegabytes" type="number" min="1" step="1" required value="${escapeAttr(String(debugLogMaxMegabytes(state.appSettings.debugLogMaxBytes)))}">
          </label>
        </div>
        <div class="debug-log-list">
          ${entries.length
      ? entries.map(renderDebugLogEntry).join('')
      : '<p class="debug-log-empty">No debug entries yet.</p>'}
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="close-debug-log">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderDebugLogEntry(entry: AppState['debugLogEntries'][number]): string {
  const details = formatDebugLogEntryDetails(entry);
  const duration = typeof entry.details?.durationMs === 'number'
    ? `${entry.details.durationMs.toFixed(1)} ms`
    : typeof entry.durationMs === 'number'
      ? `${entry.durationMs.toFixed(1)} ms`
      : '';
  return `
    <article class="debug-log-entry" data-kind="${escapeAttr(entry.kind)}">
      <div class="debug-log-entry-summary">
        <span class="debug-log-kind">${escapeHtml(entry.kind)}</span>
        <strong>${escapeHtml(entry.label)}</strong>
        ${duration ? `<span class="debug-log-duration">${escapeHtml(duration)}</span>` : ''}
        <time datetime="${escapeAttr(entry.startedAt)}">${escapeHtml(formatDebugLogTime(entry.startedAt))}</time>
      </div>
      ${renderLlmDebugLogDetails(entry)}
      ${details ? `<pre>${escapeHtml(details)}</pre>` : ''}
    </article>`;
}

export function formatDebugLogEntryDetails(entry: AppState['debugLogEntries'][number]): string {
  if (!entry.details) return '';
  if (entry.kind === 'llm' && (entry.details.task === 'semanticFilter' || entry.details.task === 'chat')) {
    const { body: _body, output: _output, payload: _payload, ...summary } = entry.details;
    return JSON.stringify(summary, null, 2);
  }
  return JSON.stringify(entry.details, null, 2);
}

export function renderLlmDebugLogDetails(entry: AppState['debugLogEntries'][number]): string {
  if (entry.kind !== 'llm') return '';
  if (entry.label === 'llm:request' && entry.details?.task === 'semanticFilter') {
    return renderDebugLogExpandable('Semantic prompt', formatSemanticRequestPrompt(entry.details.body));
  }
  if (entry.label === 'llm:response' && entry.details?.task === 'chat') {
    return renderDebugLogExpandable('LLM response', formatDebugLogValue(entry.details?.output));
  }
  if (entry.label === 'llm:response' && entry.details?.task === 'semanticFilter') {
    return [
      renderDebugLogExpandable('Semantic prompt', formatSemanticRequestPrompt(entry.details?.body)),
      renderDebugLogExpandable('Semantic response', formatSemanticResponse(entry.details?.output)),
    ].join('');
  }
  if (entry.label === 'workspace-filter:semantic-error' && entry.details?.task === 'semanticFilter') {
    return [
      renderDebugLogExpandable('Semantic prompt', formatSemanticRequestPrompt(entry.details?.body)),
      renderDebugLogExpandable('Semantic response', formatSemanticResponse(entry.details?.output)),
    ].join('');
  }
  if (entry.label === 'llm:semantic-filter-output') {
    return renderDebugLogExpandable('Semantic response', formatSemanticResponse(entry.details?.output));
  }
  return '';
}

export function renderDebugLogExpandable(label: string, value: string): string {
  if (!value.trim()) return '';
  return `<details class="debug-log-details"><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(value)}</pre></details>`;
}

export function formatSemanticRequestPrompt(body: unknown): string {
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  const formattedMessages = messages
    .filter(isRecord)
    .map((message, index) => {
      const role = String(message.role ?? `message ${index + 1}`);
      const content = String(message.content ?? '');
      const normalizedContent = content.startsWith('Context:\n') ? content.slice('Context:\n'.length) : content;
      const label = content.startsWith('Context:\n') ? 'context' : role;
      return `--- ${label} ---\n${normalizedContent.trim()}`;
    })
    .filter((message) => message.trim().length > 0);
  return formattedMessages.length ? formattedMessages.join('\n\n') : formatDebugLogValue(body);
}

export function formatSemanticResponse(output: unknown): string {
  if (output === null || output === undefined) {
    return '';
  }
  if (typeof output !== 'string') {
    return formatDebugLogValue(output);
  }
  const source = output;
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source;
  }
}

export function formatDebugLogValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  const json = JSON.stringify(value, null, 2);
  return typeof json === 'string' ? json : String(value);
}

export function formatDebugLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function renderScriptingReviewDialog(state: AppState): string {
  if (!state.scriptingReviewDialogOpen) return '';
  const currentPath = state.document && !state.document.isNew ? state.document.path : null;
  const paths = [...new Set([
    ...(currentPath ? [currentPath] : []),
    ...state.appSettings.powerScriptingAllowedFiles,
    ...Object.keys(state.appSettings.powerScriptAcceptances),
  ])].sort((left, right) => {
    if (left === currentPath) return -1;
    if (right === currentPath) return 1;
    return left.localeCompare(right);
  });
  const files = paths.map((path) => {
    const wholeFileAllowed = state.appSettings.powerScriptingAllowedFiles.includes(path);
    const fingerprints = state.appSettings.powerScriptAcceptances[path] ?? [];
    return `
      <section class="scripting-review-file">
        <div class="scripting-review-file-heading">
          <div>
            <strong>${escapeHtml(path.split(/[\\/]/).pop() || path)}${path === currentPath ? ' (current file)' : ''}</strong>
            <div class="scripting-review-path">${escapeHtml(path)}</div>
          </div>
          <button class="hvy-galaxy-button"
            type="button"
            data-action="${wholeFileAllowed ? 'revoke-file-power-scripting' : 'allow-file-power-scripting'}"
            data-path="${escapeAttr(path)}"
          >${wholeFileAllowed ? 'Revoke whole file' : 'Allow All'}</button>
        </div>
        ${wholeFileAllowed ? '<p class="dialog-note">Every power script in this file is allowed, including scripts added or changed later.</p>' : ''}
        ${fingerprints.length > 0 ? `
          <div class="scripting-review-fingerprints">
            ${fingerprints.map((fingerprint) => {
      const scripts = state.appSettings.powerScriptAcceptanceScripts[path]?.[fingerprint] ?? [];
      return `
              <div class="scripting-review-acceptance">
                <div class="scripting-review-script-list">
                  ${scripts.length > 0 ? scripts.map((script) => `
                    <div class="scripting-review-script">
                      <strong>${escapeHtml(script.id)}</strong>
                      <code title="${escapeAttr(script.hash)}">${escapeHtml(script.hash)}</code>
                    </div>`).join('') : `
                    <div class="scripting-review-script">
                      <strong>Legacy approval</strong>
                      <code title="${escapeAttr(fingerprint)}">${escapeHtml(fingerprint)}</code>
                    </div>`}
                </div>
                <button class="hvy-galaxy-button"
                  type="button"
                  data-action="revoke-power-script"
                  data-path="${escapeAttr(path)}"
                  data-fingerprint="${escapeAttr(fingerprint)}"
                >Revoke</button>
              </div>`;
    }).join('')}
          </div>` : '<p class="dialog-note">No individual script approvals.</p>'}
      </section>`;
  }).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog scripting-review-dialog" role="dialog" aria-modal="true" aria-labelledby="scriptingReviewTitle">
        <h2 id="scriptingReviewTitle">Review Power Scripting</h2>
        <p class="dialog-note">Whole-file approval trusts future script changes. Individual approvals apply only to the accepted script fingerprint.</p>
        <input class="hvy-galaxy-input" type="search" data-field="scripting-review-filter" placeholder="Filter by file or script hash" autocomplete="off">
        <div class="scripting-review-files">
          ${files || '<p class="dialog-note">No power scripting approvals have been saved.</p>'}
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="close-scripting-review">Done</button>
        </div>
      </section>
    </div>`;
}

export function renderAppSettingsDialog(state: AppState): string {
  if (!state.appSettingsDialogOpen) {
    return '';
  }
  const settings = state.appSettingsDraft ?? state.appSettings;
  const pluginManager = state.appSettingsDialogMode === 'plugins';
  const imageAttachmentMaxDimensions = normalizeImageAttachmentMaxDimensions(settings.imageAttachmentMaxDimensions);
  const homepageSelection = settings.homepage.kind === 'included'
    ? `included:${settings.homepage.id}`
    : settings.homepage.kind;
  const homepagePath = settings.homepage.kind === 'file' ? settings.homepage.path : '';
  const homepageFile = homepagePath ? findFileInWorkspaces(state.workspaces, homepagePath) : null;
  const homepagePathAvailable = !homepagePath || Boolean(homepageFile && !homepageFile.archived);
  const homepageDisplayPath = homepagePath
    ? workspaceRelativeFilePath(state.workspaces, state.workspaceEntries.map((entry) => entry.path), homepagePath)
    : '';
  const currentWorkspaceFile = state.document?.path
    ? findFileInWorkspaces(state.workspaces, state.document.path)
    : null;
  const canUseCurrentDocument = Boolean(
    state.document?.includedDocumentId
    || (state.document?.path && !state.document.isNew && !state.document.virtual && currentWorkspaceFile && !currentWorkspaceFile.archived)
  );
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="dialog app-settings-dialog" data-form="app-settings">
        <h2>${pluginManager ? 'Manage Plugins' : 'Settings'}</h2>
        <div class="app-settings-scroll">
        <p class="dialog-note">${pluginManager
      ? 'Configure downloaded plugin access.'
      : 'Configure application defaults used when a document does not set its own value.'}</p>
        <textarea class="hvy-galaxy-textarea" name="settingsJson" hidden>${escapeHtml(JSON.stringify(settings))}</textarea>
        ${pluginManager ? '' : `<fieldset class="ai-action-config homepage-settings">
          <legend>Homepage</legend>
          <p class="dialog-note">Shown when no launch file or previous document is restored.</p>
          <label>
            <span>Homepage</span>
            <select class="hvy-galaxy-select" name="homepageSelection">
              ${includedDocuments.map((document) => `<option value="included:${escapeAttr(document.id)}" ${homepageSelection === `included:${document.id}` ? 'selected' : ''}>${escapeHtml(document.name)}</option>`).join('')}
              <option value="file" ${homepageSelection === 'file' ? 'selected' : ''} ${homepagePath ? '' : 'disabled'}>Custom document</option>
              <option value="none" ${homepageSelection === 'none' ? 'selected' : ''}>No homepage</option>
            </select>
          </label>
          <input name="homepagePath" type="hidden" value="${escapeAttr(homepagePath)}">
          ${homepagePath ? `<p class="dialog-note homepage-path" title="${escapeAttr(homepageDisplayPath)}">${escapeHtml(homepageDisplayPath)}</p>` : ''}
          ${homepagePath && !homepagePathAvailable ? '<p class="dialog-note homepage-unavailable" data-state="error">This document is not currently available. The selection will be kept.</p>' : ''}
          <div class="dialog-actions homepage-actions">
            <button class="hvy-galaxy-button" type="button" data-action="open-homepage-picker">Choose…</button>
            <button class="hvy-galaxy-button" type="button" data-action="use-current-document-as-homepage" ${canUseCurrentDocument ? '' : 'disabled'}>Use Current Document</button>
          </div>
        </fieldset>
        <fieldset class="ai-action-config image-dimension-settings">
          <legend>Attached image defaults</legend>
          <p class="dialog-note">Images are downscaled to reduce file size.</p>
          <label>
            <span>Maximum width</span>
            <span class="dimension-input">
              <input class="hvy-galaxy-input"
                name="imageAttachmentMaxWidth"
                type="number"
                min="${MIN_IMAGE_ATTACHMENT_DIMENSION}"
                max="${MAX_IMAGE_ATTACHMENT_DIMENSION}"
                step="1"
                value="${escapeAttr(String(imageAttachmentMaxDimensions.width))}"
              >
              <span aria-hidden="true">px</span>
            </span>
          </label>
          <label>
            <span>Maximum height</span>
            <span class="dimension-input">
              <input class="hvy-galaxy-input"
                name="imageAttachmentMaxHeight"
                type="number"
                min="${MIN_IMAGE_ATTACHMENT_DIMENSION}"
                max="${MAX_IMAGE_ATTACHMENT_DIMENSION}"
                step="1"
                value="${escapeAttr(String(imageAttachmentMaxDimensions.height))}"
              >
              <span aria-hidden="true">px</span>
            </span>
          </label>
        </fieldset>`}
        <fieldset class="ai-action-config">
          <legend>Built-in plugins</legend>
          <p class="dialog-note">These plugins are included with HVY Galaxy.</p>
          <div class="plugin-settings-list">
            ${builtInPlugins.map((plugin) => {
        const enabled = settings.pluginPolicies[plugin.id] !== 'disabled';
        return `<label class="plugin-settings-row">
                <span>
                  <strong>${escapeHtml(plugin.displayName)}</strong>
                  <small>Built in · ${escapeHtml(plugin.id)} · ${escapeHtml(plugin.version)}</small>
                </span>
                <select class="hvy-galaxy-select" name="pluginPolicy:${escapeAttr(plugin.id)}" aria-label="${escapeAttr(`${plugin.displayName} status`)}">
                  <option value="enabled" ${enabled ? 'selected' : ''}>Enabled</option>
                  <option value="disabled" ${enabled ? '' : 'selected'}>Disabled</option>
                </select>
              </label>`;
      }).join('')}
          </div>
        </fieldset>
        <fieldset class="ai-action-config plugin-install-zone" data-plugin-drop-zone>
          <legend>Custom plugins</legend>
          <div class="plugin-install-controls">
            <p class="dialog-note">Choose a <code>.hvy.plugin</code> package or drag one here. Newly installed plugins remain disabled until you enable them.</p>
            <label class="plugin-file-picker">
              <input class="hvy-galaxy-input" data-plugin-file-picker type="file" accept=".hvy.plugin" multiple>
              <span>Add plugin…</span>
            </label>
          </div>
          <div class="plugin-settings-list">
          ${getInstalledPlugins().map((record) => {
        if (!record.manifest) {
          return `<div class="dialog-note"><strong>${escapeHtml(record.file.name)}</strong>: ${escapeHtml(record.error ?? 'Invalid package')}</div>`;
        }
        const policy = settings.pluginPolicies[record.key] ?? 'disabled';
        const requiresPerFileApproval = record.manifest.authorization === 'required';
        const currentPath = state.document?.path ?? '';
        const acceptedForCurrentFile = Boolean(currentPath)
          && (settings.pluginAcceptances[currentPath] ?? []).includes(record.key);
        return `<label class="plugin-settings-row">
              <span>
                <strong>${escapeHtml(record.manifest.displayName)}</strong>
                <small>Custom · ${escapeHtml(record.manifest.id)} · ${escapeHtml(record.manifest.version)}</small>
                <small>${record.manifest.permissions.length > 0
            ? `Requests: ${escapeHtml(record.manifest.permissions.join(', '))}`
            : 'Requests no package permissions'}${requiresPerFileApproval ? '; package requires per-file approval' : ''}</small>
              </span>
              <select class="hvy-galaxy-select" name="pluginPolicy:${escapeAttr(record.key)}">
                <option value="disabled" ${policy === 'disabled' ? 'selected' : ''}>Disabled</option>
                <option value="conditional" ${policy === 'conditional' ? 'selected' : ''}>Per-file approval</option>
                <option value="enabled" ${policy === 'enabled' ? 'selected' : ''} ${requiresPerFileApproval ? 'disabled' : ''}>Enabled for all files</option>
              </select>
            </label>
            ${currentPath ? `<label class="inline-checkbox">
              <input class="hvy-galaxy-input" name="pluginAccepted:${escapeAttr(record.key)}" type="checkbox" ${acceptedForCurrentFile ? 'checked' : ''}>
              <span>Allow this exact version for the current file</span>
            </label>` : ''}`;
      }).join('') || '<p class="dialog-note">No custom plugins installed.</p>'}
          </div>
        </fieldset>
        ${pluginManager ? '' : `<fieldset class="ai-action-config">
          <legend>Debug log</legend>
          <label class="inline-checkbox app-settings-checkbox">
            <input class="hvy-galaxy-input" name="debugSemanticSearch" type="checkbox" ${settings.debugSemanticSearch ? 'checked' : ''}>
            <span>Debug semantic search</span>
          </label>
          <label>
            <span>Maximum log size (MB)</span>
            <input class="hvy-galaxy-input"
              name="debugLogMaxMegabytes"
              type="number"
              min="1"
              step="1"
              value="${escapeAttr(String(debugLogMaxMegabytes(settings.debugLogMaxBytes)))}"
            >
          </label>
        </fieldset>`}
        </div>
        <div class="dialog-actions app-settings-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-app-settings">Cancel</button>
          <button class="hvy-galaxy-button" type="submit" ${state.busy ? 'disabled' : ''}>Save</button>
        </div>
      </form>
    </div>`;
}

export function renderAppSettingsDiscardDialog(state: AppState): string {
  if (!state.appSettingsDiscardDialogOpen) {
    return '';
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog app-settings-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="appSettingsDiscardTitle">
        <h2 id="appSettingsDiscardTitle">Discard Settings Changes?</h2>
        <p class="dialog-note">You have unsaved settings changes.</p>
        <div class="dialog-actions">
          <button type="button" class="hvy-galaxy-button danger-button" data-action="discard-app-settings-changes">Discard Changes</button>
          <button class="hvy-galaxy-button" type="button" data-action="keep-editing-app-settings">Keep Editing</button>
        </div>
      </section>
    </div>`;
}

export function renderHomepageErrorDialog(state: AppState): string {
  if (!state.homepageError) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog homepage-error-dialog" role="dialog" aria-modal="true" aria-labelledby="homepageErrorTitle">
        <h2 id="homepageErrorTitle">Homepage Could Not Be Opened</h2>
        <p class="dialog-note homepage-error-details">${escapeHtml(state.homepageError)}</p>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="choose-replacement-homepage">Choose Another…</button>
          <button class="hvy-galaxy-button" type="button" data-action="use-included-guide-as-homepage">Use HVY Galaxy Guide</button>
          <button class="hvy-galaxy-button" type="button" data-action="disable-homepage">No Homepage</button>
        </div>
      </section>
    </div>`;
}

export function renderHomepagePickerDialog(state: AppState): string {
  if (!state.homepagePickerMode) return '';
  const selectedPath = state.homepagePickerMode === 'settings' && state.appSettingsDraft?.homepage.kind === 'file'
    ? state.appSettingsDraft.homepage.path
    : state.appSettings.homepage.kind === 'file'
      ? state.appSettings.homepage.path
      : '';
  const entries = state.workspaceEntries.map((entry) => {
    const workspace = state.workspaces.find((candidate) => candidate.path === entry.path);
    if (entry.status !== 'ready' || !workspace) {
      const detail = entry.status === 'loading' ? 'Loading…' : entry.error ?? 'Workspace is unavailable.';
      return `
        <section class="homepage-picker-workspace homepage-picker-workspace-${entry.status}">
          <div class="homepage-picker-workspace-status">
            <strong>${escapeHtml(entry.displayName)}</strong>
            <span title="${escapeAttr(detail)}">${escapeHtml(detail)}</span>
          </div>
          ${entry.status === 'loading' ? '' : `<button class="hvy-galaxy-button" type="button" data-action="retry-workspace" data-workspace-path="${escapeAttr(entry.path)}">Retry</button>`}
        </section>`;
    }
    if (!workspace.files.some(workspaceNodeContainsHomepageFile)) return '';
    const selectedFile = selectedPath ? findWorkspaceFileNode(workspace.files, selectedPath) : null;
    const containsSelection = Boolean(selectedFile && !selectedFile.archived);
    return `
      <details class="homepage-picker-workspace" ${containsSelection ? 'open' : ''}>
        <summary>${escapeHtml(workspace.manifest.name)}</summary>
        <ul class="tree homepage-picker-tree">
          ${sortHomepageNodes(workspace.files.filter(workspaceNodeContainsHomepageFile)).map((node) => renderHomepagePickerNode(node, selectedPath)).join('')}
        </ul>
      </details>`;
  }).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog homepage-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="homepagePickerTitle">
        <h2 id="homepagePickerTitle">Choose Homepage Document</h2>
        <p class="dialog-note">Choose a document from a workspace known to HVY Galaxy.</p>
        <div class="homepage-picker-workspaces">
          ${entries || '<p class="dialog-note">No workspace documents are available to use as a homepage.</p>'}
        </div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-homepage-picker">Cancel</button>
        </div>
      </section>
    </div>`;
}

export function renderHomepagePickerNode(node: WorkspaceTreeNode, selectedPath: string): string {
  if (node.kind === 'folder') {
    const containsSelection = nodeContainsFilePath(node, selectedPath);
    return `
      <li>
        <details ${containsSelection ? 'open' : ''}>
          <summary>${escapeHtml(workspaceNodeName(node))}</summary>
          <ul class="tree">${sortHomepageNodes(node.children.filter(workspaceNodeContainsHomepageFile)).map((child) => renderHomepagePickerNode(child, selectedPath)).join('')}</ul>
        </details>
      </li>`;
  }
  const selected = node.path === selectedPath;
  return `
    <li>
      <button type="button" class="hvy-galaxy-button homepage-picker-file${selected ? ' is-selected' : ''}" data-action="select-homepage-document" data-path="${escapeAttr(node.path)}" title="${escapeAttr(workspaceNodeRelativePath(node))}">
        <span>${escapeHtml(displayDocumentName(node.name))}</span>
        ${node.locked ? '<span class="tree-file-archived">Locked</span>' : ''}
      </button>
    </li>`;
}

export function sortHomepageNodes(nodes: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return workspaceNodeName(left).localeCompare(workspaceNodeName(right));
  });
}

export function nodeContainsFilePath(node: WorkspaceTreeNode, path: string): boolean {
  if (!path) return false;
  return node.kind === 'file' ? node.path === path : node.children.some((child) => nodeContainsFilePath(child, path));
}

export function workspaceNodeContainsHomepageFile(node: WorkspaceTreeNode): boolean {
  return node.kind === 'file' ? !node.archived : node.children.some(workspaceNodeContainsHomepageFile);
}
