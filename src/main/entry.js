'use strict';

/**
 * 快捷方式接管：在桌面和开始菜单放一个叫「Codex」的 .lnk，指向本程序。
 *
 * 这是「双击 Codex 就走开屏」的唯一实现方式 —— MSIX 的 ChatGPT.exe 是执行别名，
 * 既不能改它的参数，也没有官方 .lnk 可以改（M0 实测：桌面/开始菜单/任务栏都没有）。
 * 所以只能自己建一个同名入口，接管用户的点击习惯。
 *
 * 图标从 Codex 自己的 ChatGPT.exe 里提取，看起来和官方一致。
 * 卸载时只删「目标确实是我们」的那些，不碰用户自己的快捷方式。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./logger');
const appx = require('./appx');

const LINK_NAME = 'Codex.lnk';

const CREATE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($env:COB_LNK)
$s.TargetPath = $env:COB_EXE
if ($env:COB_ARGS) { $s.Arguments = $env:COB_ARGS } else { $s.Arguments = '' }
$s.WorkingDirectory = $env:COB_WD
if ($env:COB_ICON) { $s.IconLocation = $env:COB_ICON }
$s.Description = 'Codex'
$s.Save()
`.trim();

const READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sh = New-Object -ComObject WScript.Shell
if (-not (Test-Path -LiteralPath $env:COB_LNK)) { '' } else { $sh.CreateShortcut($env:COB_LNK).TargetPath }
`.trim();

const ICON_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:COB_SRC)
if (-not $icon) { throw 'no icon' }
$fs = [System.IO.File]::Create($env:COB_DST)
$icon.Save($fs)
$fs.Close()
`.trim();

function ps(script, env) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  }).trim();
}

/** 我们自己的可执行文件 + 启动参数 */
function selfTarget(app) {
  if (app.isPackaged) return { exe: process.execPath, args: '', cwd: path.dirname(process.execPath) };
  return { exe: process.execPath, args: `"${app.getAppPath()}"`, cwd: app.getAppPath() };
}

/** 快捷方式该放的位置 */
function linkPaths(app) {
  const desktop = path.join(app.getPath('desktop'), LINK_NAME);
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const startMenu = path.join(programs, LINK_NAME);
  return { desktop, startMenu, programs };
}

/** Codex 官方图标 -> userData\codex.ico */
function ensureIcon(app, target) {
  const dst = path.join(app.getPath('userData'), 'codex.ico');
  try {
    if (fs.existsSync(dst) && fs.statSync(dst).size > 512) return dst;
  } catch {
    /* 重新生成 */
  }

  const candidates = [];
  let pkg = null;
  try {
    pkg = appx.info();
  } catch {
    /* 包信息拿不到就用自己的图标 */
  }

  // 包里自带 .ico 最好，直接复制
  if (pkg && pkg.icon && fs.existsSync(pkg.icon)) {
    try {
      fs.copyFileSync(pkg.icon, dst);
      if (fs.statSync(dst).size > 512) {
        logger.info(`快捷方式图标取自 ${pkg.icon}`);
        return dst;
      }
    } catch {
      /* 继续尝试提取 */
    }
  }

  if (pkg) {
    for (const name of [pkg.exe, path.join(pkg.appDir, 'ChatGPT.exe')]) {
      if (name) candidates.push(name);
    }
  }

  for (const source of candidates) {
    try {
      if (!fs.existsSync(source)) continue;
      ps(ICON_SCRIPT, { COB_SRC: source, COB_DST: dst });
      if (fs.statSync(dst).size > 512) {
        logger.info(`快捷方式图标取自 ${source}`);
        return dst;
      }
    } catch {
      /* 试下一个 */
    }
  }

  // 最后兜底：打包时会把 build/icon.ico 放到 resources/codex.ico
  const candidates2 = [
    path.join(process.resourcesPath || '', 'codex.ico'),
    path.join(target.cwd, 'build', 'icon.ico'),
  ];
  for (const own of candidates2) {
    try {
      if (own && fs.existsSync(own) && fs.statSync(own).size > 512) {
        fs.copyFileSync(own, dst);
        return dst;
      }
    } catch {
      /* 试下一个 */
    }
  }
  return '';
}

function readTarget(lnk) {
  try {
    if (!fs.existsSync(lnk)) return null;
    return ps(READ_SCRIPT, { COB_LNK: lnk }) || null;
  } catch {
    return null;
  }
}

function status({ app }) {
  const paths = linkPaths(app);
  const self = selfTarget(app);
  const same = (p) => {
    const value = p ? path.resolve(p).toLowerCase() : '';
    return !!value && value === path.resolve(self.exe).toLowerCase();
  };
  return {
    linkName: LINK_NAME,
    self: self.exe,
    desktop: { path: paths.desktop, exists: fs.existsSync(paths.desktop), target: readTarget(paths.desktop) },
    startMenu: { path: paths.startMenu, exists: fs.existsSync(paths.startMenu), target: readTarget(paths.startMenu) },
    ownsDesktop: same(readTarget(paths.desktop)),
    ownsStartMenu: same(readTarget(paths.startMenu)),
  };
}

function install({ app }) {
  const paths = linkPaths(app);
  const self = selfTarget(app);
  const icon = ensureIcon(app, self);
  const created = [];

  // 已经存在但不是我们的：先备份，别把用户原来的入口弄没了
  for (const lnk of [paths.desktop, paths.startMenu]) {
    const existing = readTarget(lnk);
    if (existing && path.resolve(existing).toLowerCase() !== path.resolve(self.exe).toLowerCase()) {
      try {
        fs.copyFileSync(lnk, `${lnk}.cob-backup`);
        logger.warn(`备份了用户已有的 ${path.basename(lnk)} -> ${path.basename(lnk)}.cob-backup`);
      } catch {
        /* 备份失败也继续 */
      }
    }
  }

  try {
    fs.mkdirSync(paths.programs, { recursive: true });
  } catch {
    /* ignore */
  }

  for (const lnk of [paths.desktop, paths.startMenu]) {
    try {
      ps(CREATE_SCRIPT, {
        COB_LNK: lnk,
        COB_EXE: self.exe,
        COB_ARGS: self.args,
        COB_WD: self.cwd,
        COB_ICON: icon ? `${icon},0` : '',
      });
      created.push(lnk);
    } catch (error) {
      logger.warn(`创建快捷方式失败 ${lnk}: ${error.message}`);
    }
  }

  return {
    ok: created.length > 0,
    created,
    icon,
    status: status({ app }),
    reason: created.length ? null : '创建失败（可能被安全软件拦截）',
  };
}

function remove({ app }) {
  const paths = linkPaths(app);
  const self = selfTarget(app);
  const removed = [];

  for (const lnk of [paths.desktop, paths.startMenu]) {
    const target = readTarget(lnk);
    if (!target) continue;
    if (path.resolve(target).toLowerCase() !== path.resolve(self.exe).toLowerCase()) continue;
    try {
      fs.unlinkSync(lnk);
      removed.push(lnk);
    } catch (error) {
      logger.warn(`删除快捷方式失败 ${lnk}: ${error.message}`);
    }
  }

  return { ok: true, removed, status: status({ app }) };
}

module.exports = { status, install, remove, linkPaths, selfTarget, LINK_NAME };
