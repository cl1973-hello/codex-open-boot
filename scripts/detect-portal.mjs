/**
 * Dev utility: detects the glowing rectangle inside a splash video and prints the
 * normalised keyframes, so `assets/media/theme.json` can be calibrated without hand work.
 *
 *   node scripts/detect-portal.mjs [video] [--from 6.8] [--to 10] [--step 0.25]
 *
 * It measures row/column brightness profiles in the central band of the frame and picks
 * the two strongest peaks — which is exactly where the glowing outline sits.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { video: path.join(ROOT, 'assets', 'media', 'video.mp4'), from: 6.75, to: 10, step: 0.25, width: 1280, height: 720 };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--from') args.from = Number(argv[++i]);
    else if (token === '--to') args.to = Number(argv[++i]);
    else if (token === '--step') args.step = Number(argv[++i]);
    else if (!token.startsWith('--')) args.video = path.resolve(token);
  }
  return args;
}

function frameAt(video, time, width, height) {
  const result = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-ss', String(time), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: width * height * 3 + 1024 }
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed at ${time}s: ${result.stderr}`);
  return result.stdout;
}

function profile(buffer, width, height) {
  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const lum = (0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2]) / 255;
      rowSum += lum;
      cols[x] += lum;
    }
    rows[y] = rowSum;
  }
  return { rows, cols };
}

function peakInRange(values, from, to) {
  let best = -1;
  let bestValue = -1;
  for (let i = Math.max(0, from); i < Math.min(values.length, to); i += 1) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      best = i;
    }
  }
  return best;
}

function detect(buffer, width, height) {
  const { rows, cols } = profile(buffer, width, height);

  // Use only the central band so the planet limb / stars cannot win the peak.
  const xFrom = Math.round(width * 0.2);
  const xTo = Math.round(width * 0.8);
  const yFrom = Math.round(height * 0.2);
  const yTo = Math.round(height * 0.8);

  const centralRows = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = xFrom; x < xTo; x += 1) {
      const i = (y * width + x) * 3;
      sum += (0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2]) / 255;
    }
    centralRows[y] = sum;
  }

  const centralCols = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = yFrom; y < yTo; y += 1) {
      const i = (y * width + x) * 3;
      sum += (0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2]) / 255;
    }
    centralCols[x] = sum;
  }

  const midY = Math.round(height / 2);
  const midX = Math.round(width / 2);
  const top = peakInRange(centralRows, Math.round(height * 0.12), midY);
  const bottom = peakInRange(centralRows, midY, Math.round(height * 0.92));
  const left = peakInRange(centralCols, Math.round(width * 0.06), midX);
  const right = peakInRange(centralCols, midX, Math.round(width * 0.94));

  return {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}

const args = parseArgs(process.argv);
const frames = [];
for (let t = args.from; t <= args.to + 1e-6; t += args.step) {
  const time = Math.round(t * 1000) / 1000;
  const buffer = frameAt(args.video, time, args.width, args.height);
  const rect = detect(buffer, args.width, args.height);
  frames.push({
    time,
    x: Math.round(rect.x * 10000) / 10000,
    y: Math.round(rect.y * 10000) / 10000,
    width: Math.round(rect.width * 10000) / 10000,
    height: Math.round(rect.height * 10000) / 10000,
  });
}

console.log(JSON.stringify(frames, null, 2));

if (process.argv.includes('--write')) {
  const themePath = path.join(ROOT, 'assets', 'media', 'theme.json');
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  theme.screenFrames = frames;
  theme.duration = theme.duration || 10;
  fs.writeFileSync(themePath, JSON.stringify(theme, null, 2), 'utf8');
  console.log(`[detect] wrote ${frames.length} frames into ${path.relative(ROOT, themePath)}`);
}
