'use strict';

/**
 * 用视频时间驱动真实 Codex 窗口的矩形。
 *
 * 时序（M0 实测校准）：
 *   t < entryTime  -> 窗口先摆在入场矩形（被开屏窗盖住，但仍在渲染）
 *   entryTime..end -> 每帧按视频关键帧缩放窗口
 *   帧结束后       -> 尾段补间到目标矩形，然后交出前台
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const win32 = require('./win32');
const { portalRectAt, tailMs, tailFrames } = require('../shared/portal');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class WindowAnimator {
  constructor(options) {
    const {
      hwnd,
      frames,
      layout,
      cw,
      ch,
      entryTime,
      transitionEnd,
      endRect,
      minTrack,
      original,
      origin,
      sessionFile,
      onDone,
      onEnter,
      onError,
    } = options;

    this.hwnd = hwnd;
    this.frames = frames;
    this.layout = layout;
    this.cw = cw;
    this.ch = ch;
    this.entryTime = entryTime;
    this.transitionEnd = transitionEnd;
    this.endRect = endRect;
    this.minTrack = minTrack;
    this.original = original;
    // 视频布局是相对内容区左上角的；SetWindowPos 需要屏幕坐标，这里统一加偏移
    this.ox = Math.round((origin && origin.x) || 0);
    this.oy = Math.round((origin && origin.y) || 0);
    this.sessionFile = sessionFile;
    this.onDone = onDone || (() => {});
    this.onEnter = onEnter || (() => {});
    this.onError = onError || (() => {});

    this.entered = false;
    this.finished = false;
    this.lastRect = null;
    this.dirty = false;
  }

  rectAt(time) {
    const raw = portalRectAt(this.frames, this.layout, time, this.cw, this.ch);
    // 窗口不能小于最小跟踪尺寸，否则 SetWindowPos 会被钳制并导致跳变
    const w = Math.max(raw.w, this.minTrack.w);
    const h = Math.max(raw.h, this.minTrack.h);
    // 保持居中，避免只往右下角长
    const cx = raw.x + raw.w / 2;
    const cy = raw.y + raw.h / 2;
    return {
      x: Math.round(cx - w / 2) + this.ox,
      y: Math.round(cy - h / 2) + this.oy,
      w: Math.round(w),
      h: Math.round(h),
    };
  }

  markDirty() {
    this.dirty = true;
    try {
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
      fs.writeFileSync(
        this.sessionFile,
        JSON.stringify(
          {
            dirty: true,
            hwnd: String(this.hwnd),
            original: this.original,
            at: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      logger.warn(`写 session.json 失败: ${error.message}`);
    }
  }

  /** 把窗口摆到入场矩形并压在最上层（不抢焦点） */
  prepare() {
    if (win32.isMaximized(this.hwnd)) win32.show(this.hwnd, win32.SW_RESTORE);
    const rect = this.rectAt(this.entryTime);
    this.markDirty();
    win32.setRect(this.hwnd, rect, { topmost: true, show: true });
    this.lastRect = rect;
    logger.info(`入场 ${this.entryTime.toFixed(2)}s 矩形 ${rect.w}x${rect.h} @ ${rect.x},${rect.y}`);
    try {
      this.onEnter();
    } catch {
      /* 回调不该影响动画 */
    }
  }

  /** 播放层每帧调用 */
  push(time) {
    if (this.finished || !win32.isWindow(this.hwnd)) return;
    if (time < this.entryTime - 0.001) return;

    if (!this.entered) {
      this.entered = true;
      this.prepare();
    }

    if (time >= this.transitionEnd) {
      this.runTail();
      return;
    }

    const rect = this.rectAt(time);
    if (this.lastRect && Math.abs(rect.w - this.lastRect.w) < 1 && Math.abs(rect.h - this.lastRect.h) < 1 && Math.abs(rect.x - this.lastRect.x) < 1) {
      return;
    }
    win32.setRect(this.hwnd, rect, { topmost: true });
    this.lastRect = rect;
  }

  /** 尾段：从当前矩形补间到终态 */
  async runTail(overrideMs) {
    if (this.finished) return;
    this.finished = true;
    const from = this.lastRect || this.rectAt(this.transitionEnd);
    const to = this.endRect;
    const duration = overrideMs || tailMs(from, this.cw, this.ch);
    const frames = tailFrames(from, to, duration, 20);
    const startedAt = Date.now();

    for (const frame of frames) {
      const wait = startedAt + frame.at - Date.now();
      if (wait > 0) await sleep(wait);
      if (!win32.isWindow(this.hwnd)) return;
      win32.setRect(this.hwnd, frame.rect, { topmost: true });
    }

    win32.setRect(this.hwnd, to, { topmost: false });
    this.clearDirty();
    logger.info(`尾段完成 ${to.w}x${to.h}（${duration}ms）`);
    this.onDone();
  }

  /** 跳过：立刻收尾 */
  skip() {
    if (this.entered) {
      this.runTail(320);
    } else {
      this.finished = true;
      this.clearDirty();
      this.onDone();
    }
  }

  /** 出错/取消：还原窗口尺寸 */
  abort(reason) {
    this.finished = true;
    if (win32.isWindow(this.hwnd) && this.original) {
      try {
        win32.setRect(this.hwnd, this.original, { topmost: false });
      } catch {
        /* ignore */
      }
    }
    this.clearDirty();
    if (reason) logger.warn(`动画中止: ${reason}`);
  }

  clearDirty() {
    this.dirty = false;
    try {
      fs.writeFileSync(this.sessionFile, JSON.stringify({ dirty: false, at: new Date().toISOString() }, null, 2));
    } catch {
      /* ignore */
    }
  }
}

module.exports = { WindowAnimator };
