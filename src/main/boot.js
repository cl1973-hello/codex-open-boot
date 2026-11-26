'use strict';

/**
 * 一次完整的开屏：视频先播 -> Codex 在后台起来 -> 主题注入 -> 真实窗口按视频里
 * 那块「屏幕」逐帧长大 -> 铺满屏幕 -> 淡出开屏窗。
 *
 * 时序上唯一不能写死的是「入场时间」：Codex 窗口有 793×991 物理像素的硬性最小
 * 尺寸，视频里那块矩形要长到足够大才放得下它，所以用 findEntryTime() 按当前分辨率
 * 和缩放比例算。算不出来就退化成「直接到尾段」。
 *
 * 状态机：idle -> running -> done | failed。任何时候按 Esc 都走 skip。
 */

const fs = require('fs');
const path = require('path');
const { screen } = require('electron');

const logger = require('./logger');
const launch = require('./launch');
const win32 = require('./win32');
const media = require('./media');
const theme = require('./theme');
const windows = require('./window');
const { Injector } = require('./cdp');
const { WindowAnimator } = require('./animate');
const probe = require('./probe');
const { findEntryTime } = require('../shared/portal');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve = () => {};
  const promise = new Promise((rs) => {
    resolve = rs;
  });
  return { promise, resolve };
}

/** BrowserWindow -> Win32 HWND（BigInt） */
function hwndOf(win) {
  try {
    const buf = win.getNativeWindowHandle();
    return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  } catch {
    return 0n;
  }
}

class Boot {
  constructor({ store, skins, mediaDir }) {
    this.store = store;
    this.skins = skins;
    this.mediaDir = mediaDir;

    this.phase = 'idle';
    this.media = null;
    this.composed = null;
    this.holdAt = 7;

    this.splashWindow = null;
    this.splashHwnd = 0n;
    this.splashGate = null;

    this.normalized = null;
    this.animator = null;
    this.injector = null;
    this.passiveInjector = null;

    this.hwnd = 0n;
    this.port = 0;
    this.original = null;
    this.areaPx = null;
    this.endRect = null;
    this.minTrack = null;

    this.lastTime = 0;
    this.lastFrameAt = 0;
    this.holding = false;
    this.skipRequested = false;
    this.handedOff = false;
    this.finished = null;
    this.timers = [];
    this.note = null;
  }

  get userDataDir() {
    return this.store.dir;
  }

  get sessionFile() {
    return path.join(this.userDataDir, 'session.json');
  }

  reloadMedia() {
    this.media = media.load({ userDataDir: this.userDataDir, mediaDir: this.mediaDir });
    return this.media;
  }

  bootstrap() {
    if (!this.media) this.reloadMedia();
    const settings = this.store.get();
    const display = screen.getPrimaryDisplay();
    return {
      media: media.forRenderer(this.media, settings),
      settings,
      skins: this.skins,
      screen: {
        width: display.workAreaSize.width,
        height: display.workAreaSize.height,
        scale: display.scaleFactor,
      },
      version: process.env.COB_VERSION || '',
    };
  }

  status() {
    return {
      phase: this.phase,
      port: this.port,
      media: this.media ? { ok: this.media.ok, frames: this.media.frames.length, zoom: this.media.zoom } : null,
      pages: this.injector ? this.injector.stats() : this.passiveInjector ? this.passiveInjector.stats() : null,
      entry: this.animator ? { entryTime: this.animator.entryTime, end: this.animator.transitionEnd } : null,
      rect: this.hwnd && win32.isWindow(this.hwnd) ? win32.getRect(this.hwnd) : null,
      note: this.note,
    };
  }

  send(channel, ...args) {
    const win = this.splashWindow;
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(channel, ...args);
    } catch {
      /* 窗口正在销毁 */
    }
  }

  note2renderer(text) {
    this.note = text || null;
    this.send('splash:note', text || '');
  }

  // ---------------------------------------------------------------- 开屏窗口

  openSplash() {
    if (!this.media) this.reloadMedia();
    const settings = this.store.get();
    if (!this.media.ok || settings.splash.enabled === false) {
      logger.info('跳过开屏动画（素材缺失或已关闭）');
      return null;
    }

    const win = windows.createSplashWindow(screen.getPrimaryDisplay());
    this.splashWindow = win;
    this.splashHwnd = hwndOf(win);
    this.splashGate = deferred();

    // 开屏页出问题（preload 挂了、bundle 404）时，之前是完全静默的：
    // 窗口一片黑、动画被跳过，日志里什么都没有。这里把渲染层的错误捞出来。
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      logger.error(`preload 出错 ${preloadPath}: ${error && error.message}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      logger.error(`开屏页加载失败 ${code} ${description} ${url}`);
    });
    win.webContents.on('console-message', (...args) => {
      // Electron 36+ 是 (event, details)，老版本是 (event, level, message, line, source)
      const second = args[1];
      if (second && typeof second === 'object') {
        logger.warn(`开屏页 console[${second.level}]: ${second.message} (${second.sourceId || ''}:${second.lineNumber || 0})`);
        return;
      }
      logger.warn(`开屏页 console[${args[1]}]: ${args[2]} (${args[4] || ''}:${args[3] || 0})`);
    });
    win.webContents.on('did-finish-load', () => {
      const probe =
        'JSON.stringify({' +
        "bridge: typeof window.bridge," +
        "hasLayout: !!(window.bridge && window.bridge.layout)," +
        "error: window.__cobSplashError || null" +
        '})';
      win.webContents
        .executeJavaScript(probe)
        .then((info) => logger.info(`开屏页自检: ${info}`))
        .catch((error) => logger.warn(`开屏页自检失败: ${error.message}`));
    });

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      this.splashGate.resolve(true);
    });

    win.on('closed', () => {
      if (this.splashWindow === win) this.splashWindow = null;
      this.splashGate.resolve(false);
    });

    // 渲染层没起来（bundle 缺失等）时不能把整个启动卡住
    this.after(4000, () => {
      // 复用已有实例的开屏只活几百毫秒，窗口早关了，这时候再报「没上报布局」纯属噪音
      if (this.phase !== 'running' || !this.splashWindow) return;
      if (!this.normalized) logger.warn('开屏页没有上报布局，动画将退化为直接铺满');
    });

    return win;
  }

  after(ms, fn) {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer);
      try {
        fn();
      } catch (error) {
        logger.warn(`定时任务出错: ${error.message}`);
      }
    }, ms);
    this.timers.push(timer);
    return timer;
  }

  clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  // ---------------------------------------------------------------- 渲染层消息

  onLayout(rect) {
    if (!rect || this.normalized || this.phase !== 'running') return;
    const n = { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) };
    if (![n.x, n.y, n.w, n.h].every((v) => Number.isFinite(v))) return;
    // cover + zoom 时视频会整体溢出视口，x/y 是负值、w/h 大于 1 都是正常的，
    // 只挡住明显越界的异常值（比如 NaN 或者被写坏的 settings）
    if (n.w <= 0 || n.h <= 0 || n.w > 8 || n.h > 8 || Math.abs(n.x) > 8 || Math.abs(n.y) > 8) {
      logger.warn(`开屏布局异常，已忽略: ${JSON.stringify(n)}`);
      return;
    }
    this.normalized = n;
    this.reportedPx = rect.px || null;
    this.reportedDpr = Number(rect.dpr) || 0;
    // 渲染层认为的物理视口：主进程按这个空间映射，才和画面对齐（见 splash.js 注释）
    this.viewport = {
      w: Number(rect.vw) > 0 ? Number(rect.vw) : 0,
      h: Number(rect.vh) > 0 ? Number(rect.vh) : 0,
    };
    this.tryBuildAnimator();
  }

  onFrame(time) {
    if (this.phase !== 'running') return;
    const t = Number(time);
    if (!Number.isFinite(t)) return;
    this.lastTime = t;
    this.lastFrameAt = Date.now();

    if (this.animator) {
      this.animator.push(t);
      if (!this.probeMid && t >= (this.animator.entryTime + this.media.transitionEnd) / 2) {
        this.probeMid = true;
        probe.mark('mid', { time: t, rect: this.animator.rectAt(t) });
      }
      return;
    }

    // Codex 还没准备好：在画面「长成窗口」之前先定住，别把动画一次演完
    if (!this.holding && t >= this.holdAt) {
      this.holding = true;
      this.send('splash:hold');
      logger.info(`视频 ${t.toFixed(2)}s 处暂停等待 Codex 就绪`);
    }
  }

  onSkip() {
    if (this.phase !== 'running' && this.phase !== 'done') return { ok: false, phase: this.phase };
    this.skipRequested = true;
    this.note2renderer('正在进入 Codex…');
    logger.info('用户跳过开屏');

    if (this.animator) {
      this.animator.skip();
      return { ok: true, action: 'tail' };
    }
    return { ok: true, action: 'early' };
  }

  onSplashFailed(reason) {
    logger.warn(`开屏失败: ${String(reason)}`);
    this.note = String(reason);
    // 视频放不出来就别演了，等窗口就绪直接铺满
    if (reason === 'video-error' || reason === 'play-failed' || reason === 'no-media') {
      this.skipRequested = true;
      this.note2renderer('正在进入 Codex…');
    }
  }

  // ---------------------------------------------------------------- 启动链

  async run({ reason = 'launch' } = {}) {
    if (this.phase === 'running') return { ok: false, reason: 'busy' };

    this.phase = 'running';
    this.handedOff = false;
    this.skipRequested = false;
    this.animator = null;
    this.normalized = null;
    this.holding = false;
    this.lastTime = 0;
    this.lastFrameAt = 0;
    this.probeMid = false;
    this.note = null;
    this.endRect = null;
    this.finished = deferred();
    probe.init();

    const startedAt = Date.now();
    this.reloadMedia();

    const settings = this.store.get();
    this.composed = theme.compose({ settings, skins: this.skins });
    this.holdAt = Math.max(1, this.media.transitionStart + 0.4);

    if (this.passiveInjector) {
      this.passiveInjector.stop();
      this.passiveInjector = null;
    }

    logger.info(
      `开始开屏（${reason}）：素材=${this.media.ok ? 'ok' : '缺失'} 帧=${this.media.frames.length} 目录=${this.media.mediaSource || '?'}`,
    );
    this.openSplash();

    try {
      // 探针要量的是「入场 → 逐帧缩放 → 尾段 → 交接」这条完整路径。
      // 复用已有实例会直接跳到收尾（不到 1 秒），测出来全是 null，所以探针不复用。
      const probing = !!process.env.COB_PROBE;
      // Codex 已经在跑：能挂上调试端口就直接复用，不打断用户
      if (!probing && launch.isRunning()) {
        const reused = await this.reuseExisting();
        if (reused) {
          logger.info('Codex 已在运行且可注入，复用现有实例');
          this.phase = 'done';
          await this.fadeSplash();
          this.finished.resolve(true);
          return this.result(startedAt, { reused: true });
        }
      }
      if (probing && launch.isRunning()) logger.info('探针模式：不复用已有实例，走完整启动流程');

      await launch.ensureNotRunning();
      const info = await launch.launchAndWait({
        launch: settings.codex.launch,
        onProgress: (p) => {
          if (p.phase === 'spawned') this.note2renderer('Codex 正在启动…');
        },
      });
      this.port = info.port;
      logger.info(`Codex 就绪：端口 ${info.port}，用时 ${info.elapsed}ms`);

      this.injector = new Injector({
        port: info.port,
        css: this.composed.css,
        bg: this.composed.bg,
        scheme: this.composed.scheme,
      });
      this.injector.start().catch((error) => logger.warn(`注入器启动失败: ${error.message}`));
      if (this.composed.note) this.note2renderer(this.composed.note);

      this.hwnd = await this.waitForWindow(info.pid);
      if (!this.hwnd) throw new Error('等不到 Codex 主窗口');
      logger.info(`Codex 窗口 HWND=${this.hwnd}`);

      this.restoreIfDirty();
      this.measure();

      if (this.splashWindow) {
        // 布局可能在 measure() 之前就到了，那时 endRect 还没有，所以这里必须再试一次
        this.tryBuildAnimator();
        await this.waitForAnimator(2500);
      }

      if (this.animator) {
        this.startStallGuard();
        await this.finished.promise;
        return this.result(startedAt, { reused: false });
      }

      // 没有动画（素材缺失、视频报错、渲染层没起来）：注入完成就直接摆好窗口
      await this.injector.waitApplied(6000);
      await this.handoff();
      return this.result(startedAt, { reused: false });
    } catch (error) {
      logger.error(`开屏失败: ${error.message}`);
      this.clearTimers();
      if (this.animator) this.animator.abort('启动失败');
      this.animator = null;
      this.note2renderer(`启动失败：${error.message}`);
      // 失败时别动窗口尺寸，把控制权还给 Codex 自己
      this.endRect = this.original || this.areaPx;
      await sleep(1600);
      await this.handoff();
      return this.result(startedAt, { error: error.message });
    }
  }

  result(startedAt, extra) {
    return { ok: !extra.error, elapsed: Date.now() - startedAt, ...extra, note: this.note };
  }

  /** 已经运行的 Codex 能不能直接接管 */
  async reuseExisting() {
    try {
      const hit = launch.findPortFile();
      if (!hit) return false;
      const port = Number(String(hit.raw).split(/\r?\n/)[0]);
      if (!Number.isInteger(port) || port <= 0) return false;

      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return false;
      const list = await res.json();
      if (!list.some((t) => t.type === 'page' && String(t.url).startsWith('app://'))) return false;

      const injector = new Injector({
        port,
        css: this.composed.css,
        bg: this.composed.bg,
        scheme: this.composed.scheme,
      });
      await injector.start();
      const ok = await injector.waitApplied(4000);
      if (!ok) {
        injector.stop();
        return false;
      }
      this.passiveInjector = injector;

      const pid = launch.mainPid();
      const hwnd = pid ? win32.findMainWindow(pid) : 0;
      if (hwnd) win32.focus(hwnd);
      return true;
    } catch (error) {
      logger.warn(`复用已有实例失败: ${error.message}`);
      return false;
    }
  }

  async waitForWindow(pid, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = (pid && win32.findMainWindow(pid)) || win32.findMainWindow(launch.mainPid() || 0);
      if (hit) return hit;
      await sleep(120);
    }
    return 0n;
  }

  async waitForAnimator(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.animator || this.phase !== 'running') return;
      this.tryBuildAnimator();
      if (this.animator) return;
      await sleep(60);
    }
  }

  /** 上一次中途被杀掉：把窗口尺寸还回去，别让 Codex 记住一个 500×700 的大小 */
  restoreIfDirty() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
    } catch {
      return;
    }
    if (!saved || !saved.dirty || !saved.original) return;
    if (win32.isMaximized(this.hwnd)) win32.show(this.hwnd, win32.SW_RESTORE);
    win32.setRect(this.hwnd, saved.original, { topmost: false });
    logger.warn(`恢复上次中断的窗口尺寸 ${saved.original.w}x${saved.original.h}`);
    this.clearSession();
  }

  clearSession() {
    try {
      fs.writeFileSync(this.sessionFile, JSON.stringify({ dirty: false, at: new Date().toISOString() }, null, 2));
    } catch {
      /* ignore */
    }
  }

  /** 量一遍窗口的原始尺寸、最小尺寸、所在显示器工作区 */
  measure() {
    if (win32.isMaximized(this.hwnd)) win32.show(this.hwnd, win32.SW_RESTORE);
    this.original = win32.getRect(this.hwnd);
    this.minTrack = win32.getMinTrack(this.hwnd) || { w: 1, h: 1 };

    const fromSplash = this.splashWindow && !this.splashWindow.isDestroyed() ? win32.getRect(this.splashHwnd) : null;
    this.areaPx = fromSplash && fromSplash.w > 0 ? fromSplash : win32.getMonitorWorkArea(this.hwnd);
    this.endRect = this.store.get().window.endMode === 'fill' ? this.areaPx : this.original;

    logger.info(
      `窗口原始 ${this.original.w}x${this.original.h} 最小 ${this.minTrack.w}x${this.minTrack.h} 工作区 ${this.areaPx.w}x${this.areaPx.h}`,
    );
  }

  tryBuildAnimator() {
    if (this.animator || this.phase !== 'running') return;
    if (!this.normalized || !this.hwnd || !this.splashWindow || this.skipRequested) return;
    if (!this.endRect) return;

    // 映射空间用「渲染层认为的物理视口」，不是窗口的实际物理宽度：
    // 两者会差约 1%，用窗口宽度会让窗口和画面上那块视频区域错开几十像素。
    const cw = this.viewport && this.viewport.w > 0 ? this.viewport.w : this.areaPx.w;
    const ch = this.viewport && this.viewport.h > 0 ? this.viewport.h : this.areaPx.h;
    const layout = {
      x: this.normalized.x * cw,
      y: this.normalized.y * ch,
      w: this.normalized.w * cw,
      h: this.normalized.h * ch,
    };

    const entryTime = findEntryTime(this.media.frames, layout, cw, ch, this.minTrack);
    const settings = this.store.get();

    this.animator = new WindowAnimator({
      hwnd: this.hwnd,
      frames: this.media.frames,
      layout,
      cw,
      ch,
      entryTime,
      transitionEnd: this.media.transitionEnd,
      endRect: this.endRect,
      minTrack: this.minTrack,
      original: this.original,
      origin: { x: this.areaPx.x, y: this.areaPx.y },
      sessionFile: this.sessionFile,
      onEnter: () => {
        const rate = Number(settings.splash.slowRate);
        if (Number.isFinite(rate) && rate > 0 && rate < 1) this.send('splash:rate', rate);
        probe.mark('entry', {
          entryTime,
          rect: this.animator ? this.animator.rectAt(entryTime) : null,
          minTrack: this.minTrack,
        });
      },
      onDone: () => this.handoff(),
    });

    logger.info(`入场时间 ${entryTime.toFixed(2)}s / 过渡结束 ${this.media.transitionEnd}s`);

    // 两侧各算一次物理矩形，差值就是验收里的「portal 与视频误差」
    if (this.reportedPx) {
      const p = this.reportedPx;
      const dx = Math.abs(p.x - layout.x);
      const dy = Math.abs(p.y - layout.y);
      const dw = Math.abs(p.w - layout.w);
      const dh = Math.abs(p.h - layout.h);
      const worst = Math.max(dx, dy, dw, dh);
      const line = `视频矩形(物理) 渲染层=${Math.round(p.w)}x${Math.round(p.h)}@${Math.round(p.x)},${Math.round(p.y)} 主进程=${Math.round(layout.w)}x${Math.round(layout.h)}@${Math.round(layout.x)},${Math.round(layout.y)} 最大偏差=${worst.toFixed(1)}px`;
      if (worst <= 2) logger.info(line);
      else logger.warn(`${line}（超过 2px）`);
    }

    if (this.holding) {
      this.holding = false;
      this.send('splash:resume');
    }
    if (this.lastTime > 0) this.animator.push(this.lastTime);
  }

  /** 渲染层不再送帧时兜底收尾 */
  startStallGuard() {
    this.after(900, () => this.checkStall());
  }

  checkStall() {
    if (this.phase !== 'running') return;
    const idle = Date.now() - (this.lastFrameAt || 0);
    // 门限别太长：视频末尾停帧时，用户看到的就是「画面卡住不动」，
    // 1.4s 的空白比尾段被压短更难受。
    if (this.animator && this.animator.entered && !this.animator.finished && idle > 900) {
      logger.warn(`渲染层停帧 ${idle}ms，强制收尾动画`);
      this.animator.runTail();
    }
    this.after(600, () => this.checkStall());
  }

  // ---------------------------------------------------------------- 收尾

  async handoff() {
    if (this.handedOff) return;
    this.handedOff = true;
    this.clearTimers();

    // 主题先到位，否则窗口铺满那一瞬间会露出默认配色
    if (this.injector) {
      const ok = await this.injector.waitApplied(5000);
      if (!ok) logger.warn('交接时主题仍未注入成功');
    }

    const target = this.endRect || this.areaPx || (this.hwnd ? win32.getRect(this.hwnd) : null);
    if (this.hwnd && win32.isWindow(this.hwnd) && target) {
      win32.setRect(this.hwnd, target, { topmost: false });
      win32.focus(this.hwnd);
    }

    await this.fadeSplash();

    if (this.hwnd && win32.isWindow(this.hwnd)) win32.focus(this.hwnd);
    this.phase = 'done';
    this.finished.resolve(true);
    logger.info('开屏交接完成');
  }

  async fadeSplash() {
    const win = this.splashWindow;
    if (!win || win.isDestroyed()) {
      this.splashWindow = null;
      return;
    }
    this.send('splash:fade');

    const steps = 12;
    const stepMs = 20;
    let faded = true;
    for (let i = steps - 1; i >= 0; i -= 1) {
      if (win.isDestroyed()) {
        this.splashWindow = null;
        return;
      }
      try {
        win.setOpacity(i / steps);
      } catch {
        faded = false;
        break;
      }
      await sleep(stepMs);
    }
    if (!faded) logger.warn('窗口透明度不受支持，淡出退化为直接隐藏');

    try {
      win.setOpacity(0);
      win.hide();
      win.setAlwaysOnTop(false);
      win.destroy();
    } catch {
      /* 已经销毁 */
    }
    this.splashWindow = null;
  }

  /** 出错后用户手动「恢复窗口」 */
  restoreWindow() {
    if (!this.hwnd || !win32.isWindow(this.hwnd)) return { ok: false, reason: 'Codex 不在运行' };
    const rect = this.original || win32.getMonitorWorkArea(this.hwnd);
    if (!rect) return { ok: false, reason: '拿不到屏幕信息' };
    win32.setRect(this.hwnd, rect, { topmost: false, show: true });
    win32.focus(this.hwnd);
    this.clearSession();
    return { ok: true, rect };
  }

  /** 设置面板改了主题：立刻推给已注入的页面 */
  async applyTheme() {
    const settings = this.store.get();
    this.composed = theme.compose({ settings, skins: this.skins });
    const target = this.injector || this.passiveInjector;
    if (!target) return { ok: false, reason: 'Codex 尚未接管', note: this.composed.note };
    const stats = await target.update({
      css: this.composed.css,
      bg: this.composed.bg,
      scheme: this.composed.scheme,
    });
    return { ok: true, ...stats, note: this.composed.note };
  }

  dispose() {
    this.clearTimers();
    if (this.injector) this.injector.stop();
    if (this.passiveInjector) this.passiveInjector.stop();
    if (this.splashWindow && !this.splashWindow.isDestroyed()) this.splashWindow.destroy();
    this.splashWindow = null;
  }
}

module.exports = { Boot, hwndOf };
