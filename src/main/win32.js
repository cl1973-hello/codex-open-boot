'use strict';

/**
 * Win32 调用层（koffi，NAPI 预编译，无需 node-gyp）。
 * 只做「读窗口信息 + 摆窗口」，不做任何注入或挂钩。
 */

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

// koffi 3.x 里函数签名必须写 koffi.struct() 注册时的名字（COB_*），不能写本地变量名
const RECT = koffi.struct('COB_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('COB_POINT', { x: 'long', y: 'long' });
const MINMAXINFO = koffi.struct('COB_MINMAXINFO', {
  ptReserved: POINT,
  ptMaxSize: POINT,
  ptMaxPosition: POINT,
  ptMinTrackSize: POINT,
  ptMaxTrackSize: POINT,
});
const MONITORINFO = koffi.struct('COB_MONITORINFO', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
});

const EnumWindows = user32.func('bool EnumWindows(void *cb, intptr_t lParam)');
const EnumWindowsProc = koffi.proto('int COB_EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
const GetClassNameW = user32.func('int GetClassNameW(intptr_t hwnd, _Out_ uint16 *buf, int n)');
const GetWindowTextW = user32.func('int GetWindowTextW(intptr_t hwnd, _Out_ uint16 *buf, int n)');
const IsWindow = user32.func('bool IsWindow(intptr_t hwnd)');
const IsWindowVisible = user32.func('bool IsWindowVisible(intptr_t hwnd)');
const IsZoomed = user32.func('bool IsZoomed(intptr_t hwnd)');
const GetForegroundWindow = user32.func('intptr_t GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(intptr_t hwnd)');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ COB_RECT *rect)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
const ShowWindow = user32.func('bool ShowWindow(intptr_t hwnd, int cmd)');
const GetDpiForWindow = user32.func('uint32 GetDpiForWindow(intptr_t hwnd)');
const MonitorFromWindow = user32.func('intptr_t MonitorFromWindow(intptr_t hwnd, uint32 flags)');
const GetMonitorInfoW = user32.func('bool GetMonitorInfoW(intptr_t monitor, _Inout_ COB_MONITORINFO *info)');
const SendMessageTimeoutW = user32.func(
  'intptr_t SendMessageTimeoutW(intptr_t hwnd, uint32 msg, uintptr_t wParam, _Inout_ COB_MINMAXINFO *mmi, uint32 flags, uint32 timeout, _Out_ uintptr_t *result)',
);
const PostMessageW = user32.func('bool PostMessageW(intptr_t hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam)');
const DwmGetWindowAttribute = dwmapi.func('long DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ COB_RECT *value, uint32 size)');

// Electron 主进程本身已是 per-monitor aware，这里再声明一次是为了让本模块单独在
// node 里跑（冒烟脚本 / probe）时坐标也是物理像素，否则 SetWindowPos 会被虚拟化。
try {
  const SetProcessDpiAwarenessContext = user32.func('bool SetProcessDpiAwarenessContext(intptr_t value)');
  SetProcessDpiAwarenessContext(-4); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
} catch {
  /* 已经设置过或系统太旧，忽略 */
}

const HWND_TOPMOST = -1n;
const HWND_NOTOPMOST = -2n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const SWP_NOCOPYBITS = 0x0100;
const SWP_ASYNCWINDOWPOS = 0x4000;
const SWP_SHOWWINDOW = 0x0040;
const SW_RESTORE = 9;
const SW_SHOW = 5;
const SW_HIDE = 0;
const WM_CLOSE = 0x0010;
const WM_GETMINMAXINFO = 0x0024;
const SMTO_ABORTIFHUNG = 0x0002;
const SMTO_BLOCK = 0x0001;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const MONITOR_DEFAULTTONEAREST = 2;

function wide(buf) {
  let s = '';
  for (const c of buf) {
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function toBig(hwnd) {
  return typeof hwnd === 'bigint' ? hwnd : BigInt(hwnd);
}

/** 找出某进程里可见的 Chromium 主窗口 */
function findMainWindow(pid, classNameHint = 'Chrome_WidgetWin') {
  let hit = 0;
  const cb = koffi.register((hwnd, _l) => {
    const out = [0];
    GetWindowThreadProcessId(hwnd, out);
    if (out[0] !== pid) return 1;
    if (!IsWindowVisible(hwnd)) return 1;
    const buf = new Uint16Array(256);
    GetClassNameW(hwnd, buf, 256);
    const cls = wide(buf);
    if (!cls.includes(classNameHint)) return 1;
    const titleBuf = new Uint16Array(512);
    GetWindowTextW(hwnd, titleBuf, 512);
    const title = wide(titleBuf);
    if (!title) return 1;
    hit = hwnd;
    return 0; // 找到就停
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return hit;
}

function isWindow(hwnd) {
  try {
    return !!hwnd && IsWindow(toBig(hwnd));
  } catch {
    return false;
  }
}

function getRect(hwnd) {
  const r = {};
  GetWindowRect(toBig(hwnd), r);
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

/** 可见边框与窗口矩形的差值；无边框窗口为 0（M0 实测 Codex 就是 0） */
function getFrameInsets(hwnd) {
  const win = {};
  const frame = {};
  GetWindowRect(toBig(hwnd), win);
  const hr = DwmGetWindowAttribute(toBig(hwnd), DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16);
  if (hr !== 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: frame.left - win.left,
    top: frame.top - win.top,
    right: win.right - frame.right,
    bottom: win.bottom - frame.bottom,
  };
}

function getMinTrack(hwnd) {
  const mmi = {};
  const result = [0n];
  const ok = SendMessageTimeoutW(toBig(hwnd), WM_GETMINMAXINFO, 0, mmi, SMTO_ABORTIFHUNG | SMTO_BLOCK, 500, result);
  if (!ok) return null;
  return { w: mmi.ptMinTrackSize.x, h: mmi.ptMinTrackSize.y };
}

function getDpi(hwnd) {
  try {
    return GetDpiForWindow(toBig(hwnd)) || 96;
  } catch {
    return 96;
  }
}

function getMonitorWorkArea(hwnd) {
  const mon = MonitorFromWindow(toBig(hwnd), MONITOR_DEFAULTTONEAREST);
  const info = { cbSize: 40 };
  if (!GetMonitorInfoW(mon, info)) return null;
  const r = info.rcWork;
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

/**
 * 摆窗口。默认异步 + 不抢焦点 + 不复制旧像素（缩放时不拖影）。
 */
function setRect(hwnd, rect, options = {}) {
  let flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOCOPYBITS | SWP_ASYNCWINDOWPOS;
  if (options.sizeOnly) flags |= SWP_NOMOVE;
  if (options.show) {
    flags |= SWP_SHOWWINDOW;
    flags &= ~SWP_NOZORDER;
  }
  let after = 0n;
  if (options.topmost === true) {
    after = HWND_TOPMOST;
    flags &= ~SWP_NOZORDER;
  } else if (options.topmost === false) {
    after = HWND_NOTOPMOST;
    flags &= ~SWP_NOZORDER;
  }
  return SetWindowPos(toBig(hwnd), after, Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h), flags);
}

function show(hwnd, cmd = SW_SHOW) {
  return ShowWindow(toBig(hwnd), cmd);
}

function isMaximized(hwnd) {
  try {
    return !!IsZoomed(toBig(hwnd));
  } catch {
    return false;
  }
}

function foreground() {
  return GetForegroundWindow();
}

function focus(hwnd) {
  try {
    return SetForegroundWindow(toBig(hwnd));
  } catch {
    return false;
  }
}

function closeWindow(hwnd) {
  return PostMessageW(toBig(hwnd), WM_CLOSE, 0, 0);
}

module.exports = {
  findMainWindow,
  isWindow,
  getRect,
  getFrameInsets,
  getMinTrack,
  getDpi,
  getMonitorWorkArea,
  setRect,
  show,
  isMaximized,
  foreground,
  focus,
  closeWindow,
  SW_RESTORE,
  SW_SHOW,
  SW_HIDE,
  SWP_NOSIZE,
  SWP_NOMOVE,
  SWP_NOZORDER,
  SWP_NOACTIVATE,
};
