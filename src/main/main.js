'use strict';

/**
 * Codex Open Boot：双击「Codex」-> 播开屏 -> 真实 Codex 窗口按视频长大 -> 铺满。
 * 交接完就驻留托盘，不再有自己的工作台。
 */

const fs = require('fs');
const path = require('path');
const { app, screen, dialog } = require('electron');

// 必须在 ready 之前：设置与素材都放 %APPDATA%\CodexOpenBoot，和安装目录无关
app.setPath('userData', path.join(app.getPath('appData'), 'CodexOpenBoot'));

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Chromium 认为窗口被遮挡时会暂停 rAF/媒体 —— 开屏铺满时窗口正被自己盖着，必须关掉
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// 调试用：COB_DEBUG_PORT=9333 时本进程自己也开 CDP，
// 这样可以在不接管键盘/屏幕的前提下检查开屏页（见 README「排查」）
if (process.env.COB_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(Number(process.env.COB_DEBUG_PORT) || 9333));
}

const logger = require('./logger');
const paths = require('./paths');
const theme = require('./theme');
const { SettingsStore } = require('./settings-store');
const { Boot } = require('./boot');
const { registerIpc } = require('./ipc');
const entry = require('./entry');
const trayModule = require('./tray');
const windows = require('./window');

const PANEL_HTML = path.join(__dirname, '..', 'renderer', 'panel.html');

const state = {
  store: null,
  boot: null,
  skins: null,
  panel: null,
  quitting: false,
};

function trayActions() {
  return {
    boot: state.boot,
    openPanel: fs.existsSync(PANEL_HTML) ? openPanel : null,
    quit: quitApp,
  };
}

function openPanel() {
  if (state.panel && !state.panel.isDestroyed()) {
    if (state.panel.isMinimized()) state.panel.restore();
    state.panel.show();
    state.panel.focus();
    return state.panel;
  }
  try {
    state.panel = windows.createSettingsWindow(null);
  } catch (error) {
    logger.warn(`打开设置失败: ${error.message}`);
    return null;
  }
  const panel = state.panel;
  panel.once('ready-to-show', () => {
    if (!panel.isDestroyed()) panel.show();
  });
  panel.on('closed', () => {
    if (state.panel === panel) state.panel = null;
  });
  return panel;
}

function quitApp() {
  state.quitting = true;
  app.quit();
}

/**
 * 首次运行问一次「要不要接管桌面/开始菜单的 Codex 入口」。
 *
 * 只问一次：答完（无论选哪个）就把 ui.onboardedAt 写下来。否则用户选了「以后再说」，
 * 每次开机都弹一次。已经指向我们的快捷方式就直接跳过。
 */
async function maybeOfferEntry() {
  const settings = state.store.get();
  if (settings.ui && settings.ui.entryAskedAt) return;

  let owns = false;
  try {
    const current = entry.status({ app });
    owns = !!(current.ownsDesktop || current.ownsStartMenu);
  } catch (error) {
    logger.warn(`读取快捷方式状态失败: ${error.message}`);
  }

  if (!owns) {
    let response = 1;
    try {
      const answer = await dialog.showMessageBox({
        type: 'question',
        buttons: ['创建「Codex」快捷方式', '以后再说'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Codex Open Boot',
        message: '把桌面和开始菜单的「Codex」指向本程序？',
        detail:
          '创建之后，双击 Codex 就是「开屏动画 → 主题化 Codex」。\n随时可以在托盘菜单里移除。',
      });
      response = answer.response;
    } catch (error) {
      logger.warn(`首次询问失败: ${error.message}`);
    }

    if (response === 0) {
      try {
        const result = entry.install({ app });
        logger.info(
          `创建快捷方式：ok=${result.ok} 数量=${result.created.length} 图标=${result.icon || '（默认）'}`,
        );
        if (!result.ok) logger.warn(`创建快捷方式失败：${result.reason}`);
      } catch (error) {
        logger.warn(`创建快捷方式异常: ${error.message}`);
      }
    }
  }

  state.store.patch({ ui: { entryAskedAt: new Date().toISOString() } });
  state.store.saveNow();
}

async function start() {
  const userData = app.getPath('userData');
  logger.init(userData);
  logger.info(
    `Codex Open Boot ${app.getVersion()} 启动（packaged=${app.isPackaged}, electron=${process.versions.electron}）`,
  );

  const display = screen.getPrimaryDisplay();
  logger.info(`屏幕 ${display.size.width}x${display.size.height} @ ${display.scaleFactor}x 工作区 ${display.workArea.width}x${display.workArea.height}`);

  state.store = new SettingsStore(userData);
  state.store.load();

  const mediaDir = paths.mediaDir(app);
  const skinSet = theme.loadSkins(userData, mediaDir);
  state.skins = skinSet.skins;
  logger.info(`皮肤 ${state.skins.map((s) => s.id).join(', ')}（默认 ${skinSet.defaultSkin}）`);
  state.boot = new Boot({ store: state.store, skins: state.skins, mediaDir });

  registerIpc({
    store: state.store,
    boot: state.boot,
    backgroundsDir: paths.backgroundsDir(app),
  });

  trayModule.create(trayActions());

  if (process.argv.includes('--panel')) {
    openPanel();
    return;
  }

  // 探针只关心动画与注入，不要弹窗打断
  if (!process.env.COB_PROBE) {
    try {
      await maybeOfferEntry();
    } catch (error) {
      logger.warn(`首启询问失败: ${error.message}`);
    }
  }

  const result = await state.boot.run({ reason: 'launch' });
  logger.info(
    `开屏结束：ok=${result.ok} ${result.elapsed}ms${result.reused ? '（复用已有实例）' : ''}${
      result.error ? ` 错误=${result.error}` : ''
    }`,
  );
  trayModule.refresh(trayActions());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 此时 logger 还没初始化，直接往日志文件里留一行 —— 否则打包版「双击没反应」是零线索的
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'launcher.log'),
      `${new Date().toISOString()} [warn] 已有实例在运行，本进程退出（argv=${process.argv.slice(1).join(' ')}）\n`,
    );
  } catch {
    /* ignore */
  }
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!state.boot) return;
    if (Array.isArray(argv) && argv.includes('--panel')) {
      openPanel();
      return;
    }
    if (state.boot.phase === 'running') {
      logger.info('已有一次开屏在进行，忽略重复启动');
      return;
    }
    state.boot.run({ reason: 'second-instance' }).catch((error) => logger.error(`重播失败: ${error.message}`));
  });

  app.whenReady().then(start).catch((error) => {
    logger.error(`启动失败: ${error && error.stack ? error.stack : error}`);
    app.quit();
  });

  // 常驻托盘：窗口全关了也不退出
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    state.quitting = true;
    if (state.store) state.store.saveNow();
    if (state.boot) state.boot.dispose();
    trayModule.destroy();
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    logger.error(`渲染进程退出: ${details.reason}`);
  });
}
