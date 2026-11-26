'use strict';

/**
 * 低成本进程枚举（koffi + psapi/kernel32）。给「官方入口侦测」用。
 *
 * 为什么不用 PowerShell：`Get-Process` 每次要 400~700ms，轮询起来必卡；
 * `tasklist` 每 400ms 起一个进程，CPU 和 EDR 日志都不好看。
 * 这里 EnumProcesses 实测 3.6ms 扫完 250 个进程（含解析镜像路径），
 * 400ms 轮询不到 1% 单核。
 *
 * 只在 Windows 上有意义；koffi 加载失败时整体降级成 PowerShell 版本，
 * 调用方不需要关心用的是哪条路。
 */

const { execFileSync } = require('child_process');

const MAX_PIDS = 4096;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let api = null;

function loadApi() {
  if (api !== null) return api;
  try {
    // eslint-disable-next-line global-require
    const koffi = require('koffi');
    const psapi = koffi.load('psapi.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      EnumProcesses: psapi.func('bool EnumProcesses(void *pProcessIds, uint32_t cb, _Out_ uint32_t *pBytesReturned)'),
      OpenProcess: kernel32.func('void *OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      QueryFullProcessImageNameW: kernel32.func(
        'bool QueryFullProcessImageNameW(void *handle, uint32_t flags, void *buffer, _Inout_ uint32_t *size)'
      ),
      CloseHandle: kernel32.func('bool CloseHandle(void *handle)'),
      ids: Buffer.alloc(MAX_PIDS * 4),
      returned: [0],
      name: Buffer.alloc(1024 * 2),
      nameSize: [1024],
      cache: new Map(), // pid -> 镜像路径（只缓存本次扫描里还活着的 pid）
    };
  } catch {
    api = false;
  }
  return api;
}

/** 当前所有 pid。失败返回空数组，不抛。 */
function listPids() {
  const a = loadApi();
  if (!a) return null;
  if (!a.EnumProcesses(a.ids, MAX_PIDS * 4, a.returned)) return [];
  const count = a.returned[0] / 4;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const pid = a.ids.readUInt32LE(i * 4);
    if (pid) out.push(pid);
  }
  return out;
}

/** 单个 pid 的镜像路径（失败返回空串：受保护进程、已退出都算失败） */
function imageName(pid) {
  const a = loadApi();
  if (!a) return '';
  const cached = a.cache.get(pid);
  if (cached !== undefined) return cached;

  let name = '';
  const handle = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (handle) {
    try {
      a.nameSize[0] = 1024;
      if (a.QueryFullProcessImageNameW(handle, 0, a.name, a.nameSize)) {
        name = a.name.toString('utf16le', 0, a.nameSize[0] * 2);
      }
    } finally {
      a.CloseHandle(handle);
    }
  }
  a.cache.set(pid, name);
  return name;
}

/** 降级路径：没有 koffi 时用 PowerShell 兜底 */
function pidsByNameFallback(basename) {
  try {
    const base = String(basename).replace(/\.exe$/i, '');
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process ${base} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ","`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }
    ).trim();
    return out
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * 按镜像名找 pid（大小写不敏感，只比文件名）。
 * @param {string} basename 例如 'ChatGPT.exe'
 * @returns {number[]}
 */
function pidsByName(basename) {
  const pids = listPids();
  if (pids === null) return pidsByNameFallback(basename);
  const want = String(basename).toLowerCase();
  const a = loadApi();
  const hits = [];
  for (const pid of pids) {
    const full = imageName(pid);
    if (!full) continue;
    const file = full.slice(full.lastIndexOf('\\') + 1).toLowerCase();
    if (file === want) hits.push(pid);
  }
  // 丢掉已经退出的缓存，避免 pid 被系统重用后读到旧名字
  if (a && a.cache.size > pids.length * 2) {
    const alive = new Set(pids);
    for (const pid of a.cache.keys()) if (!alive.has(pid)) a.cache.delete(pid);
  }
  return hits;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 立即结束若干进程（TerminateProcess）。这些进程是刚被用户点起来的，
 * 没有可保存的状态，所以不走「先礼后兵」。
 * @returns {Promise<{ok:boolean, killed:number[], left:number[]}>}
 */
async function killAll(pids, { timeoutMs = 4000 } = {}) {
  const targets = [...new Set((pids || []).filter((n) => Number.isInteger(n) && n > 0))];
  const killed = [];
  for (const pid of targets) {
    try {
      process.kill(pid);
      killed.push(pid);
    } catch {
      /* 已经退了 */
    }
  }

  const deadline = Date.now() + timeoutMs;
  let left = targets.filter(alive);
  while (left.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 80));
    left = targets.filter(alive);
  }
  return { ok: left.length === 0, killed, left };
}

module.exports = { listPids, imageName, pidsByName, alive, killAll };
