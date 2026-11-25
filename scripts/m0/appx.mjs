// M0-A：解析已安装的 Codex 包（只读）。
// 用法：node scripts/m0/appx.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PS = 'powershell.exe';

function ps(script) {
  return execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  }).trim();
}

const json = ps(
  "Get-AppxPackage -Name OpenAI.Codex | Select-Object Name,Version,PackageFullName,PackageFamilyName,InstallLocation | ConvertTo-Json -Compress",
);
const pkg = JSON.parse(json);
const appDir = path.join(pkg.InstallLocation, 'app');
const exe = path.join(appDir, 'ChatGPT.exe');
const alias = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe');
const manifest = path.join(pkg.InstallLocation, 'AppxManifest.xml');
const icons = ['chatgpt-app-dark.ico', 'chatgpt-app-light.ico'].map((n) => ({
  name: n,
  path: path.join(appDir, 'resources', n),
  exists: fs.existsSync(path.join(appDir, 'resources', n)),
}));

// 从清单里取 Application Id 与执行别名，构造 AUMID
let appId = null;
let aliases = [];
if (fs.existsSync(manifest)) {
  const xml = fs.readFileSync(manifest, 'utf8');
  const m = xml.match(/<Application\s+Id="([^"]+)"[^>]*Executable="app\/ChatGPT\.exe"/i) || xml.match(/<Application\s+Id="([^"]+)"/i);
  if (m) appId = `${pkg.PackageFamilyName}!${m[1]}`;
  // 清单里是 <desktop:ExecutionAlias Alias="chatgpt-desktop.exe" />，前缀不固定
  aliases = [...xml.matchAll(/<[A-Za-z0-9:]*ExecutionAlias\s+Alias="([^"]+)"/gi)].map((x) => x[1]);
}

// 执行别名是 AppX 重解析点：existsSync 会返回 false，必须用 lstat
function reparseExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

const userData = path.join(process.env.APPDATA, 'Codex');
const devtoolsFile = path.join(userData, 'DevToolsActivePort');

const result = {
  package: pkg,
  aumid: appId,
  execAliases: aliases,
  paths: {
    appDir,
    exe,
    exeExists: fs.existsSync(exe),
    alias,
    aliasExists: reparseExists(alias),
    manifest,
    userData,
    userDataExists: fs.existsSync(userData),
    devtoolsFile,
    devtoolsFileExists: fs.existsSync(devtoolsFile),
  },
  icons,
  // 顺便报告当前是否已有实例在跑（单实例锁的前置条件）
  running: ps("(Get-Process ChatGPT -ErrorAction SilentlyContinue | Measure-Object).Count"),
};

console.log(JSON.stringify(result, null, 2));

const ok = result.paths.exeExists && result.paths.aliasExists && appId;
console.log(ok ? '\nM0-A: PASS' : '\nM0-A: FAIL（缺 exe / 别名 / AUMID）');
process.exit(ok ? 0 : 1);
