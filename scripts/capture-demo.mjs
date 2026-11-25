/**
 * Builds docs/demo.gif and the README screenshots by driving the real app.
 * Requires `npm install` (electron + ffmpeg-static are devDependencies).
 *
 *   npm run demo
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRAMES = path.join(ROOT, 'docs', '.frames');
const MANIFEST = path.join(FRAMES, 'manifest.json');
const OUT_GIF = path.join(ROOT, 'docs', 'demo.gif');
const isWin = process.platform === 'win32';

function electronBin() {
  // Use the real binary: the .bin shim is a node script and inherits
  // ELECTRON_RUN_AS_NODE, which would make Electron behave like plain Node.
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  return path.join(dist, isWin ? 'electron.exe' : 'electron');
}

function ffmpegBin() {
  // eslint-disable-next-line import/no-unresolved
  const mod = require('ffmpeg-static');
  return mod;
}

function cleanEnv() {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function run(capture) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  const result = spawnSync(electronBin(), [path.join('scripts', 'demo-capture', 'main.cjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: cleanEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`electron capture exited with ${result.status}`);
  }
  if (!capture && !fs.existsSync(MANIFEST)) throw new Error('no frames captured');
}

function buildGif({ fps, width, colors }) {
  const frames = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const lines = [];
  for (const frame of frames) {
    lines.push(`file '${path.relative(FRAMES, frame.file).replace(/\\/g, '/')}'`);
    lines.push(`duration ${(frame.hold / fps).toFixed(3)}`);
  }
  // concat demuxer needs the last file repeated
  lines.push(`file '${path.relative(FRAMES, frames[frames.length - 1].file).replace(/\\/g, '/')}'`);
  const listFile = path.join(FRAMES, 'concat.txt');
  fs.writeFileSync(listFile, lines.join('\n'), 'utf8');

  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filter, '-loop', '0', OUT_GIF];
  const result = spawnSync(ffmpegBin(), args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`);
  return fs.statSync(OUT_GIF).size;
}

function main() {
  run(false);
  const presets = [
    { fps: 12, width: 760, colors: 180 },
    { fps: 10, width: 680, colors: 128 },
    { fps: 8, width: 600, colors: 96 },
  ];
  for (const preset of presets) {
    const size = buildGif(preset);
    const mb = size / (1024 * 1024);
    console.log(`[demo] gif ${mb.toFixed(2)} MB with ${preset.fps}fps / ${preset.width}px`);
    if (mb <= 6.5) break;
  }
  console.log('[demo] done: docs/demo.gif + docs/shot-*.png');
}

main();
