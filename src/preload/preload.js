'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Minimal, explicit IPC surface. The renderer never gets `ipcRenderer` itself, so it
 * cannot reach arbitrary channels even if the page is compromised.
 */
const bridge = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),

  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  reloadTheme: () => ipcRenderer.invoke('theme:load'),
  saveTheme: (theme) => ipcRenderer.invoke('theme:save', theme),

  chooseBackground: () => ipcRenderer.invoke('background:choose'),
  importBackgroundPath: (filePath) => ipcRenderer.invoke('background:import-path', filePath),
  importBackgroundBytes: (data, extension) => ipcRenderer.invoke('background:import-bytes', { data, extension }),
  describeBackground: () => ipcRenderer.invoke('background:describe'),

  pickProject: () => ipcRenderer.invoke('project:pick'),
  removeProject: (target) => ipcRenderer.invoke('project:remove', target),
  openProject: (target) => ipcRenderer.invoke('project:open', target),

  launchCodex: (appId) => ipcRenderer.invoke('app:launch-codex', appId),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  openLog: () => ipcRenderer.invoke('app:open-log'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  splashDone: () => ipcRenderer.invoke('splash:done'),
  setSplashMode: (on) => ipcRenderer.invoke('splash:mode', on),

  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggle-max'),
  close: () => ipcRenderer.invoke('win:close'),
  windowState: () => ipcRenderer.invoke('win:state'),

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },

  onWindowState: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('win:state', handler);
    return () => ipcRenderer.removeListener('win:state', handler);
  },
};

contextBridge.exposeInMainWorld('bridge', bridge);
