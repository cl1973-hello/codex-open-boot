'use strict';

const { toFinite, isValidAppId } = require('./validate');

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  skinId: 'cosmic',
  background: {
    mode: 'builtin', // builtin | file | none
    filePath: null,
    fit: 'cover', // cover | contain
    opacity: 1, // 0..1  -> exposed in the UI as 0–100 %
    blur: 0, // px, 0..40
    scrim: 0.28, // 0..0.72
    vignette: 0.45, // 0..1
  },
  splash: {
    enabled: true,
    volume: 0.6,
    skippable: true,
    gateTimeoutMs: 1200,
    tailMs: 0, // 0 => auto
    tailMode: 'auto', // auto | fixed
  },
  window: {
    bounds: null,
    maximized: false,
  },
  app: {
    codexAppId: 'OpenAI.Codex_2p2nqsd0c76g0!App',
    recentProjects: [],
  },
  ui: {
    navCollapsed: false,
    settingsOpen: true,
    onboardedAt: null,
  },
};

const MAX_PROJECTS = 8;

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

/** Defence in depth: settings.json is user-editable, never trust it. */
function sanitizeSettings(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, isPlainObject(raw) ? raw : {});
  const bg = merged.background;

  merged.skinId = typeof merged.skinId === 'string' && merged.skinId ? merged.skinId.slice(0, 40) : 'cosmic';
  merged.background = {
    mode: ['builtin', 'file', 'none'].includes(bg.mode) ? bg.mode : 'builtin',
    filePath: typeof bg.filePath === 'string' ? bg.filePath : null,
    fit: bg.fit === 'contain' ? 'contain' : 'cover',
    opacity: ratio(bg.opacity, 1),
    blur: Math.max(0, Math.min(40, toFinite(bg.blur, 0))),
    scrim: ratio(bg.scrim, 0.28) * 0.72,
    vignette: ratio(bg.vignette, 0.45),
  };
  if (merged.background.mode === 'file' && !merged.background.filePath) merged.background.mode = 'builtin';

  const splash = merged.splash;
  merged.splash = {
    enabled: splash.enabled !== false,
    volume: ratio(splash.volume, 0.6),
    skippable: splash.skippable !== false,
    gateTimeoutMs: Math.max(0, Math.min(5000, toFinite(splash.gateTimeoutMs, 1200))),
    tailMs: Math.max(0, Math.min(3000, toFinite(splash.tailMs, 0))),
    tailMode: splash.tailMode === 'fixed' ? 'fixed' : 'auto',
  };

  const bounds = merged.window && merged.window.bounds;
  merged.window = {
    maximized: !!(merged.window && merged.window.maximized),
    bounds:
      bounds &&
      ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(toFinite(bounds[k], NaN)))
        ? {
            x: Math.round(toFinite(bounds.x, 0)),
            y: Math.round(toFinite(bounds.y, 0)),
            width: Math.max(960, Math.round(toFinite(bounds.width, 1440))),
            height: Math.max(640, Math.round(toFinite(bounds.height, 900))),
          }
        : null,
  };

  const app = merged.app;
  merged.app = {
    codexAppId: isValidAppId(app.codexAppId) ? app.codexAppId : DEFAULT_SETTINGS.app.codexAppId,
    recentProjects: Array.isArray(app.recentProjects)
      ? app.recentProjects
          .filter((p) => typeof p === 'string' && p.length > 0 && p.length < 400)
          .slice(0, MAX_PROJECTS)
      : [],
  };

  const ui = merged.ui;
  merged.ui = {
    navCollapsed: !!ui.navCollapsed,
    settingsOpen: ui.settingsOpen !== false,
    onboardedAt: typeof ui.onboardedAt === 'string' ? ui.onboardedAt : null,
  };

  merged.schemaVersion = 1;
  return merged;
}

module.exports = { DEFAULT_SETTINGS, MAX_PROJECTS, deepMerge, sanitizeSettings, isPlainObject };
