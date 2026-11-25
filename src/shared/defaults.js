'use strict';

const { toFinite } = require('./validate');

/**
 * v2：本工具不再有自己的工作台，只负责「开屏动画 + 给 Codex 注入主题」。
 * 因此去掉了 recentProjects / navCollapsed / settingsOpen 这类工作台状态。
 */
const DEFAULT_SETTINGS = {
  schemaVersion: 2,
  skinId: 'cosmic',
  background: {
    mode: 'builtin', // builtin | file | none
    filePath: null,
    fit: 'cover', // cover | contain
    opacity: 1, // 背景图自身不透明度 0..1
    panelAlpha: 0.82, // UI 面板不透明度 0.35..1（越低，背景越透出来）
    blur: 0, // px 0..40
    scrim: 0.28, // 0..0.72（内部再乘 0.72）
    vignette: 0.45, // 0..1
  },
  splash: {
    enabled: true,
    volume: 0.6,
    skippable: true,
    tailMs: 0, // 0 => 自动
    slowRate: 0.6, // 入场后把视频放慢到该倍速，让「长成窗口」那一段看得清；1 = 不放慢
  },
  codex: {
    launch: 'alias', // alias（执行别名，保包身份）| exe（直启安装目录里的 exe）
  },
  window: {
    endMode: 'fill', // fill（铺满工作区）| keep（保持 Codex 原尺寸）
  },
  ui: {
    // 只用来记住「已经问过要不要接管 Codex 快捷方式」，避免每次启动都弹窗。
    // 1.0 的 onboardedAt 是另一回事（看过三步引导），刻意不复用这个字段：
    // 否则升级上来的用户会因为旧时间戳而永远看不到 2.0 的接管询问。
    entryAskedAt: null,
  },
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  Object.keys(patch).forEach((key) => {
    const value = patch[key];
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  });
  return out;
}

function ratio(value, fallback) {
  const n = toFinite(value, fallback);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clamp(value, min, max, fallback) {
  const n = toFinite(value, fallback);
  return n < min ? min : n > max ? max : n;
}

/**
 * settings.json 是用户可编辑的，永远不要相信它。
 * 这里重建一个只含已知字段的对象：v1 留下的工作台状态（recentProjects / bounds /
 * codexAppId）会被自然丢弃，而不是一路带到新版本里。
 */
function sanitizeSettings(raw) {
  const input = isPlainObject(raw) ? raw : {};
  const merged = deepMerge(DEFAULT_SETTINGS, input);
  // v1 的 scrim 是「算出来的极小值」，照搬到 v2 会得到一个几乎不遮罩的难看效果，
  // 迁移时只把这一项拉回默认，其余用户选择（背景图、音量）保留。
  if (Number(input.schemaVersion) === 1) {
    merged.background = { ...(merged.background || {}), scrim: DEFAULT_SETTINGS.background.scrim };
  }
  const bg = isPlainObject(merged.background) ? merged.background : {};
  const splash = isPlainObject(merged.splash) ? merged.splash : {};
  const codex = isPlainObject(merged.codex) ? merged.codex : {};
  const win = isPlainObject(merged.window) ? merged.window : {};
  const ui = isPlainObject(merged.ui) ? merged.ui : {};

  const background = {
    mode: ['builtin', 'file', 'none'].includes(bg.mode) ? bg.mode : 'builtin',
    filePath: typeof bg.filePath === 'string' && bg.filePath ? bg.filePath : null,
    fit: bg.fit === 'contain' ? 'contain' : 'cover',
    opacity: ratio(bg.opacity, 1),
    panelAlpha: clamp(bg.panelAlpha, 0.35, 1, 0.82),
    blur: clamp(bg.blur, 0, 40, 0),
    scrim: ratio(bg.scrim, 0.28),
    vignette: ratio(bg.vignette, 0.45),
  };
  if (background.mode === 'file' && !background.filePath) background.mode = 'builtin';

  return {
    schemaVersion: 2,
    skinId: typeof merged.skinId === 'string' && merged.skinId ? merged.skinId.slice(0, 40) : 'cosmic',
    background,
    splash: {
      enabled: splash.enabled !== false,
      volume: ratio(splash.volume, 0.6),
      skippable: splash.skippable !== false,
      tailMs: clamp(splash.tailMs, 0, 3000, 0),
      slowRate: clamp(splash.slowRate, 0.25, 1, 0.6),
    },
    codex: {
      launch: codex.launch === 'exe' ? 'exe' : 'alias',
    },
    window: {
      endMode: win.endMode === 'keep' ? 'keep' : 'fill',
    },
    ui: {
      entryAskedAt: typeof ui.entryAskedAt === 'string' ? ui.entryAskedAt : null,
    },
  };
}

module.exports = { DEFAULT_SETTINGS, deepMerge, sanitizeSettings, isPlainObject };
