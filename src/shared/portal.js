'use strict';

/**
 * 视频矩形 -> 真实窗口矩形的映射（纯函数，有单测）。
 *
 * M0 实测结论：Codex 窗口有 793×991 物理像素的硬性最小尺寸，不能更小；
 * 而视频里的矩形要长到足够大才放得下窗口。所以必须动态算出「入场时间」，
 * 而不是把 6.8s 写死。
 */

const { layoutVideo, framesAt, mapFrame, clampRect, tailMs, lerpRect, easeInOutCubic } = require('./geometry');

/**
 * 复刻播放层的布局：先按 object-fit 算出视频显示区，再按 zoom 以中心放大，
 * 用来裁掉视频里自带的黑边。
 */
function layoutFor(cw, ch, videoW, videoH, fit, zoom) {
  const base = layoutVideo(cw, ch, videoW || 1280, videoH || 720, fit === 'contain' ? 'contain' : 'cover');
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  if (z === 1) return base;
  return {
    x: base.x - (base.w * (z - 1)) / 2,
    y: base.y - (base.h * (z - 1)) / 2,
    w: base.w * z,
    h: base.h * z,
  };
}

/** 某个时间点的像素矩形（已收进视口） */
function portalRectAt(frames, layout, time, cw, ch) {
  return clampRect(mapFrame(framesAt(frames, time), layout), cw, ch);
}

/**
 * 真实窗口最早能入场的时间：第一帧矩形宽高都 >= 窗口最小尺寸。
 * 找不到就返回最后一帧时间（此时只能直接到尾段）。
 */
function findEntryTime(frames, layout, cw, ch, min, stepSec = 0.02) {
  if (!Array.isArray(frames) || frames.length === 0) return 0;
  const minW = Math.max(1, Number(min && min.w) || 1);
  const minH = Math.max(1, Number(min && min.h) || 1);
  const start = frames[0].time;
  const end = frames[frames.length - 1].time;
  for (let t = start; t <= end + 1e-6; t += stepSec) {
    const rect = portalRectAt(frames, layout, t, cw, ch);
    if (rect.w >= minW && rect.h >= minH) return Math.min(t, end);
  }
  return end;
}

/** 从入场矩形到终点的收尾动画（时长沿用 tailMs 的自适应规则） */
function tailFrames(from, to, durationMs, steps = 24) {
  const out = [];
  const n = Math.max(2, steps);
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    out.push({ at: p * durationMs, rect: lerpRect(from, to, easeInOutCubic(p)) });
  }
  return out;
}

module.exports = { layoutFor, portalRectAt, findEntryTime, tailFrames, tailMs };
