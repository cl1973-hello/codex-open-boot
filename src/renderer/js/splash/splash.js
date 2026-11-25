'use strict';

/**
 * 开屏页。只做四件事：
 *   1. 把视频摆到 portal.layoutFor() 算出来的矩形（和主进程摆放真实窗口共用同一套映射）
 *   2. 每来一帧视频就把 currentTime 报给主进程
 *   3. 显示 / 隐藏提示与跳过按钮
 *   4. Esc 或点击跳过
 *
 * 这里不关心 Codex 是否就绪：主进程会在该停的时候发 splash:hold。
 */

const { layoutFor } = require('../../../shared/portal');

// 开屏页出错时窗口就是一块黑屏，主进程看不到任何东西 —— 记下来供自检读取
window.addEventListener('error', (event) => {
  window.__cobSplashError = String((event && event.message) || (event && event.error) || 'unknown');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  window.__cobSplashError = `unhandled: ${(reason && reason.message) || reason}`;
});

const frame = document.getElementById('frame');
const poster = document.getElementById('poster');
const video = document.getElementById('video');
const note = document.getElementById('note');
const skip = document.getElementById('skip');

let fit = 'cover';
let zoom = 1;
let reportedLayout = '';

function setNote(text) {
  if (!text) {
    note.hidden = true;
    note.textContent = '';
    return;
  }
  if (note.textContent !== text) note.textContent = text;
  note.hidden = false;
}

/** 视频在窗口里占的矩形（CSS px），按 object-fit + zoom 计算 */
function place() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  if (cw < 2 || ch < 2) return;

  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const rect = layoutFor(cw, ch, vw, vh, fit, zoom);

  frame.style.left = `${rect.x}px`;
  frame.style.top = `${rect.y}px`;
  frame.style.width = `${rect.w}px`;
  frame.style.height = `${rect.h}px`;

  // 报给主进程的是归一化坐标：主进程乘自己的物理像素尺寸即可，天然跨 DPI。
  //
  // 但要注意 Electron 按 DIP 建窗口、Chromium 按取整后的 devicePixelRatio 绘制，
  // 两者会差 1%（例如窗口 2588 物理px，而页面实际按 2561 物理px 绘制）。
  // 所以除了归一化坐标，还要把「渲染层认为的物理视口」告诉主进程，它按这个映射
  // 出来的矩形才和画面上看到的那块视频区域严丝合缝。
  const dpr = window.devicePixelRatio || 1;
  const payload = {
    x: rect.x / cw,
    y: rect.y / ch,
    w: rect.w / cw,
    h: rect.h / ch,
    dpr,
    vw: cw * dpr,
    vh: ch * dpr,
    px: { x: rect.x * dpr, y: rect.y * dpr, w: rect.w * dpr, h: rect.h * dpr },
  };
  const key = [payload.x, payload.y, payload.w, payload.h].map((n) => n.toFixed(6)).join(',');
  if (key !== reportedLayout) {
    reportedLayout = key;
    window.bridge.layout(payload);
  }
  return rect;
}

function startFrameLoop() {
  if (typeof video.requestVideoFrameCallback === 'function') {
    const tick = () => {
      if (video.readyState >= 2) window.bridge.frame(video.currentTime);
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
    return;
  }
  // 老内核兜底：rAF 里读 currentTime
  const tick = () => {
    if (video.readyState >= 2) window.bridge.frame(video.currentTime);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function start() {
  const state = await window.bridge.bootstrap();
  const media = state.media || {};
  const splash = (state.settings && state.settings.splash) || {};

  fit = media.fit === 'contain' ? 'contain' : 'cover';
  zoom = Number(media.zoom) > 0 ? Number(media.zoom) : 1;

  if (media.poster) poster.src = media.poster;

  video.addEventListener('loadedmetadata', place);
  video.addEventListener('playing', () => document.body.classList.add('video-live'));
  video.addEventListener('error', () => {
    setNote('视频无法播放，直接进入 Codex');
    window.bridge.failed('video-error');
  });

  // 视频比 theme.json 里的 transitionEnd 先结束（素材被换成更短的一段、或解码在末尾
  // 停止送帧）时，requestVideoFrameCallback 不再回调，主进程就永远等不到 transitionEnd，
  // 只能等停帧兜底把尾段压成 400ms。这里补报一次结束时间，让尾段按自然时长跑完。
  const endAt = Math.max(
    Number(media.duration) || 0,
    Number(media.transitionEnd) || 0,
  );
  const videoEnded = () => window.bridge.frame(Math.max(video.currentTime || 0, endAt));
  video.addEventListener('ended', videoEnded);

  // 光靠 'ended' 不够：解码器常在最后几帧就停止呈现，视频还没 ended、rVFC 已经不回调了，
  // 用户看到的是「画面卡住 1~2 秒再突然收尾」。用定时器盯住播放头，到末尾就直接补报。
  if (endAt > 0) {
    const nearEnd = setInterval(() => {
      if (video.ended || video.currentTime >= endAt - 0.08) {
        clearInterval(nearEnd);
        videoEnded();
      }
    }, 200);
  }

  window.addEventListener('resize', place);
  place();

  window.bridge.onNote(setNote);
  window.bridge.onHold(() => {
    if (!video.paused) video.pause();
    setNote('Codex 还在启动…');
  });
  window.bridge.onResume(() => {
    setNote('');
    if (video.paused) video.play().catch(() => {});
  });
  window.bridge.onRate((rate) => {
    const value = Number(rate);
    if (Number.isFinite(value) && value > 0) video.playbackRate = Math.min(2, Math.max(0.25, value));
  });
  window.bridge.onFade(() => document.body.classList.add('fade-out'));

  const skipNow = () => window.bridge.skip();
  skip.addEventListener('click', skipNow);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') skipNow();
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());

  if (!media.video) {
    setNote('没有找到开屏视频，直接进入 Codex');
    window.bridge.failed('no-media');
    // 仍然要报 layout，主进程靠它算入场时间
    await window.bridge.ready();
    return;
  }

  if (splash.enabled === false) {
    window.bridge.failed('disabled');
    await window.bridge.ready();
    return;
  }

  video.src = media.video;
  const volume = Math.max(0, Math.min(1, Number(splash.volume) || 0));
  video.volume = volume;
  video.muted = volume === 0;

  startFrameLoop();

  try {
    await window.bridge.ready();
    await video.play();
  } catch (error) {
    setNote('自动播放被阻止，正在进入 Codex');
    window.bridge.failed('play-failed');
  }
}

start().catch((error) => {
  setNote(`开屏出错：${(error && error.message) || error}`);
  window.bridge.failed(String((error && error.message) || error));
});
