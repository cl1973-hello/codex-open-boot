'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { layoutFor, portalRectAt, findEntryTime, tailFrames } = require('../src/shared/portal');
const { framesAt } = require('../src/shared/geometry');

const theme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'media', 'theme.json'), 'utf8'));

// M0 实测的本机参数：2560×1368 物理 @150% -> 1706.7×912 DIP，最小 529×661 DIP
const CW = 2560 / 1.5;
const CH = 1368 / 1.5;
const MIN = { w: 793 / 1.5, h: 991 / 1.5 };

test('layoutFor：zoom 以中心放大，cover 时溢出为负坐标', () => {
  const plain = layoutFor(1000, 600, 1280, 720, 'cover', 1);
  const zoomed = layoutFor(1000, 600, 1280, 720, 'cover', 1.5);
  assert.ok(zoomed.w > plain.w);
  assert.ok(zoomed.x < plain.x);
  // 中心不变
  assert.ok(Math.abs(zoomed.x + zoomed.w / 2 - (plain.x + plain.w / 2)) < 1e-6);
});

test('portalRectAt 随视频时间单调变大（本项目素材）', () => {
  const layout = layoutFor(CW, CH, 1280, 720, 'cover', theme.zoom);
  let prev = null;
  for (const t of [6.8, 7.4, 8.0, 8.6, 9.2, 9.9]) {
    const r = portalRectAt(theme.screenFrames, layout, t, CW, CH);
    if (prev) assert.ok(r.w >= prev.w - 1 && r.h >= prev.h - 1, `t=${t} 矩形变小了`);
    prev = r;
  }
});

test('findEntryTime：本机 150% 缩放下落在 9.0~9.6 秒之间', () => {
  const layout = layoutFor(CW, CH, 1280, 720, 'cover', theme.zoom);
  const t = findEntryTime(theme.screenFrames, layout, CW, CH, MIN);
  assert.ok(t > 8.9 && t < 9.7, `入场时间异常: ${t}`);
  const rect = portalRectAt(theme.screenFrames, layout, t, CW, CH);
  assert.ok(rect.w >= MIN.w - 1 && rect.h >= MIN.h - 1, '入场时矩形仍放不下窗口');
});

test('findEntryTime：1080p@100% 时入场更早', () => {
  const layout = layoutFor(1920, 1040, 1280, 720, 'cover', theme.zoom);
  const t = findEntryTime(theme.screenFrames, layout, 1920, 1040, { w: 529, h: 661 });
  assert.ok(t < 9.5, `1080p 入场时间应该更早，实际 ${t}`);
});

test('findEntryTime：最小尺寸超过终态矩形时退化为最后一帧', () => {
  const layout = layoutFor(CW, CH, 1280, 720, 'cover', 1);
  const t = findEntryTime(theme.screenFrames, layout, CW, CH, { w: 99999, h: 99999 });
  assert.equal(t, theme.screenFrames.at(-1).time);
});

test('findEntryTime：空帧表不抛异常', () => {
  assert.equal(findEntryTime([], { x: 0, y: 0, w: 1, h: 1 }, 100, 100, MIN), 0);
});

test('tailFrames 单调收敛到目标矩形', () => {
  const from = { x: 10, y: 10, w: 200, h: 120 };
  const to = { x: 0, y: 0, w: 1000, h: 600 };
  const frames = tailFrames(from, to, 600, 12);
  assert.equal(frames.length, 13);
  assert.deepEqual(frames.at(-1).rect, to);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].rect.w >= frames[i - 1].rect.w);
  }
});

test('framesAt 在本项目数据上不会因越界返回全屏帧', () => {
  const f = framesAt(theme.screenFrames, 7.5);
  assert.ok(f.width > 0 && f.width < 1);
});
