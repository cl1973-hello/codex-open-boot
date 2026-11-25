'use strict';

/** WCAG contrast helpers used by the background readability guard. */

function parseHex(hex) {
  const value = String(hex || '#000000').trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

function contrastRatio(a, b) {
  const l1 = Math.max(a, b);
  const l2 = Math.min(a, b);
  return (l1 + 0.05) / (l2 + 0.05);
}

function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function gray(lum) {
  // Approximate luminance back to an 8-bit grey tone (linear -> sRGB).
  const c = lum <= 0.0031308 ? lum * 12.92 : 1.055 * Math.pow(lum, 1 / 2.4) - 0.055;
  const v = Math.round(Math.max(0, Math.min(1, c)) * 255);
  return { r: v, g: v, b: v };
}

/**
 * Smallest scrim opacity that keeps `text` readable over the composited background.
 * The image is approximated by its 90th-percentile luminance (worst case that still
 * covers 90% of the picture), which is the right thing for text legibility.
 *
 * @returns {{scrim:number, ratio:number, ok:boolean}}
 */
function requiredScrim(options) {
  const {
    bgHex = '#070F12',
    textHex = '#E4EEEB',
    imageLum = 0,
    opacity = 1,
    forcedScrim = 0,
    minRatio = 4.5,
    maxScrim = 0.72,
  } = options || {};

  const bg = parseHex(bgHex);
  const text = parseHex(textHex);
  const textLum = relativeLuminance(text);
  const imageGray = gray(imageLum);
  const composited = mix(bg, imageGray, Math.max(0, Math.min(1, opacity)));
  const scrimColor = relativeLuminance(bg) < 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

  const start = Math.max(0, Math.min(1, forcedScrim));
  let best = { scrim: start, ratio: contrastRatio(relativeLuminance(mix(composited, scrimColor, start)), textLum), ok: false };

  for (let s = start; s <= maxScrim + 1e-6; s += 0.02) {
    const final = mix(composited, scrimColor, s);
    const ratio = contrastRatio(relativeLuminance(final), textLum);
    if (ratio >= minRatio) {
      return { scrim: Math.round(s * 100) / 100, ratio, ok: true };
    }
    best = { scrim: Math.round(s * 100) / 100, ratio, ok: false };
  }
  return best;
}

module.exports = { parseHex, relativeLuminance, contrastRatio, mix, requiredScrim };
