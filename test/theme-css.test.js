'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildThemeCss, buildBootScript, normalizeBackground, schemeOf, rgba } = require('../src/shared/theme-css');
const { sanitizeSettings, DEFAULT_SETTINGS } = require('../src/shared/defaults');

const COSMIC = {
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
};

test('rgba() 输出带两位小数的 alpha', () => {
  assert.equal(rgba('#0D1A1E', 0.82), 'rgba(13, 26, 30, 0.82)');
  assert.equal(rgba('#FFFFFF', 2), 'rgba(255, 255, 255, 1)');
});

test('深色皮肤给出 color-scheme: dark，浅色皮肤给出 light', () => {
  assert.equal(schemeOf(COSMIC), 'dark');
  assert.equal(schemeOf({ ...COSMIC, background: '#F4F5F1' }), 'light');
});

test('面板透明度写进 token 的 alpha，并且全部带 !important', () => {
  const css = buildThemeCss({ skin: { colors: COSMIC }, background: { panelAlpha: 0.6 } });
  assert.match(css, /--app-color-background-surface: rgba\(13, 26, 30, 0.6\) !important;/);
  assert.match(css, /--app-color-text-foreground: #E4EEEB !important;/);
  assert.match(css, /--codex-theme-accent-color: #C8ECEB !important;/);
  // 每个 token 行都必须带 !important，否则会被应用自己的 light-dark() 覆盖
  const tokenLines = css.split('\n').filter((l) => l.trim().startsWith('--'));
  assert.ok(tokenLines.length >= 25, `token 行数偏少: ${tokenLines.length}`);
  for (const line of tokenLines) {
    if (line.includes('--cob-')) continue; // 自己的变量不需要 !important
    assert.ok(line.includes('!important'), `缺少 !important: ${line.trim()}`);
  }
});

test('背景图走 data URL，并且不会被 file:// 拒绝（CSP img-src 没有 file:）', () => {
  const url = 'data:image/jpeg;base64,AAAABBBB';
  const css = buildThemeCss({ skin: { colors: COSMIC }, background: { imageDataUrl: url } });
  assert.match(css, /--cob-bg-image: url\("data:image\/jpeg;base64,AAAABBBB"\);/);
  const none = buildThemeCss({ skin: { colors: COSMIC }, background: { imageDataUrl: 'file:///c:/x.png' } });
  assert.match(none, /--cob-bg-image: none;/);
});

test('结构层只碰 html/body/#root，不出现任何哈希类名', () => {
  const css = buildThemeCss({ skin: { colors: COSMIC } });
  assert.match(css, /html\[data-cob\] body/);
  assert.match(css, /#cob-bg/);
  assert.ok(!/\\b[a-z]+-[A-Za-z0-9]{6}\\b/.test(css), '不应出现 Tailwind 哈希类名');
});

test('非法皮肤颜色回落到黑色，不抛异常', () => {
  const css = buildThemeCss({ skin: { colors: { surface: 'red', text: null } } });
  assert.match(css, /--app-color-text-foreground: #000000 !important;/);
});

test('背景参数被钳制在合法范围', () => {
  const bg = normalizeBackground({ opacity: 5, panelAlpha: 0.1, blur: 999, scrim: 2, vignette: -1 });
  assert.equal(bg.opacity, 1);
  assert.equal(bg.panelAlpha, 0.35);
  assert.equal(bg.blur, 40);
  assert.equal(bg.scrim, 0.72);
  assert.equal(bg.vignette, 0);
});

test('引导脚本把 CSS 与背景层都带上，且不依赖 data-* 属性', () => {
  const css = buildThemeCss({ skin: { colors: COSMIC }, background: { imageDataUrl: 'data:image/png;base64,AA' } });
  const boot = buildBootScript(css, { bg: true });
  assert.ok(boot.includes('cob-theme'));
  assert.ok(boot.includes('cob-bg'));
  assert.ok(boot.includes('data-cob'));
  // 应用会重置 <html> 上的 data-*，所以必须每次 ensure 时重设
  assert.ok(boot.includes("setAttribute('data-cob'"));
});

test('v2 设置：旧版 settings.json 能被无损迁移并钳制', () => {
  const old = {
    schemaVersion: 1,
    skinId: 'graphite',
    background: { mode: 'file', filePath: 'x.png', opacity: 0.5, blur: 10 },
    splash: { enabled: false, volume: 0.3, tailMs: 9999 },
    app: { codexAppId: 'OpenAI.Codex_2p2nqsd0c76g0!App', recentProjects: ['a'] },
    ui: { navCollapsed: true },
  };
  const s = sanitizeSettings(old);
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.skinId, 'graphite');
  assert.equal(s.background.mode, 'file');
  assert.equal(s.background.panelAlpha, DEFAULT_SETTINGS.background.panelAlpha);
  assert.equal(s.splash.enabled, false);
  assert.equal(s.splash.tailMs, 3000);
  assert.equal(s.ui.navCollapsed, undefined);
  assert.equal(s.window.endMode, 'fill');
});

test('v2 设置：恶意输入不会留下非法值', () => {
  const s = sanitizeSettings({
    skinId: 42,
    background: { mode: 'ftp', opacity: 'x', panelAlpha: NaN, blur: 'y', scrim: -3 },
    splash: { slowRate: 99, volume: -2 },
    codex: { launch: 'rm -rf' },
    window: { endMode: 'whatever' },
  });
  assert.equal(s.skinId, 'cosmic');
  assert.equal(s.background.mode, 'builtin');
  assert.equal(s.background.opacity, 1);
  assert.equal(s.background.panelAlpha, 0.82);
  assert.equal(s.background.blur, 0);
  assert.equal(s.background.scrim, 0);
  assert.equal(s.splash.slowRate, 1);
  assert.equal(s.splash.volume, 0);
  assert.equal(s.codex.launch, 'alias');
  assert.equal(s.window.endMode, 'fill');
});
