// M0-C：真实 Codex 窗口的可控性实测
//   1) 找 HWND  2) 读 WM_GETMINMAXINFO  3) 尝试缩到 400x300 看是否被钳制
//   4) 180 帧 SetWindowPos 测耗时  5) topmost+NOACTIVATE 是否抢焦点
// 用法：node scripts/m0/c1-window.mjs
import koffi from 'koffi';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const MINMAXINFO = koffi.struct('MINMAXINFO', {
  ptReserved: POINT,
  ptMaxSize: POINT,
  ptMaxPosition: POINT,
  ptMinTrackSize: POINT,
  ptMaxTrackSize: POINT,
});

const EnumWindows = user32.func('bool EnumWindows(void *cb, intptr_t lParam)');
const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
const GetClassNameW = user32.func('int GetClassNameW(intptr_t hwnd, _Out_ uint16 *buf, int n)');
const GetWindowTextW = user32.func('int GetWindowTextW(intptr_t hwnd, _Out_ uint16 *buf, int n)');
const IsWindowVisible = user32.func('bool IsWindowVisible(intptr_t hwnd)');
const IsZoomed = user32.func('bool IsZoomed(intptr_t hwnd)');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
const ShowWindow = user32.func('bool ShowWindow(intptr_t hwnd, int cmd)');
const GetForegroundWindow = user32.func('intptr_t GetForegroundWindow()');
const SendMessageTimeoutW = user32.func('intptr_t SendMessageTimeoutW(intptr_t hwnd, uint32 msg, uintptr_t wParam, _Inout_ MINMAXINFO *mmi, uint32 flags, uint32 timeout, _Out_ uintptr_t *result)');
const GetDpiForWindow = user32.func('uint32 GetDpiForWindow(intptr_t hwnd)');
const SetProcessDpiAwarenessContext = user32.func('bool SetProcessDpiAwarenessContext(intptr_t value)');
const DwmGetWindowAttribute = dwmapi.func('long DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ RECT *value, uint32 size)');

// 关键：Node 默认是 DPI 不感知的，拿到的坐标会被 Windows 虚拟化成 96 DPI。
// Electron 主进程本身是 per-monitor DPI aware，所以生产代码不需要这一步；M0 脚本必须自己声明。
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);


const WM_GETMINMAXINFO = 0x0024;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const SWP_ASYNCWINDOWPOS = 0x4000;
const SWP_NOCOPYBITS = 0x0100;
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const SMTO_ABORTIFHUNG = 0x0002;
const SMTO_BLOCK = 0x0001;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

function wide(buf) {
  let s = '';
  for (const c of buf) {
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function targetPid() {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty Id'],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return Number(out) || 0;
}

const pid = targetPid();
if (!pid) {
  console.log('M0-C: FAIL —— 没有带主窗口的 ChatGPT 进程，先跑 b1-port.mjs');
  process.exit(1);
}

// 1) 找 HWND
let hwnd = 0n;
const found = [];
const cb = koffi.register((h, _l) => {
  const p = [0];
  GetWindowThreadProcessId(h, p);
  if (p[0] === pid) {
    const buf = new Uint16Array(256);
    GetClassNameW(h, buf, 256);
    const cls = wide(buf);
    const tbuf = new Uint16Array(256);
    GetWindowTextW(h, tbuf, 256);
    const title = wide(tbuf);
    const vis = IsWindowVisible(h);
    found.push({ hwnd: h, cls, title, visible: vis });
    if (vis && cls.includes('Chrome_WidgetWin') && !hwnd) hwnd = h;
  }
  return 1;
}, koffi.pointer(EnumWindowsProc));
EnumWindows(cb, 0);
koffi.unregister(cb);

console.log(`pid=${pid}`);
console.log('该进程的顶层窗口:');
for (const w of found) console.log(`  ${w.cls} | "${w.title}" | visible=${w.visible}`);
if (!hwnd) {
  console.log('M0-C: FAIL —— 没找到可见的 Chrome_WidgetWin_1');
  process.exit(1);
}

const rect0 = {};
GetWindowRect(hwnd, rect0);
const frame = {};
DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16);
const dpi = GetDpiForWindow(hwnd);
console.log(`\nHWND=${hwnd}`);
console.log(`GetWindowRect: ${rect0.left},${rect0.top} ${rect0.right - rect0.left}x${rect0.bottom - rect0.top}`);
console.log(`DWM 扩展边框: ${frame.left},${frame.top} ${frame.right - frame.left}x${frame.bottom - frame.top}`);
console.log(`边框补偿: dx=${frame.left - rect0.left} dy=${frame.top - rect0.top} dr=${rect0.right - frame.right} db=${rect0.bottom - frame.bottom}`);
console.log(`DPI=${dpi} (scale ${(dpi / 96).toFixed(3)}), IsZoomed=${IsZoomed(hwnd)}`);

// 2) WM_GETMINMAXINFO
const mmi = {};
const res = [0n];
const r = SendMessageTimeoutW(hwnd, WM_GETMINMAXINFO, 0, mmi, SMTO_ABORTIFHUNG | SMTO_BLOCK, 500, res);
console.log(`\nWM_GETMINMAXINFO ret=${r} result=${res[0]}`);
console.log(`  ptMinTrackSize = ${mmi.ptMinTrackSize?.x} x ${mmi.ptMinTrackSize?.y}`);
console.log(`  ptMaxTrackSize = ${mmi.ptMaxTrackSize?.x} x ${mmi.ptMaxTrackSize?.y}`);

// 3) 先还原（最大化窗口 SetWindowPos 不会改变尺寸），再缩到 400x300 看是否被钳制
ShowWindow(hwnd, 9); // SW_RESTORE
await new Promise((r) => setTimeout(r, 500));
const restored0 = {};
GetWindowRect(hwnd, restored0);
const orig = { x: restored0.left, y: restored0.top, w: restored0.right - restored0.left, h: restored0.bottom - restored0.top };
console.log(`\n还原后: ${orig.w}x${orig.h} @ ${orig.x},${orig.y}`);

SetWindowPos(hwnd, 0, orig.x, orig.y, 400, 300, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
await new Promise((r) => setTimeout(r, 500));
const shrunk = {};
GetWindowRect(hwnd, shrunk);
const sw = shrunk.right - shrunk.left;
const sh = shrunk.bottom - shrunk.top;
const clamped = sw > 400 * 1.15 || sh > 300 * 1.15;
console.log(`SetWindowPos(400x300) -> 实测 ${sw}x${sh}  ${clamped ? '被钳制' : '未被钳制'}`);

// 3b) 再试一次贴近下限的尺寸，确认正常缩放可用
const justAbove = { w: Math.round((mmi.ptMinTrackSize?.x || 800) * 1.02), h: Math.round((mmi.ptMinTrackSize?.y || 600) * 1.02) };
SetWindowPos(hwnd, 0, orig.x, orig.y, justAbove.w, justAbove.h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
await new Promise((r) => setTimeout(r, 400));
const nearMin = {};
GetWindowRect(hwnd, nearMin);
console.log(`SetWindowPos(${justAbove.w}x${justAbove.h}) -> 实测 ${nearMin.right - nearMin.left}x${nearMin.bottom - nearMin.top}`);

// 4) 帧率：在两个尺寸之间来回 180 次
const sizes = [
  [orig.w, orig.h],
  [Math.max(400, Math.round(orig.w * 0.35)), Math.max(300, Math.round(orig.h * 0.35))],
];
const times = [];
const t0 = performance.now();
for (let i = 0; i < 180; i++) {
  const [w, h] = sizes[i % 2];
  const t = performance.now();
  SetWindowPos(hwnd, 0, orig.x, orig.y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS | SWP_NOCOPYBITS);
  times.push(performance.now() - t);
}
const total = performance.now() - t0;
times.sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(`180 帧调用: 总 ${total.toFixed(0)}ms, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, max=${times.at(-1).toFixed(2)}ms`);

// 5) 焦点：topmost + NOACTIVATE 之后前台窗口是否被抢
const fgBefore = GetForegroundWindow();
SetWindowPos(hwnd, HWND_TOPMOST, orig.x, orig.y, orig.w, orig.h, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
await new Promise((r) => setTimeout(r, 500));
const fgAfter = GetForegroundWindow();
console.log(`\n前台窗口 before=${fgBefore} after=${fgAfter}  ${fgBefore === fgAfter ? '未被抢焦点' : '焦点被抢（需要 topmost 小窗兜底）'}`);

// 还原
SetWindowPos(hwnd, HWND_NOTOPMOST, orig.x, orig.y, orig.w, orig.h, SWP_NOACTIVATE);
ShowWindow(hwnd, 9); // SW_RESTORE
const restored = {};
GetWindowRect(hwnd, restored);
console.log(`还原: ${restored.right - restored.left}x${restored.bottom - restored.top}`);

const report = {
  pid,
  hwnd: String(hwnd),
  windows: found,
  rect: orig,
  dwmFrame: frame,
  dpi,
  minTrack: mmi.ptMinTrackSize,
  maxTrack: mmi.ptMaxTrackSize,
  clamped,
  shrunk: { w: sw, h: sh },
  frames: { totalMs: +total.toFixed(1), p50: +p50.toFixed(2), p95: +p95.toFixed(2), max: +times.at(-1).toFixed(2) },
  focusStolen: fgBefore !== fgAfter,
};
fs.writeFileSync(path.join(ROOT, '.m0', 'c1-report.json'), JSON.stringify(report, null, 2));
console.log('\n报告已写入 .m0/c1-report.json');
