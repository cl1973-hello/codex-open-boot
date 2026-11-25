# 参与贡献

感谢你愿意改进这个项目。它体积不大，但「为什么这么写」全都来自实测，改之前建议先读
[`.m0/M0-REPORT.md`](.m0/M0-REPORT.md) —— 那里记录了 Codex 侧的几个硬约束。

## 本地开发

```bash
npm install
npm run dev          # 改渲染层自动重编译，改主进程自动重启
npm test             # 39 个单元测试，不需要图形界面
npm run probe        # 端到端跑一次开屏并输出可核对的数据
npm run check:entry  # 在临时目录里真建一遍 Codex.lnk（不动你的桌面），验图标/读回/删除
npm run pack         # 产出未打包的目录
```

- `src/main/` 主进程：开屏状态机、逐帧摆窗口、CDP 注入、启动 Codex、托盘、快捷方式。
- `src/preload/` 唯一的桥接层，新增能力必须在这里逐个登记具名方法。
- `src/renderer/` 两个页面：`index.html`（开屏，播放视频并按帧上报矩形）、`panel.html`（设置面板）。
- `src/shared/` 纯函数（几何、归一化矩形、入场时刻、token 生成、设置校验），**必须能被 `node --test` 直接测试**。
- `assets/media/` 素材与主题配置（改视频前请读 `MEDIA_NOTICE.md`）。
- `scripts/m0/` M0 阶段的一次性取证脚本，保留下来是因为报告里的数字都出自它们。

## 约定

1. **不要引入前端框架。** 开屏页只有三个 DOM 节点，面板是手写模板字符串 —— 这是刻意的取舍。
2. **几何、矩形、token 生成放进 `src/shared/`**，并补单元测试 —— 这几块最容易在改窗口尺寸时悄悄坏掉。
3. **新增 IPC 通道**必须：在 `preload.js` 暴露具名方法、在 `ipc.js` 校验参数类型与路径、不要暴露 `ipcRenderer`。
4. **绝不碰 Codex 的哈希类名。** 只覆盖 CSS 变量；也不能修改、重打包、替换 `app.asar` 里任何文件。
5. **新增注入标记要能被 Codex 重置后恢复。** `<html>` 上的属性会被应用清掉，标记请放在 `<style id="cob-theme">` 或 `window` 上，并在 MutationObserver 里重设。
6. **界面文案中文为主**，保持简洁；错误提示要说清「发生了什么 + 下一步怎么做」。
7. 提交前跑 `npm test` 与 `npm run build:renderer`；动了时间轴 / 窗口相关的逻辑，再跑一次 `npm run probe`，确认两侧矩形偏差仍是 0.0px。

## 常见开发环境问题

`npm start` 报 `Cannot read properties of undefined (reading 'setPath')`，说明环境里存在
`ELECTRON_RUN_AS_NODE=1`（部分 IDE / 容器工具链会注入），此时 `electron` 会退化成一个纯 Node 进程。
用 `unset ELECTRON_RUN_AS_NODE`（Windows PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）再启动即可。

`npm start` 起来后没反应、日志里也没有新行？那是**单实例锁**：已经有一个实例在托盘里。
先退出托盘里的旧实例，或者直接 `--panel` 只开设置面板。

`npm run probe` 卡住不动？它会真的重启一次 Codex 并等开屏跑完（约 13 秒）。若中途 `Esc` 打断，
报告里 `verdict.skipped` 会是 `true`。

`npm install` 卡在 electron 下载时，可以换镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
```

打包时卡在下载 `winCodeSign` 之类的二进制同理：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npm run pack
```

重新打包请**换一个新的输出目录**（`electron-builder.yml` 里的 `directories.output` 或 `--config.directories.output`）。
覆盖正在运行的旧的 `win-unpacked` 会失败，且容易留下半删状态。

调试开屏页：`COB_DEBUG_PORT=9333 npm start`，然后用 Chrome 打开 `http://127.0.0.1:9333`。
主进程侧的坐标换算日志带 `[boot]` / `[animate]` 前缀，`SetWindowPos` 前后各一行。

## 提交信息

`feat: …` / `fix: …` / `docs: …` / `refactor: …` / `chore: …`，正文写清动机与影响面。
修 Codex 兼容性问题时，请把 Codex 版本号写进提交正文。

## 发布

维护者执行：

```bash
npm version patch        # 或 minor / major
git push --follow-tags
```

打上 `v*` tag 后，GitHub Actions 会在 windows-latest 上构建便携版与安装版，并把
`SHA256SUMS.txt` 附到 Release 上。CI 还会检查两件事：`app.asar.unpacked` 里必须有 `koffi.node`
（否则启动即崩），`app.asar` 内必须含 `splash.bundle.js` / `panel.bundle.js` / `panel.html`。

`electron-builder.yml` 里 `publish.releaseType` 目前是 `release`（打 tag 即对公众可见）；
想先自己验一遍再发，把它改成 `draft` 即可。
