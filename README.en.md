<div align="center">

<img src="docs/shot-splash.png" alt="Codex Open Boot splash screen" width="880" />

# Codex Open Boot

**A splash animation for the real Codex desktop client — plus a theme injected into its UI.**

[![Release](https://img.shields.io/github/v/release/cl1973-hello/codex-open-boot?style=flat-square)](https://github.com/cl1973-hello/codex-open-boot/releases)
[![License](https://img.shields.io/github/license/cl1973-hello/codex-open-boot?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0a7ea4?style=flat-square)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-45-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)

[中文](README.md) · [Download](https://github.com/cl1973-hello/codex-open-boot/releases/latest) · [Hard limits](#five-hard-limits) · [Troubleshooting](#troubleshooting)

</div>

---

## This is not a launcher

1.0 was "my own window, my own workbench" — you watched a splash, then worked inside a Codex-looking UI that was not Codex.

2.0 throws that away. **When the splash ends, what you get is the real Codex window**, and the theme is injected into the real Codex UI. You never see a second app, because there is no second UI.

| What you see | What actually happens |
| --- | --- |
| You click **Codex** in the Start menu (the official tile) | A 400 ms process poll in the tray notices a fresh `ChatGPT.exe` and grabs the screen instantly |
| A 10-second starfield splash | A full-screen frameless window playing `video.mp4` |
| The screen inside the footage "grows" | Every frame issues `SetWindowPos` on the **real** Codex window, following that rectangle |
| The splash fades and the UI is already there | The splash window drops `setOpacity` to 0, then destroys itself; Codex is already laid out underneath |
| The UI turns deep teal | 31 semantic tokens injected as CSS variables over CDP |

Codex is already rendering when the entrance happens — it grows *underneath* the splash window, so the handoff has no black flash, no white flash and no reload.

---

## Five hard limits

These are not "not implemented yet". They are ceilings imposed by the approach itself. Stated up front so you do not waste an evening on them.

**1. Windows + Microsoft Store Codex only.**
The install path comes from `Get-AppxPackage OpenAI.Codex` and the launch goes through the execution alias. Portable builds and other platforms will not work.

**2. Taking over means restarting Codex once.**
Injecting a theme requires `--remote-debugging-port` at launch, and Codex holds a single-instance lock — a second launch's arguments are simply dropped. So after you click the official tile, this tool ends that just-started instance and relaunches it with the flag.
A Codex that was *already* started by this tool (debug port present) is adopted as-is, no restart. And if Codex is already running, clicking the tile only focuses the window — the splash does not replay.

**3. The tray process has to stay alive.**
Detection is that 400 ms poll. Once you pick **Quit** from the tray, clicking the official tile gives you plain Codex — no splash, no theme. This is the one thing worth remembering.

**4. The entrance cannot be earlier than ~9.2 s into the video.**
Codex has a `WM_GETMINMAXINFO` floor of 793×991 **physical pixels**. That cannot be lowered. The rectangle in your footage has to be large enough to hold that window, which at 165% scaling happens at 9.22 s. The number is recomputed on every run (`findEntryTime`) rather than hard-coded, but your video cannot be shorter than it.

**5. Reskin only, no layout changes.**
What gets injected is colours, a background image and transparency — no moved buttons, no resized type, no rearranged panels. Want a different layout? Patch Codex itself.

---

## 30-second setup

1. Open [Releases](https://github.com/cl1973-hello/codex-open-boot/releases/latest) and download the file whose name ends with `-portable.exe`.
2. Run it. It plays the splash once, then drops into the tray — **leave it there**, that tray process is what watches the official entry.
3. From then on, click **Codex** in the Start menu or search exactly as you always have; the splash grabs the screen for you.

> The binary is not code-signed, so Windows will show "Windows protected your PC". Click **More info → Run anyway**.
> It needs no administrator rights and never writes into the Codex install directory.

<img src="docs/shot-panel.png" alt="Settings panel" width="720" />

Tray → **Settings** opens the panel above: three skins, background image (opacity / blur / scrim / vignette), splash volume, post-entrance slow-motion, and what the window does at the end. Changes are pushed to a running Codex immediately — no restart.

---

## How it works

```
Click Codex in the Start menu (the official tile)
   │
   ├─ The 400 ms poll in the tray sees ChatGPT.exe go from "none" to "some" (3 ms to react, measured)
   │
   ├─ Full-screen splash appears instantly (poster underneath, so the video join does not flash)
   │
   ├─ Background: end that just-started instance → relaunch with 5 debug flags → wait for DevToolsActivePort
   │    (the fresh instance has no debug port, so a theme cannot be injected into it)
   │
   ├─ Connect CDP to app://-/index.html, inject <style id="cob-theme">
   │    · 31 --app-color-* / --codex-theme-* semantic tokens
   │    · force <html data-theme> to the skin's side (otherwise panels stay light)
   │    · re-inject on navigation / reload via events + retries
   │
   ├─ Play to 9.2 s; the real window is resized per frame, growing with that "screen"
   │    video time comes from requestVideoFrameCallback, not the wall clock
   │
   ├─ Final 400–1100 ms tween fills the work area, HWND_NOTOPMOST
   │
   └─ Splash fades out in 240 ms → destroyed → focus handed to Codex → app stays in the tray
```

> Why the shortcut cannot just be rewritten: the official Codex is an MSIX **execution alias**
> (`%LOCALAPPDATA%\Microsoft\WindowsApps\chatgpt-desktop.exe`). There is no `.lnk` to edit and no
> way to append launch arguments to it. Hence "see it start → grab the screen → relaunch with our flags".
> The trigger is strictly zero-to-nonzero: subprocesses Codex spawns while running do not count,
> otherwise a window you are actively using would get killed and reopened.

Facts that came out of the M0 spikes (full log in [`.m0/M0-REPORT.md`](.m0/M0-REPORT.md)):

- `Page.addScriptToEvaluateOnNewDocument` **does not run after a reload** on `app://` pages; you need `frameNavigated` / `loadEventFired` plus retries.
- Codex resets `data-*` on `<html>`, so the marker lives on `<style id="cob-theme">` and a `window` property, with a `MutationObserver` to reassert it.
- Codex's CSP has no `file:` in `img-src`, so background images must be data URLs.
- The page shell paints a hard-coded `linear-gradient(#181818 50%)` that is not a semantic token, so it needs its own override.
- Electron sizes windows in DIP while Chromium paints with a rounded `devicePixelRatio` — roughly 1% apart. Window placement therefore uses "the physical viewport the renderer believes in".

---

## Requirements

| | |
| --- | --- |
| OS | Windows 10 1809+ / Windows 11 |
| Codex | Microsoft Store build (MSIX, package name `OpenAI.Codex`) |
| Privileges | Standard user is enough |
| Dependencies | None. No Node, no drivers |
| Display | Verified on a single 2560×1440 @165%; multi-monitor / mixed DPI untested |

---

## Use your own splash video

`assets/media/theme.json` describes the video and the "screen track":

```json
{
  "duration": 10.027,
  "video": "video.mp4",
  "poster": "poster.png",
  "transitionStart": 6.8,
  "transitionEnd": 9.9,
  "fit": "cover",
  "zoom": 1.33,
  "screenFrames": [
    { "time": 6.8, "x": 0.3141, "y": 0.3486, "width": 0.3711, "height": 0.3028 }
  ]
}
```

- `screenFrames` are **normalised** rectangles (0..1 relative to the video frame), one every 100 ms, linearly interpolated.
- `zoom` crops the video's own letterboxing (>1 zooms in, edges get cut).
- Dropping `theme.json` and a video into `%APPDATA%\CodexOpenBoot\` overrides the bundled media without repacking.

---

## Troubleshooting

The log is at `%APPDATA%\CodexOpenBoot\launcher.log` (tray → Open log).

| Symptom | Cause / fix |
| --- | --- |
| Clicking Codex gives no splash | The tray process is not running (you quit it). Start the app again; it drops back to the tray |
| Codex flashes briefly before the splash | Expected: the takeover ends the fresh official instance and relaunches it, ~1.5 s, and the splash is usually already on top |
| Codex restarts on its own while I work | It should not. Send the log — the trigger is zero-to-nonzero only; subprocesses spawned while running are never taken over |
| The UI is still light | Codex was not started by this tool. Tray → Replay splash |
| Sidebar / input colours unchanged | A Codex update changed the tokens. Run `npm run probe` and read the injection result |
| Window is tiny after the splash | The previous run was killed mid-animation. Restored automatically next launch, or tray → Restore Codex window |
| Blocked by security software | Whitelist it, or use the `--setup.exe` installer |

**`npm run probe`** runs one complete splash and prints something you can check: entrance time, entrance rect, tail duration, number of injected pages, and the delta between the video rectangle as computed by the renderer and by the main process (acceptance requires ≤2 px; measured 0.0 px). Written to `.probe/report.json`.

To debug the renderer: `COB_DEBUG_PORT=9333 npm start`, then open `http://127.0.0.1:9333` in Chrome to inspect the splash page.

---

## Development

```bash
npm install
npm start            # build renderer + launch (this restarts Codex once)
npm run dev          # rebuild renderer / restart main on change
npm test             # pure-function tests: geometry, rects, token generation, settings clamping
npm run probe        # end-to-end measurement
npm run check:entry  # really creates a Codex.lnk, but in a temp folder (your desktop is untouched)
npm run pack         # unpacked directory
npm run dist         # portable + nsis installer
```

Layout:

```
src/main/         Main process
  boot.js         Splash state machine (idle → running → done/failed)
  animate.js      Resize the real window per video frame
  win32.js        koffi bindings to user32/dwmapi (read window info + SetWindowPos)
  cdp.js          CDP client + theme injector
  launch.js       Launch Codex, find the debug port, quit stale instances
  theme.js        Settings + skins + background → CSS for injection
  watcher.js      Official-entry detection (400 ms poll, zero-to-nonzero only)
  processes.js    koffi process enumeration (~3.6 ms per full sweep)
  entry.js        Detecting / cleaning up legacy .lnk files (2.1 creates none)
  tray.js         Tray menu
src/shared/       Pure functions (unit tested, shared by main and renderer)
  portal.js       Normalised rect → pixel rect, entrance time
  theme-css.js    Builds the stylesheet injected into Codex
  geometry.js     Geometry primitives
src/renderer/     Splash page + settings panel
test/             node:test
.m0/              M0 spike scripts and findings
```

### What it deliberately does not do

- Never patches, repacks or replaces any Codex file (`app.asar` is untouched, byte for byte).
- Never touches hashed class names — only CSS variables. Worst case after a Codex update is "colours stopped applying", not a blank window.
- No network. Apart from CDP on `127.0.0.1` there are no outbound requests.
- No telemetry.

---

## Notes

- Personal project, **not affiliated with OpenAI**. No official Codex assets are bundled.
- The video and stills in `assets/media/` are **not** MIT licensed — see [MEDIA_NOTICE.md](MEDIA_NOTICE.md) before redistributing.
- Windows x64 only. Other platforms are untested.

## Credits & license

- Code: [MIT](LICENSE) © 2026 cl1973-hello
- Design inspiration (no code copied): [dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot),
  [dragon-codex-boot-enhanced](https://github.com/knight458687810-code/dragon-codex-boot-enhanced) — both MIT.
  See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
