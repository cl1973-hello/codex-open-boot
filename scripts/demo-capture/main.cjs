'use strict';

/**
 * Demo capture harness. Boots the *real* main process modules (settings store, IPC,
 * window) so screenshots show exactly what users see, then drives the renderer at fixed
 * video times for reproducible frames.
 *
 * Run via: node scripts/capture-demo.mjs
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs');
const FRAMES = path.join(ROOT, 'docs', '.frames');
const USER_DATA = path.join(ROOT, '.demo-userdata');

app.setPath('userData', USER_DATA);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const { SettingsStore } = require(path.join(ROOT, 'src', 'main', 'settings-store'));
const { registerIpc } = require(path.join(ROOT, 'src', 'main', 'ipc'));
const windowModule = require(path.join(ROOT, 'src', 'main', 'window'));

const WIDTH = 1440;
const HEIGHT = 900;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeDemoSettings() {
  fs.mkdirSync(USER_DATA, { recursive: true });
  const settings = {
    schemaVersion: 1,
    skinId: 'cosmic',
    background: { mode: 'builtin', filePath: null, fit: 'cover', opacity: 1, blur: 0, scrim: 0.3, vignette: 0.5 },
    splash: { enabled: true, volume: 0, skippable: false, gateTimeoutMs: 600, tailMs: 620, tailMode: 'fixed' },
    window: { bounds: { x: 40, y: 40, width: WIDTH, height: HEIGHT }, maximized: false },
    app: {
      codexAppId: 'OpenAI.Codex_2p2nqsd0c76g0!App',
      recentProjects: ['D:\\projects\\orbit-ui', 'D:\\projects\\starfield'],
    },
    ui: { navCollapsed: false, settingsOpen: true, onboardedAt: '2026-11-25T00:00:00.000Z' },
  };
  fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

async function capture(win, filePath) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(filePath, image.toPNG());
}

async function evalInPage(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function main() {
  writeDemoSettings();
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const store = new SettingsStore(USER_DATA);
  store.load();

  const state = { store, media: null, preview: false };
  registerIpc(state);

  windowModule.createWindow({
    settings: store.get(),
    preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
    indexFile: path.join(ROOT, 'src', 'renderer', 'index.html'),
    calibrate: false,
    getSettings: () => store.get(),
    saveSettings: (patch) => store.patch(patch),
  });

  const win = windowModule.getWindow();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await sleep(1800);

  const ready = await evalInPage(win, 'Boolean(window.__codexOpenBoot && window.__codexOpenBoot.splash)');
  if (!ready) throw new Error('renderer did not finish booting');

  // Freeze the automatic timeline so every capture is deterministic.
  await evalInPage(
    win,
    `(() => { const c = window.__codexOpenBoot; c.splash.video.pause(); c.splash.running = false; return true; })()`
  );

  const frames = [];
  const seek = async (time) => {
    // Seek the video first, otherwise the still frame would not match the geometry time.
    await evalInPage(
      win,
      `new Promise((resolve) => {
        const v = window.__codexOpenBoot.splash.video;
        let settled = false;
        const done = () => { if (settled) return; settled = true; resolve(v.currentTime); };
        v.addEventListener('seeked', done, { once: true });
        v.pause();
        try { v.currentTime = ${time}; } catch (e) { }
        setTimeout(done, 900);
      })`
    );
    await evalInPage(win, `(() => { window.__codexOpenBoot.splash.previewAt(${time}); return true; })()`);
    await sleep(160);
  };

  const plan = [
    { time: 0.6, hold: 5 },
    { time: 2.0, hold: 4 },
    { time: 3.4, hold: 3 },
    { time: 4.6, hold: 2 },
    { time: 5.5, hold: 2 },
    { time: 6.2, hold: 1 },
    { time: 6.6, hold: 1 },
    { time: 6.8, hold: 1 },
    { time: 7.2, hold: 1 },
    { time: 7.6, hold: 1 },
    { time: 8.0, hold: 1 },
    { time: 8.4, hold: 1 },
    { time: 8.8, hold: 1 },
    { time: 9.2, hold: 1 },
    { time: 9.6, hold: 1 },
    { time: 10.0, hold: 1 },
  ];

  for (let i = 0; i < plan.length; i += 1) {
    await seek(plan[i].time);
    const file = path.join(FRAMES, `f${String(i).padStart(3, '0')}.png`);
    await capture(win, file);
    frames.push({ file, hold: plan[i].hold });
  }

  // the 620 ms expand
  await evalInPage(win, `(() => { const c = window.__codexOpenBoot; c.splash.toEnd(false); return true; })()`);
  for (let i = 0; i < 6; i += 1) {
    await sleep(110);
    const file = path.join(FRAMES, `f${String(frames.length).padStart(3, '0')}.png`);
    await capture(win, file);
    frames.push({ file, hold: 1 });
  }
  await sleep(1000);

  // workbench states
  const shots = [
    { name: 'shot-workbench.png', view: 'home' },
    { name: 'shot-tools.png', view: 'tools' },
    { name: 'shot-about.png', view: 'about' },
  ];
  for (const shot of shots) {
    await evalInPage(
      win,
      `(() => { const c = window.__codexOpenBoot; c.store.set({ view: '${shot.view}' }); c.workbench.renderStage(true); c.workbench.syncNav(); return true; })()`
    );
    await sleep(500);
    await capture(win, path.join(OUT, shot.name));
  }

  await evalInPage(
    win,
    `(() => { const c = window.__codexOpenBoot; c.store.set({ view: 'home' }); c.workbench.renderStage(true); c.workbench.syncNav(); return true; })()`
  );
  await sleep(400);
  for (let i = 0; i < 2; i += 1) {
    const file = path.join(FRAMES, `f${String(frames.length).padStart(3, '0')}.png`);
    await capture(win, file);
    frames.push({ file, hold: 14 });
  }

  // stills for the "what it does" table
  await evalInPage(
    win,
    `(() => { const c = window.__codexOpenBoot; c.splash.enterCalibration(c.store.get().theme); return true; })()`
  );
  await sleep(800);
  await seek(5.5);
  await capture(win, path.join(OUT, 'shot-splash.png'));
  await seek(8.6);
  await capture(win, path.join(OUT, 'shot-transition.png'));

  fs.writeFileSync(path.join(FRAMES, 'manifest.json'), JSON.stringify(frames, null, 2), 'utf8');
  console.log(`[demo] captured ${frames.length} frames + 5 screenshots`);

  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('[demo] failed', error);
    app.exit(1);
  })
);
