import { describe, expect, it } from 'vitest';
import { pluginAcceptanceKey, setPluginAcceptances } from '../pluginManager';
import { state as appState, type AppState } from '../state';
import { renderPluginApprovalBar, renderPluginApprovalDialog } from './render-plugin-approval';

const blocked = [
  { id: 'galaxy.web-api', version: '0.1.0', displayName: 'Web API', blocks: 1 },
  { id: 'galaxy.web-collection', version: '0.1.0', displayName: 'Web Collection', blocks: 2 },
];

function stateWith(blockedPlugins: typeof blocked, dialogOpen = false): AppState {
  return {
    ...appState,
    document: { source: { path: '/jobs.hvy' }, mounted: { blockedPlugins } } as unknown as AppState['document'],
    pluginApprovalDialogOpen: dialogOpen,
  };
}

describe('plugin approval for the open file', () => {
  it('shows a bar naming the plugins the file is waiting on, and nothing once none are', () => {
    expect(renderPluginApprovalBar(stateWith(blocked))).toContain('This file uses 2 plugins that can run code: Web API, Web Collection.');
    expect(renderPluginApprovalBar(stateWith([]))).toBe('');
  });

  it('lists each plugin with a checked box to the left of its name, keyed as the file approval', () => {
    const dialog = renderPluginApprovalDialog(stateWith(blocked, true));
    expect(dialog).toMatch(/<input[^>]*data-plugin-acceptance-key="[^"]*"[^>]*checked>\s*<span class="plugin-approval-option-text">\s*<strong>Web API<\/strong>/);
    expect(dialog).toContain(pluginAcceptanceKey(blocked[1]).replaceAll('"', '&quot;'));
    expect(dialog).toContain('Used by 2 blocks in this file');
    expect(renderPluginApprovalDialog(stateWith(blocked, false))).toBe('');
  });

  it('saves several approvals for one file at once, and keeps other files', () => {
    const keys = blocked.map((plugin) => pluginAcceptanceKey(plugin));
    expect(setPluginAcceptances({ '/jobs.hvy': ['existing'], '/other.hvy': ['x'] }, '/jobs.hvy', keys, true)).toEqual({ '/jobs.hvy': ['existing', ...keys], '/other.hvy': ['x'] });
    expect(setPluginAcceptances({ '/jobs.hvy': ['existing', ...keys] }, '/jobs.hvy', [keys[0]], false)).toEqual({ '/jobs.hvy': ['existing', keys[1]] });
  });
});
