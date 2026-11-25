// M0-D（第二半·修正版）：用 <style> + window 属性验证跨导航存活，并收集 token。
// 用法：node scripts/m0/d2-tokens.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'session.json'), 'utf8'));
const page = state.targets.find((t) => t.type === 'page');

const client = await connect(page.webSocketDebuggerUrl);
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

await client.send('Page.enable');
await client.send('Runtime.enable');

// 关键修正：应用会重置 <html> 上的 data-*，所以标记只能挂在 <style> 元素 + window 属性上
const BOOT = `
(() => {
  window.__COB_CSS__ = 'html{--m0-survive:ok}';
  const ensure = () => {
    const root = document.documentElement;
    if (!root) return;
    let el = document.getElementById('cob-theme');
    if (!el) { el = document.createElement('style'); el.id = 'cob-theme'; root.appendChild(el); }
    if (el.textContent !== window.__COB_CSS__) el.textContent = window.__COB_CSS__;
  };
  window.__cobEnsure = ensure;
  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true });
  document.addEventListener('DOMContentLoaded', ensure, { once: true });
  window.__m0Boot = (window.__m0Boot || 0) + 1;
})();
`;

const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT, runImmediately: true });
const before = await evaluate(client, `({ boot: window.__m0Boot || null, style: !!document.getElementById('cob-theme'), v: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim() })`);
say(`注册后立即: ${JSON.stringify(before)} (scriptId=${identifier})`);

await client.send('Page.reload', { ignoreCache: false });
await new Promise((r) => setTimeout(r, 5000));

const after = await evaluate(
  client,
  `({ boot: window.__m0Boot || null, style: !!document.getElementById('cob-theme'), v: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim(), theme: document.documentElement.dataset.theme, href: location.href })`,
);
say(`刷新后: ${JSON.stringify(after)}`);

// token 收集：CSSOM + fetch 双路
const tokenNames = await evaluate(
  client,
  `(async () => {
    const names = new Set();
    const add = (txt) => { for (const m of txt.matchAll(/--(app-color-[a-z0-9-]+|codex-theme-[a-z0-9-]+)/g)) names.add(m[1]) };
    for (const s of document.styleSheets) {
      try { add([...s.cssRules].map(r => r.cssText).join('\\n')) } catch {}
      if (s.href) { try { add(await (await fetch(s.href)).text()) } catch {} }
    }
    return [...names].sort();
  })()`,
);
say(`\n抓到 ${tokenNames.length} 个 token`);

// 关键 token 在 dark / light 下的 computed 值（改完立刻取样，再还原）
const sample = async (mode) =>
  evaluate(
    client,
    `(() => {
      const root = document.documentElement;
      const prev = root.dataset.theme;
      root.dataset.theme = ${JSON.stringify(mode)};
      const cs = getComputedStyle(root);
      const keys = ['--app-color-background-surface','--app-color-background-shell','--app-color-background-surface-under','--app-color-text-foreground','--app-color-text-foreground-secondary','--app-color-border','--codex-theme-accent-color'];
      const out = { mode: ${JSON.stringify(mode)}, colorScheme: cs.colorScheme, bodyBg: getComputedStyle(document.body).backgroundColor, rootBg: getComputedStyle(document.getElementById('root') || document.body).backgroundColor };
      for (const k of keys) out[k] = cs.getPropertyValue(k).trim();
      root.dataset.theme = prev;
      return out;
    })()`,
);
const light = await sample('light');
const dark = await sample('dark');
say(`\nlight: ${JSON.stringify(light, null, 2)}\ndark: ${JSON.stringify(dark, null, 2)}`);

// 大 surface 体检：哪些元素面积大且不透明（决定「注入背景层」是否会被盖住）
const surfaces = await evaluate(
  client,
  `(() => {
    const vw = innerWidth * innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < vw * 0.12) continue;
      const cs = getComputedStyle(el);
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') continue;
      out.push({
        tag: el.tagName.toLowerCase(), id: el.id || null,
        cls: (el.className || '').toString().slice(0, 60),
        area: +(r.width * r.height / vw).toFixed(2),
        bg: cs.backgroundColor, bgImage: cs.backgroundImage === 'none' ? null : 'yes',
        pos: cs.position, z: cs.zIndex,
      });
    }
    return out.sort((a, b) => b.area - a.area).slice(0, 12);
  })()`,
);
say(`\n大面积不透明元素（>12% 视口）:\n${JSON.stringify(surfaces, null, 2)}`);

const pass = after.boot === 1 && after.style === true && after.v === 'ok';
say(`\nM0-D(跨导航存活): ${pass ? 'PASS' : 'FAIL'}`);

fs.writeFileSync(
  path.join(ROOT, '.m0', 'd2-report.json'),
  JSON.stringify({ before, after, tokenNames, light, dark, surfaces, scriptId: identifier }, null, 2),
);
say('报告已写入 .m0/d2-report.json');
client.close();
