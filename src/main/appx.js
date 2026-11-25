'use strict';

/**
 * 解析已安装的 Codex 包（MSIX）。
 * 安装目录带版本号，Store 更新会换名，所以每次启动都重新查，只做短缓存。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./logger');

const CACHE_MS = 5 * 60 * 1000;
let cache = null;

function pwsh(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  }).trim();
}

/** AppX 执行别名是重解析点：existsSync 会返回 false，必须用 lstat */
function reparseExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function query() {
  const json = pwsh(
    'Get-AppxPackage -Name OpenAI.Codex | Select-Object Name,Version,PackageFullName,PackageFamilyName,InstallLocation | ConvertTo-Json -Compress',
  );
  if (!json) throw new Error('未检测到已安装的 Codex（OpenAI.Codex）');
  const pkg = JSON.parse(json);
  const appDir = path.join(pkg.InstallLocation, 'app');
  const exe = path.join(appDir, 'ChatGPT.exe');
  const alias = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe');

  let aumid = null;
  try {
    const xml = fs.readFileSync(path.join(pkg.InstallLocation, 'AppxManifest.xml'), 'utf8');
    const m = xml.match(/<Application\s+Id="([^"]+)"[^>]*Executable="app\/ChatGPT\.exe"/i) || xml.match(/<Application\s+Id="([^"]+)"/i);
    if (m) aumid = `${pkg.PackageFamilyName}!${m[1]}`;
  } catch {
    /* manifest 读不到就算了，AUMID 只用于提示 */
  }

  const iconCandidates = ['chatgpt-app-dark.ico', 'chatgpt-app-light.ico'].map((name) => path.join(appDir, 'resources', name));
  const icon = iconCandidates.find((p) => fs.existsSync(p)) || null;

  return {
    at: Date.now(),
    version: pkg.Version,
    fullName: pkg.PackageFullName,
    family: pkg.PackageFamilyName,
    installLocation: pkg.InstallLocation,
    appDir,
    exe,
    exeExists: fs.existsSync(exe),
    alias,
    aliasExists: reparseExists(alias),
    aumid,
    icon,
    userData: path.join(process.env.APPDATA || '', 'Codex'),
  };
}

function info({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  cache = query();
  logger.info(`codex ${cache.version} @ ${cache.installLocation}`);
  return cache;
}

/** 启动目标：优先执行别名（保留包身份），其次直启 exe */
function launchTarget(prefer) {
  const pkg = info();
  if (prefer === 'exe' && pkg.exeExists) return { target: pkg.exe, via: 'exe' };
  if (pkg.aliasExists) return { target: pkg.alias, via: 'alias' };
  if (pkg.exeExists) return { target: pkg.exe, via: 'exe' };
  throw new Error('找不到 Codex 的可执行文件');
}

module.exports = { info, launchTarget, reparseExists };
