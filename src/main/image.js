'use strict';

/** 背景图预处理：缩到合适尺寸、转 JPEG data URL（Codex 的 CSP 没有 file:，只能用 data:/blob:） */

const fs = require('fs');
const { nativeImage } = require('electron');

const MAX_EDGE = 2560;
const QUALITY = 82;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

const cache = new Map(); // filePath + mtime -> result

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 采样缩略图的亮度：avg 与 p90（后者用于对比度守卫的最坏情况） */
function luminanceOf(image) {
  try {
    const small = image.resize({ width: 48, height: Math.max(1, Math.round((48 * image.getSize().height) / image.getSize().width)) });
    const bmp = small.toBitmap(); // BGRA
    const lums = [];
    let sum = 0;
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      const b = bmp[i];
      const g = bmp[i + 1];
      const r = bmp[i + 2];
      const lin = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
      lums.push(lin);
      sum += lin;
    }
    if (!lums.length) return { avg: 0, p90: 0 };
    lums.sort((a, b) => a - b);
    return { avg: sum / lums.length, p90: lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.9))] };
  } catch {
    return { avg: 0, p90: 0 };
  }
}

/**
 * 读图 -> 缩放 -> JPEG data URL
 * @returns {{dataUrl:string|null, lum:{avg:number,p90:number}, width:number, height:number, error?:string}}
 */
function prepare(filePath) {
  if (typeof filePath !== 'string' || !filePath) return { dataUrl: null, lum: { avg: 0, p90: 0 }, width: 0, height: 0 };
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { dataUrl: null, lum: { avg: 0, p90: 0 }, width: 0, height: 0, error: '文件不存在' };
  }
  if (stat.size > MAX_SOURCE_BYTES) {
    return { dataUrl: null, lum: { avg: 0, p90: 0 }, width: 0, height: 0, error: '图片超过 40MB' };
  }

  const key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  if (cache.has(key)) return cache.get(key);

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    const failed = { dataUrl: null, lum: { avg: 0, p90: 0 }, width: 0, height: 0, error: '无法解码这张图片' };
    cache.set(key, failed);
    return failed;
  }

  const size = image.getSize();
  const longEdge = Math.max(size.width, size.height);
  const scaled =
    longEdge > MAX_EDGE
      ? image.resize({ width: Math.round((size.width * MAX_EDGE) / longEdge), height: Math.round((size.height * MAX_EDGE) / longEdge) })
      : image;

  const buffer = scaled.toJPEG(QUALITY);
  const result = {
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    lum: luminanceOf(scaled),
    width: scaled.getSize().width,
    height: scaled.getSize().height,
  };

  if (cache.size > 8) cache.clear();
  cache.set(key, result);
  return result;
}

module.exports = { prepare, luminanceOf, MAX_EDGE };
