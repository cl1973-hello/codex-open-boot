'use strict';

const { qs, on, nextFrame } = require('../core/dom');
const {
  layoutVideo,
  framesAt,
  mapFrame,
  clampRect,
  toPortal,
  tailMs,
  lerpRect,
  easeInOutCubic,
} = require('../../../shared/geometry');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the splash video and the "portal" that carries the workbench out of it.
 *
 * The workbench is mounted at its final size and uniformly scaled down into the video's
 * screen rectangle, then scaled back up — so what the user sees is a screen growing,
 * not a hole opening.
 */
class Splash {
  constructor({ store, bridge, workbench, workbenchEl, onSettled }) {
    this.store = store;
    this.bridge = bridge;
    this.workbench = workbench;
    this.onSettled = onSettled || (() => {});
    this.stage = qs('#stage');
    this.splashEl = qs('#splash');
    this.video = qs('#splash-video');
    this.poster = qs('#splash-poster');
    this.portal = qs('#portal');
    this.workbenchEl = workbenchEl;
    this.skipButton = qs('#splash-skip');

    this.raf = 0;
    this.vfcId = 0;
    this.anchor = null;
    this.tailing = false;
    this.running = false;
    this.liveShown = false;
    this.time = 0;
    this.cw = 0;
    this.ch = 0;
    this.vw = 0;
    this.vh = 0;
    this.layout = null;
    this.currentRect = null;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async run() {
    const state = this.store.get();
    const theme = state.theme;
    const media = state.media || {};
    if (!media.video || !theme) {
      this.settle();
      return;
    }

    this.theme = theme;
    this.measure();
    this.running = true;
    this.liveShown = false;
    this.tailing = false;
    this.anchor = null;

    this.stage.dataset.mode = 'splash';
    this.portal.classList.remove('is-settled');
    this.portal.classList.remove('is-live');
    this.splashEl.hidden = false;
    this.splashEl.classList.toggle('fit-contain', theme.fit === 'contain');
    this.poster.src = media.poster || '';
    this.skipButton.hidden = !state.settings.splash.skippable;

    const video = this.video;
    video.style.display = '';
    video.classList.remove('is-visible');
    video.src = media.video;
    video.volume = state.settings.splash.volume;
    video.muted = false;
    video.load();

    await this.gate();

    // Wait one rAF so the first frame is painted before the poster fades out.
    this.showPoster();

    video.addEventListener(
      'playing',
      () => {
        this.showVideo();
        setTimeout(() => this.hidePoster(), 120);
      },
      { once: true }
    );

    try {
      await video.play();
    } catch {
      this.settle();
      return;
    }

    this.bindFrameCallback();
    this.loop();
  }

  showPoster() {
    if (this.poster) this.poster.style.opacity = '1';
  }

  hidePoster() {
    if (this.poster) this.poster.style.opacity = '0';
  }

  showVideo() {
    if (this.video) this.video.classList.add('is-visible');
  }

  measure() {
    this.cw = window.innerWidth;
    this.ch = window.innerHeight;
    this.vw = this.video.videoWidth || 16;
    this.vh = this.video.videoHeight || 9;
    const base = layoutVideo(this.cw, this.ch, this.vw, this.vh, (this.theme && this.theme.fit) || 'cover');
    // Cropping the baked-in letterbox: zoom about the centre keeps the keyframe mapping
    // exact because the same factor is applied to the layout rect.
    const zoom = (this.theme && this.theme.zoom) || 1;
    this.layout =
      zoom === 1
        ? base
        : {
            x: base.x - (base.w * (zoom - 1)) / 2,
            y: base.y - (base.h * (zoom - 1)) / 2,
            w: base.w * zoom,
            h: base.h * zoom,
          };
    if (this.video) this.video.style.transform = `scale(${zoom})`;
    if (this.poster) this.poster.style.transform = `scale(${zoom})`;
    // The glowing frame in the footage has a ~1.5 %-of-width corner radius; match it so the
    // workbench looks like it is *inside* that frame instead of pasted on top.
    this.radius = Math.round(this.layout.w * 0.0156);
    this.workbench.resize(this.cw, this.ch);
  }

  async gate() {
    const timeout = (this.store.get().settings.splash || {}).gateTimeoutMs || 1200;
    const video = this.video;

    const ready = new Promise((resolve) => {
      if (video.readyState >= 3 && video.videoWidth) return resolve();
      const done = () => {
        video.removeEventListener('canplay', done);
        video.removeEventListener('error', done);
        resolve();
      };
      video.addEventListener('canplay', done, { once: true });
      video.addEventListener('error', done, { once: true });
    });

    const posterReady = new Promise((resolve) => {
      if (!this.poster.src) return resolve();
      if (this.poster.complete && this.poster.naturalWidth) return resolve();
      const done = () => resolve();
      this.poster.addEventListener('load', done, { once: true });
      this.poster.addEventListener('error', done, { once: true });
    });

    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

    await Promise.race([Promise.all([ready, posterReady, fonts, nextFrame()]), sleep(timeout)]);
    this.measure();
  }

  bindFrameCallback() {
    const video = this.video;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    const onFrame = (_now, metadata) => {
      this.anchor = { mediaTime: metadata.mediaTime, expected: metadata.expectedDisplayTime };
      this.vfcId = video.requestVideoFrameCallback(onFrame);
    };
    this.vfcId = video.requestVideoFrameCallback(onFrame);

    video.addEventListener('ended', () => this.toEnd(false), { once: true });
    video.addEventListener('error', () => this.settle(), { once: true });
  }

  estimateTime(now) {
    const video = this.video;
    const duration = Number.isFinite(video.duration) ? video.duration : this.theme.duration;
    if (video.paused || !this.anchor) return Math.min(video.currentTime || 0, duration);
    const estimate = this.anchor.mediaTime + (now - this.anchor.expected) / 1000;
    return Math.max(0, Math.min(duration, estimate));
  }

  loop() {
    const tick = (now) => {
      if (!this.running || this.tailing) return;
      this.raf = requestAnimationFrame(tick);
      const time = this.estimateTime(now);
      this.time = time;
      this.updateGeometry(time);

      if (!this.liveShown && time >= this.theme.transitionStart - 0.25) {
        this.liveShown = true;
        this.portal.classList.add('is-live');
        this.stage.classList.add('is-transitioning');
      }
      if (time >= this.theme.transitionEnd) this.toEnd(false);
    };
    this.raf = requestAnimationFrame(tick);
  }

  updateGeometry(time) {
    if (!this.layout) this.measure();
    const frame = framesAt(this.theme.screenFrames, time);
    const raw = mapFrame(frame, this.layout);
    const rect = clampRect(raw, this.cw, this.ch);
    this.currentRect = rect;
    this.applyRect(rect, this.radius || 14);
    return rect;
  }

  applyRect(rect, radius) {
    const portalRect = toPortal(rect, this.cw, this.ch);
    const style = this.portal.style;
    style.left = `${portalRect.x}px`;
    style.top = `${portalRect.y}px`;
    style.width = `${portalRect.w}px`;
    style.height = `${portalRect.h}px`;
    style.borderRadius = `${Math.max(0, Math.round(radius))}px`;

    // The video's frame is ~2.1:1 while the window is ~1.6:1, so a uniform "cover" scale
    // overflows vertically. Centre that overflow instead of anchoring at the top-left.
    const offsetX = Math.round((portalRect.w - this.cw * portalRect.k) / 2);
    const offsetY = Math.round((portalRect.h - this.ch * portalRect.k) / 2);
    this.workbenchEl.style.left = `${offsetX}px`;
    this.workbenchEl.style.top = `${offsetY}px`;
    this.workbenchEl.style.transform = `scale(${portalRect.k})`;
    this.workbenchEl.style.transformOrigin = '0 0';
  }

  /** Close the remaining gap: from the last keyframe rectangle to the full window. */
  toEnd(short) {
    if (this.tailing) return;
    this.tailing = true;
    this.liveShown = true;
    this.portal.classList.add('is-live');
    this.stage.classList.add('is-transitioning');

    if (this.skipButton) this.skipButton.hidden = true;

    // Recompute at transitionEnd so the tail starts exactly where the keyframes stop.
    const rect = this.updateGeometry(this.theme.transitionEnd);
    try {
      this.video.pause();
    } catch {
      /* ignore */
    }

    const settings = this.store.get().settings;
    const duration = short ? 320 : settings.splash.tailMs > 0 ? settings.splash.tailMs : tailMs(rect, this.cw, this.ch);
    const from = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const to = { x: 0, y: 0, w: this.cw, h: this.ch };
    const start = performance.now();

    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(p);
      const current = lerpRect(from, to, eased);
      this.applyRect(current, (this.radius || 14) * (1 - eased));
      if (p < 1) requestAnimationFrame(step);
      else this.settle();
    };
    requestAnimationFrame(step);
  }

  async settle() {
    if (!this.running && this.stage.dataset.mode === 'workbench') return;
    this.running = false;
    this.tailing = false;
    cancelAnimationFrame(this.raf);
    await this.releaseVideo();

    this.stage.dataset.mode = 'workbench';
    this.portal.classList.add('is-settled');
    this.portal.classList.remove('is-live');
    this.stage.classList.remove('is-transitioning');
    this.portal.removeAttribute('style');
    this.resetWorkbenchTransform();

    if (this.skipButton) this.skipButton.hidden = true;
    this.bridge.splashDone();
    this.onSettled();
  }

  async releaseVideo() {
    const video = this.video;
    if (!video) return;
    if (typeof video.cancelVideoFrameCallback === 'function' && this.vfcId) {
      try {
        video.cancelVideoFrameCallback(this.vfcId);
      } catch {
        /* ignore */
      }
      this.vfcId = 0;
    }
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.classList.remove('is-visible');
    this.showPoster();
    await nextFrame();
    video.style.display = 'none';
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      /* ignore */
    }
    this.anchor = null;
  }

  /** Esc / skip button: jump to the end of the animation, keep the transition short. */
  skip() {
    if (!this.running) return;
    this.toEnd(true);
  }

  /* -------------------------- calibration helpers -------------------------- */

  /** Bring the video layer back without starting the automatic timeline. */
  async enterCalibration(themeOverride) {
    const state = this.store.get();
    const media = state.media || {};
    this.theme = themeOverride || state.theme;
    this.running = false;
    this.tailing = false;
    this.liveShown = true;
    cancelAnimationFrame(this.raf);
    this.stage.dataset.mode = 'splash';
    this.portal.classList.remove('is-settled');
    this.splashEl.hidden = false;
    this.splashEl.classList.toggle('fit-contain', this.theme.fit === 'contain');
    this.poster.src = media.poster || '';

    const video = this.video;
    video.style.display = '';
    video.classList.remove('is-visible');
    if (video.getAttribute('src') !== media.video) {
      video.src = media.video;
      video.load();
    }
    await this.waitMetadata(2500);
    this.measure();
    video.pause();
    this.showVideo();
    this.hidePoster();
  }

  waitMetadata(timeout) {
    const video = this.video;
    if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('loadedmetadata', done);
        video.removeEventListener('error', done);
        resolve();
      };
      video.addEventListener('loadedmetadata', done, { once: true });
      video.addEventListener('error', done, { once: true });
      setTimeout(done, timeout);
    });
  }

  /** Pixel rect (window space) for an arbitrary time, using the current theme. */
  rectAt(time) {
    if (!this.layout) this.measure();
    const frame = framesAt(this.theme.screenFrames, time);
    return clampRect(mapFrame(frame, this.layout), this.cw, this.ch);
  }

  /** Jump straight to the workbench state, skipping the tail animation. */
  settleNow() {
    this.running = false;
    this.tailing = false;
    cancelAnimationFrame(this.raf);
    this.stage.dataset.mode = 'workbench';
    this.portal.classList.add('is-settled');
    this.portal.classList.remove('is-live');
    this.stage.classList.remove('is-transitioning');
    this.portal.removeAttribute('style');
    this.resetWorkbenchTransform();
    this.releaseVideo();
    this.bridge.splashDone();
    this.onSettled();
  }

  resetWorkbenchTransform() {
    this.workbenchEl.style.transform = 'none';
    this.workbenchEl.style.left = '0px';
    this.workbenchEl.style.top = '0px';
  }

  previewAt(time) {
    if (!this.layout) this.measure();
    if (!this.video.paused) {
      this.video.pause();
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
    const threshold = (this.theme.transitionStart || 0) - 0.25;
    this.portal.classList.toggle('is-live', time >= threshold);
    this.time = time;
    return this.updateGeometry(time);
  }

  bindSkip() {
    on(window, 'keydown', (event) => {
      if (event.key === 'Escape' && this.running && !document.body.classList.contains('hud-active')) {
        event.preventDefault();
        this.skip();
      }
    });
    on(this.skipButton, 'click', () => this.skip());
  }

  bindResize() {
    on(window, 'resize', () => {
      this.measure();
      if (this.stage.dataset.mode === 'workbench') {
        this.workbenchEl.style.transform = 'none';
        return;
      }
      if (this.theme && this.running) this.updateGeometry(this.time);
    });
  }
}

module.exports = { Splash };
