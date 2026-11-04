import { invoke } from '@tauri-apps/api/core';
import { mountIntegrationToolbar, type IntegrationToolbarMessage } from './toolbar';
import './styles.css';

declare global {
  interface Window {
    /** Electron: the toolbar's preload (src-electron/integration-toolbar-preload.cjs). */
    hvyIntegrationToolbar?: { send(message: IntegrationToolbarMessage): void };
  }
}

// What is clicked goes to the host over the app's IPC: Electron's preload, or Tauri's command, which knows the toolbar
// by its webview.
const send = (message: IntegrationToolbarMessage) => {
  if (window.hvyIntegrationToolbar) window.hvyIntegrationToolbar.send(message);
  else void invoke('integration_toolbar_message', { message });
};

const toolbar = mountIntegrationToolbar(document.getElementById('integration-toolbar')!, send);
// The host tells the toolbar what to show by calling these.
Object.assign(window, { hvySetBrowserState: toolbar.setBrowserState, hvySetInspectionState: toolbar.setInspectionState });
