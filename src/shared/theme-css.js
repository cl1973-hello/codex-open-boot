'use strict';

/**
 * Codex 主题 CSS 生成器（纯函数，有单测）。
 *
 * 设计要点（来自 M0 实测，见 .m0/M0-REPORT.md）：
 * - Codex 的 UI 用 83 个语义 CSS 变量（--app-color-* / --codex-theme-*）驱动，
 *   类名是构建哈希，**绝对不能碰**；
 * - :root / body / #root 计算背景都是透明的，真正不透明的是 main 等面板，
 *   所以只要把这些面板改成半透明，背景图就能透出来；
 * - <html> 上的 data-* 会被应用重置，因此所有标记都挂在 <style id="cob-theme"> 上。
 */

const { parseHex } = require('./contrast');

const SKIN_KEYS = [
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clamp01(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** #RRGGBB + alpha -> rgba() */
function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  const a = Math.round(clamp01(alpha, 1) * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function normalizeColors(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of SKIN_KEYS) {
    out[key] = HEX_RE.test(source[key]) ? source[key] : '#000000';
  }
  return out;
}

/** 皮肤整体亮度决定 color-scheme（浅色皮肤必须让 light-dark() 走浅色分支） */
function schemeOf(colors) {
  const { r, g, b } = parseHex(colors.background);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? 'light' : 'dark';
}

function normalizeBackground(raw) {
  const bg = raw && typeof raw === 'object' ? raw : {};
  return {
    imageDataUrl: typeof bg.imageDataUrl === 'string' && bg.imageDataUrl.startsWith('data:image/') ? bg.imageDataUrl : null,
    opacity: clamp01(bg.opacity, 1),
    panelAlpha: Math.max(0.35, Math.min(1, clamp01(bg.panelAlpha, 0.82))),
    blur: Math.max(0, Math.min(40, Number(bg.blur) || 0)),
    scrim: clamp01(bg.scrim, 0.28) * 0.72,
    vignette: clamp01(bg.vignette, 0.45),
  };
}

/**
 * 生成注入 Codex 的完整样式表。
 * @param {{skin:{colors:object,name?:string}, background?:object}} input
 * @returns {string} CSS 文本
 */
function buildThemeCss(input) {
  const colors = normalizeColors(input && input.skin && input.skin.colors);
  const bg = normalizeBackground(input && input.background);
  const scheme = schemeOf(colors);
  const a = bg.panelAlpha;
  const aDeep = Math.min(1, a + 0.12);
  const aRaised = Math.min(1, a + 0.08);

  /** 语义 token -> Codex 变量 */
  const map = {
    '--app-color-background-surface': rgba(colors.surface, a),
    '--app-color-background-surface-under': rgba(colors.background, aDeep),
    '--app-color-background-shell': rgba(colors.sidebar, a),
    '--app-color-background-elevated-primary': rgba(colors.surfaceRaised, aRaised),
    '--app-color-background-elevated-primary-opaque': rgba(colors.surfaceRaised, 0.98),
    '--app-color-background-elevated-secondary': rgba(colors.surfaceRaised, a),
    '--app-color-background-elevated-secondary-opaque': rgba(colors.surfaceRaised, 0.97),
    '--app-color-background-elevated-tertiary-opaque': rgba(colors.surfaceRaised, 0.94),
    '--app-color-background-card': rgba(colors.surfaceRaised, a),
    '--app-color-background-control': rgba(colors.surfaceRaised, Math.min(1, a + 0.06)),
    '--app-color-background-application-menu': rgba(colors.surfaceRaised, 0.96),
    '--app-color-background-button-primary': rgba(colors.accent, 1),
    '--app-color-background-button-secondary': rgba(colors.surfaceRaised, a),
    '--app-color-background-button-tertiary': rgba(colors.surfaceRaised, 0),
    '--app-color-background-editor-opaque': rgba(colors.background, 1),
    '--app-color-background-tooltip-classic': rgba(colors.background, 0.98),
    '--app-color-background-accent': rgba(colors.accent, 1),
    '--app-color-border': rgba(colors.border, 0.85),
    '--app-color-border-heavy': rgba(colors.border, 1),
    '--app-color-text-foreground': colors.text,
    '--app-color-text-foreground-secondary': colors.muted,
    '--app-color-text-foreground-tertiary': rgba(colors.muted, 0.8),
    '--app-color-text-accent': colors.accent,
    '--app-color-text-on-accent': colors.accentText,
    '--app-color-background-button-primary-hover': rgba(colors.accent, 1),
    '--codex-theme-accent-color': colors.accent,
    '--codex-theme-accent-text': colors.accent,
    '--codex-theme-accent-icon': colors.accent,
    '--codex-theme-accent-background-subtle': rgba(colors.accent, 0.16),
    '--codex-theme-accent-background-hover': rgba(colors.accent, 0.24),
    '--codex-theme-accent-background-pressed': rgba(colors.accent, 0.32),
  };

  const tokenLines = Object.keys(map)
    .map((name) => `  ${name}: ${map[name]} !important;`)
    .join('\n');

  const imageLine = bg.imageDataUrl
    ? `  --cob-bg-image: url("${bg.imageDataUrl}");`
    : '  --cob-bg-image: none;';

  return `/* Codex Open Boot theme */
:root[data-cob] {
  color-scheme: ${scheme};
  --cob-panel-alpha: ${a};
  --cob-bg-opacity: ${bg.opacity};
  --cob-blur: ${bg.blur}px;
  --cob-scrim: ${bg.scrim};
  --cob-vignette: ${bg.vignette};
  --cob-base: ${colors.background};
${imageLine}
${tokenLines}
}

/* L2 结构层：只碰最外层容器，不碰任何哈希类名 */
html[data-cob],
html[data-cob] body {
  background: var(--cob-base) !important;
}
html[data-cob] body,
html[data-cob] #root {
  background-color: transparent !important;
}
html[data-cob] #root {
  position: relative;
  z-index: 1;
}

/* Codex 的页面外框画的是一层写死的 linear-gradient(#181818 50%)，不是语义 token，
   所以必须单独接管，否则整块主内容区永远是中性灰，和皮肤对不上。 */
html[data-cob] [data-app-shell-frame] {
  background-image: linear-gradient(
    color-mix(in srgb, var(--app-color-background-surface) 50%, transparent),
    color-mix(in srgb, var(--app-color-background-surface) 50%, transparent)
  ) !important;
}

/* L3 背景层 */
#cob-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: var(--cob-base);
}
#cob-bg > i {
  position: absolute;
  inset: -${Math.max(24, Math.round(bg.blur * 2))}px;
  display: block;
  background-image: var(--cob-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  opacity: var(--cob-bg-opacity);
  filter: blur(var(--cob-blur));
  transform: scale(1.02);
}
#cob-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 38%, rgba(0, 0, 0, var(--cob-scrim)), rgba(0, 0, 0, calc(var(--cob-scrim) + 0.16))),
    radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, var(--cob-vignette)));
}
`;
}

/**
 * 注入脚本。这是唯一的注入入口：必须先保证 #cob-theme 存在，再谈更新。
 *
 * 三个 M0 实测约束：
 * - Codex 会重置 <html> 上的 data-*，所以标记要同时放在 <style> 和 window 上；
 * - 页面刷新后 `addScriptToEvaluateOnNewDocument` 不执行，只能靠事件 + 重试重注入；
 * - Codex 自己靠 `<html data-theme="light|dark">` + light-dark() 选调色板，
 *   不把它掰到我们这侧的话，侧边栏/输入框会保持系统主题的浅色，出现浅底浅字。
 */
function buildApplyScript(css, options) {
  const opts = options || {};
  const payload = JSON.stringify({
    css,
    bg: !!opts.bg,
    scheme: opts.scheme === 'light' ? 'light' : 'dark',
  });

  return `(() => {
  const P = ${payload};
  window.__COB_CSS__ = P.css;
  const root = document.documentElement;
  if (!root) return false;

  const ensure = () => {
    const html = document.documentElement;
    if (!html) return;
    if (html.getAttribute('data-cob') !== '1') html.setAttribute('data-cob', '1');
    // 只在真的不一样时才写，避免自家 MutationObserver 无限自激
    if (html.getAttribute('data-theme') !== P.scheme) html.setAttribute('data-theme', P.scheme);

    let style = document.getElementById('cob-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cob-theme';
      html.appendChild(style);
    }
    if (style.textContent !== P.css) style.textContent = P.css;

    if (P.bg && document.body && !document.getElementById('cob-bg')) {
      const layer = document.createElement('div');
      layer.id = 'cob-bg';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<i></i>';
      document.body.insertBefore(layer, document.body.firstChild);
    }
    if (!P.bg) {
      const old = document.getElementById('cob-bg');
      if (old) old.remove();
    }
  };

  window.__cobApply = ensure;
  ensure();

  if (!window.__cobObserver) {
    window.__cobObserver = new MutationObserver(ensure);
    window.__cobObserver.observe(root, {
      childList: true,
      subtree: false,
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
  document.addEventListener('DOMContentLoaded', ensure, { once: false });
  window.__cobBootCount = (window.__cobBootCount || 0) + 1;

  return !!document.getElementById('cob-theme') && document.documentElement.getAttribute('data-cob') === '1';
})()`;
}

/** 兼容旧名字：启动注入与运行时更新现在是同一段脚本 */
const buildBootScript = buildApplyScript;

/** 运行时更新（只换样式文本 + scheme + 背景层开关，不重建 target） */
const buildUpdateScript = buildApplyScript;

module.exports = {
  buildThemeCss,
  buildBootScript,
  buildUpdateScript,
  buildApplyScript,
  normalizeColors,
  normalizeBackground,
  schemeOf,
  rgba,
  SKIN_KEYS,
};
