// M0-D（第三版）：浏览器级 auto-attach + 新 target 立即注入，验证「刷新后主题还在」。
// 用法：node scripts/m0/d3-autoattach.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'session.json'), 'utf8'));
const port = state.port;

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
console.log('browser:', version.Browser, '\nws:', version.webSocketDebuggerUrl);

const browser = await connect(version.webSocketDebuggerUrl);

const CSS = 'html{--m0-survive:ok}';
const BOOT = `(() => {
  const ensure = () => {
    const root = document.documentElement; if (!root) return;
    let el = document.getElementById('cob-theme');
    if (!el) { el = document.createElement('style'); el.id = 'cob-theme'; root.appendChild(el); }
    if (el.textContent !== ${JSON.stringify(CSS)}) el.textContent = ${JSON.stringify(CSS)};
  };
  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true });
  document.addEventListener('DOMContentLoaded', ensure, { once: true });
  window.__m0Boot = (window.__m0Boot || 0) + 1;
})();`;

const sessions = new Map(); // sessionId -> targetInfo
let injected = 0;

browser.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
  sessions.set(sessionId, targetInfo);
  if (targetInfo.type !== 'page') return;
  console.log(`attach: ${targetInfo.type} ${targetInfo.url.slice(0, 60)}`);
  try {
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    // ① 立即注入当前文档
    await browser.send('Runtime.evaluate', { expression: BOOT }, sessionId);
    // ② 为后续导航登记（双保险）
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT }, sessionId);
    injected++;
    console.log('  -> 已注入');
  } catch (e) {
    console.log('  -> 注入失败:', e.message);
  }
});

browser.on('Target.detachedFromTarget', ({ sessionId }) => {
  const info = sessions.get(sessionId);
  if (info) console.log(`detach: ${info.url.slice(0, 60)}`);
  sessions.delete(sessionId);
});

await browser.send('Target.setDiscoverTargets', { discover: true });
await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await new Promise((r) => setTimeout(r, 1500));
console.log(`已 attach ${injected} 个 page\n`);

// 找一个 page session 用来触发 reload
const entry = [...sessions.entries()].find(([, info]) => info.type === 'page' && info.url.startsWith('app://'));
if (!entry) {
  console.log('没有找到 app:// 的 page session');
  process.exit(1);
}
const [pageSession] = entry;

const beforeReload = await evaluate(browser, `({ boot: window.__m0Boot || null, ok: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim() })`, pageSession);
console.log('刷新前:', JSON.stringify(beforeReload));

await browser.send('Page.reload', { ignoreCache: false }, pageSession);
await new Promise((r) => setTimeout(r, 6000));

// 重新找（刷新后可能换了 session）
const pages = [...sessions.entries()].filter(([, info]) => info.type === 'page');
console.log(`刷新后 page session 数: ${pages.length}`);
let result = null;
for (const [sid, info] of pages) {
  try {
    const r = await evaluate(browser, `({ boot: window.__m0Boot || null, ok: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim(), style: !!document.getElementById('cob-theme'), href: location.href })`, sid);
    console.log(`  ${info.url.slice(0, 50)} -> ${JSON.stringify(r)}`);
    if (r.ok === 'ok') result = r;
  } catch (e) {
    console.log(`  ${info.url.slice(0, 50)} -> eval 失败 ${e.message}`);
  }
}

const pass = !!result;
console.log(`\nM0-D(auto-attach 跨刷新): ${pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(path.join(ROOT, '.m0', 'd3-report.json'), JSON.stringify({ pass, beforeReload, sessions: pages.map(([sid, i]) => ({ sid, type: i.type, url: i.url })) }, null, 2));
browser.close();
