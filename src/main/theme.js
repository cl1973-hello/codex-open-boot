'use strict';

/**
 * 把 settings + 皮肤 + 背景图 组装成要注入 Codex 的 CSS。
 * 这里只做「决定用哪些颜色」，真正的字符串拼装在 shared/theme-css.js（纯函数、有单测）。
 */

const fs = require('fs');
const path = require('path');
const { buildThemeCss, schemeOf } = require('../shared/theme-css');
const { requiredScrim } = require('../shared/contrast');
const image = require('./image');
const logger = require('./logger');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const FALLBACK_SKIN = {
  id: 'cosmic',
  name: '星河',
  description: '深空墨绿 · 冷白星光 · 暖金点缀',
  colors: {
    background: '#070F12',
    sidebar: '#050B0E',
    surface: '#0D1A1E',
    surfaceRaised: '#13242A',
    border: '#2B4247',
    text: '#E4EEEB',
    muted: '#9DB5B6',
    accent: '#C8ECEB',
    accentText: '#102323',
    secondary: '#CFB98D',
    glow: '#284B4D',
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sanitizeSkin(raw, id) {
  const source = (raw && raw.colors) || {};
  const colors = {};
  for (const key of Object.keys(FALLBACK_SKIN.colors)) {
    colors[key] = HEX_RE.test(source[key]) ? source[key] : FALLBACK_SKIN.colors[key];
  }
  return {
    id,
    name: typeof (raw && raw.name) === 'string' ? raw.name.slice(0, 24) : id,
    description: typeof (raw && raw.description) === 'string' ? raw.description.slice(0, 80) : '',
    colors,
  };
}

/** 读 assets/media/skins.json（用户也可以放到 userData/skins.json 覆盖） */
function loadSkins(userDataDir, mediaDir) {
  const candidates = [path.join(userDataDir, 'skins.json'), path.join(mediaDir, 'skins.json')];
  let raw = null;
  for (const file of candidates) {
    raw = readJson(file);
    if (raw) break;
  }
  const list = [];
  if (raw && raw.skins && typeof raw.skins === 'object') {
    for (const id of Object.keys(raw.skins)) list.push(sanitizeSkin(raw.skins[id], id));
  }
  if (!list.length) list.push({ ...FALLBACK_SKIN });
  return { defaultSkin: (raw && raw.defaultSkin) || list[0].id, skins: list };
}

function resolveSkin(skins, skinId) {
  return skins.find((s) => s.id === skinId) || skins[0] || { ...FALLBACK_SKIN };
}

/**
 * @returns {{
 *   css: string, bg: boolean, skin: object, scheme: 'light'|'dark',
 *   scrim: number, raised: boolean, note: string|null, imageInfo: object|null
 * }}
 */
function compose({ settings, skins }) {
  const skin = resolveSkin(skins, settings.skinId);
  const bgSettings = settings.background;

  let imageInfo = null;
  let dataUrl = null;
  if (bgSettings.mode === 'file' && bgSettings.filePath) {
    imageInfo = image.prepare(bgSettings.filePath);
    if (imageInfo.error) logger.warn(`背景图不可用: ${imageInfo.error}`);
    dataUrl = imageInfo.dataUrl;
  }

  // 可读性守卫：背景太亮就自动加深遮罩，保证正文对比度 >= 4.5:1
  let scrim = bgSettings.scrim;
  let raised = false;
  let note = null;
  if (dataUrl) {
    const need = requiredScrim({
      bgHex: skin.colors.surface,
      textHex: skin.colors.text,
      imageLum: imageInfo.lum.p90,
      opacity: bgSettings.opacity,
      forcedScrim: bgSettings.scrim,
      minRatio: 4.5,
    });
    if (need.scrim > scrim) {
      scrim = need.scrim;
      raised = true;
      note = `背景较亮，遮罩已自动加深到 ${Math.round(scrim * 100)}%（对比度 ${need.ratio.toFixed(1)}:1）`;
    }
  }

  const css = buildThemeCss({
    skin,
    background: {
      imageDataUrl: dataUrl,
      opacity: bgSettings.opacity,
      panelAlpha: bgSettings.panelAlpha,
      blur: bgSettings.blur,
      scrim,
      vignette: bgSettings.vignette,
    },
  });

  return {
    css,
    bg: !!dataUrl,
    skin,
    scheme: schemeOf(skin.colors),
    scrim,
    raised,
    note,
    imageInfo: imageInfo ? { width: imageInfo.width, height: imageInfo.height, lum: imageInfo.lum } : null,
  };
}

module.exports = { compose, loadSkins, resolveSkin, sanitizeSkin, FALLBACK_SKIN };
