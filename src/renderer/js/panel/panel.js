'use strict';

/** 设置面板：只做「读设置 -> 改设置 -> 立刻推给 Codex」，不持有任何业务状态 */

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  skins: [],
  queue: {},
  timer: null,
  entry: null,
};

// ---------------------------------------------------------------- 工具

let toastTimer = null;
function toast(text, kind) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.kind = kind || 'info';
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

const pct = (v) => `${Math.round(v * 100)}%`;

/** 把改动攒 160ms 再发出去，避免拖滑杆时每一帧都重建一次 CSS */
function patch(partial) {
  state.queue = { ...state.queue, ...partial };
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(flush, 160);
}

async function flush() {
  const payload = state.queue;
  state.queue = {};
  state.timer = null;
  if (!Object.keys(payload).length) return;
  try {
    const result = await window.bridge.patchSettings(payload);
    if (result && result.settings) state.settings = result.settings;
    showThemeNote(result && result.applied ? result.applied.note : null);
    // Codex 没在运行时注入器是空的，这不是错误：设置已经存盘，下次启动会生效
    if (result && result.applied && result.applied.ok === false) {
      toast('设置已保存，下次启动 Codex 时生效');
    }
  } catch (error) {
    toast(`保存失败：${error.message}`, 'error');
  }
}

function showThemeNote(note) {
  const el = $('theme-note');
  if (!note) {
    el.hidden = true;
    return;
  }
  el.textContent = note;
  el.hidden = false;
}

// ---------------------------------------------------------------- 皮肤

function renderSkins() {
  const host = $('skins');
  host.textContent = '';
  for (const skin of state.skins) {
    const colors = skin.colors || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skin';
    button.dataset.id = skin.id;
    button.setAttribute('aria-pressed', String(state.settings.skinId === skin.id));

    const swatch = document.createElement('div');
    swatch.className = 'skin__swatch';
    for (const key of ['background', 'surface', 'accent', 'text']) {
      const cell = document.createElement('i');
      cell.style.background = colors[key] || '#000';
      swatch.appendChild(cell);
    }

    const name = document.createElement('div');
    name.className = 'skin__name';
    name.textContent = skin.name || skin.id;

    const desc = document.createElement('div');
    desc.className = 'skin__desc';
    desc.textContent = skin.description || '';

    button.append(swatch, name, desc);
    button.addEventListener('click', () => {
      state.settings.skinId = skin.id;
      for (const node of host.children) {
        node.setAttribute('aria-pressed', String(node.dataset.id === skin.id));
      }
      patch({ skinId: skin.id });
    });
    host.appendChild(button);
  }
}

// ---------------------------------------------------------------- 绑定

function bind() {
  $('minimize').addEventListener('click', () => window.bridge.minimize());
  $('close').addEventListener('click', () => window.bridge.close());

  // 背景图相关：0..1 -> 0..100
  for (const key of ['opacity', 'panelAlpha', 'scrim', 'vignette']) {
    const input = $(key);
    const label = $(`${key}-v`);
    input.addEventListener('input', () => {
      const value = Number(input.value) / 100;
      label.textContent = pct(value);
      patch({ background: { [key]: value } });
    });
  }
  const blur = $('blur');
  blur.addEventListener('input', () => {
    const value = Number(blur.value);
    $('blur-v').textContent = `${value}px`;
    patch({ background: { blur: value } });
  });

  const volume = $('volume');
  volume.addEventListener('input', () => {
    const value = Number(volume.value) / 100;
    $('volume-v').textContent = pct(value);
    patch({ splash: { volume: value } });
  });

  const slow = $('slowRate');
  slow.addEventListener('input', () => {
    const value = Number(slow.value) / 100;
    $('slowRate-v').textContent = `${value.toFixed(2)}×`;
    patch({ splash: { slowRate: value } });
  });

  $('splash-enabled').addEventListener('change', (event) => {
    patch({ splash: { enabled: event.target.checked } });
  });

  for (const button of $('end-mode').querySelectorAll('button')) {
    button.addEventListener('click', () => {
      const value = button.dataset.value;
      for (const node of $('end-mode').querySelectorAll('button')) {
        node.setAttribute('aria-pressed', String(node.dataset.value === value));
      }
      patch({ window: { endMode: value } });
    });
  }

  $('pick-bg').addEventListener('click', async () => {
    const result = await window.bridge.chooseBackground();
    if (!result || result.canceled) return;
    if (!result.ok) {
      toast(result.reason || '导入失败', 'error');
      return;
    }
    state.settings = result.settings;
    syncAll();
    showThemeNote(result.applied && result.applied.note);
    toast('背景已更新');
  });

  $('clear-bg').addEventListener('click', async () => {
    const result = await window.bridge.clearBackground();
    if (result && result.settings) state.settings = result.settings;
    syncAll();
    toast('已恢复内置背景');
  });

  $('entry-install').addEventListener('click', async () => {
    const result = await window.bridge.installEntries();
    state.entry = result.status || null;
    renderEntry(result.ok ? '快捷方式已创建' : result.reason || '创建失败', !result.ok);
  });

  $('entry-remove').addEventListener('click', async () => {
    const result = await window.bridge.removeEntries();
    state.entry = result.status || null;
    renderEntry('已移除快捷方式');
  });

  $('replay').addEventListener('click', async () => {
    toast('正在重播开屏…');
    const result = await window.bridge.relaunchCodex();
    if (result && result.ok) toast(`完成，用时 ${(result.elapsed / 1000).toFixed(1)}s`);
    else toast(result && result.reason ? result.reason : '重播失败', 'error');
  });

  $('restore').addEventListener('click', async () => {
    const result = await window.bridge.restoreWindow();
    toast(result && result.ok ? '已恢复 Codex 窗口尺寸' : (result && result.reason) || '恢复失败', result && result.ok ? 'info' : 'error');
  });

  $('open-log').addEventListener('click', () => window.bridge.openLog());
  $('open-data').addEventListener('click', () => window.bridge.openDataDir());

  $('reset').addEventListener('click', async () => {
    const result = await window.bridge.resetSettings();
    if (result && result.settings) state.settings = result.settings;
    syncAll();
    renderSkins();
    toast('已恢复默认设置');
  });

  $('toggle-diag').addEventListener('click', async () => {
    const pre = $('diag');
    if (!pre.hidden) {
      pre.hidden = true;
      $('toggle-diag').textContent = '查看诊断信息';
      return;
    }
    const info = await window.bridge.diagnostics();
    pre.textContent = JSON.stringify(info, null, 2);
    pre.hidden = false;
    $('toggle-diag').textContent = '收起诊断信息';
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.bridge.close();
  });
}

// ---------------------------------------------------------------- 同步

function syncAll() {
  const s = state.settings;
  if (!s) return;
  const bg = s.background;
  const splash = s.splash;

  $('opacity').value = String(Math.round(bg.opacity * 100));
  $('opacity-v').textContent = pct(bg.opacity);
  $('panelAlpha').value = String(Math.round(bg.panelAlpha * 100));
  $('panelAlpha-v').textContent = pct(bg.panelAlpha);
  $('blur').value = String(Math.round(bg.blur));
  $('blur-v').textContent = `${Math.round(bg.blur)}px`;
  $('scrim').value = String(Math.round(bg.scrim * 100));
  $('scrim-v').textContent = pct(bg.scrim);
  $('vignette').value = String(Math.round(bg.vignette * 100));
  $('vignette-v').textContent = pct(bg.vignette);

  $('volume').value = String(Math.round(splash.volume * 100));
  $('volume-v').textContent = pct(splash.volume);
  $('slowRate').value = String(Math.round(splash.slowRate * 100));
  $('slowRate-v').textContent = `${splash.slowRate.toFixed(2)}×`;
  $('splash-enabled').checked = splash.enabled !== false;

  for (const node of $('end-mode').querySelectorAll('button')) {
    node.setAttribute('aria-pressed', String(node.dataset.value === s.window.endMode));
  }

  const file = bg.mode === 'file' && bg.filePath ? bg.filePath : null;
  $('bg-file').textContent = file ? `当前：${file.split(/[\\/]/).pop()}` : '当前：内置（无图片）';
  $('clear-bg').disabled = !file;
  for (const id of ['opacity', 'blur', 'scrim', 'vignette']) {
    $(id).disabled = !file;
  }

  for (const node of $('skins').children) {
    node.setAttribute('aria-pressed', String(node.dataset.id === s.skinId));
  }
}

function renderEntry(message, isError) {
  const entry = state.entry;
  if (!entry) {
    $('entry-state').textContent = message || '';
    return;
  }
  const label = (name, owned) => `${name}：${owned ? '已接管' : '未创建'}`;
  $('entry-state').textContent = [label('桌面', entry.ownsDesktop), label('开始菜单', entry.ownsStartMenu)].join(' · ');
  if (message) toast(message, isError ? 'error' : 'info');
}

async function refreshEntry() {
  try {
    state.entry = await window.bridge.entryStatus();
    renderEntry('');
  } catch (error) {
    $('entry-state').textContent = `检查失败：${error.message}`;
  }
}

// ---------------------------------------------------------------- 启动

(async () => {
  try {
    const boot = await window.bridge.bootstrap();
    state.settings = boot.settings;
    state.skins = boot.skins || [];
    if (boot.version) $('version').textContent = `v${boot.version}`;
    renderSkins();
    bind();
    syncAll();
    await refreshEntry();
  } catch (error) {
    toast(`面板初始化失败：${error.message}`, 'error');
  }
})();
