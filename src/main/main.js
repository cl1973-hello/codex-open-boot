'use strict';

/**
 * Codex Open Boot：点官方的 Codex 入口 -> 播开屏 -> 真实 Codex 窗口按视频长大 -> 铺满。
 * 交接完就驻留托盘，继续盯着官方入口，不再有自己的工作台。
 */

const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');

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
const { OfficialWatcher } = require('./watcher');
const { registerIpc } = require('./ipc');
const launch = require('./launch');
const entry = require('./entry');
const trayModule = require('./tray');
const windows = require('./window');

const PANEL_HTML = path.join(__dirname, '..', 'renderer', 'panel.html');

const state = {
  store: null,
  boot: null,
  watcher: null,
  preempt: null,
  skins: null,
  panel: null,
  quitting: false,
};

function trayActions() {
  return {
    boot: state.boot,
    store: state.store,
    openPanel: fs.existsSync(PANEL_HTML) ? openPanel : null,
    toggleWatch: setWatchOfficial,
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
 * 2.0 的做法是在桌面和开始菜单放一个叫「Codex」的 .lnk 指向本程序。
 *
 * 2.1 起改为直接盯官方入口（开始菜单/搜索里的 MSIX 磁贴），所以那些自己建的
 * 快捷方式要清掉 —— 留着就是两套入口：点桌面那个走一套时序，点官方那个走另一套，
 * 用户根本分不清哪次会播动画。只删「目标确实是我们」的，用户自己的 Codex 快捷方式不动。
 */
function retireShortcuts() {
  let status = null;
  try {
    status = entry.status({ app });
  } catch (error) {
    logger.warn(`读取快捷方式状态失败: ${error.message}`);
    return;
  }
  if (!status.ownsDesktop && !status.ownsStartMenu) return;
  try {
    const result = entry.remove({ app });
    logger.info(`已移除 2.0 留下的「Codex」快捷方式：${JSON.stringify(result.removed)}`);
  } catch (error) {
    logger.warn(`移除旧快捷方式失败: ${error.message}`);
  }
}

/** 开屏正在跑的时候，抢屏会互相打架；直接让这次点击走正常路径 */
function bootBusy() {
  return !!(state.boot && state.boot.phase === 'running');
}

async function runOfficial() {
  if (bootBusy()) {
    logger.info('已有一次开屏在进行，忽略这次官方入口');
    return;
  }
  const result = await state.boot.run({ reason: 'official', preemptPids: state.preempt });
  logger.info(
    `开屏结束（官方入口）：ok=${result.ok} ${result.elapsed}ms${result.error ? ` 错误=${result.error}` : ''}`,
  );
  trayModule.refresh(trayActions());
}

/**
 * 常驻盯官方入口。
 *
 * 官方 Codex 是 MSIX 执行别名：没有 .lnk 可改，也不能给它加启动参数，
 * 所以「点官方图标也有开屏」只能这样实现 —— 看见新的 ChatGPT.exe 出现就抢屏，
 * 再把那个刚起来的实例结束掉、用自己的调试参数重拉（没有端口就注入不了主题）。
 */
function startWatcher() {
  if (state.watcher) return state.watcher;
  const settings = state.store.get();
  if (!settings.watch.official) {
    logger.info('官方入口侦测已关闭（settings.watch.official = false）');
    return null;
  }

  state.watcher = new OfficialWatcher({
    scan: () => launch.pids(),
    intervalMs: settings.watch.intervalMs,
    log: logger,
    onDetect: async (pids) => {
      // 把「要点杀的 pid」挂在 state 上，交给 runOfficial 传给 boot
      state.preempt = pids;
      try {
        await runOfficial();
      } finally {
        state.preempt = null;
      }
    },
  });
  state.watcher.start();
  return state.watcher;
}

/** 托盘里切换「官方入口触发」，立即生效 */
function setWatchOfficial(enabled) {
  const next = !!enabled;
  state.store.patch({ watch: { official: next } });
  state.store.saveNow();
  if (next) {
    startWatcher();
  } else if (state.watcher) {
    state.watcher.stop();
    state.watcher = null;
  }
  logger.info(`官方入口触发开屏：${next ? '开' : '关'}`);
  trayModule.refresh(trayActions());
  return next;
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
  retireShortcuts();

  if (process.argv.includes('--panel')) {
    openPanel();
    return;
  }

  const result = await state.boot.run({ reason: 'launch' });
  logger.info(
    `开屏结束：ok=${result.ok} ${result.elapsed}ms${result.reused ? '（复用已有实例）' : ''}${
      result.error ? ` 错误=${result.error}` : ''
    }`,
  );
  trayModule.refresh(trayActions());

  // 开屏交接完才开始盯：启动路径本身已经把 Codex 拉起来了，
  // 这时候建基线不会把「自己拉起来的那个」误判成官方点击。
  startWatcher();
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
    if (state.watcher) {
      state.watcher.stop();
      state.watcher = null;
    }
    if (state.store) state.store.saveNow();
    if (state.boot) state.boot.dispose();
    trayModule.destroy();
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    logger.error(`渲染进程退出: ${details.reason}`);
  });
}
