'use strict';

const { qs, on, escapeHtml, ICONS, formatClock } = require('../core/dom');
const { navHtml } = require('./nav');
const { stageHtml } = require('./stage');
const { Panel } = require('./panel');
const { Background } = require('./background');
const { applySkin, resolveSkin } = require('./skin');
const { isValidAppId } = require('../../../shared/validate');

const GITHUB_URL = 'https://github.com/cl1973-hello/codex-open-boot';

class Workbench {
  constructor({ store, bridge, root, onReplay, onCalibrate }) {
    this.store = store;
    this.bridge = bridge;
    this.root = root;
    this.onReplay = onReplay || (() => {});
    this.onCalibrate = onCalibrate || (() => {});
    this.clockTimer = null;
    this.stageKey = '';
    this.ready = false;
    this.toastTimer = null;
    this.width = 0;
    this.height = 0;
  }

  mount() {
    const state = this.store.get();
    this.root.innerHTML = `
      <div class="wb">
        <header class="wb-titlebar">
          <div class="wb-title">
            <span class="wb-mark"></span>
            <span class="wb-title-text">Codex Open Boot</span>
            <span class="wb-title-sep"></span>
            <span class="wb-title-sub">工作台</span>
          </div>
          <span class="wb-titlebar-meta" id="wb-title-meta"></span>
          <div class="wb-winbtns">
            <button class="wb-winbtn" data-act="minimize" title="最小化">${ICONS.minimize}</button>
            <button class="wb-winbtn" data-act="maximize" title="最大化">${ICONS.maximize}</button>
            <button class="wb-winbtn wb-winbtn--close" data-act="close" title="关闭">${ICONS.close}</button>
          </div>
        </header>
        <div class="wb-body" id="wb-body">
          <aside class="wb-nav" id="wb-nav"></aside>
          <main class="wb-stage" id="wb-stage"></main>
          <aside class="wb-panel" id="wb-panel"></aside>
        </div>
        <div class="wb-toast" id="wb-toast"></div>
      </div>
    `;

    this.body = qs('#wb-body', this.root);
    this.navRoot = qs('#wb-nav', this.root);
    this.stageRoot = qs('#wb-stage', this.root);
    this.panelRoot = qs('#wb-panel', this.root);
    this.toastEl = qs('#wb-toast', this.root);
    this.metaEl = qs('#wb-title-meta', this.root);

    this.navRoot.innerHTML = navHtml(state);
    this.panel = new Panel({ root: this.panelRoot, store: this.store, api: this.api() });
    this.panel.mount();

    this.background = new Background({ bridge: this.bridge, store: this.store, toast: (m, e) => this.toast(m, e) });
    this.background.mount(this.root);
    this.background.bindNote(qs('#bg-note', this.root));

    applySkin(resolveSkin(state));

    this.bindDelegation();
    this.body.classList.toggle('is-nav-collapsed', state.settings.ui.navCollapsed);
    this.body.classList.toggle('is-panel-hidden', !state.settings.ui.settingsOpen);

    this.renderStage(true);
    this.background.render(state);
    this.startClock();
    this.ready = true;

    if (!state.settings.ui.onboardedAt && !state.calibrate) this.showTour();
  }

  api() {
    return {
      patchSettings: (patch) => this.patchSettings(patch),
      chooseBackground: () => this.chooseBackground(),
      ingestBackground: (file) => this.ingestBackground(file),
      setAppId: (value) => this.setAppId(value),
    };
  }

  bindDelegation() {
    on(this.root, 'click', (event) => {
      const target = event.target.closest('[data-act]');
      if (!target || !this.root.contains(target)) return;
      const act = target.dataset.act;
      this.handle(act, target, event);
    });
  }

  handle(act, target, event) {
    switch (act) {
      case 'view':
        this.store.set({ view: target.dataset.view });
        this.renderStage(true);
        this.syncNav();
        break;
      case 'launch':
        this.launch();
        break;
      case 'add-project':
        this.addProject();
        break;
      case 'open-project':
        this.bridge.openProject(target.dataset.path).then((res) => {
          if (res && res.ok === false) this.toast('这个目录已经不存在了', true);
        });
        break;
      case 'remove-project':
        this.removeProject(target.dataset.path);
        break;
      case 'skin':
        this.patchSettings({ skinId: target.dataset.skin });
        break;
      case 'bg-mode':
        this.patchSettings({ background: { mode: target.dataset.mode } });
        break;
      case 'choose-bg':
        event.stopPropagation();
        this.chooseBackground();
        break;
      case 'toggle-nav':
        this.body.classList.toggle('is-nav-collapsed');
        this.patchSettings({ ui: { navCollapsed: this.body.classList.contains('is-nav-collapsed') } });
        break;
      case 'toggle-panel':
        this.body.classList.toggle('is-panel-hidden');
        this.patchSettings({ ui: { settingsOpen: !this.body.classList.contains('is-panel-hidden') } });
        break;
      case 'replay':
        this.onReplay();
        break;
      case 'calibrate':
        this.onCalibrate();
        break;
      case 'open-data':
        this.bridge.openDataDir();
        break;
      case 'open-log':
        this.bridge.openLog();
        break;
      case 'open-github':
        this.bridge.openExternal(GITHUB_URL);
        break;
      case 'reset-settings':
        this.resetSettings();
        break;
      case 'tour-done':
      case 'tour-skip':
        this.closeTour();
        break;
      case 'minimize':
        this.bridge.minimize();
        break;
      case 'maximize':
        this.bridge.toggleMaximize();
        break;
      case 'close':
        this.bridge.close();
        break;
      default:
        break;
    }
  }

  async patchSettings(patch) {
    const result = await this.bridge.patchSettings(patch);
    if (!result || !result.settings) return;
    const previousSkin = this.store.get().settings.skinId;
    this.store.set({ settings: result.settings, background: result.background || this.store.get().background });
    const state = this.store.get();

    if (previousSkin !== state.settings.skinId) applySkin(resolveSkin(state));
    this.background.render(state);
    this.panel.sync();
    this.updateMeta();
    this.renderStage(false);
  }

  async chooseBackground() {
    const result = await this.bridge.chooseBackground();
    this.afterBackgroundResult(result);
  }

  async ingestBackground(file) {
    const result = await this.background.ingestFile(file);
    this.afterBackgroundResult(result);
  }

  afterBackgroundResult(result) {
    if (!result || result.canceled) return;
    if (!result.ok) {
      if (result.reason && result.reason !== 'mock') this.toast(this.background.reasonText(result.reason), true);
      return;
    }
    this.store.set({ settings: result.settings, background: result.background });
    this.background.render(this.store.get());
    this.panel.sync();
    this.renderStage(false);
    this.toast('背景已更新');
  }

  async setAppId(value) {
    if (!isValidAppId(value)) {
      this.toast('AppID 格式应为「包名!App」，例如 OpenAI.Codex_2p2nqsd0c76g0!App', true);
      if (this.panel.els.appid) {
        this.panel.els.appid.classList.add('is-invalid');
        setTimeout(() => this.panel.els.appid && this.panel.els.appid.classList.remove('is-invalid'), 1600);
      }
      return;
    }
    await this.patchSettings({ app: { codexAppId: value } });
    this.toast('已保存 AppID');
  }

  async launch() {
    const state = this.store.get();
    this.store.set({ launch: { status: 'pending' } });
    this.renderStage(true);
    const result = await this.bridge.launchCodex(state.settings.app.codexAppId);
    if (result && result.ok) {
      this.store.set({ launch: { status: 'ok', at: Date.now() } });
      this.renderStage(true);
      setTimeout(() => {
        if ((this.store.get().launch || {}).status === 'ok') {
          this.store.set({ launch: { status: 'idle' } });
          this.renderStage(true);
        }
      }, 4000);
      return;
    }
    const message =
      result && result.reason === 'invalid-app-id'
        ? 'AppID 格式不正确，请在右侧设置里改成正确的「包名!App」。'
        : '没能唤起 Codex。请确认已安装桌面客户端，或在右侧设置里更正 AppID。';
    this.store.set({ launch: { status: 'error', message } });
    this.renderStage(true);
    this.toast('启动失败', true);
  }

  async addProject() {
    const result = await this.bridge.pickProject();
    if (!result || !result.ok) return;
    if (result.settings) this.store.set({ settings: result.settings });
    this.panel.sync();
    this.renderStage(true);
    this.toast('项目已添加');
  }

  async removeProject(target) {
    const result = await this.bridge.removeProject(target);
    if (result && result.settings) this.store.set({ settings: result.settings });
    this.panel.sync();
    this.renderStage(true);
  }

  async resetSettings() {
    const result = await this.bridge.resetSettings();
    if (!result || !result.settings) return;
    this.store.set({ settings: result.settings, background: result.background, launch: { status: 'idle' } });
    const state = this.store.get();
    applySkin(resolveSkin(state));
    this.body.classList.toggle('is-nav-collapsed', state.settings.ui.navCollapsed);
    this.body.classList.toggle('is-panel-hidden', !state.settings.ui.settingsOpen);
    this.background.render(state);
    this.panel.sync();
    this.renderStage(true);
    this.toast('已恢复默认设置');
  }

  syncNav() {
    this.navRoot.innerHTML = navHtml(this.store.get());
  }

  renderStage(force) {
    const state = this.store.get();
    const key = [
      state.view,
      (state.settings.app.recentProjects || []).join('|'),
      (state.launch || {}).status || 'idle',
      state.settings.background.mode,
      state.settings.skinId,
      state.settings.background.opacity,
    ].join('::');
    if (!force && key === this.stageKey) {
      this.updateHomeMeta();
      return;
    }
    this.stageKey = key;
    const scrollTop = this.stageRoot.scrollTop;
    this.stageRoot.innerHTML = stageHtml(state);
    this.stageRoot.scrollTop = scrollTop;
    this.updateClock();
    this.updateMeta();
  }

  /** Cheap in-place refresh of the home meta row (avoids rebuilding the view while a
   *  slider is being dragged). */
  updateHomeMeta() {
    const state = this.store.get();
    const skin = resolveSkin(state);
    const set = (id, text) => {
      const node = qs(`#${id}`, this.stageRoot);
      if (node) node.textContent = text;
    };
    set('meta-skin', (skin && skin.name) || state.settings.skinId);
    set('meta-bg', state.settings.background.mode === 'none' ? '无' : state.settings.background.mode === 'file' ? '自选图片' : '内置');
    set('meta-opacity', `${Math.round(state.settings.background.opacity * 100)}%`);
  }

  updateMeta() {
    const state = this.store.get();
    const skin = resolveSkin(state);
    if (this.metaEl) this.metaEl.textContent = `${(skin && skin.name) || ''} · ${state.theme.displayName || ''}`;
  }

  startClock() {
    this.updateClock();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = setInterval(() => this.updateClock(), 15000);
  }

  updateClock() {
    const node = qs('#wb-clock', this.stageRoot);
    if (node) node.textContent = formatClock(new Date());
  }

  toast(message, isError) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle('is-error', !!isError);
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), isError ? 4200 : 2600);
  }

  showTour() {
    if (qs('#wb-tour', this.root)) return;
    const tour = document.createElement('div');
    tour.className = 'wb-tour';
    tour.id = 'wb-tour';
    tour.innerHTML = `
      <div class="wb-tour-card">
        <span class="wb-chip">首次使用</span>
        <h2>这里可以很自由</h2>
        <p>工作台就是你的起点。三件事值得先试一下：</p>
        <ul class="wb-tour-steps">
          <li>右侧面板里换一套皮肤，星河 / 石墨 / 晨光三套配色，随时切换。</li>
          <li>把一张自己的图片拖进「背景」区域，用透明度滑杆调到舒服为止。</li>
          <li>点「启动 Codex」，把这段开屏动画交还给真正的客户端。</li>
        </ul>
        <div class="wb-tour-actions">
          <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="tour-skip">跳过</button>
          <button class="wb-btn wb-btn--sm wb-btn--primary" data-act="tour-done">开始使用</button>
        </div>
      </div>`;
    this.root.appendChild(tour);
  }

  closeTour() {
    const tour = qs('#wb-tour', this.root);
    if (tour) tour.remove();
    this.patchSettings({ ui: { onboardedAt: new Date().toISOString() } });
  }

  resize(cw, ch) {
    if (!cw || !ch) return;
    this.root.style.width = `${cw}px`;
    this.root.style.height = `${ch}px`;
    this.width = cw;
    this.height = ch;
  }
}

module.exports = { Workbench, GITHUB_URL };
