'use strict';

function qs(selector, root) {
  return (root || document).querySelector(selector);
}

function qsa(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

function on(target, type, handler, options) {
  if (!target) return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setVar(name, value, root) {
  (root || document.documentElement).style.setProperty(name, value);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatClock(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(date) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${week}`;
}

function greeting(hour) {
  if (hour < 5) return '夜深了，把宇宙装进工作台。';
  if (hour < 11) return '早上好，今天从一段开屏开始。';
  if (hour < 14) return '中午好，先让屏幕亮起来。';
  if (hour < 18) return '下午好，继续未完成的事情。';
  if (hour < 23) return '晚上好，安静地做点事。';
  return '夜深了，把宇宙装进工作台。';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function basename(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/* ---------- icon set (stroke, 24×24, currentColor) ---------- */

function icon(paths, extra) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${paths}</svg>`;
}

const ICONS = {
  home: icon('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'),
  folder: icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  tools: icon('<path d="M14.7 6.3a4 4 0 0 0 5 5L20 11l-9 9-2-2 9-9z"/><path d="M6 6l3 3"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  play: icon('<path d="M8 5.5v13l11-6.5z"/>'),
  refresh: icon('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>'),
  crosshair: icon('<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  image: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4 4 3 3-2 4 3"/>'),
  terminal: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  star: icon('<path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  minimize: icon('<path d="M5 12h14"/>'),
  maximize: icon('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  external: icon('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  check: icon('<path d="m5 13 4 4L19 7"/>'),
  trash: icon('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  sliders: icon('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  panelRight: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
};

module.exports = { qs, qsa, on, el, setVar, debounce, nextFrame, pad2, formatClock, formatDate, greeting, escapeHtml, basename, ICONS };
