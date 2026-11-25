'use strict';

const { qs, on, setVar } = require('../core/dom');
const { requiredScrim } = require('../../../shared/contrast');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

/**
 * Owns the three background layers and keeps text readable no matter which picture the
 * user drops in. The guard is what makes a 100 %-opacity white photo usable.
 */
class Background {
  constructor({ bridge, store, toast }) {
    this.bridge = bridge;
    this.store = store;
    this.toast = toast;
    this.img = null;
    this.note = null;
    this.lastKey = '';
  }

  mount(root) {
    const layer = document.createElement('div');
    layer.className = 'wb-bg';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <img class="wb-bg-img" alt="" draggable="false" />
      <div class="wb-bg-scrim"></div>
      <div class="wb-bg-vignette"></div>
      <div class="wb-bg-grain"></div>
    `;
    root.appendChild(layer);
    this.root = layer;
    this.img = qs('.wb-bg-img', layer);
    this.img.addEventListener('error', () => {
      this.img.style.visibility = 'hidden';
    });
    this.img.addEventListener('load', () => {
      this.img.style.visibility = 'visible';
    });
  }

  render(state) {
    if (!this.img) return;
    const bg = state.settings.background;
    const media = state.media || {};
    const descriptor = state.background || {};
    const url = descriptor.url || (bg.mode === 'builtin' ? media.builtinBackground : null) || null;

    const key = `${bg.mode}|${url || ''}|${bg.opacity}|${bg.blur}|${bg.scrim}|${bg.vignette}|${bg.fit}|${state.settings.skinId}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (bg.mode === 'none' || !url) {
      this.img.removeAttribute('src');
      this.img.style.opacity = '0';
      setVar('--bg-opacity', '0');
    } else {
      if (this.img.getAttribute('src') !== url) this.img.setAttribute('src', url);
      this.img.classList.toggle('fit-contain', bg.fit === 'contain');
      setVar('--bg-opacity', String(bg.opacity));
    }

    setVar('--bg-blur', `${bg.blur}px`);
    setVar('--vignette', String(bg.vignette));

    this.applyReadabilityGuard(state, descriptor, bg);
  }

  /**
   * Contrast guard: if the composited background makes --text drop below WCAG AA 4.5:1
   * we raise the scrim (never lower the user's value) and explain why.
   */
  applyReadabilityGuard(state, descriptor, bg) {
    const skin = (state.skins || []).find((s) => s.id === state.settings.skinId) || (state.skins || [])[0];
    const colors = (skin && skin.colors) || {};
    const lum = descriptor && descriptor.lum ? descriptor.lum : { p90: 0 };
    const effectiveOpacity = bg.mode === 'none' ? 0 : bg.opacity;

    const result = requiredScrim({
      bgHex: colors.background || '#070F12',
      textHex: colors.text || '#E4EEEB',
      imageLum: lum.p90 || 0,
      opacity: effectiveOpacity,
      forcedScrim: bg.scrim,
      minRatio: 4.5,
      maxScrim: 0.72,
    });

    const scrim = Math.max(bg.scrim, result.ok ? bg.scrim : result.scrim);
    setVar('--scrim', String(scrim));

    if (this.note) {
      const raised = scrim > bg.scrim + 0.005;
      this.note.hidden = !raised;
      if (raised) {
        this.note.textContent = `为保证文字可读，遮罩已自动加深至 ${Math.round(scrim * 100)}%（你设置的是 ${Math.round(
          bg.scrim * 100
        )}%）。`;
      }
    }
    return { scrim, ratio: result.ratio, raised: scrim > bg.scrim + 0.005 };
  }

  bindNote(noteEl) {
    this.note = noteEl;
  }

  /** Drag & drop / file picker / clipboard paste all funnel into here. */
  async ingestFile(file) {
    if (!file) return { ok: false, reason: 'no-file' };
    const name = String(file.name || '').toLowerCase();
    const ext = IMAGE_EXT.find((candidate) => name.endsWith(candidate));
    if (!ext) {
      this.toast('只支持 PNG / JPG / WEBP / BMP 图片', true);
      return { ok: false, reason: 'unsupported-format' };
    }

    let payload;
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      payload = await this.bridge.importBackgroundBytes(buffer, ext);
    } catch (error) {
      payload = { ok: false, reason: String(error && error.message) };
    }

    if (!payload || !payload.ok) {
      this.toast(this.reasonText(payload && payload.reason), true);
    }
    return payload;
  }

  reasonText(reason) {
    switch (reason) {
      case 'too-large':
        return '图片超过 20MB，请先压缩后再试';
      case 'unsupported-format':
        return '只支持 PNG / JPG / WEBP / BMP 图片';
      case 'missing':
        return '找不到这个文件了，请重新选择';
      default:
        return '导入失败，请重新选择图片';
    }
  }
}

module.exports = { Background };
