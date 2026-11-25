/**
 * Generates build/icon.ico (256×256, PNG-in-ICO) without any image dependency.
 * Run with: node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 256;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Deterministic stars so the icon is reproducible.
function stars(count) {
  const out = [];
  let seed = 20261125;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    out.push({ x: rand(), y: rand(), r: 0.3 + rand() * 0.9, a: 0.15 + rand() * 0.6 });
  }
  return out;
}

const STAR_LIST = stars(90);

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const bg = [7, 15, 18];
  const orbCore = [233, 251, 249];
  const orbMid = [90, 190, 188];
  const orbEdge = [18, 44, 48];

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const nx = x / SIZE;
      const ny = y / SIZE;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / (SIZE / 2);

      // rounded-square backdrop with a soft vignette
      const corner = Math.max(Math.abs(dx), Math.abs(dy)) / (SIZE / 2);
      const alphaBg = 1 - smoothstep(0.98, 1.16, corner);
      let color = mixColor(bg, [3, 7, 9], smoothstep(0.2, 1.1, dist) * 0.8);

      // stars
      for (const star of STAR_LIST) {
        const sx = (star.x - nx) * SIZE;
        const sy = (star.y - ny) * SIZE;
        const d = Math.sqrt(sx * sx + sy * sy);
        const radius = star.r * 1.6;
        if (d < radius) color = mixColor(color, [236, 250, 248], (1 - d / radius) * star.a);
      }

      // planet horizon: a dim arc in the lower right
      const px = nx - 0.94;
      const py = ny - 1.12;
      const planet = Math.sqrt(px * px + py * py);
      if (planet < 0.62) {
        const light = 1 - smoothstep(0.12, 0.62, planet);
        color = mixColor(color, mixColor([8, 20, 24], [40, 86, 88], light * 0.9), 0.75);
      }
      const halo = Math.exp(-Math.pow((planet - 0.62) * 24, 2));
      color = mixColor(color, [110, 205, 200], halo * 0.3);

      // the orb
      if (dist < 0.44) {
        const t = smoothstep(0.44, 0.03, dist);
        color = mixColor(color, mixColor(orbEdge, orbMid, Math.pow(t, 0.7)), 0.92);
        color = mixColor(color, orbCore, Math.pow(t, 3.4) * 0.95);
      }
      // outer glow
      const glow = Math.exp(-Math.pow((dist - 0.2) * 4.2, 2));
      color = mixColor(color, [96, 200, 196], glow * 0.18);

      const index = (y * SIZE + x) * 4;
      pixels[index] = Math.round(Math.max(0, Math.min(255, color[0])));
      pixels[index + 1] = Math.round(Math.max(0, Math.min(255, color[1])));
      pixels[index + 2] = Math.round(Math.max(0, Math.min(255, color[2])));
      pixels[index + 3] = Math.round(Math.max(0, Math.min(255, alphaBg * 255)));
    }
  }
  return pixels;
}

function encodePng(pixels) {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256px
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

const pixels = render();
const png = encodePng(pixels);
const dir = path.join(process.cwd(), 'build');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), png);
fs.writeFileSync(path.join(dir, 'icon.ico'), encodeIco(png));
console.log(`[make-icon] wrote build/icon.ico (${encodeIco(png).length} bytes) and build/icon.png`);
