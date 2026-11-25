// M0-B1/B2：带调试端口拉起 Codex，确认能拿到 page target，并记录 profile 目录名。
// 用法：
//   node scripts/m0/b1-port.mjs --via=alias     # 执行别名
//   node scripts/m0/b1-port.mjs --via=exe       # 直启 WindowsApps 内 exe
//   node scripts/m0/b1-port.mjs --attach        # 不动进程，只找现有端口并写 session.json
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const via = (args.find((a) => a.startsWith('--via=')) || '--via=alias').split('=')[1];
const attachOnly = args.includes('--attach');
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const STATE_DIR = path.join(ROOT, '.m0');
const STATE = path.join(STATE_DIR, 'session.json');
const WEB_ROOT = path.join(process.env.APPDATA, 'Codex', 'web');

const SWITCHES = [
  '--remote-debugging-port=0',
  '--remote-allow-origins=*',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pkg() {
  const json = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-AppxPackage -Name OpenAI.Codex | Select-Object PackageFamilyName,InstallLocation | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true },
  );
  return JSON.parse(json);
}

function runningCount() {
  const n = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process ChatGPT -ErrorAction SilentlyContinue | Measure-Object).Count'],
    { encoding: 'utf8', windowsHide: true },
  );
  return Number(n.trim()) || 0;
}

/** profile 目录名由启动入口决定，必须靠前后对比找出来 */
function listWebProfiles() {
  try {
    return fs.readdirSync(WEB_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** DevToolsActivePort 落在 %APPDATA%\Codex\web\<profile>\ 下，逐层找最新的一个 */
function findPortFile() {
  const hits = [];
  for (const name of listWebProfiles()) {
    const file = path.join(WEB_ROOT, name, 'DevToolsActivePort');
    try {
      const stat = fs.statSync(file);
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw) hits.push({ profile: name, file, raw, mtime: stat.mtimeMs });
    } catch {
      /* 没有就是没有 */
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0] || null;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const info = pkg();
  const exe = path.join(info.InstallLocation, 'app', 'ChatGPT.exe');
  const alias = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe');
  const target = via === 'exe' ? exe : alias;

  const before = listWebProfiles();
  let t0 = Date.now();

  if (!attachOnly) {
    const already = runningCount();
    if (already > 0) {
      console.log(`M0-B: SKIP —— 已有 ${already} 个 ChatGPT 进程（单实例锁会吞参数）。先退出再测，或用 --attach。`);
      process.exitCode = 2;
      return;
    }
    console.log(`启动方式: ${via}\n目标: ${target}\n参数: ${SWITCHES.join(' ')}\n`);
    const child = spawn(target, SWITCHES, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    child.on('error', (e) => console.log('spawn error:', e.message));

    // 先等端口文件出现（可能落在新 profile 或旧 profile 下）
    const deadline = Date.now() + 45000;
    let hit = null;
    while (Date.now() < deadline) {
      hit = findPortFile();
      if (hit && hit.mtime > t0) break;
      hit = null;
      await sleep(250);
    }
    if (!hit) {
      console.log('M0-B: FAIL —— 45s 内没有任何 DevToolsActivePort');
      process.exitCode = 1;
      return;
    }
    console.log(`DevToolsActivePort 出现于 ${Date.now() - t0}ms`);
    console.log(`  profile: ${hit.profile}`);
    console.log(`  file   : ${hit.file}`);
  }

  const hit = findPortFile();
  if (!hit) {
    console.log('M0-B: FAIL —— 找不到 DevToolsActivePort');
    process.exitCode = 1;
    return;
  }
  const port = Number(hit.raw.split(/\r?\n/)[0]);
  console.log(`port=${port}`);

  let targets = [];
  const tDeadline = Date.now() + 30000;
  while (Date.now() < tDeadline) {
    try {
      targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* 端口还没 listening */
    }
    await sleep(250);
  }

  const after = listWebProfiles();
  const newProfiles = after.filter((n) => !before.includes(n));
  const pages = targets.filter((t) => t.type === 'page');

  console.log(`\n总共 ${Date.now() - t0}ms 内就绪；page target ${pages.length} 个：`);
  for (const t of pages) console.log(`  - ${t.title} | ${t.url.slice(0, 110)}`);
  console.log(`其它 target: ${targets.filter((t) => t.type !== 'page').map((t) => t.type).join(', ') || '无'}`);
  console.log(`web profile 目录：本次新增 [${newProfiles.join(', ') || '无'}]，已有 [${before.join(', ')}]`);

  const ok = pages.length > 0;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        via,
        exe,
        alias,
        port,
        profile: hit.profile,
        portFile: hit.file,
        newProfiles,
        targets: targets.map(({ id, type, title, url, webSocketDebuggerUrl }) => ({ id, type, title, url, webSocketDebuggerUrl })),
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\n状态已写入 ${path.relative(ROOT, STATE)}`);
  console.log(ok ? 'M0-B: PASS' : 'M0-B: FAIL（没有 page target）');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error('M0-B 异常:', e);
  process.exitCode = 1;
});
