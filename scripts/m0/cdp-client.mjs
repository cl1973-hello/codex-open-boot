// 极简 CDP 客户端（M0 用，后续会演进成 src/main/cdp/client.js）
// 只依赖 Node 22 的全局 WebSocket。

export async function connect(wsUrl, { timeoutMs = 10000 } = {}) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map(); // method -> [fn]

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
      return;
    }
    if (msg.method) {
      const fns = listeners.get(msg.method) || [];
      for (const fn of fns) fn(msg.params, msg.sessionId);
    }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error('WebSocket error'));
    });
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });

  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };

  return {
    send,
    on,
    close: () => ws.close(),
    get raw() {
      return ws;
    },
  };
}

/** 便捷：在指定 session 里 eval 一个表达式，返回 JSON 值。 */
export async function evaluate(client, expression, sessionId) {
  const res = await client.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true },
    sessionId,
  );
  if (res.exceptionDetails) {
    throw new Error(`eval failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
  }
  return res.result?.value;
}
