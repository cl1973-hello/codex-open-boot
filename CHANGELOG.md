# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-11-25

**这一版换掉了整个思路。** 1.0 是一个「自己的窗口 + 自己的工作台」，看完动画后你在一个长得像 Codex 的界面里工作 —— 那不是 Codex。2.0 交出去的，就是真正的 Codex 窗口本身。

### 变更

- **产品形态**：从「独立启动器」改为「Codex 的开屏动画 + Codex 的主题」。开屏放完，浮在上面的是真实 Codex 窗口；主题也注入在真实 Codex 界面里。没有第二个应用，因为根本没有第二个界面。
- **过渡方式**：从「在自己的窗口里缩放一个假工作台」改为「按视频关键帧逐帧 `SetWindowPos` 真实的 Codex 窗口」。Codex 在开屏窗**下面**同步长大，交接瞬间既没有黑闪也没有白闪，也没有重新加载。
- **主题落点**：从「给自己的 UI 换肤」改为「通过 CDP 注入 Codex 的语义 CSS 变量」。不修改、不重打包、不替换 `app.asar` 一个字节。
- **入口**：新增「Codex」桌面 / 开始菜单快捷方式接管。双击 Codex 就等于「开屏动画 → 主题化 Codex」，而不是先打开本程序再点一下。
- **窗口收尾**：动画结束时把 Codex 窗口铺满工作区（可选保留入场尺寸），`HWND_NOTOPMOST`，焦点交给 Codex，开屏窗 240ms 淡出后销毁，本程序驻留托盘。

### 新增

- `src/main/boot.js` 开屏主流程状态机（`idle → running → done/failed`），含入场时刻动态计算、断点窗口尺寸还原、开屏页自检。
- `src/main/win32.js`：用 koffi 绑定 `user32` / `dwmapi`，读取窗口矩形与 `WM_GETMINMAXINFO` 下限，`SetWindowPos` 逐帧摆真实窗口；进程级 `SetProcessDpiAwarenessContext(-4)` 拿物理坐标。
- `src/main/cdp.js`：CDP 客户端 + 主题注入器，含 `frameNavigated` / `loadEventFired` 后的事件重注入（`addScriptToEvaluateOnNewDocument` 在 `app://` 页面上刷新后不执行）。
- `src/main/entry.js`：创建 / 移除指向本程序的 `Codex.lnk`，优先使用 Codex 官方图标，已存在的非本程序快捷方式先备份为 `.cob-backup`。
- `src/main/tray.js`：托盘菜单（重播开屏 / 恢复 Codex 窗口尺寸 / 设置 / 创建或移除快捷方式 / 打开日志 / 打开数据目录 / 退出）。
- `src/main/probe.js` + `npm run probe`：端到端取证。跑一次完整开屏，输出入场时间、入场矩形、尾段时长、主题注入页面数，以及视频矩形在渲染层与主进程两侧算出的偏差（验收要求 ≤2px，实测 0.0px）。
- 首次运行问一次「要不要接管桌面 / 开始菜单的 Codex 入口」，答完就记住（`ui.entryAskedAt`），不再纠缠；已经指向本程序的快捷方式会跳过询问。
- `npm run check:entry`：把桌面与 `appData` 重定向到临时目录，真建一遍 `Codex.lnk` 并验证图标提取、目标读回、删除保护 —— 不动用户自己的桌面。
- 设置面板重写（`panel.html` / `panel.js` / `panel.css`）：三套皮肤、背景图（不透明度 / 模糊 / 遮罩 / 暗角）、开屏音量、入场后慢放、结束时窗口大小。改动 160ms 防抖后即时推给已打开的 Codex，不需要重启。
- 背景图通过 `data:` URL 注入（Codex 的 CSP 里 `img-src` 没有 `file:`），图片以 sha1 命名复制进用户数据目录。
- `COB_DEBUG_PORT=9333` 可开本程序自身的 CDP，用 Chrome 调试开屏页。

### 移除

- 三栏工作台（首页 / 项目 / 工具 / 关于）与 `src/renderer/js/workbench/`。
- 关键帧校准面板与 `src/renderer/js/calibration/`。
- `src/renderer/js/core/`、`src/renderer/js/app.js`、`src/renderer/app.bundle.js`。
- `src/renderer/styles/{workbench,calibration,stage,tokens}.css`。
- `src/main/launcher.js`（改为 `launch.js`）与 `src/main/theme-store.js`（并入 `theme.js`）。
- 首次启动引导、演示动图生成（`scripts/capture-demo.mjs`、`scripts/detect-portal.mjs`、`ffmpeg-static` 依赖）。
- 依赖 `ffmpeg-static`（GPL-3.0），现在没有任何 GPL 代码参与构建。

### 修复 / 踩坑记录

- Codex 有单实例锁：第二次带 `--remote-debugging-port` 启动，参数会被丢弃、端口不会开。因此必须先让 Codex 完全退出再带 5 个调试参数启动；已由本工具启动过的实例直接接管，不重启。
- Codex 会重置 `<html>` 上的 `data-*`，所以标记同时放在 `<style id="cob-theme">`、`window.__cobApply` 上，并挂 `MutationObserver`。
- 只替换变量不够：Codex 靠 `<html data-theme="light|dark">` + `light-dark()` 选调色板，不把 `data-theme` 掰到皮肤那一侧，侧栏和输入框会保持浅色（浅底浅字）。
- 页面外框 `div[data-app-shell-frame]` 的 `background-image` 是写死的 `linear-gradient()`，不是语义 token，必须单独接管，否则主内容区永远是中性灰。
- Electron 按 DIP 建窗口、Chromium 按取整后的 `devicePixelRatio` 绘制，两者相差约 1%。窗口定位改用「渲染层认为的物理视口」，两侧矩形偏差从 27.4px 降到 0.0px。
- koffi 3.x 的函数签名必须写 `koffi.struct()` 的注册名（`COB_RECT`），写本地变量名会 `Unknown or invalid type name`；`koffi.node` 必须在 `asarUnpack` 里，否则打包版启动即崩。
- `npm run probe` 之前其实跑不起来：根目录少算一层导致 `spawn EINVAL`，日志又按字节切片（中文被切坏）导致结果全是 `null`。两处都已修，现在能稳定输出可核对的数据。
- 探针的整屏截图会卡住主进程约 2 秒，恰好压在入场那一帧上，导致测出来的尾段被停帧兜底压成 400ms —— 看起来像产品卡顿，其实是取证自己造成的。截图改成 `COB_PROBE_SHOTS=1` 才开，默认只取数值。修完实测尾段 709ms（自然时长）、全程 14.2s。
- 视频末尾解码器会提前停止送帧，`requestVideoFrameCallback` 不再回调，主进程只能等停帧兜底。开屏页补了 `ended` + 播放头定时补报，尾段按自然时长收，不再被压短。

### 工程

- Electron 45 + 原生 DOM + esbuild 单文件打包，无前端框架。
- 39 个单元测试（`node --test`）：几何插值、归一化矩形、入场时刻、token 生成、设置校验与 v1 → v2 迁移。
- 设置 schema 升到 v2：旧的 `recentProjects` / `bounds` / `codexAppId` 在读入时被丢弃，v1 里被算成极小值的 `scrim` / `panelAlpha` 重设为默认。
- GitHub Actions 增加两条打包完整性检查：`app.asar.unpacked` 里必须有 `koffi.node`；`app.asar` 内必须含两个 bundle 与 `panel.html`。

### 已知限制（不是「暂未实现」）

1. 只支持 Windows + 微软商店版 Codex（靠 `Get-AppxPackage OpenAI.Codex` 与执行别名）。
2. 会重启已经开着的 Codex（单实例锁决定了这件事，见上）。
3. 入场不能早于视频第 ~9.2 秒：Codex 窗口有 `WM_GETMINMAXINFO` 定下的 793×991 **物理像素**最小尺寸，改不掉；视频里那块矩形必须长到足够大才放得下窗口。
4. 只换皮，不改布局：只覆盖颜色、背景、透明度，不移动按钮、不改字号、不重排面板。

## [1.0.0] - 2026-11-25

### 新增

- 开屏动画：播放 10 秒原生视频，`Esc` 或「跳过」随时结束。
- 无缝过渡：工作台 UI 始终待在这块矩形「屏幕」里，随视频关键帧一起放大，最后 620ms 收尾铺满窗口。
- 三栏工作台：首页（时钟 / 启动 Codex / 最近项目）、项目、工具、关于。
- 三套主题皮肤（星河 / 石墨 / 晨光），切换带 220ms 颜色过渡，浅色皮肤单独校正阴影与玻璃层。
- 背景系统：内置静帧 / 自选图片 / 无背景；透明度 0–100%、模糊 0–40px、遮罩与暗角实时可调。
- 可读性守卫：背景过亮时自动加深遮罩，保证正文对比度不低于 WCAG AA 4.5:1，并说明调整原因。
- 动画校准面板：拖动矩形与时间轴关键帧，`Ctrl+Shift+C` 打开，保存后写入用户数据目录。
- 一键唤起真实 Codex 客户端（`shell:AppsFolder` 应用标识，可自行修改 AppID）。
- 设置持久化到 `%APPDATA%\CodexOpenBoot`，窗口位置与尺寸自动记忆。
- 首次启动引导，三步说明换肤 / 换背景 / 启动客户端。

### 工程

- Electron 45 + 原生 DOM，无前端框架；渲染层用 esbuild 打包为单文件。
- 主进程 `contextIsolation` + `sandbox`，preload 仅暴露具名方法。
- 20 个单元测试覆盖几何插值、配置校验、对比度算法。
- GitHub Actions：打 tag 自动产出便携版与安装版，并生成 `SHA256SUMS.txt`。
