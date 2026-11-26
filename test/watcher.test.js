'use strict';

/**
 * 官方入口侦测的单元测试。
 *
 * 这段逻辑的价值全在「什么时候不该触发」：用户本来就开着 Codex、我们自己在拉、
 * 上一次接管还没结束 —— 任意一条判错，用户就会看到 Codex 被莫名其妙杀掉重开。
 */

const test = require('node:test');
const assert = require('node:assert');

const { OfficialWatcher } = require('../src/main/watcher.js');

function fakeScan(state) {
  return () => state.pids.slice();
}

function makeWatcher(state, extra = {}) {
  const fired = [];
  const watcher = new OfficialWatcher({
    scan: fakeScan(state),
    onDetect: (pids) => {
      fired.push(pids);
      return extra.onDetect ? extra.onDetect(pids) : undefined;
    },
    ...extra.options,
  });
  return { watcher, fired };
}

test('启动时已有的进程不算「点了官方入口」', () => {
  const state = { pids: [100, 200] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();
  watcher.tick();
  watcher.tick();
  watcher.stop();
  assert.deepStrictEqual(fired, []);
});

test('新出现的 pid 触发一次，且带上是哪些', () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();

  state.pids = [500, 501];
  watcher.tick();
  watcher.stop();

  assert.strictEqual(fired.length, 1);
  assert.deepStrictEqual(fired[0].sort(), [500, 501]);
});

test('同一个实例不会被重复触发', async () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();

  state.pids = [700];
  watcher.tick();
  await new Promise((r) => setTimeout(r, 10));
  watcher.tick();
  watcher.tick();
  watcher.stop();

  assert.strictEqual(fired.length, 1);
});

test('上一次接管还没结束时，又冒出新进程也只是记一笔', () => {
  const state = { pids: [] };
  let release = () => {};
  const { watcher, fired } = makeWatcher(state, {
    onDetect: () => new Promise((resolve) => {
      release = resolve;
    }),
  });
  watcher.start();

  state.pids = [900];
  watcher.tick();
  state.pids = [900, 901];
  watcher.tick();
  watcher.tick();

  assert.strictEqual(fired.length, 1);
  release();
  watcher.stop();
});

test('我们亲手拉起来的 pid 被忽略', () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();

  state.pids = [1100];
  watcher.ignore([1100]);
  watcher.tick();
  watcher.stop();

  assert.deepStrictEqual(fired, []);
});

test('扫描失败不打乱基线，恢复后 Codex 重新启动仍能触发', () => {
  const state = { pids: [1200] };
  let broken = false;
  const fired = [];
  const watcher = new OfficialWatcher({
    scan: () => {
      if (broken) throw new Error('枚举失败');
      return state.pids.slice();
    },
    onDetect: (pids) => fired.push(pids),
  });

  watcher.start();
  broken = true;
  watcher.tick();
  broken = false;
  // 枚举失败那一轮不能把基线清空，否则下一轮会把老进程当新的一批
  state.pids = [1200, 1201];
  watcher.tick();
  assert.deepStrictEqual(fired, []);

  // Codex 全部退出，再点官方入口 —— 这才是真正该触发的时机
  state.pids = [];
  watcher.tick();
  state.pids = [1600];
  watcher.tick();
  watcher.stop();

  assert.deepStrictEqual(fired, [[1600]]);
});

test('Codex 运行中派生新子进程不算「点了官方入口」', () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();

  state.pids = [1700, 1701];
  watcher.tick();
  // 打开预览、拉 utility 进程之类，Codex 自己会长出新 pid
  state.pids = [1700, 1701, 1702];
  watcher.tick();
  watcher.tick();
  watcher.stop();

  // 只有「从零到有」那一次算数，后面长出来的不许把用户正在用的 Codex 杀掉重开
  assert.deepStrictEqual(fired, [[1700, 1701]]);
});

test('Codex 全部退出后再启动，仍然算新的一次', async () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();

  state.pids = [1300];
  watcher.tick();
  await new Promise((r) => setTimeout(r, 10));
  state.pids = [];
  watcher.tick();
  await new Promise((r) => setTimeout(r, 10));
  state.pids = [1400];
  watcher.tick();
  await new Promise((r) => setTimeout(r, 10));
  watcher.stop();

  assert.deepStrictEqual(fired, [[1300], [1400]]);
});

test('stop 之后不再触发', () => {
  const state = { pids: [] };
  const { watcher, fired } = makeWatcher(state);
  watcher.start();
  watcher.stop();

  state.pids = [1500];
  watcher.tick();

  assert.deepStrictEqual(fired, []);
  assert.strictEqual(watcher.running, false);
});
