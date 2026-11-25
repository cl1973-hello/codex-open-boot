'use strict';

const FRAME_KEYS = ['time', 'x', 'y', 'width', 'height'];

function toFinite(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value, fallback) {
  const n = toFinite(value, fallback);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Accepts Time/X/Width (reference project) and time/x/width (our theme.json). */
function normaliseFrame(raw) {
  const get = (...names) => {
    for (const name of names) {
      if (raw && raw[name] !== undefined) return raw[name];
    }
    return undefined;
  };
  return {
    time: Math.max(0, toFinite(get('time', 'Time'), 0)),
    x: toFinite(get('x', 'X'), 0),
    y: toFinite(get('y', 'Y'), 0),
    width: toFinite(get('width', 'Width'), 1),
    height: toFinite(get('height', 'Height'), 1),
  };
}

/**
 * Normalise a theme object coming from disk. Never throws: bad values fall back to
 * something renderable so the splash can always hand off to Codex.
 */
function normalizeTheme(raw, durationSeconds) {
  const theme = raw && typeof raw === 'object' ? raw : {};
  const duration = toFinite(theme.duration, durationSeconds) || durationSeconds || 10;

  const frames = Array.isArray(theme.screenFrames)
    ? theme.screenFrames.map(normaliseFrame).filter((f) => Number.isFinite(f.time))
    : [];

  // Keep at least two synthetic frames so the transition still works.
  if (frames.length === 0) {
    frames.push({ time: 0, x: 0, y: 0, width: 1, height: 1 });
    frames.push({ time: duration, x: 0, y: 0, width: 1, height: 1 });
  } else if (frames.length === 1) {
    frames.push({ ...frames[0], time: frames[0].time + 0.5 });
  }

  frames.sort((a, b) => a.time - b.time);

  const transitionEnd = Math.min(duration, Math.max(0.1, toFinite(theme.transitionEnd, frames[frames.length - 1].time)));
  const transitionStart = Math.min(transitionEnd - 0.05, Math.max(0, toFinite(theme.transitionStart, Math.max(0, transitionEnd - 1))));
  const holdAt = Math.min(transitionStart, Math.max(0, toFinite(theme.holdAt, 0)));
  const expandStart = Math.min(transitionEnd, Math.max(transitionStart, toFinite(theme.expandStart, transitionStart)));

  return {
    ...theme,
    schemaVersion: toFinite(theme.schemaVersion, 1),
    id: typeof theme.id === 'string' && theme.id ? theme.id : 'custom',
    displayName: typeof theme.displayName === 'string' ? theme.displayName : 'Custom',
    video: typeof theme.video === 'string' && theme.video ? theme.video : 'video.mp4',
    poster: typeof theme.poster === 'string' && theme.poster ? theme.poster : 'poster.png',
    holdPoster: typeof theme.holdPoster === 'string' && theme.holdPoster ? theme.holdPoster : 'hold.png',
    fit: theme.fit === 'contain' ? 'contain' : 'cover',
    zoom: Math.min(2, Math.max(1, toFinite(theme.zoom, 1))),
    duration,
    holdAt,
    transitionStart,
    expandStart,
    transitionEnd,
    screenFrames: frames,
  };
}

const APP_ID_RE = /^[A-Za-z0-9_.-]+![A-Za-z0-9_.-]+$/;

function isValidAppId(value) {
  return typeof value === 'string' && APP_ID_RE.test(value);
}

/** Returns { ok, errors[] } – used before writing a calibrated theme back to disk. */
function validateTheme(theme) {
  const errors = [];
  const frames = theme && theme.screenFrames;

  if (!Array.isArray(frames)) {
    return { ok: false, errors: ['screenFrames 必须是数组'] };
  }
  if (frames.length < 2) errors.push('至少需要 2 个关键帧');

  let previous = -Infinity;
  frames.forEach((f, i) => {
    const label = `第 ${i + 1} 帧`;
    FRAME_KEYS.forEach((key) => {
      const v = f[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${label} ${key} 不是有限数字`);
    });
    if (f.time < 0) errors.push(`${label} time 不能为负`);
    if (f.time <= previous) errors.push(`${label} time 必须严格递增`);
    previous = f.time;
    ['x', 'y', 'width', 'height'].forEach((key) => {
      if (f[key] < 0 || f[key] > 1) errors.push(`${label} ${key} 必须在 0..1`);
    });
    if (f.width <= 0 || f.height <= 0) errors.push(`${label} 宽高必须大于 0`);
    if (f.x + f.width > 1.001 || f.y + f.height > 1.001) errors.push(`${label} 超出画面范围`);
  });

  const { holdAt, transitionStart, transitionEnd } = theme;
  if (!(transitionStart > 0)) errors.push('transitionStart 必须大于 0');
  if (!(transitionStart >= holdAt)) errors.push('holdAt 不能晚于 transitionStart');
  if (!(transitionEnd > transitionStart)) errors.push('transitionEnd 必须晚于 transitionStart');
  if (Number.isFinite(theme.duration) && !(transitionEnd <= theme.duration - 0.02)) {
    errors.push('transitionEnd 必须早于视频结尾 0.02 秒以上');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  toFinite,
  clamp01,
  normaliseFrame,
  normalizeTheme,
  validateTheme,
  isValidAppId,
  APP_ID_RE,
};
