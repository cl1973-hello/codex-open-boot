'use strict';

const { qs, on } = require('./core/dom');
const { createStore } = require('./core/store');
const { createBridge } = require('./core/bridge');
const { Workbench } = require('./workbench/workbench');
const { Splash } = require('./splash/splash');
const { Calibration } = require('./calibration/calibration');
const { applySkin, resolveSkin } = require('./workbench/skin');

const ctx = {};

function showFallback(message) {
  const box = qs('#boot-fallback');
  if (!box) return;
  box.hidden = false;
  const text = qs('p', box);
  if (text && message) text.textContent = message;
  const retry = qs('#boot-fallback-retry', box);
  if (retry) retry.addEventListener('click', () => location.reload());
}

async function replay() {
  const { bridge, splash, store, workbench, calibration } = ctx;
  if (!bridge || !splash) return;
  if (calibration && calibration.open) return;
  if (!store.get().media || !store.get().media.video) {
    workbench.toast('没有可播放的开屏视频', true);
    return;
  }
  workbench.closeTour();
  bridge.setSplashMode(true);
  try {
    await splash.run();
  } catch (error) {
    console.error('replay failed', error);
    splash.settleNow();
  }
}

async function main() {
  const bridge = createBridge();

  let boot;
  try {
    boot = await bridge.bootstrap();
  } catch (error) {
    console.error(error);
    showFallback('无法读取配置，请查看数据目录里的日志。');
    return;
  }

  const store = createStore({ ...boot, view: 'home', launch: { status: 'idle' } });
  // Paint the theme colour before anything else so there is never a white flash.
  applySkin(resolveSkin(store.get()));

  const workbenchEl = qs('#workbench');
  const workbench = new Workbench({
    store,
    bridge,
    root: workbenchEl,
    onReplay: () => replay(),
    onCalibrate: () => ctx.calibration && ctx.calibration.openHud(),
  });
  workbench.mount();
  workbench.resize(window.innerWidth, window.innerHeight);

  const splash = new Splash({
    store,
    bridge,
    workbench,
    workbenchEl,
    onSettled: () => workbench.resize(window.innerWidth, window.innerHeight),
  });
  splash.bindSkip();
  splash.bindResize();

  const calibration = new Calibration({
    store,
    bridge,
    splash,
    onClosed: (afterSave) => {
      workbench.renderStage(true);
      workbench.toast(afterSave ? '关键帧已保存，下次开屏生效' : '已退出校准');
    },
  });
  calibration.bindShortcut();

  Object.assign(ctx, { bridge, store, workbench, splash, calibration });
  window.__codexOpenBoot = ctx;

  const state = store.get();
  const canAnimate = !!(state.settings.splash.enabled && state.media && state.media.video);

  if (canAnimate) {
    bridge.setSplashMode(true);
    try {
      await splash.run();
    } catch (error) {
      console.error('splash failed', error);
      splash.settleNow();
    }
  } else {
    splash.settleNow();
  }

  if (state.calibrate) await calibration.openHud();

  on(window, 'resize', () => {
    workbench.resize(window.innerWidth, window.innerHeight);
    if (calibration.open) calibration.render();
  });

  window.addEventListener('error', (event) => {
    console.error('renderer error', event.error || event.message);
  });
}

main();

module.exports = { main, ctx };
