'use strict';

/**
 * npm run check:entry
 *
 * 真实地走一遍 entry.install() / status() / remove()，但把桌面与开始菜单
 * 重定向到临时目录 —— 不会在用户自己的桌面上留东西。
 *
 * 验证的是三件容易只在本机坏掉的事：
 *   1. WScript.Shell 能不能创建 .lnk 并读回目标（COM 被安全策略拦掉时会失败）
 *   2. 图标能不能从 Codex 包里取到（取不到会退回自带 icon.ico）
 *   3. remove() 只删「目标确实是我们」的快捷方式
 *
 * 用 electron 跑（需要 app.getPath 与 COM）：
 *   node_modules/electron/dist/electron.exe scripts/check-entry.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tmp = path.join(os.tmpdir(), 'cob-entry-check');
fs.mkdirSync(tmp, { recursive: true });

// 必须在 ready 之前改：desktop 决定 .lnk 落点，appData 决定开始菜单与 userData
app.setPath('desktop', tmp);
app.setPath('appData', tmp);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[check:entry] ${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

app.whenReady().then(() => {
  const entry = require('../src/main/entry');

  try {
    const before = entry.status({ app });
    check('初始状态没有我们的快捷方式', !before.ownsDesktop && !before.ownsStartMenu, before.desktop.path);

    const installed = entry.install({ app });
    check('install 返回 ok', installed.ok === true, `created=${installed.created.length}`);
    check('桌面 .lnk 已创建', fs.existsSync(before.desktop.path), before.desktop.path);
    check('开始菜单 .lnk 已创建', fs.existsSync(before.startMenu.path), before.startMenu.path);
    check(
      '图标已落地',
      !!installed.icon && fs.existsSync(installed.icon),
      installed.icon ? `${installed.icon} (${fs.statSync(installed.icon).size} B)` : '未取到',
    );

    const after = entry.status({ app });
    check('读回目标 = 本程序', after.ownsDesktop && after.ownsStartMenu, after.desktop.target || '(空)');

    const removed = entry.remove({ app });
    check('remove 删掉两个入口', removed.removed.length === 2, `removed=${removed.removed.length}`);
    check('删完不复存在', !fs.existsSync(before.desktop.path) && !fs.existsSync(before.startMenu.path));

    // 别人的快捷方式不能被 remove 掉
    const foreign = path.join(tmp, 'Codex.lnk');
    const { execFileSync } = require('child_process');
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$sh = New-Object -ComObject WScript.Shell; $s = $sh.CreateShortcut('${foreign.replace(/'/g, "''")}'); $s.TargetPath = 'C:\\Windows\\System32\\notepad.exe'; $s.Save()`,
      ],
      { windowsHide: true, timeout: 20000 },
    );
    const guarded = entry.remove({ app });
    check('不删别人的 Codex.lnk', guarded.removed.length === 0 && fs.existsSync(foreign), foreign);
  } catch (error) {
    check('未抛异常', false, error && error.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[check:entry] ${results.length - failed.length}/${results.length} 通过，临时目录 ${tmp}`);
  app.exit(failed.length ? 1 : 0);
});
