# M0 可行性打点报告

> 环境：Windows 11 22621 / 2560×1368 物理 @150% 缩放 / Codex `26.1120.5083.0`
> 所有结论都来自本机实测，脚本在 `scripts/m0/`，原始数据在 `.m0/*.json`。

## 闸门结论

| Gate | 内容 | 结果 | 数字 |
| --- | --- | --- | --- |
| G1 | 带 `--remote-debugging-port=0` 启动并 attach | **PASS** | 端口文件出现在 `%APPDATA%\Codex\web\chatgpt-desktop\DevToolsActivePort`，page target `app://-/index.html` |
| G2 | 逐帧缩放真实窗口 | **PASS（但入场必须延后）** | 最小尺寸 793×991 物理 / 529×661 DIP，不可突破 |
| G3 | 主题靠语义 token 注入 | **PASS** | 83 个 `--app-color-*` / `--codex-theme-*`，`:root` / `body` / `#root` 全透明 |

## M0-A 包解析 — PASS

- `OpenAI.Codex_26.1120.5083.0_x64__2p2nqsd0c76g0`，InstallLocation 可读
- AUMID `OpenAI.Codex_2p2nqsd0c76g0!App`
- 执行别名 `chatgpt-desktop.exe`：**`fs.existsSync` 返回 false，必须用 `lstatSync`**（AppX 重解析点）
- 官方图标 `app\resources\chatgpt-app-{dark,light}.ico` 存在

## M0-B CDP — PASS（走端口，不走 pipe）

实测流程：
1. 别名 `chatgpt-desktop.exe` + 5 个参数启动成功，**登录态保留**（页面直接是用户自己的项目列表）
2. 端口文件在 `%APPDATA%\Codex\web\<profile>\DevToolsActivePort`，**不在** `%APPDATA%\Codex\DevToolsActivePort`
3. profile 目录名由**启动入口**决定：别名 → `web\chatgpt-desktop`（新建），Store 激活 → `web\Codex`；两者并存，互不干扰
4. targets：`page`(`app://-/index.html`) + `webview`(auth) + `iframe` + `worker`

**单实例**：已有实例时再带参启动，参数被丢弃、不开端口（b1-port 直接拒绝启动）。必须先退干净。

## M0-C 窗口控制 — PASS，但有两个硬约束

| 项 | 实测 |
| --- | --- |
| 边框补偿 | `DWM 扩展边框 == GetWindowRect`，**dx=dy=dr=db=0**（无边框窗口，无需补偿） |
| DPI | 144 (1.5x)，Node 需 `SetProcessDpiAwarenessContext(-4)` 才拿到物理坐标 |
| `ptMinTrackSize` | **793 × 991 物理 = 529 × 661 DIP** |
| `ptMaxTrackSize` | 0×0（不限） |
| `SetWindowPos(400,300)` | 实测 793×991 — **被钳制** |
| 去掉 `WS_THICKFRAME` 再缩 | 仍钳到 793×991 — **Chromium 层硬约束，无解** |
| 180 帧调用 | 总 6ms，p50 0.01ms，p95 **0.15ms**（ASYNCWINDOWPOS，我们不是瓶颈） |
| topmost + NOACTIVATE | 前台窗口不变 — **不抢焦点** |
| 最大化窗口直接 SetWindowPos | 无效，必须先 `SW_RESTORE` |

### 最小尺寸下 Codex 自己的表现
压到 481×601 CSS px 后截图（`.m0/c2-min.png`）：图标化侧边栏、内容居中、输入框固定在底部，**版式不崩**。说明缩放真实窗口在视觉上成立。

### 与视频矩形的冲突（关键）
视频里的矩形是**宽 2:1**，而窗口最小尺寸是**高 0.8:1**，两者长宽比不兼容。按当前 `zoom: 1.33`、窗口 1707×912 DIP 计算：

| 时间 | 矩形 (DIP) | 高度够 661 吗 |
| --- | --- | --- |
| 6.8s | 842×387 | 差 274 |
| 8.4s | 1195×589 | 差 72 |
| 9.2s | 1328×658 | 差 3 |
| 9.6s | 1381×684 | 够 |
| 9.9s | 1406×697 | 够 |

→ **真实窗口最早只能在 ~9.3s 入场**，之后 0.6s 跟随视频长大 + 尾段铺满。
→ 提高 `theme.json` 的 `zoom` 可以让矩形整体变大、入场提前（1.41 → 约 7.6s，再大会裁掉更多画面）。代码里按「rect ≥ minTrack 的第一帧」动态算，不写死时间。

## M0-D 主题注入 — PASS，但持久化方式必须改

| 项 | 实测 |
| --- | --- |
| 内联 `<style>` 是否被 CSP 拦 | 不拦（`style-src 'unsafe-inline'`），`--m0-test` 生效 |
| `Page.addScriptToEvaluateOnNewDocument` | **刷新后不执行**（window 与 style 都没了），不可依赖 |
| 浏览器级 `Target.setAutoAttach` | 刷新不产生新 page target，收不到 attach 事件，同样救不了 |
| **导航事件 + 重试重注入** | **PASS**：`frameNavigated` → `domContentEventFired` → `loadEventFired`，重试 6×300ms 内必中 |
| `data-*` 挂在 `<html>` | **会被应用重置**，标记只能挂在 `<style>` 元素 + window 属性 |
| token 数量 | 83（`--app-color-*` 34 个 background 系列 + `--codex-theme-*` 6 个等） |
| 明暗 | `<html data-theme="light">`，token 用 `light-dark()`；覆盖时给具体色值即可，并设 `color-scheme` |
| 背景层可行性 | `body`/`#root` 计算背景为 `rgba(0,0,0,0)`；真正不透明的是 `main`（`bg rgb(255,255,255)`）和几个白色面板，都由 token 驱动 → 覆盖为半透明即可透出背景图 |

## 对实施计划的三处修正

1. **§5.1 边框补偿可以删掉**：Codex 是无边框窗口，`GetWindowRect == DWM 扩展边框`，误差 0。
2. **M1 增加「动态入场时间」**：`entryT = 第一帧 rect ≥ minTrack 的时间`，并在入场前 0.2s 预先把窗口摆好（隐藏），避免首帧跳变。
3. **M2 的注入改为「事件驱动重注入」**：`frameNavigated` + `loadEventFired` + 1s 心跳兜底，每次重试 6 次；不依赖 `addScriptToEvaluateOnNewDocument`。

## 未验证（不阻塞）

- `--remote-debugging-pipe`（端口方案已够用，pipe 作为「高安全模式」留待以后）
- 多显示器 / 混合 DPI 的坐标换算（本机只有一个 150% 缩放的主屏）
- DWM 缩略图降级路径（当前不需要）
