'use strict';

const { ICONS, escapeHtml } = require('../core/dom');

const ITEMS = [
  { view: 'home', label: '首页', icon: 'home' },
  { view: 'projects', label: '项目', icon: 'folder' },
  { view: 'tools', label: '工具', icon: 'tools' },
  { view: 'about', label: '关于', icon: 'info' },
];

function navHtml(state) {
  const active = state.view || 'home';
  return `
    <div class="wb-nav-brand">
      <div class="wb-brand-orb"></div>
      <div class="wb-brand-text"><b>Codex</b><span>Open Boot</span></div>
    </div>
    <nav class="wb-nav-list" aria-label="主导航">
      ${ITEMS.map(
        (item) => `
        <button class="wb-nav-item ${active === item.view ? 'is-active' : ''}"
                data-act="view" data-view="${item.view}" title="${escapeHtml(item.label)}">
          ${ICONS[item.icon]}<span class="wb-nav-label">${escapeHtml(item.label)}</span>
        </button>`
      ).join('')}
    </nav>
    <div class="wb-nav-foot">
      <button class="wb-nav-item is-accent" data-act="launch" title="启动 Codex">
        ${ICONS.play}<span class="wb-nav-label">启动 Codex</span>
      </button>
      <button class="wb-nav-item" data-act="toggle-nav" title="折叠 / 展开导航">
        ${ICONS.panelRight}<span class="wb-nav-label">折叠导航</span>
      </button>
    </div>
  `;
}

module.exports = { navHtml, NAV_ITEMS: ITEMS };
