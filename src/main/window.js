'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const logger = require('./logger');

const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_SIZE = { width: 960, height: 640 };

let win = null;
let maximized = false;
let lastNormalBounds = null;
let saveTimer = null;
let getSettings = () => ({});
let saveSettings = () => {};

function intersectsEnough(bounds) {
  if (!bounds) return false;
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y));
    return overlapX * overlapY >= bounds.width * bounds.height * 0.25;
  });
}

function initialBounds(settings) {
  const saved = settings.window && settings.window.bounds;
  if (saved && intersectsEnough(saved)) return saved;
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT_SIZE.width, wa.width - 40);
  const height = Math.min(DEFAULT_SIZE.height, wa.height - 40);
  return {
    width: Math.max(MIN_SIZE.width, width),
    height: Math.max(MIN_SIZE.height, height),
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
  };
}

function persistBounds(immediate) {
  if (!win || win.isDestroyed()) return;
  const bounds = maximized ? lastNormalBounds : win.getBounds();
  if (!bounds) return;
  const write = () => {
    saveSettings({ window: { bounds, maximized } });
  };
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = setTimeout(write, 400);
}

function emitState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('win:state', { maximized, visible: win.isVisible() });
}

function createWindow(options) {
  const { settings, preload, indexFile, calibrate } = options;
  getSettings = options.getSettings || getSettings;
  saveSettings = options.saveSettings || saveSettings;

  const bounds = initialBounds(settings);
  lastNormalBounds = { ...bounds };

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: false,
    backgroundColor: '#070F12',
    show: false,
    skipTaskbar: true,
    title: 'Codex Open Boot',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (settings.window && settings.window.maximized) {
      const wa = screen.getDisplayMatching(win.getBounds()).workArea;
      win.setBounds(wa);
      maximized = true;
    }
    emitState();
    logger.info('window shown');
  });

  win.on('resize', () => {
    if (!maximized && win && !win.isDestroyed()) lastNormalBounds = win.getBounds();
    persistBounds(false);
  });
  win.on('move', () => {
    if (!maximized && win && !win.isDestroyed()) lastNormalBounds = win.getBounds();
    persistBounds(false);
  });

  win.on('maximize', () => {
    maximized = true;
    // Frameless windows maximize over the taskbar; snap back to the work area.
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds(wa);
    persistBounds(true);
    emitState();
  });

  win.on('unmaximize', () => {
    maximized = false;
    if (lastNormalBounds) win.setBounds(lastNormalBounds);
    persistBounds(true);
    emitState();
  });

  win.on('close', () => persistBounds(true));
  win.on('closed', () => {
    win = null;
  });

  const loadOptions = calibrate ? { query: { calibrate: '1' } } : undefined;
  win.loadFile(indexFile, loadOptions).catch((error) => logger.error(`loadFile failed: ${error.message}`));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  return win;
}

function setSplashMode(on) {
  if (!win || win.isDestroyed()) return;
  if (on) {
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.focus();
  }
  emitState();
}

function toggleMaximize() {
  if (!win || win.isDestroyed()) return { maximized };
  if (maximized) win.unmaximize();
  else win.maximize();
  return { maximized };
}

function getWindow() {
  return win;
}

module.exports = { createWindow, setSplashMode, toggleMaximize, getWindow, DEFAULT_SIZE, MIN_SIZE, initialBounds };
