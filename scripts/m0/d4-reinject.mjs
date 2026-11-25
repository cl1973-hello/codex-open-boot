// M0-D（第四版）：不依赖 addScriptToEvaluateOnNewDocument 的持久化，
// 改成「导航事件 + 心跳」重注入，验证刷新后主题能自己回来。
// 用法：node scripts/m0/d4-reinject.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'session.json'), 'utf8'));
const page = state.targets.find((t) => t.type === 'page');

const CSS = 'html{--m0-survive:ok}';
const BOOT = `(() => {
  const ensure = () => {
    const root = document.documentElement; if (!root) return;
    let el = document.getElementById('cob-theme');
    if (!el) { el = document.createElement('style'); el.id = 'cob-theme'; root.appendChild(el); }
    if (el.textContent !== ${JSON.stringify(CSS)}) el.textContent = ${JSON.stringify(CSS)};
  };
  window.__cobEnsure = ensure;
  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true });
  document.addEventListener('DOMContentLoaded', ensure, { once: true });
  window.__m0Boot = (window.__m0Boot || 0) + 1;
})();`;

const client = await connect(page.webSocketDebuggerUrl);
const events = [];

client.on('Page.frameNavigated', (p) => {
  events.push(['frameNavigated', p.frame?.url?.slice(0, 40), p.frame?.parentId ? 'child' : 'main']);
});
client.on('Page.loadEventFired', () => events.push(['loadEventFired']));
client.on('Page.domContentEventFired', () => events.push(['domContentEventFired']));
client.on('Page.frameStartedLoading', () => events.push(['frameStartedLoading']));
client.on('Runtime.executionContextCreated', (p) => events.push(['ctxCreated', p.context?.name || '(default)']));
client.on('Runtime.executionContextDestroyed', () => events.push(['ctxDestroyed']));

await client.send('Page.enable');
await client.send('Runtime.enable');

// 首次注入
await evaluate(client, BOOT);
console.log('首次注入:', JSON.stringify(await evaluate(client, `({boot: window.__m0Boot, ok: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim()})`)));

// 模拟产品逻辑：收到导航类事件就重注入（这里用「事件 + 短延迟重试」）
let reinjects = 0;
async function reinject(reason) {
  for (let i = 0; i < 6; i++) {
    try {
      await evaluate(client, BOOT);
      const ok = await evaluate(client, `getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim()`);
      if (ok === 'ok') {
        reinjects++;
        console.log(`  重注入成功 (${reason}, 第 ${i + 1} 次尝试)`);
        return true;
      }
    } catch (e) {
      /* 上下文正在切换，忽略 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`  重注入失败 (${reason})`);
  return false;
}

client.on('Page.frameNavigated', (p) => {
  if (!p.frame?.parentId) reinject('frameNavigated');
});
client.on('Page.loadEventFired', () => reinject('loadEventFired'));

console.log('\n触发 F5 …');
await client.send('Page.reload', { ignoreCache: false });
await new Promise((r) => setTimeout(r, 8000));

console.log('\n收到的事件序列:');
for (const e of events) console.log('  ', e.join(' | '));

const after = await evaluate(client, `({ boot: window.__m0Boot || null, ok: getComputedStyle(document.documentElement).getPropertyValue('--m0-survive').trim(), style: !!document.getElementById('cob-theme'), theme: document.documentElement.dataset.theme, html: document.documentElement.outerHTML.slice(0, 120) })`);
console.log('\n刷新后:', JSON.stringify(after, null, 2));
console.log(`\nM0-D(事件+重试 跨刷新): ${after.ok === 'ok' ? 'PASS' : 'FAIL'}（重注入 ${reinjects} 次）`);

client.close();
