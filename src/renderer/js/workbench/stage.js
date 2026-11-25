'use strict';

const { ICONS, escapeHtml, basename, greeting } = require('../core/dom');

function backgroundLabel(settings) {
  const mode = settings.background.mode;
  if (mode === 'none') return '无';
  if (mode === 'file') return '自选图片';
  return '内置';
}

function projectRow(item) {
  return `
    <div class="wb-row">
      <div class="wb-row-icon">${ICONS.folder}</div>
      <div class="wb-row-main">
        <b>${escapeHtml(basename(item))}</b>
        <span title="${escapeHtml(item)}">${escapeHtml(item)}</span>
      </div>
      <div class="wb-row-actions">
        <button class="wb-btn wb-btn--sm" data-act="open-project" data-path="${escapeHtml(item)}">打开</button>
        <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="remove-project" data-path="${escapeHtml(item)}"
                title="从列表移除">${ICONS.close}</button>
      </div>
    </div>`;
}

function launchHint(state) {
  const launch = state.launch || {};
  if (launch.status === 'pending') return `<div class="wb-card-hint" style="color: var(--muted)">已发出启动请求，正在等待客户端窗口…</div>`;
  if (launch.status === 'error') {
    return `<div class="wb-card-hint">${escapeHtml(launch.message || '启动失败')}<br />
      <button class="wb-btn wb-btn--sm wb-btn--ghost" data-act="open-data" style="margin-top:8px">查看数据目录</button></div>`;
  }
  return '';
}

function homeView(state) {
  const settings = state.settings;
  const projects = settings.app.recentProjects || [];
  const skin = (state.skins || []).find((s) => s.id === settings.skinId);
  const date = new Date();
  const error = (state.launch || {}).status === 'error';

  return `
    <section class="wb-view">
      <div class="wb-hero">
        <div class="wb-clock" id="wb-clock">--:--</div>
        <div class="wb-greeting">${escapeHtml(greeting(date.getHours()))}</div>
        <div class="wb-date">${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日</div>
      </div>

      <div class="wb-cards">
        <article class="wb-card wb-card--primary ${error ? 'is-error' : ''}">
          <div class="wb-card-glow"></div>
          <div class="wb-card-eyebrow">Primary</div>
          <h2>启动 Codex</h2>
          <p>唤起已安装的 Codex 桌面客户端。本程序不修改、不注入官方程序包，只负责把这段开屏动画送到它面前。</p>
          <div class="wb-card-actions">
            <button class="wb-btn wb-btn--primary" data-act="launch">${ICONS.play}启动 Codex</button>
            <button class="wb-btn wb-btn--ghost" data-act="add-project">${ICONS.folder}打开项目</button>
          </div>
          ${launchHint(state)}
        </article>

        <article class="wb-card">
          <div class="wb-card-eyebrow">Recent</div>
          <h2>最近项目</h2>
          <p>${
            projects.length
              ? `已记录 ${projects.length} 个项目目录，点「打开」直接用资源管理器进入。`
              : '还没有记录项目。添加一个目录后，它会一直留在这里。'
          }</p>
          <div class="wb-list">${projects.slice(0, 3).map(projectRow).join('')}</div>
          <div class="wb-card-actions">
            <button class="wb-btn wb-btn--sm" data-act="add-project">+ 添加项目</button>
          </div>
        </article>
      </div>

      <div class="wb-meta-row">
        <span>主题 <b id="meta-skin">${escapeHtml((skin && skin.name) || settings.skinId)}</b></span>
        <span>背景 <b id="meta-bg">${backgroundLabel(settings)}</b> · 透明度 <b id="meta-opacity">${Math.round(
    settings.background.opacity * 100
  )}%</b></span>
        <span>版本 <b>v${escapeHtml(state.version || '1.0.0')}</b></span>
      </div>
    </section>`;
}

function projectsView(state) {
  const projects = state.settings.app.recentProjects || [];
  return `
    <section class="wb-view">
      <div class="wb-hero">
        <div class="wb-date">Projects</div>
        <div class="wb-greeting" style="font-size:26px;font-weight:400">项目</div>
        <p class="wb-prose" style="margin:0">把常用的代码目录记在这里，工作台就是一个更顺手的入口。</p>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <h3 class="wb-section-title">已记录 <span>${projects.length} 个</span></h3>
        <button class="wb-btn wb-btn--sm" data-act="add-project">+ 添加项目</button>
      </div>
      ${
        projects.length
          ? `<div class="wb-list">${projects.map(projectRow).join('')}</div>`
          : `<div class="wb-empty">还没有项目。点击「添加项目」选择一个文件夹，它会显示在这里。</div>`
      }
    </section>`;
}

function toolsView(state) {
  const tiles = [
    { act: 'replay', icon: 'refresh', title: '重播开屏动画', desc: '重新播放一次过渡，确认衔接是否自然。' },
    { act: 'calibrate', icon: 'crosshair', title: '校准动画', desc: '拖动矩形为一块新视频重新标定关键帧。' },
    { act: 'open-data', icon: 'folder', title: '打开数据目录', desc: '设置、背景图、校准后的主题都保存在这里。' },
    { act: 'open-log', icon: 'terminal', title: '打开日志目录', desc: '启动失败或卡顿时，日志里有现场记录。' },
    { act: 'open-github', icon: 'star', title: '项目主页', desc: '反馈问题、查看更新与使用说明。' },
    { act: 'toggle-panel', icon: 'sliders', title: '显示 / 隐藏设置面板', desc: '把右侧面板收起来，享受完整背景。' },
  ];

  return `
    <section class="wb-view">
      <div class="wb-hero">
        <div class="wb-date">Tools</div>
        <div class="wb-greeting" style="font-size:26px;font-weight:400">工具</div>
      </div>
      <div class="wb-tiles">
        ${tiles
          .map(
            (tile) => `
          <button class="wb-tile" data-act="${tile.act}">
            ${ICONS[tile.icon]}
            <b>${escapeHtml(tile.title)}</b>
            <span>${escapeHtml(tile.desc)}</span>
          </button>`
          )
          .join('')}
      </div>
      <div>
        <h3 class="wb-section-title">当前客户端标识</h3>
        <p class="wb-prose" style="margin:8px 0 0">
          <code>${escapeHtml(state.settings.app.codexAppId)}</code><br />
          若「启动 Codex」没有反应，通常是这个标识与已安装版本不符。在 PowerShell 里执行
          <code>Get-StartApps | findstr /i codex</code> 查到真实 AppID 后，粘贴到右侧设置面板。
        </p>
      </div>
    </section>`;
}

function aboutView(state) {
  return `
    <section class="wb-view">
      <div class="wb-hero">
        <div class="wb-date">About</div>
        <div class="wb-greeting" style="font-size:26px;font-weight:400">关于 Codex Open Boot</div>
      </div>
      <p class="wb-prose">
        一个独立的开屏动画 + 主题化工作台启动器。播放完原生视频后会落进这个工作台，
        从这里的任意入口再唤起真实的 Codex 客户端。<br /><br />
        它不是 OpenAI 官方工具，不包含 Codex 本体，也不修改官方程序包；所有设置都存在你自己的
        <code>%APPDATA%\\CodexOpenBoot</code> 目录里。
      </p>
      <div class="wb-list">
        <div class="wb-row"><div class="wb-row-main"><b>版本</b><span>v${escapeHtml(state.version || '1.0.0')}</span></div></div>
        <div class="wb-row"><div class="wb-row-main"><b>数据目录</b><span>${escapeHtml(state.dataDir || '')}</span></div>
          <div class="wb-row-actions"><button class="wb-btn wb-btn--sm" data-act="open-data">打开</button></div></div>
        <div class="wb-row"><div class="wb-row-main"><b>许可证</b><span>MIT</span></div></div>
      </div>
      <div class="wb-card-actions">
        <button class="wb-btn" data-act="open-github">${ICONS.star}项目主页</button>
        <button class="wb-btn wb-btn--ghost" data-act="replay">${ICONS.refresh}重播开屏</button>
      </div>
    </section>`;
}

function stageHtml(state) {
  switch (state.view) {
    case 'projects':
      return projectsView(state);
    case 'tools':
      return toolsView(state);
    case 'about':
      return aboutView(state);
    default:
      return homeView(state);
  }
}

module.exports = { stageHtml, backgroundLabel };
