// M0-D（补充）：看清 Codex 的背景画在哪一层，决定「注入背景图」怎么做。
// 用法：node scripts/m0/d5-surface.mjs
import fs from 'node:fs';
import path from 'node:path';
import { connect, evaluate } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'session.json'), 'utf8'));
const page = state.targets.find((t) => t.type === 'page');
const client = await connect(page.webSocketDebuggerUrl);
await client.send('Runtime.enable');
await client.send('Page.enable');

const dump = await evaluate(
  client,
  `(() => {
    const V = innerWidth * innerHeight;
    const info = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: (el.getAttribute('class') || '').slice(0, 46),
        rect: [Math.round(r.width), Math.round(r.height)],
        ratio: +((r.width * r.height) / V).toFixed(3),
        bg: cs.backgroundColor,
        img: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 40),
        pos: cs.position, z: cs.zIndex,
        shadow: !!el.shadowRoot,
        kids: el.childElementCount,
      };
    };
    const walk = (el, depth, out) => {
      if (depth > 3) return out;
      for (const c of el.children) {
        out.push({ ...info(c), depth });
        walk(c, depth + 1, out);
      }
      return out;
    };
    const tree = walk(document.body, 0, []);
    // 全量扫描：找出真正的不透明层（包含小面积但堆叠覆盖的）
    const opaque = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      const hasPaint = !(cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') || cs.backgroundImage !== 'none';
      if (!hasPaint) continue;
      const ratio = (r.width * r.height) / V;
      if (ratio < 0.05) continue;
      opaque.push({ ...info(el), ratio: +ratio.toFixed(3) });
    }
    opaque.sort((a, b) => b.ratio - a.ratio);
    return {
      viewport: [innerWidth, innerHeight],
      bodyHTML: document.body.innerHTML.slice(0, 200),
      shadowHosts: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
      tree: tree.slice(0, 24),
      opaqueTop: opaque.slice(0, 14),
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBgImage: getComputedStyle(document.body).backgroundImage.slice(0, 60),
    };
  })()`,
);

console.log('viewport:', dump.viewport, '| shadow hosts:', dump.shadowHosts);
console.log('html bg:', dump.htmlBg, '| body img:', dump.bodyBgImage);
console.log('body.innerHTML[:200]:', dump.bodyHTML);
console.log('\n=== DOM 前 3 层 ===');
for (const n of dump.tree) console.log(`${'  '.repeat(n.depth)}${n.tag}${n.id ? '#' + n.id : ''} [${n.rect.join('x')} ratio=${n.ratio}] bg=${n.bg.slice(0, 34)} ${n.img ? 'img=' + n.img : ''} ${n.pos} z=${n.z} kids=${n.kids}`);
console.log('\n=== 面积 >5% 且有背景的元素 ===');
for (const n of dump.opaqueTop) console.log(`${n.tag}${n.id ? '#' + n.id : ''} .${n.cls} ratio=${n.ratio} bg=${n.bg.slice(0, 40)} ${n.img ? 'img ' : ''} ${n.pos} z=${n.z}`);

fs.writeFileSync(path.join(ROOT, '.m0', 'd5-surface.json'), JSON.stringify(dump, null, 2));
console.log('\n写入 .m0/d5-surface.json');
client.close();
