'use strict';

/**
 * 极简 CDP 客户端 + 主题注入器。
 *
 * M0 实测得到的两个反直觉结论：
 * - `Page.addScriptToEvaluateOnNewDocument` 在 Codex 的 app:// 页面上**刷新后不执行**；
 * - 刷新不会重建 page target，`Target.setAutoAttach` 也收不到 attach 事件。
 * 所以持久化只能靠：页面级事件（frameNavigated / loadEventFired）+ 心跳 + 带重试的重注入。
 */

const logger = require('./logger');
const { buildUpdateScript } = require('../shared/theme-css');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      reject(error);
      return;
    }
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error('CDP 连接超时'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(client);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP 连接失败'));
    });

    ws.addEventListener('close', () => {
      for (const { reject: rj } of pending.values()) rj(new Error('CDP 已断开'));
      pending.clear();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: rs, reject: rj } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rj(new Error(`${msg.error.code}: ${msg.error.message}`));
        else rs(msg.result);
        return;
      }
      if (msg.method) {
        const fns = listeners.get(msg.method);
        if (fns) for (const fn of fns) fn(msg.params || {}, msg.sessionId);
      }
    });

    const client = {
      send(method, params = {}, sessionId) {
        return new Promise((rs, rj) => {
          const id = nextId++;
          pending.set(id, { resolve: rs, reject: rj });
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          try {
            ws.send(JSON.stringify(payload));
          } catch (error) {
            pending.delete(id);
            rj(error);
            return;
          }
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              rj(new Error(`CDP 超时: ${method}`));
            }
          }, 15000);
        });
      },
      on(method, fn) {
        if (!listeners.has(method)) listeners.set(method, []);
        listeners.get(method).push(fn);
      },
      close() {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
      get open() {
        return ws.readyState === 1;
      },
    };
  });
}

async function evaluate(client, expression) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'eval 失败');
  return res.result ? res.result.value : undefined;
}

function isCodexPage(target) {
  return target && target.type === 'page' && typeof target.url === 'string' && target.url.startsWith('app://');
}

class Injector {
  constructor({ port, css = '', bg = false, scheme = 'dark', onLog } = {}) {
    this.port = port;
    this.css = css;
    this.bg = bg;
    this.scheme = scheme === 'light' ? 'light' : 'dark';
    this.pages = new Map(); // targetId -> {client, target, applied}
    this.timer = null;
    this.scanning = false;
    this.onLog = onLog || (() => {});
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async listTargets() {
    const res = await fetch(`${this.baseUrl}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async start() {
    await this.scan();
    this.timer = setInterval(() => {
      this.scan().catch(() => {});
    }, 2000);
    return this;
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const list = await this.listTargets();
      const alive = new Set();
      for (const target of list) {
        if (!isCodexPage(target)) continue;
        alive.add(target.id);
        if (this.pages.has(target.id)) continue;
        await this.attach(target);
      }
      // 关掉的页面清理掉
      for (const [id, page] of this.pages) {
        if (!alive.has(id)) {
          page.client.close();
          this.pages.delete(id);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  async attach(target) {
    let client;
    try {
      client = await connect(target.webSocketDebuggerUrl);
    } catch (error) {
      logger.warn(`attach 失败: ${error.message}`);
      return;
    }
    const page = { client, target, applied: false, lastAt: 0 };
    this.pages.set(target.id, page);

    client.on('Page.frameNavigated', (params) => {
      if (params.frame && !params.frame.parentId) this.apply(page, 'navigated');
    });
    client.on('Page.loadEventFired', () => this.apply(page, 'load'));

    try {
      await client.send('Page.enable');
      await client.send('Runtime.enable');
    } catch (error) {
      logger.warn(`page.enable 失败: ${error.message}`);
    }
    await this.apply(page, 'attach');
    logger.info(`已注入主题: ${target.url}`);
  }

  /** 带重试的注入（页面切换瞬间上下文会短暂不可用） */
  async apply(page, reason, attempts = 6) {
    if (!this.css) return false;
    for (let i = 0; i < attempts; i++) {
      try {
        const ok = await evaluate(page.client, buildUpdateScript(this.css, { bg: this.bg, scheme: this.scheme }));
        if (ok === true) {
          page.applied = true;
          page.lastAt = Date.now();
          if (reason !== 'update') this.onLog({ phase: 'injected', reason });
          return true;
        }
      } catch {
        /* 上下文正在切换，重试 */
      }
      await sleep(300);
    }
    logger.warn(`注入失败(${reason}) ${page.target.url}`);
    return false;
  }

  /** 换主题 / 换背景：只更新样式文本，不重建连接 */
  async update({ css, bg, scheme }) {
    if (typeof css === 'string') this.css = css;
    if (typeof bg === 'boolean') this.bg = bg;
    if (scheme === 'light' || scheme === 'dark') this.scheme = scheme;
    let ok = 0;
    for (const page of this.pages.values()) {
      if (await this.apply(page, 'update', 3)) ok++;
    }
    return { pages: this.pages.size, applied: ok };
  }

  /** 等第一张页面真正带上主题（开屏交接前用） */
  async waitApplied(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const page of this.pages.values()) {
        if (page.applied) return true;
      }
      await this.scan().catch(() => {});
      await sleep(200);
    }
    return false;
  }

  stats() {
    return { pages: this.pages.size, applied: [...this.pages.values()].filter((p) => p.applied).length };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const page of this.pages.values()) page.client.close();
    this.pages.clear();
  }
}

module.exports = { connect, evaluate, Injector, sleep };
