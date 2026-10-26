import { pluginAcceptanceKey, type BlockedPlugin } from '../pluginManager';
import type { AppState } from '../state';
import { escapeAttr, escapeHtml } from './shared';

function blockedPluginsOf(state: AppState): BlockedPlugin[] {
  return state.document?.mounted?.blockedPlugins ?? [];
}

function pluginNames(plugins: BlockedPlugin[]): string {
  return plugins.map((plugin) => plugin.displayName).join(', ');
}

/** Under the toolbar while the open file uses plugins it has not allowed yet. */
export function renderPluginApprovalBar(state: AppState): string {
  const plugins = blockedPluginsOf(state);
  if (plugins.length === 0) return '';
  const count = plugins.length === 1 ? '1 plugin that needs' : `${plugins.length} plugins that need`;
  return `
    <div class="plugin-approval-bar" role="status">
      <span>This file uses ${count} your approval: ${escapeHtml(pluginNames(plugins))}.</span>
      <button class="hvy-galaxy-button" type="button" data-action="review-plugin-approvals">Review</button>
    </div>`;
}

/** Every plugin the file is waiting on, allowed together, so the document reopens once. */
export function renderPluginApprovalDialog(state: AppState): string {
  const plugins = blockedPluginsOf(state);
  if (!state.pluginApprovalDialogOpen || plugins.length === 0) return '';
  const rows = plugins.map((plugin) => `
    <label class="checkbox-row plugin-approval-option">
      <input class="hvy-galaxy-input" type="checkbox" data-plugin-acceptance-key="${escapeAttr(pluginAcceptanceKey(plugin))}" checked>
      <span class="plugin-approval-option-text">
        <strong>${escapeHtml(plugin.displayName)}</strong>
        <span class="plugin-approval-option-detail">${plugin.blocks === 1 ? '1 instance' : `${plugin.blocks} instances`} in this file · ${escapeHtml(plugin.id)} ${escapeHtml(plugin.version)}</span>
      </span>
    </label>`).join('');
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="dialog plugin-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="pluginApprovalTitle">
        <h2 id="pluginApprovalTitle">Allow plugins in this file?</h2>
        <p class="dialog-note">These plugins ask to be approved for each file that uses them. Allow only the ones you trust this file to use. You can change this later in App Settings.</p>
        <div class="plugin-approval-list">${rows}</div>
        <div class="dialog-actions">
          <button class="hvy-galaxy-button" type="button" data-action="cancel-plugin-approvals">Cancel</button>
          <button class="hvy-galaxy-button primary-button" type="button" data-action="confirm-plugin-approvals">Allow</button>
        </div>
      </section>
    </div>`;
}
