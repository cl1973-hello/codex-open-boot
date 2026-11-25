// M0-C（补充）：把真实窗口压到最小尺寸，截图看它会不会崩版式。
// 用法：node scripts/m0/c2-shrink-shot.mjs
import koffi from 'koffi';
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './cdp-client.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const SetProcessDpiAwarenessContext = user32.func('bool SetProcessDpiAwarenessContext(intptr_t value)');
const GetForegroundWindow = user32.func('intptr_t GetForegroundWindow()');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
SetProcessDpiAwarenessContext(-4);

const report = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'c1-report.json'), 'utf8'));
const hwnd = BigInt(report.hwnd);
const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'session.json'), 'utf8'));
const page = state.targets.find((t) => t.type === 'page');

const client = await connect(page.webSocketDebuggerUrl);
await client.send('Page.enable');

async function shot(name) {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(ROOT, '.m0', name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const { width, height } = await client.send('Page.getLayoutMetrics').then((m) => m.cssContentSize);
  console.log(`  截图 ${name}  viewport≈${Math.round(width)}x${Math.round(height)}`);
  return file;
}

const r = {};
GetWindowRect(hwnd, r);
console.log(`起始 ${r.right - r.left}x${r.bottom - r.top}`);
await shot('c2-before.png');

// 压到最小尺寸（按 c1 实测的 793x991）
SetWindowPos(hwnd, 0, r.left, r.top, 793, 991, 0x0004 | 0x0010 | 0x0200);
await new Promise((res) => setTimeout(res, 1200));
GetWindowRect(hwnd, r);
console.log(`压到最小后 ${r.right - r.left}x${r.bottom - r.top}`);
await shot('c2-min.png');

// 中间尺寸
SetWindowPos(hwnd, 0, r.left, r.top, 1200, 900, 0x0004 | 0x0010 | 0x0200);
await new Promise((res) => setTimeout(res, 900));
GetWindowRect(hwnd, r);
console.log(`中间尺寸后 ${r.right - r.left}x${r.bottom - r.top}`);
await shot('c2-mid.png');

// 还原
SetWindowPos(hwnd, 0, report.rect.x, report.rect.y, report.rect.w, report.rect.h, 0x0004 | 0x0010 | 0x0200);
await new Promise((res) => setTimeout(res, 700));
GetWindowRect(hwnd, r);
console.log(`还原 ${r.right - r.left}x${r.bottom - r.top}`);
console.log('前台窗口:', GetForegroundWindow().toString());
client.close();
