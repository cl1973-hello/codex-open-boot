'use strict';

const { setVar } = require('../core/dom');
const { parseHex, relativeLuminance } = require('../../../shared/contrast');

const VAR_MAP = {
  background: '--bg',
  sidebar: '--sidebar',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  border: '--border',
  text: '--text',
  muted: '--muted',
  accent: '--accent',
  accentText: '--accent-text',
  secondary: '--secondary',
  glow: '--glow',
};

function resolveSkin(state) {
  const skins = state.skins || [];
  return skins.find((skin) => skin.id === state.settings.skinId) || skins[0] || null;
}

/** Push one skin's palette into CSS custom properties on <html>. */
function applySkin(skin) {
  const root = document.documentElement;
  if (!skin) return { isLight: false, skin: null };

  Object.keys(VAR_MAP).forEach((key) => {
    const value = skin.colors && skin.colors[key];
    if (value) setVar(VAR_MAP[key], value, root);
  });

  const isLight = relativeLuminance(parseHex(skin.colors.background)) > 0.45;
  root.classList.toggle('is-light', isLight);
  root.dataset.ornament = skin.ornament ? '1' : '0';

  return { isLight, skin };
}

function swatchColors(skin) {
  const c = (skin && skin.colors) || {};
  return [c.background, c.surface, c.accent, c.secondary].filter(Boolean);
}

module.exports = { applySkin, resolveSkin, swatchColors, VAR_MAP };
