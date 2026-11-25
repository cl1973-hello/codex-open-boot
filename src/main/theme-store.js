'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeTheme } = require('../shared/validate');
const { fileUrl, mediaDir, userDataDir, resolveFirstExisting } = require('./paths');
const logger = require('./logger');

const COLOR_KEYS = [
  'background',
  'sidebar',
  'surface',
  'surfaceRaised',
  'border',
  'text',
  'muted',
  'accent',
  'accentText',
  'secondary',
  'glow',
];

const FALLBACK_SKIN = {
  name: '星河',
  description: '深空墨绿 · 冷白星光 · 暖金点缀',
  ornament: true,
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

function sanitizeSkin(raw, id) {
  const colors = {};
  const source = (raw && raw.colors) || {};
  COLOR_KEYS.forEach((key) => {
    const value = source[key];
    colors[key] = HEX_RE.test(value) ? value : FALLBACK_SKIN.colors[key];
  });
  return {
    id,
    name: typeof (raw && raw.name) === 'string' ? raw.name.slice(0, 24) : id,
    description: typeof (raw && raw.description) === 'string' ? raw.description.slice(0, 80) : '',
    ornament: !!(raw && raw.ornament),
    colors,
  };
}

function loadSkins(app) {
  const file = path.join(mediaDir(app), 'skins.json');
  const raw = readJson(file);
  const list = [];
  if (raw && raw.skins && typeof raw.skins === 'object') {
    Object.keys(raw.skins).forEach((id) => list.push(sanitizeSkin(raw.skins[id], id)));
  }
  if (list.length === 0) list.push(sanitizeSkin(FALLBACK_SKIN, 'cosmic'));
  return { defaultSkin: (raw && raw.defaultSkin) || list[0].id, skins: list };
}

function loadTheme(app) {
  // userData/theme.json (written by the calibration HUD) wins over the bundled one.
  const candidates = [path.join(userDataDir(app), 'theme.json'), path.join(mediaDir(app), 'theme.json')];
  let raw = null;
  let source = 'defaults';
  for (const file of candidates) {
    const parsed = readJson(file);
    if (parsed) {
      raw = parsed;
      source = file;
      break;
    }
  }
  const theme = normalizeTheme(raw || {}, raw && raw.duration);
  return { theme, source };
}

function buildMediaInfo(app, theme) {
  const video = resolveFirstExisting(app, [theme.video, 'video.mp4', 'startup.mp4', 'university.mp4']);
  const poster = resolveFirstExisting(app, [theme.poster, 'poster.png']);
  const hold = resolveFirstExisting(app, [theme.holdPoster, 'hold.png']);
  const builtinBackground = hold || poster;

  if (!video) logger.warn('no splash video found in media dir');
  return {
    dir: mediaDir(app),
    video: fileUrl(video),
    videoName: video ? path.basename(video) : null,
    poster: fileUrl(poster),
    hold: fileUrl(hold),
    builtinBackground: fileUrl(builtinBackground),
  };
}

module.exports = { loadSkins, loadTheme, buildMediaInfo, sanitizeSkin, FALLBACK_SKIN, COLOR_KEYS };
