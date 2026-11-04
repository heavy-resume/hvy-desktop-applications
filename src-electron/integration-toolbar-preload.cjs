'use strict';
// The integration browser's toolbar (src/integrationToolbar/main.ts): what it clicks goes to the main process, which
// knows the toolbar by its web contents. It can send toolbar messages and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hvyIntegrationToolbar', {
  send: (message) => ipcRenderer.send('hvy:integration-toolbar', message),
});
