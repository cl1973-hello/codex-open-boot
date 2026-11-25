'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

// Must be set before `ready`: keeps settings independent from the install folder and
// guarantees %APPDATA%\CodexOpenBoot for portable builds too.
app.setPath('userData', path.join(app.getPath('appData'), 'CodexOpenBoot'));

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Chromium pauses media/rAF when the window is considered occluded – that would freeze
// the splash animation behind any always-on-top window.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const logger = require('./logger');
const { SettingsStore } = require('./settings-store');
const { registerIpc } = require('./ipc');
const windowModule = require('./window');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

const wantsCalibration = process.argv.includes('--calibrate');

const state = {
  store: null,
  media: null,
  preview: wantsCalibration,
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = windowModule.getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    logger.init(app.getPath('userData'));
    logger.info(`Codex Open Boot ${app.getVersion()} starting (packaged=${app.isPackaged})`);

    state.store = new SettingsStore(app.getPath('userData'));
    state.store.load();

    registerIpc(state);

    windowModule.createWindow({
      settings: state.store.get(),
      preload: PRELOAD,
      indexFile: INDEX,
      calibrate: wantsCalibration,
      getSettings: () => state.store.get(),
      saveSettings: (patch) => state.store.patch(patch),
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        windowModule.createWindow({
          settings: state.store.get(),
          preload: PRELOAD,
          indexFile: INDEX,
          calibrate: false,
          getSettings: () => state.store.get(),
          saveSettings: (patch) => state.store.patch(patch),
        });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (state.store) state.store.saveNow();
    app.quit();
  });

  app.on('before-quit', () => {
    if (state.store) state.store.saveNow();
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    logger.error(`renderer gone: ${details.reason}`);
  });
}
