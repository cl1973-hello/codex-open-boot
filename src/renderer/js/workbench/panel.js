'use strict';

const { qs, qsa, on, escapeHtml, ICONS } = require('../core/dom');
const { swatchColors } = require('./skin');

function skinListHtml(state) {
  const active = state.settings.skinId;
  return (state.skins || [])
    .map((skin) => {
      const dots = swatchColors(skin)
        .map((color) => `<i style="background:${escapeHtml(color)}"></i>`)
        .join('');
      return `
        <button class="wb-skin ${skin.id === active ? 'is-active' : ''}" data-act="skin" data-skin="${escapeHtml(skin.id)}">
          <span class="wb-swatches">${dots}</span>
          <span class="wb-skin-text">
            <b>${escapeHtml(skin.name)}</b>
            <span>${escapeHtml(skin.description || '')}</span>
          </span>
          <span class="wb-skin-check">${ICONS.check}</span>
        </button>`;
    })
    .join('');
}

function panelHtml(state) {
  const bg = state.settings.background;
  const splash = state.settings.splash;
  const tailValue = splash.tailMs > 0 ? splash.tailMs : 0;
  return `
    <div class="wb-panel-head">
      <h2>设置</h2>
      <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="toggle-panel" title="隐藏面板">${ICONS.close}</button>
    </div>
    <div class="wb-panel-scroll">
      <section class="wb-sec">
        <h3>主题皮肤</h3>
        <div class="wb-skins" id="wb-skins">${skinListHtml(state)}</div>
      </section>

      <section class="wb-sec">
        <h3>背景</h3>
        <div class="wb-seg" id="bg-seg">
          <button data-act="bg-mode" data-mode="builtin" class="${bg.mode === 'builtin' ? 'is-active' : ''}">内置</button>
          <button data-act="bg-mode" data-mode="file" class="${bg.mode === 'file' ? 'is-active' : ''}">自选</button>
          <button data-act="bg-mode" data-mode="none" class="${bg.mode === 'none' ? 'is-active' : ''}">无</button>
        </div>

        <div class="wb-drop" id="bg-drop">
          <strong>把图片拖到这里</strong><br />支持 PNG / JPG / WEBP，≤ 20MB
          <div><button class="wb-btn wb-btn--sm" data-act="choose-bg">选择文件…</button></div>
        </div>

        <div class="wb-field">
          <div class="wb-field-row"><span>背景透明度</span><b id="bg-opacity-val">${Math.round(bg.opacity * 100)}%</b></div>
          <input type="range" id="bg-opacity" min="0" max="100" step="1" value="${Math.round(bg.opacity * 100)}" />
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>模糊</span><b id="bg-blur-val">${Math.round(bg.blur)} px</b></div>
          <input type="range" id="bg-blur" min="0" max="40" step="1" value="${Math.round(bg.blur)}" />
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>压暗遮罩</span><b id="bg-scrim-val">${Math.round(bg.scrim * 100)}%</b></div>
          <input type="range" id="bg-scrim" min="0" max="72" step="1" value="${Math.round(bg.scrim * 100)}" />
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>暗角</span><b id="bg-vignette-val">${Math.round(bg.vignette * 100)}%</b></div>
          <input type="range" id="bg-vignette" min="0" max="100" step="1" value="${Math.round(bg.vignette * 100)}" />
        </div>
        <p class="wb-note" id="bg-note" hidden></p>
      </section>

      <section class="wb-sec">
        <h3>开屏动画</h3>
        <label class="wb-switch">
          <span>启动时播放动画</span>
          <input type="checkbox" id="splash-enabled" ${splash.enabled ? 'checked' : ''} />
        </label>
        <div class="wb-field">
          <div class="wb-field-row"><span>音量</span><b id="splash-volume-val">${Math.round(splash.volume * 100)}%</b></div>
          <input type="range" id="splash-volume" min="0" max="100" step="1" value="${Math.round(splash.volume * 100)}" />
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>收尾放大时长</span><b id="tail-ms-val">${tailValue > 0 ? `${tailValue} ms` : '自动'}</b></div>
          <input type="range" id="tail-ms" min="0" max="1200" step="20" value="${tailValue}" />
        </div>
        <div class="wb-card-actions">
          <button class="wb-btn wb-btn--sm" data-act="replay">${ICONS.refresh}重播</button>
          <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="calibrate">${ICONS.crosshair}校准动画</button>
        </div>
      </section>

      <section class="wb-sec">
        <h3>客户端</h3>
        <div class="wb-field">
          <div class="wb-field-row"><span>Codex AppID</span></div>
          <input class="wb-input" id="appid" spellcheck="false" value="${escapeHtml(state.settings.app.codexAppId)}" />
          <p class="wb-sec-hint">格式为 <code>包名!App</code>。查询命令：<code>Get-StartApps</code></p>
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>数据目录</span><b id="data-dir" title="${escapeHtml(state.dataDir || '')}">${escapeHtml(
    state.dataDir || ''
  )}</b></div>
        </div>
        <div class="wb-field">
          <div class="wb-field-row"><span>版本</span><b>v${escapeHtml(state.version || '1.0.0')}</b></div>
        </div>
      </section>
    </div>
    <div class="wb-panel-foot">
      <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="open-data">数据目录</button>
      <button class="wb-btn wb-btn--sm wb-btn--danger" data-act="reset-settings">重置全部设置</button>
    </div>
  `;
}

/** Owns the settings panel: renders once, then syncs values imperatively so dragging a
 *  slider never fights a re-render. */
class Panel {
  constructor({ root, store, api }) {
    this.root = root;
    this.store = store;
    this.api = api;
    this.els = {};
  }

  mount() {
    this.root.innerHTML = panelHtml(this.store.get());
    const $ = (id) => qs(`#${id}`, this.root);
    this.els = {
      skins: $('wb-skins'),
      seg: $('bg-seg'),
      drop: $('bg-drop'),
      opacity: $('bg-opacity'),
      opacityVal: $('bg-opacity-val'),
      blur: $('bg-blur'),
      blurVal: $('bg-blur-val'),
      scrim: $('bg-scrim'),
      scrimVal: $('bg-scrim-val'),
      vignette: $('bg-vignette'),
      vignetteVal: $('bg-vignette-val'),
      note: $('bg-note'),
      splashEnabled: $('splash-enabled'),
      volume: $('splash-volume'),
      volumeVal: $('splash-volume-val'),
      tail: $('tail-ms'),
      tailVal: $('tail-ms-val'),
      appid: $('appid'),
    };

    this.bindRanges();
    this.bindDrop();
    this.bindAppId();
  }

  bindRanges() {
    const push = (patch) => this.api.patchSettings(patch);

    on(this.els.opacity, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.opacityVal.textContent = `${value}%`;
      push({ background: { opacity: value / 100 } });
    });
    on(this.els.blur, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.blurVal.textContent = `${value} px`;
      push({ background: { blur: value } });
    });
    on(this.els.scrim, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.scrimVal.textContent = `${value}%`;
      push({ background: { scrim: value / 100 } });
    });
    on(this.els.vignette, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.vignetteVal.textContent = `${value}%`;
      push({ background: { vignette: value / 100 } });
    });
    on(this.els.volume, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.volumeVal.textContent = `${value}%`;
      push({ splash: { volume: value / 100 } });
    });
    on(this.els.tail, 'input', (event) => {
      const value = Number(event.target.value);
      this.els.tailVal.textContent = value > 0 ? `${value} ms` : '自动';
      push({ splash: { tailMs: value } });
    });
    on(this.els.splashEnabled, 'change', (event) => {
      push({ splash: { enabled: event.target.checked } });
    });
  }

  bindDrop() {
    const drop = this.els.drop;
    let depth = 0;
    ['dragenter', 'dragover'].forEach((type) =>
      on(drop, type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        depth += 1;
        drop.classList.add('is-over');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      on(drop, type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        depth = Math.max(0, depth - 1);
        if (type === 'drop' || depth === 0) drop.classList.remove('is-over');
      })
    );
    on(drop, 'drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) this.api.ingestBackground(file);
    });
    on(drop, 'click', (event) => {
      if (event.target.closest('button')) return;
      this.api.chooseBackground();
    });
  }

  bindAppId() {
    const commit = () => {
      const value = this.els.appid.value.trim();
      this.api.setAppId(value);
    };
    on(this.els.appid, 'change', commit);
    on(this.els.appid, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.els.appid.blur();
      }
    });
  }

  syncBackgroundNote(raised) {
    if (!this.els.note) return;
    this.els.note.hidden = !raised;
  }

  sync() {
    const state = this.store.get();
    const settings = state.settings;
    const bg = settings.background;

    if (this.els.skins) this.els.skins.innerHTML = skinListHtml(state);

    qsa('[data-mode]', this.els.seg).forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === bg.mode);
    });

    const setRange = (input, value) => {
      if (input && document.activeElement !== input) input.value = String(value);
    };
    setRange(this.els.opacity, Math.round(bg.opacity * 100));
    setRange(this.els.blur, Math.round(bg.blur));
    setRange(this.els.scrim, Math.round(bg.scrim * 100));
    setRange(this.els.vignette, Math.round(bg.vignette * 100));
    setRange(this.els.volume, Math.round(settings.splash.volume * 100));
    setRange(this.els.tail, settings.splash.tailMs);

    if (this.els.opacityVal) this.els.opacityVal.textContent = `${Math.round(bg.opacity * 100)}%`;
    if (this.els.blurVal) this.els.blurVal.textContent = `${Math.round(bg.blur)} px`;
    if (this.els.scrimVal) this.els.scrimVal.textContent = `${Math.round(bg.scrim * 100)}%`;
    if (this.els.vignetteVal) this.els.vignetteVal.textContent = `${Math.round(bg.vignette * 100)}%`;
    if (this.els.volumeVal) this.els.volumeVal.textContent = `${Math.round(settings.splash.volume * 100)}%`;
    if (this.els.tailVal) this.els.tailVal.textContent = settings.splash.tailMs > 0 ? `${settings.splash.tailMs} ms` : '自动';
    if (this.els.splashEnabled) this.els.splashEnabled.checked = settings.splash.enabled;
    if (this.els.appid && document.activeElement !== this.els.appid) this.els.appid.value = settings.app.codexAppId;
  }
}

module.exports = { Panel, panelHtml };
