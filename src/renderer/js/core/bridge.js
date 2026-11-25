'use strict';

/**
 * Bridge to the main process. When the page is opened in a plain browser (handy for
 * styling the workbench without launching Electron) we fall back to a local mock so
 * every module keeps working unchanged.
 */

const { DEFAULT_SETTINGS, sanitizeSettings, deepMerge } = require('../../../shared/defaults');
const { normalizeTheme } = require('../../../shared/validate');

const STORAGE_KEY = 'codex-open-boot:mock-settings';
const MEDIA_BASE = '../../assets/media';

function readMockSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitizeSettings({});
  }
}

function writeMockSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    return fallback;
  }
}

function createMockBridge() {
  let settings = readMockSettings();

  return {
    __mock: true,

    async bootstrap() {
      const rawTheme = await loadJson(`${MEDIA_BASE}/theme.json`, {});
      const rawSkins = await loadJson(`${MEDIA_BASE}/skins.json`, {});
      const theme = normalizeTheme(rawTheme, rawTheme.duration);
      const skins = Object.keys(rawSkins.skins || {}).map((id) => ({
        id,
        name: rawSkins.skins[id].name || id,
        description: rawSkins.skins[id].description || '',
        ornament: !!rawSkins.skins[id].ornament,
        colors: rawSkins.skins[id].colors,
      }));
      return {
        settings,
        theme,
        themeSource: 'mock',
        skins: skins.length ? skins : [],
        defaultSkin: rawSkins.defaultSkin || 'cosmic',
        media: {
          dir: MEDIA_BASE,
          video: rawTheme.video ? `${MEDIA_BASE}/${rawTheme.video}` : null,
          videoName: 'video.mp4',
          poster: `${MEDIA_BASE}/poster.png`,
          hold: `${MEDIA_BASE}/hold.png`,
          builtinBackground: `${MEDIA_BASE}/hold.png`,
        },
        background: { mode: 'builtin', url: `${MEDIA_BASE}/hold.png`, lum: { avg: 0.02, p90: 0.06 } },
        version: '1.0.0-web',
        dataDir: 'localStorage',
        logPath: null,
        isPackaged: false,
        calibrate: new URLSearchParams(location.search).has('calibrate'),
      };
    },

    async patchSettings(patch) {
      settings = sanitizeSettings(deepMerge(settings, patch || {}));
      writeMockSettings(settings);
      return { settings, background: { mode: 'builtin', url: `${MEDIA_BASE}/hold.png`, lum: { avg: 0.02, p90: 0.06 } } };
    },

    async resetSettings() {
      settings = sanitizeSettings(DEFAULT_SETTINGS);
      writeMockSettings(settings);
      return { settings, background: { mode: 'builtin', url: `${MEDIA_BASE}/hold.png`, lum: { avg: 0.02, p90: 0.06 } } };
    },

    async reloadTheme() {
      return this.bootstrap();
    },
    async saveTheme(theme) {
      return { ok: true, theme };
    },
    async chooseBackground() {
      return { ok: false, reason: 'mock' };
    },
    async importBackgroundPath() {
      return { ok: false, reason: 'mock' };
    },
    async importBackgroundBytes() {
      return { ok: false, reason: 'mock' };
    },
    async describeBackground() {
      return { settings, background: { mode: 'builtin', url: `${MEDIA_BASE}/hold.png`, lum: { avg: 0.02, p90: 0.06 } } };
    },
    async pickProject() {
      return { ok: false, reason: 'mock' };
    },
    async removeProject() {
      return { ok: true, settings };
    },
    async openProject() {
      return { ok: false, reason: 'mock' };
    },
    async launchCodex() {
      return { ok: false, reason: 'mock' };
    },
    async openDataDir() {
      return { ok: false };
    },
    async openLog() {
      return { ok: false };
    },
    async openExternal() {
      return { ok: false };
    },
    async splashDone() {
      return { ok: true };
    },
    async setSplashMode() {
      return { ok: true };
    },
    async minimize() {
      return { ok: true };
    },
    async toggleMaximize() {
      return { ok: true };
    },
    async close() {
      return { ok: true };
    },
    async windowState() {
      return { maximized: false, visible: true };
    },
    pathForFile() {
      return null;
    },
    onWindowState() {
      return () => {};
    },
  };
}

function createBridge() {
  if (window.bridge) return window.bridge;
  console.warn('[codex-open-boot] running without Electron main process – using mock bridge');
  return createMockBridge();
}

module.exports = { createBridge, createMockBridge };
