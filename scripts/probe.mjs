/**
 * npm run probe
 *
 * 开一次「完整开屏 + 测量」并把结果写到 .probe/：
 *   - 入场时间 / 入场矩形 / 尾段时长
 *   - 渲染层与主进程各算一次的「视频矩形」差值（验收要求 ≤2px）
 *   - 主题注入的页面数与最终色值
 *
 * 用法：
 *   npm run probe              # 默认跑一次
 *   npm run probe -- --panel    # 只打开设置面板
 *
 * 注意：探针会用到整屏截图，部分机器上被安全策略拦截，此时只输出数值不走图像。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 注意：本文件在 scripts/ 下，仓库根是它的上一层。
// 早先写成「dirname(自身路径)」会把 scripts/ 当成根，electron 找不到就回退到
// .bin/electron.cmd，而 Windows 上不带 shell 直接 spawn 一个 .cmd 会 EINVAL。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.probe');
const LOG = path.join(process.env.APPDATA || '', 'CodexOpenBoot', 'launcher.log');
const DEBUG_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function electronBin() {
  const win = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(win)) return win;
  return path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
}

// 日志是 UTF-8 中文，按「字节数」切片会切在字符中间：要么多切要么切空。
// 这里统一用字符串长度当偏移量。
function readLogAll() {
  try {
    return fs.readFileSync(LOG, 'utf8');
  } catch {
    return '';
  }
}

function readLog(from) {
  return readLogAll().slice(from);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const probeDir = path.join(OUT, 'shots');
  fs.rmSync(probeDir, { recursive: true, force: true });

  const before = readLogAll().length;

  const env = { ...process.env, COB_PROBE: probeDir, COB_DEBUG_PORT: String(DEBUG_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBin(), ['.', ...process.argv.slice(2)], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    windowsHide: false,
  });

  console.log('[probe] 启动中…（会重启一次 Codex，几秒后开始播开屏）');

  // 等开屏结束：日志里出现「开屏结束」或超时
  const deadline = Date.now() + 60000;
  let done = false;
  while (Date.now() < deadline) {
    await sleep(400);
    if (/开屏结束/.test(readLog(before))) {
      done = true;
      break;
    }
  }

  const text = readLog(before);
  fs.writeFileSync(path.join(OUT, 'launcher.log'), text);

  const checks = {
    entry: /入场时间 ([\d.]+)s/.exec(text)?.[1] ?? null,
    entryRect: /入场 [\d.]+s 矩形 (\d+)x(\d+) @ (-?\d+),(-?\d+)/.exec(text)?.slice(1) ?? null,
    tail: /尾段完成 (\d+)x(\d+)（(\d+)ms）/.exec(text)?.slice(1) ?? null,
    layoutDelta: /最大偏差=([\d.]+)px/.exec(text)?.[1] ?? null,
    injected: (text.match(/已注入主题/g) || []).length,
    splashConsole: /开屏页 console/g.test(text),
    skipped: /用户跳过开屏/.test(text),
    restored: /恢复上次中断的窗口尺寸/.test(text),
    elapsed: /开屏结束：ok=(\w+) (\d+)ms/.exec(text)?.slice(1) ?? null,
    shots: fs.existsSync(probeDir) ? fs.readdirSync(probeDir).filter((f) => f.endsWith('.png')) : [],
  };

  const report = {
    at: new Date().toISOString(),
    done,
    checks,
    verdict: {
      layoutWithin2px: checks.layoutDelta !== null && Number(checks.layoutDelta) <= 2,
      injected: checks.injected > 0,
      noConsoleErrors: !checks.splashConsole,
    },
  };

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`[probe] 结果写入 ${path.relative(ROOT, path.join(OUT, 'report.json'))}`);

  try {
    child.kill();
  } catch {
    /* 已经退出 */
  }
  process.exit(report.done ? 0 : 1);
}

main().catch((error) => {
  console.error('[probe] 失败:', error.message);
  process.exit(1);
});
