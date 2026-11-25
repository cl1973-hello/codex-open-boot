'use strict';

/** 开屏窗口（全屏、不盖任务栏、最上层）与紧凑设置面板 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

function displayFor(bounds) {
  if (!bounds) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
}

function createSplashWindow(display) {
  const area = (display || screen.getPrimaryDisplay()).workArea;
  const win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: false,
    backgroundColor: '#05080A',
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Codex Open Boot',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

function createSettingsWindow(parent) {
  const display = displayFor(parent ? parent.getBounds() : null);
  const area = display.workArea;
  const width = Math.min(780, Math.round(area.width * 0.68));
  const height = Math.min(640, Math.round(area.height * 0.82));
  const win = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
    minWidth: 640,
    minHeight: 520,
    frame: false,
    backgroundColor: '#0A1216',
    show: false,
    title: 'Codex Open Boot 设置',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  return win;
}

module.exports = { createSplashWindow, createSettingsWindow, displayFor };
