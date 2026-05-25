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
});
