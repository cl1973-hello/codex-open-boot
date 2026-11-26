'use strict';

/**
 * 启动 Codex 并等它把调试端口开起来。
 *
 * 三个硬事实（M0 实测）：
 * 1. 单实例锁会吞掉第二次启动的参数 -> 必须先让 Codex 完全退出；
 * 2. 端口文件落在 %APPDATA%\Codex\web\<profile>\DevToolsActivePort，profile 名由启动入口决定；
 * 3. 端口用 0 让系统分配，避免和别的调试端口冲突。
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const logger = require('./logger');
const appx = require('./appx');
const win32 = require('./win32');
const processes = require('./processes');

const CODEX_EXE = 'ChatGPT.exe';

const DEBUG_ARGS = [
  '--remote-debugging-port=0',
  '--remote-allow-origins=*',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pwsh(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  }).trim();
}

/**
 * 所有 ChatGPT.exe 的 pid。
 *
 * 原来每次都起一个 PowerShell `Get-Process`（400~700ms），轮询和退出等待都吃不消，
 * 现在走 koffi 的 EnumProcesses（实测 3ms）；koffi 加载不到时 processes 内部会自动
 * 降级回 PowerShell，调用方无感。
 */
function pids() {
  return processes.pidsByName(CODEX_EXE);
}

function mainPid() {
  try {
    const out = pwsh(
      'Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty Id',
    );
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function isRunning() {
  return pids().length > 0;
}

/** 找所有 profile 下最新的 DevToolsActivePort */
function findPortFile() {
  const root = path.join(process.env.APPDATA || '', 'Codex', 'web');
  let best = null;
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(root, name, 'DevToolsActivePort');
    try {
      const stat = fs.statSync(file);
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) continue;
      if (!best || stat.mtimeMs > best.mtime) best = { profile: name, file, raw, mtime: stat.mtimeMs };
    } catch {
      /* 没有就跳过 */
    }
  }
  return best;
}

/** 先礼后兵地关掉 Codex：WM_CLOSE -> 等待 -> 强制结束 */
async function ensureNotRunning({ gracefulMs = 6000 } = {}) {
  const list = pids();
  if (list.length === 0) return { wasRunning: false };

  logger.info(`codex 正在运行（${list.length} 个进程），先退出`);
  const pid = mainPid();
  if (pid) {
    const hwnd = win32.findMainWindow(pid);
    if (hwnd) win32.closeWindow(hwnd);
  }

  const deadline = Date.now() + gracefulMs;
  while (Date.now() < deadline) {
    if (!isRunning()) return { wasRunning: true, forced: false };
    await sleep(250);
  }

  try {
    pwsh('Get-Process ChatGPT -ErrorAction SilentlyContinue | Stop-Process -Force');
  } catch {
    /* 尽力而为 */
  }
  const hardDeadline = Date.now() + 5000;
  while (Date.now() < hardDeadline) {
    if (!isRunning()) return { wasRunning: true, forced: true };
    await sleep(200);
  }
  throw new Error('Codex 无法退出，请手动关闭后重试');
}

/**
 * 接手「用户刚从官方入口点起来的那一个」：立即结束，不等它自己退。
 *
 * 和 ensureNotRunning 的区别是目的不同：那个是要保住用户正在用的窗口（先 WM_CLOSE），
 * 这个针对的是刚起来几百毫秒、还没画出窗口、也没写过任何用户数据的实例 ——
 * 等它优雅退出纯属浪费，还会让开屏黑屏好几秒。
 */
async function terminateAll(list, { timeoutMs = 4000 } = {}) {
  const targets = (list || []).filter((n) => Number.isInteger(n) && n > 0);
  if (!targets.length) return { ok: true, killed: [], left: [] };
  const result = await processes.killAll(targets, { timeoutMs });
  if (result.ok) logger.info(`已结束刚启动的 Codex（pid ${result.killed.join(',')}）`);
  else logger.warn(`有些 Codex 进程没能结束：${result.left.join(',')}`);
  return result;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 启动并等待调试端口。
 * @returns {Promise<{port:number, profile:string, via:string, pid:number}>}
 */
async function launchAndWait({ launch = 'alias', timeoutMs = 45000, onProgress } = {}) {
  const { target, via } = appx.launchTarget(launch);
  const stale = findPortFile();
  if (stale) {
    // 清掉旧文件，否则会读到上一次的端口
    try {
      fs.rmSync(stale.file);
    } catch {
      /* 可能正被占用，忽略 */
    }
  }

  const startedAt = Date.now();
  logger.info(`启动 codex via=${via} target=${target}`);
  const child = spawn(target, DEBUG_ARGS, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  if (onProgress) onProgress({ phase: 'spawned', via });

  const deadline = Date.now() + timeoutMs;
  let hit = null;
  while (Date.now() < deadline) {
    hit = findPortFile();
    if (hit && hit.mtime >= startedAt - 2000) break;
    hit = null;
    await sleep(200);
  }
  if (!hit) throw new Error('Codex 没有打开调试端口（可能被安全软件拦截）');

  const port = Number(hit.raw.split(/\r?\n/)[0]);
  logger.info(`调试端口 ${port}（profile=${hit.profile}，${Date.now() - startedAt}ms）`);

  // 等页面 target 就绪
  let pages = [];
  const pageDeadline = Date.now() + 30000;
  while (Date.now() < pageDeadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      pages = list.filter((t) => t.type === 'page' && t.url.startsWith('app://'));
      if (pages.length) break;
    } catch {
      /* 端口还没 listening */
    }
    await sleep(200);
  }
  if (!pages.length) throw new Error('Codex 打开了调试端口，但等不到界面');

  if (onProgress) onProgress({ phase: 'ready', port, elapsed: Date.now() - startedAt });
  return { port, profile: hit.profile, via, pid: mainPid(), elapsed: Date.now() - startedAt };
}

module.exports = {
  DEBUG_ARGS,
  CODEX_EXE,
  isRunning,
  mainPid,
  pids,
  findPortFile,
  ensureNotRunning,
  terminateAll,
  launchAndWait,
  fetchJson,
};
