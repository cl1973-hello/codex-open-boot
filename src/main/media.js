'use strict';

/**
 * 读取开屏素材描述（theme.json）：视频/海报路径、视频里的「屏幕」轨迹、缩放。
 *
 * theme.json 可以由用户放在 %APPDATA%\CodexOpenBoot\theme.json 覆盖内置的那份，
 * 所以这里每个字段都要当作不可信输入来清洗。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_FRAMES = 600;

const DEFAULTS = {
  duration: 0,
  fit: 'cover',
  zoom: 1,
  transitionStart: 0,
  transitionEnd: 0,
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function unit(value, fallback) {
  const n = num(value, fallback);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 归一化矩形序列，按时间升序，丢掉坏点 */
function sanitizeFrames(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const frame of raw.slice(0, MAX_FRAMES)) {
    if (!frame || typeof frame !== 'object') continue;
    const time = num(frame.time, NaN);
    if (!Number.isFinite(time) || time < 0) continue;
    out.push({
      time,
      x: unit(frame.x, 0),
      y: unit(frame.y, 0),
      width: unit(frame.width, 0),
      height: unit(frame.height, 0),
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function fileUrl(file) {
  if (!file) return null;
  try {
    return pathToFileURL(file).href;
  } catch {
    return null;
  }
}

function resolveInside(root, name) {
  if (typeof name !== 'string' || !name) return null;
  const target = path.resolve(root, name);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * @param {{userDataDir:string, mediaDir:string}} dirs
 * @returns {{
 *   ok: boolean, source: string|null, video: string|null, poster: string|null,
 *   fit: 'cover'|'contain', zoom: number, duration: number,
 *   transitionStart: number, transitionEnd: number, frames: Array<object>
 * }}
 */
function load({ userDataDir, mediaDir }) {
  const candidates = [path.join(userDataDir, 'theme.json'), path.join(mediaDir, 'theme.json')];
  let source = null;
  let raw = null;
  for (const file of candidates) {
    raw = readJson(file);
    if (raw) {
      source = file;
      break;
    }
  }

  const root = source ? path.dirname(source) : mediaDir;
  const data = raw && typeof raw === 'object' ? raw : {};

  const videoFile = resolveInside(root, data.video) || resolveInside(mediaDir, 'video.mp4');
  const posterFile = resolveInside(root, data.poster) || resolveInside(mediaDir, 'poster.png');

  const frames = sanitizeFrames(data.screenFrames);
  const duration = Math.max(0, num(data.duration, 0));
  const transitionEnd = Math.max(0, num(data.transitionEnd, frames.length ? frames[frames.length - 1].time : 0));
  const transitionStart = Math.min(transitionEnd, Math.max(0, num(data.transitionStart, frames.length ? frames[0].time : 0)));

  return {
    ok: !!videoFile && frames.length > 0,
    source,
    video: fileUrl(videoFile),
    poster: fileUrl(posterFile),
    fit: data.fit === 'contain' ? 'contain' : 'cover',
    zoom: Math.min(2, Math.max(1, num(data.zoom, DEFAULTS.zoom))),
    duration,
    transitionStart,
    transitionEnd,
    frames,
  };
}

/** 只把渲染层需要的那部分发过去（帧数据留在主进程） */
function forRenderer(media, settings) {
  return {
    video: media.video,
    poster: media.poster,
    fit: media.fit,
    zoom: media.zoom,
    duration: media.duration,
    transitionStart: media.transitionStart,
    transitionEnd: media.transitionEnd,
    enabled: !!(settings && settings.splash && settings.splash.enabled !== false) && media.ok,
  };
}

module.exports = { load, forRenderer, sanitizeFrames };
