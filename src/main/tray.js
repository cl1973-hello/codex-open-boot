'use strict';

/** 托盘：交接完成后本工具驻留在这里，随时可以重播开屏或恢复窗口 */

const fs = require('fs');
const path = require('path');
const { Tray, Menu, app, shell } = require('electron');
const logger = require('./logger');
const entry = require('./entry');

let tray = null;

function iconPath() {
  const dev = path.join(__dirname, '..', '..', 'build', 'icon.png');
  const packed = path.join(process.resourcesPath || '', 'icon.png');
  const file = app.isPackaged ? packed : dev;
  return fs.existsSync(file) ? file : null;
}

/**
 * @param {{
 *   boot: import('./boot').Boot,
 *   store: import('./settings-store').SettingsStore,
 *   openPanel: () => void,
 *   toggleWatch: (enabled:boolean) => boolean,
 *   quit: () => void
 * }} options
 */
function create({ boot, store, openPanel, toggleWatch, quit }) {
  if (tray) return tray;

  const icon = iconPath();
  tray = new Tray(icon || process.execPath);
  tray.setToolTip('Codex');
  refresh({ boot, store, openPanel, toggleWatch, quit });
  tray.on('click', () => refresh({ boot, store, openPanel, toggleWatch, quit }));
  tray.on('double-click', () => {
    if (openPanel) openPanel();
  });
  return tray;
}

function refresh({ boot, store, openPanel, toggleWatch, quit }) {
  if (!tray) return;
  let status = null;
  try {
    status = entry.status({ app });
  } catch {
    /* 查不到就不显示这一项 */
  }
  const watchOn = !!(store && store.get().watch && store.get().watch.official);

  const items = [
    {
      label: boot && boot.phase === 'running' ? '正在启动 Codex…' : '重新播放开屏',
      enabled: !boot || boot.phase !== 'running',
      click: () => {
        boot.run({ reason: 'tray' }).catch((error) => logger.error(`托盘重播失败: ${error.message}`));
      },
    },
    {
      label: '恢复 Codex 窗口尺寸',
      enabled: !!(boot && boot.hwnd),
      click: () => {
        const result = boot.restoreWindow();
        if (!result.ok) logger.warn(`恢复窗口失败: ${result.reason}`);
      },
    },
    {
      // 2.1 的主路径：官方入口（开始菜单/搜索）被点，就抢屏播开屏
      type: 'checkbox',
      label: '官方入口触发开屏',
      checked: watchOn,
      enabled: !!toggleWatch,
      click: (item) => {
        if (toggleWatch) toggleWatch(item.checked);
      },
    },
    { type: 'separator' },
  ];

  if (openPanel) {
    items.push({ label: '设置…', click: () => openPanel() });
  }

  // 只在「2.0 建过的那个快捷方式还在」时才出现，而且只能删、不能建。
  // 2.1 起唯一入口是官方磁贴，再建一个会变成两套时序，用户分不清哪次会播动画。
  if (status && (status.ownsDesktop || status.ownsStartMenu)) {
    items.push({
      label: '清理由旧版本建立的「Codex」快捷方式',
      click: () => {
        const result = entry.remove({ app });
        logger.info(`移除旧快捷方式：${JSON.stringify(result.removed)}`);
        if (!result.ok) logger.warn(result.reason || '移除失败');
        refresh({ boot, store, openPanel, toggleWatch, quit });
      },
    });
  }

  items.push(
    { type: 'separator' },
    { label: '打开日志', click: () => (logger.path ? shell.openPath(logger.path) : null) },
    { label: '打开数据目录', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '退出', click: () => quit() },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { create, refresh, destroy };
