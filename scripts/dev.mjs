/**
 * Dev loop: rebuild the renderer on change and restart Electron.
 * Usage: npm run dev
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { context } from 'esbuild';

const ELECTRON = path.join('node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

const ENTRY = 'src/renderer/js/splash/splash.js';
const OUTFILE = 'src/renderer/splash.bundle.js';

const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  platform: 'browser',
  format: 'iife',
  target: ['chrome122'],
  logLevel: 'silent',
  legalComments: 'none',
};

const ctx = await context(buildOptions);
await ctx.rebuild();
console.log('[dev] renderer bundle built');

let child = null;
let restartTimer = null;

function launch() {
  child = spawn(ELECTRON, ['.'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.log(`[dev] electron exited with ${code}`);
  });
}

function restart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (child) {
      child.kill();
      child = null;
    }
    launch();
    console.log('[dev] restarted');
  }, 180);
}

launch();

let debounce = null;
fs.watch('src/renderer', { recursive: true }, (_event, filename) => {
  if (!filename) return;
  if (filename.includes('splash.bundle.js') || filename.includes('panel.bundle.js')) return;
  if (filename.endsWith('.map')) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(async () => {
    try {
      if (filename.endsWith('.js')) await ctx.rebuild();
      console.log(`[dev] ${filename} changed`);
      restart();
    } catch (error) {
      console.error('[dev] rebuild failed', error.message);
    }
  }, 120);
});

['src/main', 'src/preload', 'src/shared'].forEach((dir) => {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    console.log(`[dev] ${dir}/${filename} changed`);
    restart();
  });
});

process.on('SIGINT', () => {
  if (child) child.kill();
  process.exit(0);
});
