'use strict';

/**
 * media.load() 的回归测试。
 *
 * 这里要钉死的是便携版那个坑：portable.exe 每次运行都会先清空同一个临时解压目录，
 * 所以「程序在跑时又双击一次」会把正在用的 resources/media 删掉。修复的办法是把
 * 素材同步到 userData 一份，之后一律读副本 —— 下面第 3 组用例就是那一刻。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const media = require('../src/main/media.js');

const VIDEO_BYTES = 'x'.repeat(2048);
const POSTER_BYTES = 'p'.repeat(512);
const THEME = {
  duration: 12,
  fit: 'cover',
  zoom: 1,
  transitionStart: 8.2,
  transitionEnd: 9.2,
  video: 'video.mp4',
  poster: 'poster.png',
  screenFrames: [
    { time: 8.4, x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
    { time: 9.2, x: 0, y: 0, width: 1, height: 1 },
  ],
};

function makeDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cob-media-'));
  const userDataDir = path.join(root, 'userData');
  const mediaDir = path.join(root, 'resources', 'media');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, 'video.mp4'), VIDEO_BYTES);
  fs.writeFileSync(path.join(mediaDir, 'poster.png'), POSTER_BYTES);
  fs.writeFileSync(path.join(mediaDir, 'theme.json'), JSON.stringify(THEME));
  return { root, userDataDir, mediaDir };
}

function cleanup({ root }) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 上偶尔被占用，忽略 */
  }
}

test('首次启动：把素材复制到 userData，file:// 指向副本', () => {
  const dirs = makeDirs();
  try {
    const m = media.load(dirs);
    assert.strictEqual(m.mediaSource, 'copied');
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.frames.length, 2);
    assert.strictEqual(m.transitionEnd, 9.2);

    const video = fileURLToPath(m.video);
    assert.strictEqual(path.dirname(video), path.join(dirs.userDataDir, 'media'));
    assert.strictEqual(fs.readFileSync(video, 'utf8'), VIDEO_BYTES);
    assert.ok(fs.existsSync(fileURLToPath(m.poster)));
  } finally {
    cleanup(dirs);
  }
});

test('再次启动：大小一致就不重复复制', () => {
  const dirs = makeDirs();
  try {
    media.load(dirs);
    const again = media.load(dirs);
    assert.strictEqual(again.mediaSource, 'cached');
    assert.strictEqual(again.ok, true);
  } finally {
    cleanup(dirs);
  }
});

test('素材更新（大小变了）：重新复制，不吃旧副本', () => {
  const dirs = makeDirs();
  try {
    media.load(dirs);
    fs.writeFileSync(path.join(dirs.mediaDir, 'video.mp4'), VIDEO_BYTES + 'y'.repeat(64));
    const m = media.load(dirs);
    assert.strictEqual(m.mediaSource, 'copied');
    assert.strictEqual(fs.statSync(fileURLToPath(m.video)).size, VIDEO_BYTES.length + 64);
  } finally {
    cleanup(dirs);
  }
});

test('portable 清空 resources/media 之后：仍然能从副本开屏', () => {
  const dirs = makeDirs();
  try {
    // 第一次启动，副本已经建好
    media.load(dirs);

    // 这就是 portable.exe 第二次双击干的事：整个目录被清空
    fs.rmSync(dirs.mediaDir, { recursive: true, force: true });
    assert.strictEqual(fs.existsSync(dirs.mediaDir), false);

    const m = media.load(dirs);
    assert.strictEqual(m.mediaSource, 'missing');
    assert.strictEqual(m.ok, true, '源目录没了也必须能开屏');
    assert.strictEqual(m.frames.length, 2);

    const video = fileURLToPath(m.video);
    assert.ok(video.startsWith(path.join(dirs.userDataDir, 'media')));
    assert.strictEqual(fs.readFileSync(video, 'utf8'), VIDEO_BYTES);
  } finally {
    cleanup(dirs);
  }
});

test('源目录和副本都没有：明确报缺失，不抛异常', () => {
  const dirs = makeDirs();
  try {
    fs.rmSync(dirs.mediaDir, { recursive: true, force: true });
    const m = media.load(dirs);
    assert.strictEqual(m.ok, false);
    assert.strictEqual(m.mediaSource, 'missing');
    assert.strictEqual(m.video, null);
  } finally {
    cleanup(dirs);
  }
});

test('坏帧数据被丢掉并按时序排好', () => {
  const dirs = makeDirs();
  try {
    fs.writeFileSync(
      path.join(dirs.mediaDir, 'theme.json'),
      JSON.stringify({
        ...THEME,
        screenFrames: [
          { time: 9.2, x: 2, y: -1, width: 1, height: 0.5 },
          { time: 'nope', x: 0, y: 0, width: 1, height: 1 },
          null,
          { time: 8.4, x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
        ],
      })
    );
    const m = media.load(dirs);
    assert.deepStrictEqual(
      m.frames.map((f) => f.time),
      [8.4, 9.2]
    );
    // 越界的归一化值被夹回 [0,1]
    assert.strictEqual(m.frames[1].x, 1);
    assert.strictEqual(m.frames[1].y, 0);
  } finally {
    cleanup(dirs);
  }
});
