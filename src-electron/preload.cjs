const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hvyElectron', {
  invoke(command, args) {
    return ipcRenderer.invoke('hvy:invoke', command, args || {});
  },
  onMenuEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('hvy:menu-event', listener);
    return () => ipcRenderer.removeListener('hvy:menu-event', listener);
  },
  onOpenDocumentPath(callback) {
    const listener = (_event, path) => callback(path);
    ipcRenderer.on('hvy:open-document-path', listener);
    return () => ipcRenderer.removeListener('hvy:open-document-path', listener);
  },
  onAppCloseRequest(callback) {
    const listener = () => callback();
    ipcRenderer.on('hvy:app-close-requested', listener);
    return () => ipcRenderer.removeListener('hvy:app-close-requested', listener);
  },
});
