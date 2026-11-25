'use strict';

const { qs, on, escapeHtml } = require('../core/dom');
const { framesAt, layoutVideo } = require('../../../shared/geometry');
const { validateTheme } = require('../../../shared/validate');
const { Overlay } = require('./overlay');
const { Timeline } = require('./timeline');

const SNAP = 0.03;

function cloneTheme(theme) {
  return {
    ...theme,
    screenFrames: theme.screenFrames.map((frame) => ({ time: frame.time, x: frame.x, y: frame.y, width: frame.width, height: frame.height })),
  };
}

/**
 * Keyframe editor. Everything is normalised to the video frame, so the same numbers work
 * at any window size; the overlay converts drag deltas by dividing by the *video display*
 * rect, which keeps the drag 1:1 even when object-fit: cover overflows the window.
 */
class Calibration {
  constructor({ store, bridge, splash, onClosed }) {
    this.store = store;
    this.bridge = bridge;
    this.splash = splash;
    this.onClosed = onClosed || (() => {});
    this.open = false;
    this.theme = null;
    this.duration = 0;
    this.time = 0;
    this.activeIndex = 0;
    this.playing = false;
    this.playRaf = 0;
    this.hud = qs('#hud');
  }

  async openHud() {
    if (this.open) return;
    const state = this.store.get();
    this.theme = cloneTheme(state.theme);
    this.duration = Number(this.theme.duration) || 10;
    this.open = true;
    this.building = true;

    await this.splash.enterCalibration(this.theme);
    this.duration = Number.isFinite(this.splash.video.duration) && this.splash.video.duration > 0
      ? this.splash.video.duration
      : this.duration;
    this.theme.duration = this.duration;

    this.build();
    document.body.classList.add('hud-active');
    this.hud.hidden = false;

    this.activeIndex = this.nearestIndex(this.theme.transitionStart);
    this.seek(this.theme.transitionStart);
    this.building = false;
    this.render();
  }

  build() {
    this.hud.innerHTML = `
      <div class="hud-topbar">
        <div class="hud-title"><b>校准动画</b><span>拖动矩形对齐视频里的那块屏幕</span></div>
        <div class="hud-readout" id="hud-time">t 0.00 / 0.00 s</div>
        <div class="hud-readout" id="hud-rect">x 0 y 0 w 0 h 0</div>
        <button class="hud-btn" data-h="prev">上帧</button>
        <button class="hud-btn" data-h="play">播放</button>
        <button class="hud-btn" data-h="next">下帧</button>
        <button class="hud-btn" data-h="add">在此打点</button>
        <button class="hud-btn" data-h="del">删除该帧</button>
        <button class="hud-btn" data-h="tail">预览收尾</button>
        <div class="hud-spacer"></div>
        <button class="hud-btn" data-h="reload">放弃修改</button>
        <button class="hud-btn hud-btn--primary" data-h="save">保存</button>
        <button class="hud-btn hud-btn--danger" data-h="exit">退出</button>
      </div>
      <div class="hud-overlay" id="hud-overlay"></div>
      <div class="hud-timeline" id="hud-timeline"></div>
    `;

    this.overlay = new Overlay({ root: qs('#hud-overlay', this.hud), onChange: (frame) => this.onFrameDrag(frame) });
    this.overlay.mount();

    this.timeline = new Timeline({
      root: qs('#hud-timeline', this.hud),
      onSeek: (time) => this.seek(time),
      onSelectFrame: (index) => {
        this.activeIndex = index;
        this.seek(this.theme.screenFrames[index].time);
      },
      onKeyframeMove: (index, time) => this.moveKeyframe(index, time),
      onMarkerMove: (name, time) => this.moveMarker(name, time),
    });
    this.timeline.mount();

    on(this.hud, 'click', (event) => {
      const button = event.target.closest('[data-h]');
      if (!button) return;
      this.action(button.dataset.h);
    });
  }

  action(name) {
    switch (name) {
      case 'prev':
        this.seek(this.time - 1 / 30);
        break;
      case 'next':
        this.seek(this.time + 1 / 30);
        break;
      case 'play':
        this.togglePlay();
        break;
      case 'add':
        this.addFrame();
        break;
      case 'del':
        this.deleteFrame();
        break;
      case 'tail':
        this.previewTail();
        break;
      case 'reload':
        this.theme = cloneTheme(this.store.get().theme);
        this.theme.duration = this.duration;
        this.activeIndex = this.nearestIndex(this.time);
        this.render();
        break;
      case 'save':
        this.save();
        break;
      case 'exit':
        this.close();
        break;
      default:
        break;
    }
  }

  nearestIndex(time) {
    let best = 0;
    let bestDistance = Infinity;
    this.theme.screenFrames.forEach((frame, index) => {
      const distance = Math.abs(frame.time - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  seek(time) {
    const clamped = Math.max(0, Math.min(this.duration - 0.01, time));
    this.time = clamped;
    const video = this.splash.video;
    try {
      video.currentTime = clamped;
    } catch {
      /* ignore */
    }
    this.apply();
  }

  apply() {
    this.splash.theme = this.theme;
    this.splash.portal.classList.add('is-live');
    this.splash.updateGeometry(this.time);
    this.render();
  }

  render() {
    if (!this.open) return;
    const layout = this.splash.layout || layoutVideo(window.innerWidth, window.innerHeight, 16, 9, 'cover');
    const frame = framesAt(this.theme.screenFrames, this.time);
    const nearest = this.theme.screenFrames[this.activeIndex] || frame;

    this.overlay.update(frame, layout, window.innerWidth, window.innerHeight, nearest);

    const timeEl = qs('#hud-time', this.hud);
    if (timeEl) timeEl.textContent = `t ${this.time.toFixed(2)} / ${this.duration.toFixed(2)} s`;

    const rectEl = qs('#hud-rect', this.hud);
    if (rectEl) {
      rectEl.textContent = `x ${frame.x.toFixed(3)} y ${frame.y.toFixed(3)} w ${frame.width.toFixed(3)} h ${frame.height.toFixed(3)}`;
    }

    const playButton = qs('[data-h="play"]', this.hud);
    if (playButton) {
      playButton.classList.toggle('is-on', this.playing);
      playButton.textContent = this.playing ? '暂停' : '播放';
    }

    this.timeline.render({
      duration: this.duration,
      frames: this.theme.screenFrames,
      currentTime: this.time,
      selectedIndex: this.activeIndex,
      holdAt: this.theme.holdAt,
      transitionStart: this.theme.transitionStart,
      transitionEnd: this.theme.transitionEnd,
    });
  }

  onFrameDrag(frame) {
    const target = this.theme.screenFrames[this.activeIndex];
    if (!target) return;
    target.x = frame.x;
    target.y = frame.y;
    target.width = frame.width;
    target.height = frame.height;
    this.apply();
  }

  addFrame() {
    const time = this.time;
    const existing = this.theme.screenFrames.find((frame) => Math.abs(frame.time - time) < SNAP);
    if (existing) {
      this.activeIndex = this.theme.screenFrames.indexOf(existing);
      this.render();
      return;
    }
    const value = framesAt(this.theme.screenFrames, time);
    const frame = { time, x: value.x, y: value.y, width: value.width, height: value.height };
    // Inserting the interpolated rect keeps the picture visually identical at that instant.
    this.theme.screenFrames.push(frame);
    this.theme.screenFrames.sort((a, b) => a.time - b.time);
    this.activeIndex = this.theme.screenFrames.indexOf(frame);
    this.render();
  }

  deleteFrame() {
    if (this.theme.screenFrames.length <= 2) return;
    this.theme.screenFrames.splice(this.activeIndex, 1);
    this.activeIndex = Math.max(0, Math.min(this.theme.screenFrames.length - 1, this.activeIndex));
    this.apply();
  }

  moveKeyframe(index, time) {
    const frames = this.theme.screenFrames;
    const frame = frames[index];
    if (!frame) return;
    const min = index > 0 ? frames[index - 1].time + 0.02 : 0;
    const max = index < frames.length - 1 ? frames[index + 1].time - 0.02 : this.duration - 0.02;
    frame.time = Math.max(min, Math.min(max, time));
    this.activeIndex = index;
    this.seek(frame.time);
  }

  moveMarker(name, time) {
    const clamped = Math.max(0, Math.min(this.duration - 0.02, time));
    if (name === 'holdAt') this.theme.holdAt = Math.min(clamped, this.theme.transitionStart);
    if (name === 'transitionStart') {
      this.theme.transitionStart = Math.max(this.theme.holdAt, Math.min(this.theme.transitionEnd - 0.05, clamped));
    }
    if (name === 'transitionEnd') {
      this.theme.transitionEnd = Math.max(this.theme.transitionStart + 0.05, clamped);
    }
    this.render();
  }

  togglePlay() {
    if (this.playing) {
      this.stopPlay();
      return;
    }
    const video = this.splash.video;
    this.playing = true;
    video.play().catch(() => this.stopPlay());
    const step = () => {
      if (!this.playing) return;
      const time = video.currentTime;
      this.time = time;
      this.splash.theme = this.theme;
      this.splash.portal.classList.add('is-live');
      this.splash.updateGeometry(time);
      this.render();
      if (time >= this.duration - 0.03) {
        this.stopPlay();
        return;
      }
      this.playRaf = requestAnimationFrame(step);
    };
    this.playRaf = requestAnimationFrame(step);
  }

  stopPlay() {
    this.playing = false;
    cancelAnimationFrame(this.playRaf);
    try {
      this.splash.video.pause();
    } catch {
      /* ignore */
    }
    this.render();
  }

  previewTail() {
    const from = this.splash.rectAt(this.theme.transitionEnd);
    const to = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const start = performance.now();
    const duration = 620;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const rect = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        w: from.w + (to.w - from.w) * eased,
        h: from.h + (to.h - from.h) * eased,
      };
      this.splash.applyRect(rect, 14 * (1 - eased));
      if (p < 1) requestAnimationFrame(step);
      else setTimeout(() => this.apply(), 420);
    };
    requestAnimationFrame(step);
  }

  async save() {
    const candidate = { ...this.theme, duration: this.duration };
    const result = validateTheme(candidate);
    if (!result.ok) {
      this.timeline.showErrors(result.errors);
      return;
    }
    this.timeline.showErrors([]);
    const saved = await this.bridge.saveTheme(candidate);
    if (!saved || !saved.ok) {
      this.timeline.showErrors((saved && saved.errors) || ['保存失败']);
      return;
    }
    const state = this.store.get();
    this.store.set({ theme: saved.theme, media: saved.media || state.media });
    this.close(true);
  }

  close(afterSave) {
    if (!this.open) return;
    this.stopPlay();
    this.open = false;
    this.hud.hidden = true;
    this.hud.innerHTML = '';
    document.body.classList.remove('hud-active');
    this.splash.theme = this.store.get().theme;
    this.splash.settleNow();
    this.onClosed(afterSave);
  }

  bindShortcut() {
    on(window, 'keydown', (event) => {
      if (event.key.toLowerCase() === 'c' && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        this.openHud();
      }
      if (!this.open) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.seek(this.time - (event.shiftKey ? 0.1 : 1 / 30));
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.seek(this.time + (event.shiftKey ? 0.1 : 1 / 30));
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }
}

module.exports = { Calibration };
