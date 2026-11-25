# 参与贡献

感谢你愿意改进这个项目。它是一个体积很小的 Electron 应用，几十分钟就能读懂全貌。

## 本地开发

```bash
npm install
npm run dev      # 改代码自动重建 + 重启应用
npm test         # 20 个单元测试，不需要图形界面
npm run pack     # 产出未打包的 release/win-unpacked/
```

- `src/main/` 主进程：窗口、设置、主题加载、IPC、唤起客户端。
- `src/preload/` 唯一的桥接层，新增能力必须在这里逐个登记。
- `src/renderer/js/` 渲染层：`splash/` 开屏与过渡、`workbench/` 工作台、`calibration/` 校准面板。
- `src/shared/` 纯函数（几何、校验、对比度），**必须能被 `node --test` 直接测试**。
- `assets/media/` 素材与主题配置（改视频前请读 `MEDIA_NOTICE.md`）。

## 约定

1. **不要引入前端框架。** 状态就一个 `core/store.js`，DOM 用模板字符串 + 事件委托，这是刻意的取舍。
2. **几何和颜色计算放进 `src/shared/`**，并补上单元测试 —— 这两块最容易在改窗口尺寸时悄悄坏掉。
3. **新增 IPC 通道**必须：在 `preload.js` 暴露具名方法、在 `ipc.js` 校验参数类型与路径、不要暴露 `ipcRenderer`。
4. **界面文案中文为主**，保持简洁；错误提示要说清「发生了什么 + 下一步怎么做」。
5. 提交前跑 `npm test` 与 `npm run build:renderer`。

## 常见开发环境问题

`npm start` 报 `Cannot read properties of undefined (reading 'setPath')`，说明环境里存在
`ELECTRON_RUN_AS_NODE=1`（部分 IDE / 容器工具链会注入），此时 `electron` 会退化成一个纯 Node 进程。
用 `unset ELECTRON_RUN_AS_NODE`（Windows PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）再启动即可。

`npm install` 卡在 electron 下载时，可以换镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
```

打包时卡在下载 `winCodeSign` 之类的二进制同理：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npm run pack
```

## 提交信息

`feat: …` / `fix: …` / `docs: …` / `refactor: …` / `chore: …`，正文写清动机与影响面。

## 发布

维护者执行：

```bash
npm version patch        # 或 minor / major
git push --follow-tags
```

打上 `v*` tag 后，GitHub Actions 会在 windows-latest 上构建便携版与安装版，并把
`SHA256SUMS.txt` 附到 Release 上。`electron-builder.yml` 里 `publish.releaseType` 目前是
`release`（打 tag 即对公众可见）；想先自己验一遍再发，把它改成 `draft` 即可。
