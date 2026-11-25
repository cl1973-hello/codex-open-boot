# 第三方与致谢 / Third-party notices

## 设计参考

本项目的「归一化关键帧矩形 → 窗口坐标」几何模型、配置集中校验的思路、以及用
`shell:AppsFolder\<PackageFamilyName>!<AppId>` 唤起客户端（而不硬编码带版本号的可执行文件路径）的做法，
参考了下面两个 MIT 许可的开源项目：

- [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot)
- [knight458687810-code/dragon-codex-boot-enhanced](https://github.com/knight458687810-code/dragon-codex-boot-enhanced)

**本仓库没有复制上述项目的源代码。** 所有实现（Electron 主进程、渲染层、几何与校验模块、
校准面板）均为独立编写；此处仅致谢其思路与文档。

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
| [esbuild](https://esbuild.github.io/) | MIT | 渲染层打包（仅构建期） |
| [electron-builder](https://www.electron.build/) | MIT | 打包安装程序（仅构建期） |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0 | **仅开发期**生成 README 演示动图，不随成品分发 |

ffmpeg-static 只用于 `npm run demo` 在本机合成 README 里的 GIF，不会被打进安装包。
因为它采用 GPL-3.0，如果你要再分发本项目的构建产物，请确认该依赖没有被一起打包
（默认的 `electron-builder.yml` 只包含 `src/` 与 `assets/media/`，不含 devDependencies）。
