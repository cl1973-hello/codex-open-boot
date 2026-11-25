// M0-C（补充 2）：临时去掉 WS_THICKFRAME，看能不能突破 793x991 的最小尺寸限制。
// 这是「让真实窗口从小矩形长起来」能否成立的关键。用完立即还原。
// 用法：node scripts/m0/c3-nostyle.mjs
import koffi from 'koffi';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const SetProcessDpiAwarenessContext = user32.func('bool SetProcessDpiAwarenessContext(intptr_t value)');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
const GetWindowLongPtrW = user32.func('intptr_t GetWindowLongPtrW(intptr_t hwnd, int index)');
const SetWindowLongPtrW = user32.func('intptr_t SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)');
SetProcessDpiAwarenessContext(-4);

const GWL_STYLE = -16;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;
const SWP_FLAGS = 0x0004 | 0x0010 | 0x0200; // NOZORDER | NOACTIVATE | NOOWNERZORDER

const report = JSON.parse(fs.readFileSync(path.join(ROOT, '.m0', 'c1-report.json'), 'utf8'));
const hwnd = BigInt(report.hwnd);
const orig = report.rect;

const rect = {};
const read = () => {
  GetWindowRect(hwnd, rect);
  return { w: rect.right - rect.left, h: rect.bottom - rect.top, x: rect.left, y: rect.top };
};

console.log('起始:', read());

const style0 = GetWindowLongPtrW(hwnd, GWL_STYLE);
const hasThick = (BigInt(style0) & BigInt(WS_THICKFRAME)) !== 0n;
console.log(`GWL_STYLE=0x${BigInt(style0).toString(16)}  WS_THICKFRAME=${hasThick}`);

if (!hasThick) {
  console.log('窗口本来就没有 WS_THICKFRAME，这个实验无意义');
} else {
  // 去掉可缩放边框与最大化按钮，再试缩到视频矩形起始尺寸 842x387（DIP→物理 ×1.5）
  const newStyle = BigInt(style0) & ~BigInt(WS_THICKFRAME) & ~BigInt(WS_MAXIMIZEBOX);
  const prev = SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
  console.log(`去边框后 GWL_STYLE=0x${newStyle.toString(16)}（旧值 0x${BigInt(prev).toString(16)}）`);

  await new Promise((r) => setTimeout(r, 200));
  SetWindowPos(hwnd, 0, orig.x, orig.y, 1263, 581, SWP_FLAGS); // 842x387 DIP × 1.5
  await new Promise((r) => setTimeout(r, 600));
  const small = read();
  console.log(`尝试 1263x581 -> 实测 ${small.w}x${small.h}  ${small.h < 800 ? '突破成功' : '仍被钳制'}`);

  // 再试更小
  SetWindowPos(hwnd, 0, orig.x, orig.y, 600, 400, SWP_FLAGS);
  await new Promise((r) => setTimeout(r, 500));
  const tiny = read();
  console.log(`尝试 600x400 -> 实测 ${tiny.w}x${tiny.h}`);

  // 立刻还原
  SetWindowLongPtrW(hwnd, GWL_STYLE, style0);
  SetWindowPos(hwnd, 0, orig.x, orig.y, orig.w, orig.h, SWP_FLAGS);
  await new Promise((r) => setTimeout(r, 600));
  const back = read();
  console.log(`还原样式与尺寸 -> ${back.w}x${back.h}  style=0x${BigInt(GetWindowLongPtrW(hwnd, GWL_STYLE)).toString(16)}`);

  fs.writeFileSync(
    path.join(ROOT, '.m0', 'c3-report.json'),
    JSON.stringify({ style0: String(style0), small, tiny, back, brokeThrough: small.h < 800 }, null, 2),
  );
}

console.log('完成');
