import { existsSync } from 'node:fs';
import { build, context } from 'esbuild';

/**
 * 渲染层两个入口，各自打成一个 IIFE：
 * - splash：开屏页（复用 src/shared/portal.js 的矩形映射，必须能 require）
 * - panel：设置面板
 * 打包而不是直接 <script src>，是为了让渲染层能用 src/shared 下的纯函数（有单测）。
 */
const TARGETS = [
  { entryPoints: ['src/renderer/js/splash/splash.js'], outfile: 'src/renderer/splash.bundle.js' },
  { entryPoints: ['src/renderer/js/panel/panel.js'], outfile: 'src/renderer/panel.bundle.js' },
];

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome122'],
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'none',
};

const watch = process.argv.includes('--watch');
const contexts = [];

for (const target of TARGETS) {
  if (!existsSync(target.entryPoints[0])) {
    console.log(`[build-renderer] skip ${target.entryPoints[0]}（文件还没建）`);
    continue;
  }
  const options = { ...common, ...target };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    contexts.push(ctx);
  } else {
    await build(options);
  }
}

console.log(watch ? '[build-renderer] watching src/renderer/js …' : '[build-renderer] done');
