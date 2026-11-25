'use strict';

const { qs, on } = require('../core/dom');

const MARKERS = [
  { key: 'holdAt', label: 'hold' },
  { key: 'transitionStart', label: 'start' },
  { key: 'transitionEnd', label: 'end' },
];

/** Time ruler with draggable keyframes, transition markers and a playhead. */
class Timeline {
  constructor({ root, onSeek, onKeyframeMove, onMarkerMove, onSelectFrame }) {
    this.root = root;
    this.onSeek = onSeek;
    this.onKeyframeMove = onKeyframeMove;
    this.onMarkerMove = onMarkerMove;
    this.onSelectFrame = onSelectFrame;
    this.data = null;
  }

  mount() {
    this.root.innerHTML = `
      <div class="hud-track" id="hud-track"></div>
      <div class="hud-legend">
        <span><i class="kf"></i>关键帧（拖动改时间）</span>
        <span><i class="mk"></i>hold / 过渡起止</span>
        <span><i class="ph"></i>播放头（点击轨道跳转）</span>
      </div>
      <div class="hud-errors" id="hud-errors" hidden></div>
    `;
    this.track = qs('#hud-track', this.root);
    this.errorsEl = qs('#hud-errors', this.root);

    on(this.track, 'pointerdown', (event) => this.onTrackPointerDown(event));
  }

  timeFromEvent(event) {
    const rect = this.track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * (this.data ? this.data.duration : 1);
  }

  onTrackPointerDown(event) {
    const keyframe = event.target.closest('.hud-keyframe');
    const marker = event.target.closest('.hud-marker');

    if (keyframe) {
      const index = Number(keyframe.dataset.index);
      if (this.onSelectFrame) this.onSelectFrame(index);
      this.drag(event, (time) => this.onKeyframeMove(index, time));
      return;
    }
    if (marker) {
      const name = marker.dataset.marker;
      this.drag(event, (time) => this.onMarkerMove(name, time));
      return;
    }
    this.onSeek(this.timeFromEvent(event));
    this.drag(event, (time) => this.onSeek(time));
  }

  drag(event, handler) {
    event.preventDefault();
    this.track.setPointerCapture(event.pointerId);
    const move = (moveEvent) => handler(this.timeFromEvent(moveEvent));
    const up = () => {
      this.track.removeEventListener('pointermove', move);
      this.track.removeEventListener('pointerup', up);
      this.track.removeEventListener('pointercancel', up);
    };
    this.track.addEventListener('pointermove', move);
    this.track.addEventListener('pointerup', up);
    this.track.addEventListener('pointercancel', up);
  }

  render(data) {
    this.data = data;
    const { duration, frames, currentTime } = data;
    const pct = (value) => `${Math.max(0, Math.min(1, value / duration)) * 100}%`;

    let html = '';

    // 0.5s ticks, label each second
    for (let t = 0; t <= duration + 1e-6; t += 0.5) {
      const isSecond = Math.abs(t - Math.round(t)) < 1e-6;
      html += `<div class="hud-tick" style="left:${pct(t)}">${isSecond ? `<span>${Math.round(t)}s</span>` : ''}</div>`;
    }

    const start = data.transitionStart;
    const end = data.transitionEnd;
    html += `<div class="hud-range" style="left:${pct(start)};width:${Math.max(0, end - start) / duration * 100}%"></div>`;

    MARKERS.forEach((marker) => {
      const value = data[marker.key];
      if (!Number.isFinite(value)) return;
      html += `<div class="hud-marker" data-marker="${marker.key}" data-label="${marker.label}" style="left:${pct(value)}"></div>`;
    });

    frames.forEach((frame, index) => {
      html += `<div class="hud-keyframe ${index === data.selectedIndex ? 'is-selected' : ''}"
                    data-index="${index}" style="left:${pct(frame.time)}"></div>`;
    });

    html += `<div class="hud-playhead" style="left:${pct(currentTime)}"></div>`;
    this.track.innerHTML = html;
  }

  showErrors(errors) {
    if (!this.errorsEl) return;
    if (!errors || errors.length === 0) {
      this.errorsEl.hidden = true;
      this.errorsEl.textContent = '';
      return;
    }
    this.errorsEl.hidden = false;
    this.errorsEl.innerHTML = errors.map((error) => `· ${error}`).join('<br />');
  }
}

module.exports = { Timeline, MARKERS };
