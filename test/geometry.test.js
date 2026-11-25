'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  layoutVideo,
  framesAt,
  mapFrame,
  clampRect,
  toPortal,
  tailMs,
  easeInOutCubic,
} = require('../src/shared/geometry');

const FRAMES = [
  { time: 7, x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
  { time: 8, x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  { time: 9, x: 0, y: 0, width: 1, height: 1 },
];

test('layoutVideo: cover fills and overflows symmetrically', () => {
  const L = layoutVideo(1440, 900, 1280, 720, 'cover');
  assert.equal(L.h, 900);
  assert.ok(L.w > 1440);
  assert.ok(L.x < 0);
  assert.equal(Math.round(L.x + L.w), Math.round(1440 - L.x));
});

test('layoutVideo: contain letterboxes', () => {
  const L = layoutVideo(1200, 900, 1280, 720, 'contain');
  assert.equal(L.w, 1200);
  assert.ok(L.h < 900);
  assert.ok(L.y > 0);
});

test('layoutVideo: degenerate input does not produce NaN', () => {
  const L = layoutVideo(0, 0, 0, 0, 'cover');
  assert.ok(Number.isFinite(L.x) && Number.isFinite(L.w));
});

test('framesAt: clamps before the first and after the last frame', () => {
  assert.deepEqual(framesAt(FRAMES, 0), FRAMES[0]);
  assert.deepEqual(framesAt(FRAMES, 99), FRAMES[2]);
});

test('framesAt: interpolates linearly in the middle', () => {
  const mid = framesAt(FRAMES, 7.5);
  assert.equal(mid.x, 0.25);
  assert.equal(mid.width, 0.5);
  assert.equal(mid.time, 7.5);
});

test('framesAt: single frame and empty arrays are safe', () => {
  assert.equal(framesAt([{ time: 3, x: 1, y: 1, width: 1, height: 1 }], 1).time, 3);
  const empty = framesAt([], 5);
  assert.equal(empty.width, 1);
});

test('mapFrame: converts normalised to pixels inside the layout rect', () => {
  const L = { x: -80, y: 0, w: 1600, h: 900 };
  const rect = mapFrame(FRAMES[0], L);
  assert.equal(rect.x, -80 + 0.3 * 1600);
  assert.equal(rect.w, 0.4 * 1600);
});

test('clampRect: keeps the rect inside the viewport', () => {
  const clamped = clampRect({ x: -500, y: -500, w: 5000, h: 5000 }, 1440, 900);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.w, 1440);
  assert.equal(clamped.h, 900);
});

test('toPortal: integer rect and a scale that always covers', () => {
  const portal = toPortal({ x: 10.4, y: 20.6, w: 400.2, h: 300.8 }, 1440, 900);
  assert.equal(portal.x, 10);
  assert.equal(portal.y, 21);
  assert.ok(portal.k >= portal.w / 1440 - 1e-9);
  assert.ok(portal.k >= portal.h / 900 - 1e-9);
  assert.ok(portal.k < 1);
});

test('tailMs: stays inside the usable window', () => {
  assert.ok(tailMs({ x: 300, y: 150, w: 780, h: 500 }, 1440, 900) >= 260);
  assert.ok(tailMs({ x: 0, y: 0, w: 10, h: 10 }, 1440, 900) <= 1100);
});

test('easeInOutCubic: monotonic, 0 -> 1', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  let previous = -1;
  for (let p = 0; p <= 1; p += 0.05) {
    const value = easeInOutCubic(p);
    assert.ok(value >= previous - 1e-9);
    previous = value;
  }
});
