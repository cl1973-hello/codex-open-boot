'use strict';

const { qs, on } = require('../core/dom');
const { mapFrame, clampRect } = require('../../../shared/geometry');

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 0.02;

function clampFrame(frame) {
  const out = { ...frame };
  out.width = Math.max(MIN_SIZE, Math.min(1, out.width));
  out.height = Math.max(MIN_SIZE, Math.min(1, out.height));
  out.x = Math.max(0, Math.min(1 - out.width, out.x));
  out.y = Math.max(0, Math.min(1 - out.height, out.y));
  return out;
}

/** Editable rectangle over the video: 8 handles, drag to move/resize in normalised space. */
class Overlay {
  constructor({ root, onChange }) {
    this.root = root;
    this.onChange = onChange;
    this.frame = null;
    this.layout = null;
    this.cw = 0;
    this.ch = 0;
  }

  mount() {
    this.root.innerHTML = `
      <div class="hud-frame" id="hud-frame" hidden></div>
      <div class="hud-rect" id="hud-rect"></div>
    `;
    this.rectEl = qs('#hud-rect', this.root);
    this.frameEl = qs('#hud-frame', this.root);
    HANDLES.forEach((handle) => {
      const dot = document.createElement('div');
      dot.className = 'hud-handle';
      dot.dataset.handle = handle;
      this.rectEl.appendChild(dot);
    });

    this.rectEl.addEventListener('pointerdown', (event) => {
      const handle = event.target.dataset.handle;
      this.startDrag(event, handle || 'move');
    });
  }

  update(frame, layout, cw, ch, nearestFrame) {
    this.frame = frame;
    this.layout = layout;
    this.cw = cw;
    this.ch = ch;
    if (!frame || !layout) {
      this.rectEl.hidden = true;
      return;
    }
    this.rectEl.hidden = false;

    const px = clampRect(mapFrame(frame, layout), cw, ch);
    const style = this.rectEl.style;
    style.left = `${px.x}px`;
    style.top = `${px.y}px`;
    style.width = `${px.w}px`;
    style.height = `${px.h}px`;

    HANDLES.forEach((handle) => {
      const dot = qs(`[data-handle="${handle}"]`, this.rectEl);
      if (!dot) return;
      const left = handle.includes('w') ? 0 : handle.includes('e') ? px.w : px.w / 2;
      const top = handle.includes('n') ? 0 : handle.includes('s') ? px.h : px.h / 2;
      dot.style.left = `${left}px`;
      dot.style.top = `${top}px`;
    });

    if (this.frameEl) {
      if (!nearestFrame) {
        this.frameEl.hidden = true;
      } else {
        const fx = mapFrame(nearestFrame, layout);
        this.frameEl.hidden = false;
        this.frameEl.style.left = `${fx.x}px`;
        this.frameEl.style.top = `${fx.y}px`;
        this.frameEl.style.width = `${fx.w}px`;
        this.frameEl.style.height = `${fx.h}px`;
      }
    }
  }

  startDrag(event, handle) {
    if (!this.frame || !this.layout) return;
    event.preventDefault();
    event.stopPropagation();
    this.rectEl.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...this.frame };
    const layoutW = this.layout.w || 1;
    const layoutH = this.layout.h || 1;

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / layoutW;
      const dy = (moveEvent.clientY - startY) / layoutH;
      const next = { ...start };
      const uniform = moveEvent.shiftKey;
      const fromCenter = moveEvent.altKey;

      if (handle === 'move') {
        next.x = start.x + dx;
        next.y = start.y + dy;
        if (fromCenter) {
          next.x = start.x;
          next.y = start.y;
        }
      } else {
        const west = handle.includes('w');
        const east = handle.includes('e');
        const north = handle.includes('n');
        const south = handle.includes('s');

        if (east) next.width = start.width + dx;
        if (west) {
          next.x = start.x + dx;
          next.width = start.width - dx;
        }
        if (south) next.height = start.height + dy;
        if (north) {
          next.y = start.y + dy;
          next.height = start.height - dy;
        }
        if (uniform && (west || east) && (north || south)) {
          const ratio = start.height / start.width;
          next.height = next.width * ratio;
          if (north) next.y = start.y + (start.height - next.height);
        }
      }

      this.onChange(clampFrame(next));
    };

    const up = () => {
      this.rectEl.removeEventListener('pointermove', move);
      this.rectEl.removeEventListener('pointerup', up);
      this.rectEl.removeEventListener('pointercancel', up);
    };

    this.rectEl.addEventListener('pointermove', move);
    this.rectEl.addEventListener('pointerup', up);
    this.rectEl.addEventListener('pointercancel', up);
  }
}

module.exports = { Overlay, clampFrame, HANDLES };
