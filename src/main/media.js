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
 * 把内置素材同步一份到 userData，之后 file:// 一律指向这份副本。
 *
 * 起因是一个只在便携版出现的坑：portable.exe 每次运行都会先清空同一个临时解压目录
 * 再解压。程序已经在跑时再双击一次，第二个实例的 wrapper 会把第一个实例正在用的
 * `resources/media` 整个删掉，随后自己因为单实例锁立刻退出 —— 结果是先跑着的那个实例
 * 从此再也读不到 video.mp4，每次开屏都 `video-error`。
 *
 * 只按文件大小判断是否需要复制：素材更新时视频体积几乎必然变化，而解压出来的 mtime
 * 每次都是新的，不能拿它当依据。
 */
function ensureStableMedia(userDataDir, mediaDir) {
  const dst = path.join(userDataDir, 'media');
  let names = null;
  try {
    names = fs.readdirSync(mediaDir);
  } catch {
    // 源目录已经没了（就是上面那个场景），能用副本就用副本
    return { dir: fs.existsSync(dst) ? dst : mediaDir, copied: 0, source: 'missing' };
  }

  try {
    fs.mkdirSync(dst, { recursive: true });
    let copied = 0;
    for (const name of names) {
      const src = path.join(mediaDir, name);
      let stat = null;
      try {
        stat = fs.statSync(src);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const out = path.join(dst, name);
      let same = false;
      try {
        same = fs.statSync(out).size === stat.size;
      } catch {
        same = false;
      }
      if (same) continue;

      try {
        fs.copyFileSync(src, out);
        copied += 1;
      } catch {
        // 写不进去（磁盘满 / 只读）就退回原始目录，宁可下次再试也不能因此开不了屏
        return { dir: mediaDir, copied, source: 'copy-failed' };
      }
    }
    return { dir: dst, copied, source: copied > 0 ? 'copied' : 'cached' };
  } catch {
    return { dir: mediaDir, copied: 0, source: 'mkdir-failed' };
  }
}

/**
 * @param {{userDataDir:string, mediaDir:string}} dirs
 * @returns {{
 *   ok: boolean, source: string|null, video: string|null, poster: string|null,
 *   fit: 'cover'|'contain', zoom: number, duration: number,
 *   transitionStart: number, transitionEnd: number, frames: Array<object>,
 *   mediaDir: string, mediaSource: string
 * }}
 */
function load({ userDataDir, mediaDir: bundledDir }) {
  const stable = ensureStableMedia(userDataDir, bundledDir);
  const mediaDir = stable.dir;
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
    mediaDir,
    mediaSource: stable.source,
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
