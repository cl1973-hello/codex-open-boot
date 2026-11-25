'use strict';

/**
 * Pure geometry helpers shared by the splash renderer, the window animator and the tests.
 *
 * Coordinate model:
 *  - `screenFrames` are normalised rectangles (0..1) relative to the *video frame*.
 *  - `layoutVideo()` returns where the video pixels actually land inside the window
 *    once `object-fit` has been applied (may overflow the window when fit === 'cover').
 *  - Everything else is plain physical pixels, unless the name says DIP or normalised.
 */

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function lerp(a, b, p) {
  return a + (b - a) * p;
}

/** Where the video is displayed inside a cw×ch content box. */
function layoutVideo(cw, ch, vw, vh, fit) {
  if (!cw || !ch || !vw || !vh) return { x: 0, y: 0, w: cw || 0, h: ch || 0 };
  const scale =
    fit === 'contain'
      ? Math.min(cw / vw, ch / vh)
      : Math.max(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Linear interpolation over keyframes; clamps outside the range. */
function framesAt(frames, time) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { time: 0, x: 0, y: 0, width: 1, height: 1 };
  }
  if (frames.length === 1) return frames[0];
  if (time <= frames[0].time) return frames[0];
  const last = frames[frames.length - 1];
  if (time >= last.time) return last;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      const p = span <= 0 ? 0 : (time - a.time) / span;
      return {
        time,
        x: lerp(a.x, b.x, p),
        y: lerp(a.y, b.y, p),
        width: lerp(a.width, b.width, p),
        height: lerp(a.height, b.height, p),
      };
    }
  }
  return last;
}

/** Normalised frame -> pixel rect using a layout rect from layoutVideo(). */
function mapFrame(frame, layout) {
  return {
    x: layout.x + frame.x * layout.w,
    y: layout.y + frame.y * layout.h,
    w: frame.width * layout.w,
    h: frame.height * layout.h,
  };
}

/** Keep a rect inside the viewport (cover layouts overflow on purpose). */
function clampRect(rect, cw, ch) {
  const w = Math.min(rect.w, cw);
  const h = Math.min(rect.h, ch);
  return {
    x: clamp(rect.x, 0, Math.max(0, cw - w)),
    y: clamp(rect.y, 0, Math.max(0, ch - h)),
    w,
    h,
  };
}

/**
 * Integer rect + the uniform scale factor between it and a cw×ch viewport.
 * `max()` keeps the rect covering the viewport (no seams), at most ~4% overscan.
 */
function toPortal(rect, cw, ch) {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const k = Math.max(w / cw, h / ch);
  return { x, y, w, h, k };
}

/** Duration of the closing "expand to full window" move, in ms. */
function tailMs(rect, cw, ch) {
  const dx = Math.max(0, cw - rect.w);
  const dy = Math.max(0, ch - rect.h);
  const distance = Math.max(dx / cw, dy / ch);
  return Math.round(clamp(1000 * 3 * distance, 260, 1100));
}

function lerpRect(a, b, p) {
  return {
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    w: lerp(a.w, b.w, p),
    h: lerp(a.h, b.h, p),
  };
}

function easeInOutCubic(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

module.exports = {
  clamp,
  lerp,
  layoutVideo,
  framesAt,
  mapFrame,
  clampRect,
  toPortal,
  tailMs,
  lerpRect,
  easeInOutCubic,
};
