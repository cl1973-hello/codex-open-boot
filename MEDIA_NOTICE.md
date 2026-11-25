# 素材说明 / Media Notice

本仓库的**代码**采用 MIT 许可证；`assets/media/` 下的**素材**不在 MIT 覆盖范围内。

The **code** in this repository is MIT licensed. The **media** in `assets/media/` is not.

## 包含哪些文件

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `assets/media/video.mp4` | 10 秒开屏动画（1280×720，H.264 + AAC） | 项目作者自备素材，仅用于演示 |
| `assets/media/poster.png` / `hold.png` | 视频静帧，用于首屏垫底与内置背景 | 同上 |
| `assets/media/theme.json` | 关键帧时间轴（归一化矩形，可被校准面板覆盖） | 本项目原创数据 |
| `assets/media/skins.json` | 三套配色的颜色值 | 本项目原创数据 |

## 请务必注意

1. **不要把这些素材当作可自由商用的资源。** 视频与静帧仅用于让默认体验开箱可用；如果你要分发、商用或在公开项目里使用，请先确认素材权利，或替换为你自己的素材。
2. **替换方式**：把你的 MP4（H.264 + AAC）命名为 `video.mp4` 放进 `assets/media/`，然后在工作台里打开「工具 → 校准动画」，重新对齐关键帧并保存。
3. **`theme.json` 与 `skins.json` 是本项目的原创配置**，可以随意修改、分发。
4. 本项目不包含、也不分发任何 OpenAI / Codex 官方资源（图标、程序包、界面截图）。

## Replacing the media (English)

Drop your own `video.mp4` (H.264 + AAC) into `assets/media/`, then open **Tools → Calibrate
animation** inside the workbench, align the rectangle with the screen in your footage and
press Save. The calibration is stored in your user data folder, not in the repository.
