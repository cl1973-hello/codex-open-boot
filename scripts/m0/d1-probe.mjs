// M0-D（第一半）：连上 page target，dump 关键事实 + 验证注入是否生效。
// 用法：node scripts/m0/d1-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const STATE = path.join(ROOT, '.m0', 'session.json');

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const page = state.targets.find((t) => t.type === 'page');
if (!page) throw new Error('session.json 里没有 page target，先跑 b1-port.mjs');

const client = await connect(page.webSocketDebuggerUrl);
await client.send('Runtime.enable');

// 1) 页面环境：theme / 登录态 / token 层
const env = await evaluate(
  client,
  `(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const tokens = {};
    for (const name of ['--app-color-background-surface','--app-color-background-shell','--app-color-text-foreground','--app-color-border','--codex-theme-accent-color']) {
      tokens[name] = cs.getPropertyValue(name).trim();
    }
    // 统计 :root 上声明的 --app-color-* 数量
    let declared = 0;
    try {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules } catch { continue }
        for (const rule of rules) {
          if (!rule.style) continue;
          for (const p of rule.style) if (p.startsWith('--app-color-')) declared++;
        }
      }
    } catch {}
    const bodyText = (document.body?.innerText || '').replace(/\\s+/g,' ').slice(0, 240);
    return {
      href: location.href, title: document.title, readyState: document.readyState,
      htmlAttrs: { ...root.dataset }, htmlClass: root.className.slice(0, 120),
      colorScheme: cs.colorScheme,
      hasRoot: !!document.getElementById('root'),
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
      tokens, declaredAppColorVars: declared,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      looksLoggedOut: /sign in|log in|登录|sign up/i.test(bodyText),
      bodyText,
      dpr: devicePixelRatio,
    };
  })()`,
);

console.log('=== 页面环境 ===');
console.log(JSON.stringify(env, null, 2));

// 2) 注入验证：插一条 style，看是否被 CSP 拦
const injected = await evaluate(
  client,
  `(() => {
    const s = document.createElement('style');
    s.id = 'm0-test';
    s.textContent = 'html{--m0-test:ok} body{outline:3px solid rgb(255,0,0) !important}';
    document.documentElement.appendChild(s);
    return {
      attached: !!document.getElementById('m0-test'),
      varApplied: getComputedStyle(document.documentElement).getPropertyValue('--m0-test').trim(),
      bodyOutline: getComputedStyle(document.body).outlineColor + ' / ' + getComputedStyle(document.body).outlineWidth,
    };
  })()`,
);
console.log('\n=== 注入验证 ===');
console.log(JSON.stringify(injected, null, 2));

// 3) 跨导航存活验证：addScriptToEvaluateOnNewDocument + reload
const marker = `window.__m0 = (window.__m0 || 0) + 1; document.documentElement.dataset.m0 = String(window.__m0);`;
const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: marker });
await client.send('Page.enable');
await client.send('Page.reload', { ignoreCache: false });
await new Promise((r) => setTimeout(r, 4000));
const afterReload = await evaluate(client, `({ m0: document.documentElement.dataset.m0 || null, ready: document.readyState })`);
console.log('\n=== 刷新后是否存活 ===');
console.log(JSON.stringify({ afterReload, markerId: identifier }, null, 2));

const pass = injected.attached && injected.varApplied === 'ok' && afterReload.m0 === '1';
console.log(`\nM0-D(注入部分): ${pass ? 'PASS' : 'FAIL'}`);
console.log(`登录态线索: ${env.looksLoggedOut ? '疑似未登录' : '疑似已登录'}（bodyText 见上）`);

client.close();
