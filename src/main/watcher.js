'use strict';

/**
 * 官方入口侦测：用户点开始菜单/搜索里的 Codex 时，把开屏抢过来。
 *
 * 背景：官方 Codex 是 MSIX 执行别名，没有 .lnk 可改，也不能给它加启动参数，
 * 所以「点官方图标 → 有开屏 + 有主题」只能靠常驻侦测：
 *   看见新的 ChatGPT.exe 出现 → 立刻抢屏 → 杀掉这个刚起的实例 →
 *   用调试端口重新拉起来（没有端口就注入不了主题）。
 *
 * 判据只看「pid 集合里多了谁」：
 *   - 启动时把当时已有的 pid 记为基线（用户如果本来就开着 Codex，点图标只是切窗口，
 *     不该抢屏）；
 *   - 之后每轮扫一次，只处理基线之外的新 pid；
 *   - onDetect 返回的 Promise 没结束前不再触发（那次开屏正在跑）。
 *
 * scan / onDetect 都是注入的，逻辑本身不碰 Electron，单测可以直接喂假的 scan。
 */
class OfficialWatcher {
  /**
   * @param {{
   *   scan: () => number[],
   *   onDetect: (pids: number[]) => Promise<void>|void,
   *   intervalMs?: number,
   *   log?: { info:(m:string)=>void, warn:(m:string)=>void }
   * }} options
   */
  constructor({ scan, onDetect, intervalMs = 400, log = null, now = () => Date.now() }) {
    if (typeof scan !== 'function') throw new Error('watcher 需要 scan');
    if (typeof onDetect !== 'function') throw new Error('watcher 需要 onDetect');

    this.scan = scan;
    this.onDetect = onDetect;
    this.intervalMs = intervalMs;
    this.log = log;
    this.now = now;

    this.timer = null;
    this.baseline = null;
    this.busy = false;
    this.ignored = new Set(); // 我们亲手拉起来的 pid，永远不算「官方点击」
    this.fires = 0;
  }

  get running() {
    return !!this.timer;
  }

  /** 扫一次，失败当空集合（别因为一次枚举失败就误判成「全都退出又新起来了」） */
  ids() {
    let list = null;
    try {
      list = this.scan();
    } catch (error) {
      if (this.log) this.log.warn(`进程扫描失败: ${error.message}`);
      return null;
    }
    if (!Array.isArray(list)) return null;
    return new Set(list.filter((n) => Number.isInteger(n) && n > 0));
  }

  start() {
    if (this.timer) return this;
    this.baseline = this.ids();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    if (this.log) {
      const n = this.baseline ? this.baseline.size : 0;
      this.log.info(`官方入口侦测已开启（基线 ${n} 个 Codex 进程，间隔 ${this.intervalMs}ms）`);
    }
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.log) this.log.info('官方入口侦测已停止');
    return this;
  }

  /** 我们自己拉起的 pid 记下来，避免「自己启动自己接管」的死循环 */
  ignore(pids) {
    for (const pid of pids || []) {
      if (Number.isInteger(pid) && pid > 0) this.ignored.add(pid);
    }
    this.refreshBaseline();
    return this;
  }

  /** 基线前进到当前状态（Codex 正常退出、我们接管完之后调用） */
  refreshBaseline() {
    const now = this.ids();
    if (now) this.baseline = now;
    return this;
  }

  tick() {
    if (!this.timer) return; // 已经 stop 了（或者还没 start）
    const now = this.ids();
    if (!now) return; // 扫描失败：保持旧基线，下一轮再看

    const before = this.baseline;
    this.baseline = now;
    if (!before) return; // 还没建基线

    const fresh = [...now].filter((pid) => !before.has(pid) && !this.ignored.has(pid));
    if (!fresh.length) return;

    // 忽略名单里的 pid 退出后可以清掉，免得集合无限长
    for (const pid of [...this.ignored]) if (!now.has(pid)) this.ignored.delete(pid);

    // 只有「上一轮一个 Codex 都没有」才算用户点了官方入口。
    // Codex 运行中会自己派生新进程（打开 PDF 预览、拉个 utility 进程都算），
    // 那不是点击事件 —— 若照 pid 增量判断，用户用着用着就会被动杀掉重开。
    if (before.size > 0) {
      if (this.log) {
        this.log.info(
          `Codex 已在运行（${before.size} 个进程），新增 ${fresh.join(',')} 视为内部子进程，不接管`,
        );
      }
      return;
    }

    if (this.busy) {
      if (this.log) this.log.info(`又有新的 Codex 进程（${fresh.join(',')}），但上一次接管还没结束，忽略`);
      return;
    }

    this.busy = true;
    this.fires += 1;
    if (this.log) this.log.info(`侦测到官方入口启动 Codex：pid ${fresh.join(',')}`);

    let result;
    try {
      result = this.onDetect(fresh);
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result)
      .catch((error) => {
        if (this.log) this.log.warn(`接管失败: ${error && error.message}`);
      })
      .then(() => {
        this.busy = false;
        this.refreshBaseline();
      });
  }
}

module.exports = { OfficialWatcher };
