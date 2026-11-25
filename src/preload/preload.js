'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * 唯一的桥接层：只暴露具名方法，渲染层拿不到 ipcRenderer。
 * 通道分三组：开屏（splash:*）、设置（settings:*）、外壳（shell/win:*）。
 */
const bridge = {
  // 状态
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  status: () => ipcRenderer.invoke('app:status'),

  // 开屏
  ready: () => ipcRenderer.invoke('splash:ready'),
  layout: (rect) => ipcRenderer.send('splash:layout', rect),
  frame: (time) => ipcRenderer.send('splash:frame', time),
  skip: () => ipcRenderer.invoke('splash:skip'),
  failed: (reason) => ipcRenderer.invoke('splash:failed', reason),

  onHold: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('splash:hold', handler);
    return () => ipcRenderer.removeListener('splash:hold', handler);
  },
  onResume: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('splash:resume', handler);
    return () => ipcRenderer.removeListener('splash:resume', handler);
  },
  onFade: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('splash:fade', handler);
    return () => ipcRenderer.removeListener('splash:fade', handler);
  },
  onRate: (callback) => {
    const handler = (_e, rate) => callback(rate);
    ipcRenderer.on('splash:rate', handler);
    return () => ipcRenderer.removeListener('splash:rate', handler);
  },
  onNote: (callback) => {
    const handler = (_e, text) => callback(text);
    ipcRenderer.on('app:note', handler);
    return () => ipcRenderer.removeListener('app:note', handler);
  },

  // 设置
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  chooseBackground: () => ipcRenderer.invoke('background:choose'),
  importBackgroundPath: (filePath) => ipcRenderer.invoke('background:import-path', filePath),
  clearBackground: () => ipcRenderer.invoke('background:clear'),
  pickFiles: () => ipcRenderer.invoke('background:choose'),

  // 应用动作
  relaunchCodex: () => ipcRenderer.invoke('codex:relaunch'),
  installEntries: () => ipcRenderer.invoke('entry:install'),
  removeEntries: () => ipcRenderer.invoke('entry:remove'),
  entryStatus: () => ipcRenderer.invoke('entry:status'),
  restoreWindow: () => ipcRenderer.invoke('codex:restore'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  openLog: () => ipcRenderer.invoke('app:open-log'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  diagnostics: () => ipcRenderer.invoke('app:diagnostics'),

  // 外壳窗口
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
};

contextBridge.exposeInMainWorld('bridge', bridge);
