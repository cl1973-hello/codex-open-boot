# 第三方与致谢 / Third-party notices

## 设计参考

本项目的「归一化关键帧矩形 → 真实窗口坐标」几何模型、配置集中校验的思路，以及用
`shell:AppsFolder\<PackageFullName>!<AppId>` 唤起客户端（而不是硬编码带版本号的可执行文件路径）的做法，
参考了下面两个 MIT 许可的开源项目：

- [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot)
- [knight458687810-code/dragon-codex-boot-enhanced](https://github.com/knight458687810-code/dragon-codex-boot-enhanced)

**本仓库没有复制上述项目的源代码。** 所有实现（Electron 主进程、逐帧窗口缩放、CDP 注入、
设置面板、几何与校验模块）均为独立编写；此处仅致谢其思路与文档。它们在实现上走的是另一条路
（DWM 缩略图 + 自己的 WPF 容器），2.0 起本项目既不嵌入窗口也不修改 Codex 的任何文件。

```
MIT License

Copyright (c) 2024 dragon-codex-boot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 运行时依赖

| 依赖 | 许可证 | 用途 |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | MIT | 桌面运行时（Chromium + Node） |
| [koffi](https://koffi.dev/) | MIT | 调用 `user32` / `dwmapi`（`GetWindowRect`、`GetWindowLongPtr`、`SetWindowPos` 等），无需编译步骤 |

koffi 是 NAPI 预编译包，源码里只 import 它的 JS 入口；`koffi.node` 会随安装包一起分发，
并在 `app.asar.unpacked` 里解包（`electron-builder.yml` 的 `asarUnpack`），因为它不能在 asar 内加载。

```
MIT License

Copyright (C) 2026  Niels Martignène <niels.martignene@protonmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 构建期依赖（不随成品分发）

| 依赖 | 许可证 | 用途 |
| --- | --- | --- |
| [esbuild](https://esbuild.github.io/) | MIT | 把开屏页与设置面板打包成单文件 |
| [electron-builder](https://www.electron.build/) | MIT | 产出 portable / nsis 安装包 |

`electron-builder.yml` 的 `files` 白名单只包含 `src/` 下运行期必需的文件与 `package.json`，
devDependencies 不会进入成品。2.0 移除了旧的演示动图生成流程，因此**不再包含任何 GPL 依赖**
（此前仅在开发期使用的 `ffmpeg-static` 已删除）。

## 商标

Codex / ChatGPT 是 OpenAI 的商标与产品。本项目与 OpenAI 无任何关联，也不分发其任何程序文件；
只读取本机已安装客户端的包信息与窗口句柄。
