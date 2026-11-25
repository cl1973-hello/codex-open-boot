import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/renderer/js/app.js'],
  bundle: true,
  outfile: 'src/renderer/app.bundle.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome122'],
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'none',
};

const watch = process.argv.includes('--watch');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-renderer] watching src/renderer/js …');
} else {
  await build(options);
  console.log('[build-renderer] done');
}
