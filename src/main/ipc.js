'use strict';

/**
 * 主进程 IPC。命名规则：
 *   app:*        状态与诊断
 *   splash:*     开屏页 -> 主进程（布局、帧、跳过、失败）
 *   settings:*   设置读写
 *   background:* 背景图
 *   codex:*      对 Codex 的动作
 *   entry:*      快捷方式
 *   win:*        外壳窗口
 *
 * 渲染层永远拿不到 ipcRenderer，只有 preload 里那几个具名方法。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');

const logger = require('./logger');
const launch = require('./launch');
const appx = require('./appx');
const entry = require('./entry');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif']);

function senderWindow(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch {
    return null;
  }
}

/** 复制进 userData\backgrounds，源文件被移动/删除也不影响 */
function safeImageCopy(dir, source) {
  const ext = path.extname(source).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error(`不支持的图片格式：${ext || '未知'}`);
  const stat = fs.statSync(source);
  const stamp = `${path.basename(source)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  const hash = crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 10);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `bg-${hash}${ext}`);
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
  return target;
}

function registerIpc({ store, boot, backgroundsDir }) {
  async function importBackground(source) {
    try {
      if (!source || !fs.existsSync(source)) return { ok: false, reason: '文件不存在' };
      const target = safeImageCopy(backgroundsDir, source);
      const settings = store.patch({ background: { mode: 'file', filePath: target } });
      const applied = await boot.applyTheme();
      return { ok: true, settings, applied, filePath: target };
    } catch (error) {
      logger.warn(`导入背景失败: ${error.message}`);
      return { ok: false, reason: error.message };
    }
  }

  // ---------------- 状态

  ipcMain.handle('app:bootstrap', () => boot.bootstrap());

  ipcMain.handle('app:status', () => ({
    ...boot.status(),
    settings: store.get(),
    running: launch.isRunning(),
  }));

  ipcMain.handle('app:diagnostics', () => {
    const info = appx.info();
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      userData: app.getPath('userData'),
      log: logger.path,
      locale: app.getLocale(),
      codex: {
        found: !!info,
        version: info && info.version,
        family: info && info.family,
        installLocation: info && info.installLocation,
        alias: info && info.alias,
        aliasExists: info && info.aliasExists,
      },
      session: boot.status(),
    };
  });

  ipcMain.handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('app:open-log', () => {
    if (logger.path && fs.existsSync(logger.path)) return shell.openPath(logger.path);
    return shell.openPath(app.getPath('userData'));
  });
  ipcMain.handle('app:open-external', (_event, url) => {
    const target = String(url || '');
    if (!/^https?:\/\//i.test(target)) return { ok: false, reason: '只允许 http(s) 链接' };
    return shell.openExternal(target);
  });

  // ---------------- 开屏

  ipcMain.handle('splash:ready', async () => {
    if (!boot.splashGate) return false;
    return boot.splashGate.promise;
  });

  ipcMain.on('splash:layout', (_event, rect) => boot.onLayout(rect));
  ipcMain.on('splash:frame', (_event, time) => boot.onFrame(time));

  ipcMain.handle('splash:skip', () => boot.onSkip());
  ipcMain.handle('splash:failed', (_event, reason) => {
    boot.onSplashFailed(String(reason || 'unknown'));
    return true;
  });

  // ---------------- 设置

  ipcMain.handle('settings:get', () => store.get());

  ipcMain.handle('settings:patch', async (_event, patch) => {
    const settings = store.patch(patch || {});
    const applied = await boot.applyTheme();
    return { settings, applied };
  });

  ipcMain.handle('settings:reset', async () => {
    const settings = store.reset();
    const applied = await boot.applyTheme();
    return { settings, applied };
  });

  // ---------------- 背景图

  ipcMain.handle('background:choose', async (event) => {
    const result = await dialog.showOpenDialog(senderWindow(event), {
      title: '选择背景图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return importBackground(result.filePaths[0]);
  });

  ipcMain.handle('background:import-path', (_event, filePath) => importBackground(String(filePath || '')));

  ipcMain.handle('background:clear', async () => {
    const settings = store.patch({ background: { mode: 'builtin', filePath: null } });
    const applied = await boot.applyTheme();
    return { ok: true, settings, applied };
  });

  // ---------------- Codex

  ipcMain.handle('codex:relaunch', async () => {
    if (boot.phase === 'running') return { ok: false, reason: '正在启动中' };
    return boot.run({ reason: 'manual' });
  });

  ipcMain.handle('codex:restore', () => boot.restoreWindow());

  // ---------------- 快捷方式

  ipcMain.handle('entry:status', () => entry.status({ app }));
  ipcMain.handle('entry:install', () => entry.install({ app }));
  ipcMain.handle('entry:remove', () => entry.remove({ app }));

  // ---------------- 外壳窗口

  ipcMain.handle('win:minimize', (event) => {
    const win = senderWindow(event);
    if (win) win.minimize();
    return true;
  });

  ipcMain.handle('win:close', (event) => {
    const win = senderWindow(event);
    if (win) win.close();
    return true;
  });
}

module.exports = { registerIpc };
