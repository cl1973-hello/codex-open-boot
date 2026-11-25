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
 * @param {{boot: import('./boot').Boot, openPanel: () => void, quit: () => void}} options
 */
function create({ boot, openPanel, quit }) {
  if (tray) return tray;

  const icon = iconPath();
  tray = new Tray(icon || process.execPath);
  tray.setToolTip('Codex');
  refresh({ boot, openPanel, quit });
  tray.on('click', () => refresh({ boot, openPanel, quit }));
  tray.on('double-click', () => {
    if (openPanel) openPanel();
  });
  return tray;
}

function refresh({ boot, openPanel, quit }) {
  if (!tray) return;
  let status = null;
  try {
    status = entry.status({ app });
  } catch {
    /* 查不到就不显示这一项 */
  }

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
    { type: 'separator' },
  ];

  if (openPanel) {
    items.push({ label: '设置…', click: () => openPanel() });
  }

  if (status) {
    const installed = status.ownsDesktop || status.ownsStartMenu;
    items.push({
      label: installed ? '移除「Codex」快捷方式' : '在桌面和开始菜单创建「Codex」',
      click: () => {
        const result = installed ? entry.remove({ app }) : entry.install({ app });
        logger.info(`快捷方式${installed ? '移除' : '创建'}：${JSON.stringify(result.created || result.removed)}`);
        if (!result.ok) logger.warn(result.reason || '快捷方式操作失败');
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
