# 素材说明 / Media Notice

本仓库的**代码**采用 MIT 许可证；`assets/media/` 下的**素材**不在 MIT 覆盖范围内。

The **code** in this repository is MIT licensed. The **media** in `assets/media/` is not.

## 包含哪些文件

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `assets/media/video.mp4` | 10 秒开屏动画（1280×720，H.264 + AAC） | 项目作者自备素材，仅用于演示 |
| `assets/media/poster.png` | 视频首帧，用于开屏窗出现前垫底，避免视频接上时闪一下 | 同上 |
| `assets/media/hold.png` | 视频尾段静帧，用于动画结束、窗口交接时垫住背景 | 同上 |
| `assets/media/theme.json` | 关键帧时间轴（归一化矩形 + 入场参数） | 本项目原创数据 |
| `assets/media/skins.json` | 三套配色的颜色值 | 本项目原创数据 |

## 请务必注意

1. **不要把这些素材当作可自由商用的资源。** 视频与静帧仅用于让默认体验开箱可用；如果你要分发、商用或在公开项目里使用，请先确认素材权利，或替换为你自己的素材。
2. **替换方式**：把你的 MP4（H.264 + AAC）命名为 `video.mp4` 放进 `assets/media/`，改好同目录的 `theme.json`（重点是把 `screenFrames` 对齐到画面里那块矩形），或者直接把这两个文件放进 `%APPDATA%\CodexOpenBoot\` 覆盖内置素材 —— 后者不用重新打包。
3. **`screenFrames` 有硬下限**：Codex 窗口最小 793×991 物理像素，视频里那块矩形必须能装下它，否则入场会退化成「直接铺满」。`theme.json` 里的 `zoom` 调大会让矩形整体变大、入场提前，但边缘会被裁掉更多。
4. **`theme.json` 与 `skins.json` 是本项目的原创配置**，可以随意修改、分发。
5. 本项目不包含、也不分发任何 OpenAI / Codex 官方资源（图标、程序包、界面截图）。

## Replacing the media (English)

Drop your own `video.mp4` (H.264 + AAC) into `assets/media/` and align `screenFrames` in
`theme.json` with the rectangle in your footage — one normalised rect every 100 ms, linearly
interpolated. `zoom` > 1 crops the video's letterboxing.

You can also place `theme.json` and the video into `%APPDATA%\CodexOpenBoot\` to override the
bundled media without repacking. Media is served from `resources/media` (outside the asar) so
that `<video>` can seek normally.
