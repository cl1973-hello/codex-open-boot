'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, dialog, nativeImage, BrowserWindow, app } = require('electron');
const { fileURLToPath } = require('url');

const { isValidAppId, validateTheme, normalizeTheme, toFinite } = require('../shared/validate');
const { deepMerge } = require('../shared/defaults');
const { backgroundsDir, fileUrl } = require('./paths');
const { launchCodex, openPath, openExternal } = require('./launcher');
const { loadTheme, loadSkins, buildMediaInfo } = require('./theme-store');
const windowModule = require('./window');
const logger = require('./logger');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
const lumCache = new Map();

// app.getVersion() falls back to Electron's own version when the app is launched via a
// script instead of the package root, so read our package.json explicitly.
const APP_VERSION = (() => {
  try {
    return require('../../package.json').version;
  } catch {
    return app.getVersion();
  }
})();

function callerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Approximate luminance statistics of an image (used by the readability guard). */
function luminanceOf(filePath) {
  if (!filePath) return { avg: 0, p90: 0 };
  if (lumCache.has(filePath)) return lumCache.get(filePath);
  let result = { avg: 0, p90: 0 };
  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      const { width, height } = image.getSize();
      const scale = Math.min(1, 48 / Math.max(width, height));
      const small = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
      const bitmap = small.toBitmap(); // BGRA
      const values = [];
      for (let i = 0; i + 3 < bitmap.length; i += 4) {
        const b = bitmap[i] / 255;
        const g = bitmap[i + 1] / 255;
        const r = bitmap[i + 2] / 255;
        const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
        values.push(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
      }
      if (values.length) {
        values.sort((a, b) => a - b);
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        result = { avg, p90: values[Math.min(values.length - 1, Math.floor(values.length * 0.9))] };
      }
    }
  } catch (error) {
    logger.warn(`luminance sample failed: ${error.message}`);
  }
  lumCache.set(filePath, result);
  return result;
}

function backgroundDescriptor(state) {
  const { settings, media } = state;
  const bg = settings.background;
  if (bg.mode === 'none') return { mode: 'none', url: null, lum: { avg: 0, p90: 0 }, filePath: null };
  if (bg.mode === 'file' && bg.filePath && fs.existsSync(bg.filePath)) {
    return { mode: 'file', url: fileUrl(bg.filePath), lum: luminanceOf(bg.filePath), filePath: bg.filePath };
  }
  let builtinPath = null;
  try {
    builtinPath = media.builtinBackground ? fileURLToPath(media.builtinBackground) : null;
  } catch {
    builtinPath = null;
  }
  return { mode: 'builtin', url: media.builtinBackground, lum: luminanceOf(builtinPath), filePath: builtinPath };
}

function importBackgroundBuffer(buffer, extension, state) {
  const ext = String(extension || '').toLowerCase();
  if (!IMAGE_EXT.has(ext)) return { ok: false, reason: 'unsupported-format' };
  if (!buffer || buffer.length === 0) return { ok: false, reason: 'empty' };
  if (buffer.length > MAX_BACKGROUND_BYTES) return { ok: false, reason: 'too-large' };

  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const target = path.join(backgroundsDir(app), `${hash}${ext}`);
  fs.writeFileSync(target, buffer);

  const settings = state.store.patch({ background: { mode: 'file', filePath: target } });
  return { ok: true, settings, background: backgroundDescriptor({ ...state, settings }) };
}

async function importBackgroundFile(sourcePath, state) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return { ok: false, reason: 'unsupported-format' };
  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_BACKGROUND_BYTES) return { ok: false, reason: 'too-large' };
  return importBackgroundBuffer(fs.readFileSync(sourcePath), ext, state);
}

function registerIpc(state) {
  const { store, preview } = state;

  const bootstrapPayload = () => {
    const settings = store.get();
    const { theme, source } = loadTheme(app);
    const { skins, defaultSkin } = loadSkins(app);
    const media = buildMediaInfo(app, theme);
    state.media = media;
    return {
      settings,
      theme,
      themeSource: source,
      skins,
      defaultSkin,
      media,
      background: backgroundDescriptor({ ...state, settings }),
      version: APP_VERSION,
      dataDir: app.getPath('userData'),
      logPath: logger.path,
      isPackaged: app.isPackaged,
      calibrate: !!preview,
    };
  };

  ipcMain.handle('bootstrap', bootstrapPayload);

  ipcMain.handle('settings:patch', (_event, patch) => {
    if (!patch || typeof patch !== 'object') return store.get();
    const settings = store.patch(patch);
    return { settings, background: backgroundDescriptor({ ...state, settings }) };
  });

  ipcMain.handle('settings:reset', () => {
    const settings = store.reset();
    return { settings, background: backgroundDescriptor({ ...state, settings }) };
  });

  ipcMain.handle('theme:load', () => {
    const { theme, source } = loadTheme(app);
    const media = buildMediaInfo(app, theme);
    state.media = media;
    return { theme, themeSource: source, media, background: backgroundDescriptor({ ...state, settings: store.get() }) };
  });

  ipcMain.handle('theme:save', (_event, rawTheme) => {
    if (!rawTheme || typeof rawTheme !== 'object') return { ok: false, errors: ['无效的主题数据'] };
    const duration = toFinite(rawTheme.duration, 10);
    const theme = normalizeTheme(rawTheme, duration);
    theme.duration = duration;
    const result = validateTheme(theme);
    if (!result.ok) return result;
    try {
      const target = path.join(app.getPath('userData'), 'theme.json');
      fs.writeFileSync(target, JSON.stringify(theme, null, 2), 'utf8');
      state.media = buildMediaInfo(app, theme);
      return { ok: true, theme, media: state.media };
    } catch (error) {
      return { ok: false, errors: [`写入失败：${error.message}`] };
    }
  });

  ipcMain.handle('background:choose', async (event) => {
    const owner = callerWindow(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    return importBackgroundFile(filePaths[0], state);
  });

  ipcMain.handle('background:import-path', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, reason: 'invalid-path' };
    if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
    return importBackgroundFile(filePath, state);
  });

  ipcMain.handle('background:import-bytes', async (_event, payload) => {
    if (!payload || !(payload.data instanceof Uint8Array)) return { ok: false, reason: 'invalid-payload' };
    return importBackgroundBuffer(Buffer.from(payload.data), payload.extension, state);
  });

  ipcMain.handle('background:describe', () => {
    const settings = store.get();
    return { settings, background: backgroundDescriptor({ ...state, settings }) };
  });

  ipcMain.handle('project:pick', async (event) => {
    const owner = callerWindow(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
      title: '选择项目文件夹',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    const settings = store.patch({ app: { recentProjects: [filePaths[0], ...store.get().app.recentProjects.filter((p) => p !== filePaths[0])] } });
    return { ok: true, settings, path: filePaths[0] };
  });

  ipcMain.handle('project:remove', (_event, target) => {
    const settings = store.patch({
      app: { recentProjects: store.get().app.recentProjects.filter((p) => p !== target) },
    });
    return { ok: true, settings };
  });

  ipcMain.handle('project:open', async (_event, target) => {
    if (typeof target !== 'string') return { ok: false, reason: 'invalid-path' };
    if (!fs.existsSync(target)) return { ok: false, reason: 'missing' };
    return openPath(target);
  });

  ipcMain.handle('app:launch-codex', async (_event, appId) => {
    const id = typeof appId === 'string' && appId ? appId : store.get().app.codexAppId;
    const result = await launchCodex(id);
    if (result.ok && id !== store.get().app.codexAppId && isValidAppId(id)) store.patch({ app: { codexAppId: id } });
    return result;
  });

  ipcMain.handle('app:open-data-dir', () => openPath(app.getPath('userData')));
  ipcMain.handle('app:open-log', () => openPath(path.dirname(logger.path || app.getPath('userData'))));
  ipcMain.handle('app:open-external', (_event, url) => openExternal(url));

  ipcMain.handle('splash:done', () => {
    windowModule.setSplashMode(false);
    return { ok: true };
  });
  ipcMain.handle('splash:mode', (_event, on) => {
    windowModule.setSplashMode(!!on);
    return { ok: true };
  });

  ipcMain.handle('win:minimize', () => {
    const win = windowModule.getWindow();
    if (win) win.minimize();
    return { ok: true };
  });
  ipcMain.handle('win:toggle-max', () => windowModule.toggleMaximize());
  ipcMain.handle('win:close', () => {
    const win = windowModule.getWindow();
    if (win) win.close();
    return { ok: true };
  });
  ipcMain.handle('win:state', () => {
    const win = windowModule.getWindow();
    return { maximized: !!(win && win.isMaximized()), visible: !!(win && win.isVisible()) };
  });
}

module.exports = { registerIpc, luminanceOf, backgroundDescriptor, deepMerge };
