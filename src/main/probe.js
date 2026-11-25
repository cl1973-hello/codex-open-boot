'use strict';

/**
 * 开屏取证（只在设了 COB_PROBE=<目录> 时启用）。
 *
 * 为什么需要它：视频里那块「屏幕」和真实窗口是不是真的对齐，只能靠同一时刻的
 * 整屏截图 + SetWindowPos 的实际矩形来对照。Windows 的截图 API 在这台机器上被
 * 安全策略挡了，所以用 Electron 自带的 desktopCapturer。
 */

const fs = require('fs');
const path = require('path');
const { desktopCapturer } = require('electron');
const logger = require('./logger');

let dir = null;
let seq = 0;
let shotsBlocked = false;
const events = [];

function enabled() {
  return !!process.env.COB_PROBE;
}

/**
 * 截图默认关闭，必须 COB_PROBE_SHOTS=1 才开。
 *
 * 原因是实测出来的：`desktopCapturer.getSources()` 在这台机器上要卡住主进程 2 秒左右，
 * 而入场恰好是最需要观测的时刻 —— 那 2 秒里 splash:frame 全被堵在队列里，
 * 停帧兜底先醒过来，把尾段压成 400ms。测出来的「卡顿」其实是探针自己造成的。
 * 所以数值取证默认不做截图，只有确定截图不吃时间（或愿意接受动画被拖慢）时才开。
 */
function shotsEnabled() {
  return process.env.COB_PROBE_SHOTS === '1';
}

function init() {
  if (!enabled()) return;
  dir = process.env.COB_PROBE;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    dir = null;
  }
  logger.info(`开屏取证开启 -> ${dir}${shotsEnabled() ? '（含截图）' : '（仅数值，截图需 COB_PROBE_SHOTS=1）'}`);
}

/** 记一条事件；开了截图才顺手拍一张 */
async function mark(label, data) {
  if (!dir) return null;
  seq += 1;
  const record = { seq, label, at: new Date().toISOString(), ...data };
  events.push(record);

  if (shotsEnabled()) {
    try {
      if (shotsBlocked) throw new Error('截图已被系统策略拦截，本次运行不再尝试');
      // 用缩略尺寸而不是整屏：getSources 拿到 2560×1440 会卡住主进程几百毫秒，
      // 进而拖慢 splash:frame 的处理，动画自己就被取证搞歪了
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 },
      });
      const source = sources[0];
      if (!source) throw new Error('没有屏幕源');
      if (source.thumbnail.isEmpty()) throw new Error('缩略图为空（可能被安全策略拦截）');
      const file = path.join(dir, `${String(seq).padStart(2, '0')}-${label}.png`);
      fs.writeFileSync(file, source.thumbnail.toPNG());
      record.shot = path.basename(file);
    } catch (error) {
      record.shotError = error.message;
      // 一次拿不到就别再试了：每次尝试都会把主进程卡住几秒，反而毁掉要观测的动画
      shotsBlocked = true;
    }
  }

  try {
    fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events, null, 2));
  } catch {
    /* ignore */
  }
  logger.info(`取证 ${label}: ${JSON.stringify(data)}`);
  return record;
}

module.exports = { init, mark, enabled };
