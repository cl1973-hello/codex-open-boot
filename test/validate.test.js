'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeTheme, validateTheme, isValidAppId } = require('../src/shared/validate');
const { sanitizeSettings, DEFAULT_SETTINGS } = require('../src/shared/defaults');
const { requiredScrim, contrastRatio, parseHex, relativeLuminance } = require('../src/shared/contrast');

const bundledTheme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'media', 'theme.json'), 'utf8'));

test('the bundled theme.json is valid and survives normalisation', () => {
  const theme = normalizeTheme(bundledTheme, bundledTheme.duration);
  const result = validateTheme({ ...theme, duration: theme.duration });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(theme.screenFrames.length, bundledTheme.screenFrames.length);
  assert.equal(theme.screenFrames[0].time, bundledTheme.transitionStart);
  assert.equal(theme.transitionEnd, bundledTheme.transitionEnd);
  assert.ok(theme.screenFrames.length >= 2);
});

test('normaliseTheme accepts the reference project key casing (Time/Width)', () => {
  const theme = normalizeTheme(
    {
      duration: 13.65,
      holdAt: 11.3,
      transitionStart: 12.7,
      transitionEnd: 13.65,
      screenFrames: [
        { Time: 12.65, X: 0.1, Y: 0.1, Width: 0.7, Height: 0.7 },
        { Time: 13.5, X: 0, Y: 0, Width: 1, Height: 1 },
      ],
    },
    13.65
  );
  assert.equal(theme.screenFrames[0].time, 12.65);
  assert.equal(theme.screenFrames[0].width, 0.7);
});

test('validateTheme rejects non-increasing keyframe times', () => {
  const theme = normalizeTheme(
    {
      duration: 10,
      holdAt: 1,
      transitionStart: 2,
      transitionEnd: 9,
      screenFrames: [
        { time: 2, x: 0, y: 0, width: 1, height: 1 },
        { time: 2, x: 0, y: 0, width: 1, height: 1 },
      ],
    },
    10
  );
  const result = validateTheme(theme);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('严格递增')));
});

test('validateTheme rejects rectangles outside the frame', () => {
  const result = validateTheme({
    duration: 10,
    holdAt: 1,
    transitionStart: 2,
    transitionEnd: 9,
    screenFrames: [
      { time: 2, x: 0.5, y: 0.5, width: 0.8, height: 0.8 },
      { time: 9, x: 0, y: 0, width: 1, height: 1 },
    ],
  });
  assert.equal(result.ok, false);
});

test('isValidAppId only accepts Package!App identities', () => {
  assert.equal(isValidAppId('OpenAI.Codex_2p2nqsd0c76g0!App'), true);
  assert.equal(isValidAppId('shell:AppsFolder\\OpenAI.Codex!App'), false);
  assert.equal(isValidAppId('OpenAI.Codex!App && calc'), false);
  assert.equal(isValidAppId(''), false);
});

test('sanitizeSettings clamps hostile values', () => {
  const settings = sanitizeSettings({
    skinId: 'nope',
    background: { mode: 'file', filePath: null, opacity: 7, blur: 900, scrim: 5, vignette: -3 },
    app: { codexAppId: 'not-valid', recentProjects: ['C:\\a', 42, ''] },
    window: { bounds: { x: 'a', y: 0, width: 10, height: 10 } },
  });
  assert.equal(settings.background.mode, 'builtin');
  assert.equal(settings.background.opacity, 1);
  assert.equal(settings.background.blur, 40);
  assert.ok(settings.background.scrim <= 0.72);
  assert.equal(settings.background.vignette, 0);
  assert.equal(settings.app.codexAppId, DEFAULT_SETTINGS.app.codexAppId);
  assert.deepEqual(settings.app.recentProjects, ['C:\\a']);
  assert.equal(settings.window.bounds, null);
});

test('requiredScrim raises the scrim until text is readable', () => {
  const dark = requiredScrim({ bgHex: '#070F12', textHex: '#E4EEEB', imageLum: 0, opacity: 1, forcedScrim: 0 });
  assert.ok(dark.ratio >= 4.5);

  const bright = requiredScrim({ bgHex: '#070F12', textHex: '#E4EEEB', imageLum: 0.95, opacity: 1, forcedScrim: 0 });
  assert.ok(bright.scrim > dark.scrim, 'bright background needs more scrim');
  assert.ok(bright.ratio >= 4.5);
});

test('requiredScrim respects the light skin (white scrim, dark text)', () => {
  const light = requiredScrim({ bgHex: '#F4F5F1', textHex: '#182923', imageLum: 0.02, opacity: 1, forcedScrim: 0.28 });
  assert.ok(light.ratio >= 4.5);
});

test('contrast maths matches known WCAG values', () => {
  const black = relativeLuminance(parseHex('#000000'));
  const white = relativeLuminance(parseHex('#ffffff'));
  assert.equal(Math.round(contrastRatio(black, white)), 21);
});
