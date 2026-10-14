'use strict';
(() => {
  const namespace = 'local-media-bridge-v1';
  window.createLocalMediaBridge = function(endpoint, onClosed) {
    const origin = new URL(endpoint).origin;
    const nonce = crypto.randomUUID();
    const popup = window.open(origin + '/bridge.html', '_blank', 'popup,width=560,height=660');
    if (!popup) throw new Error('Allow popups for this page, then click Connect to server again. The local bridge needs its own window.');
    const pending = new Map();
    let settled = false;
    let closed = false;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A connection can be cancelled before a request attaches to readiness.
    ready.catch(() => {});
    const send = data => { if (!closed) popup.postMessage({ namespace, nonce, ...data }, origin); };
    const hello = setInterval(() => send({ type: 'hello' }), 200);
    const startupTimeout = setTimeout(() => fail('Local bridge did not connect. Check that the companion is running and explicitly allows this page’s origin.'), 15000);
    const monitor = setInterval(() => { if (popup.closed) fail('The local bridge was closed. Reconnect to open it again.', true); }, 500);
    function cleanup() {
      clearInterval(hello); clearInterval(monitor); clearTimeout(startupTimeout);
      window.removeEventListener('message', receive);
    }
    function fail(message, notify = false) {
      if (closed) return;
      closed = true;
      cleanup();
      rejectReady(new Error(message));
      for (const operation of pending.values()) operation.reject(new Error(message));
      pending.clear();
      try { popup.close(); } catch { /* Browser may keep it open. */ }
      if (notify) onClosed?.(message);
    }
    function receive(event) {
      const message = event.data;
      if (closed || event.source !== popup || event.origin !== origin || !message || message.namespace !== namespace || message.nonce !== nonce) return;
      if (message.type === 'closed') { fail('The local bridge disconnected. Reconnect to continue.', true); return; }
      if (message.type === 'ready') {
        settled = true; clearInterval(hello); clearTimeout(startupTimeout); resolveReady(); return;
      }
      if (message.type !== 'response' || !pending.has(message.id)) return;
      const operation = pending.get(message.id);
      pending.delete(message.id);
      if (typeof message.error === 'string') operation.reject(new Error(message.error));
      else if (!(message.blob instanceof Blob) || !Number.isInteger(message.status) || message.status < 200 || message.status > 599) operation.reject(new Error('The local bridge returned an invalid response.'));
      else operation.resolve(new Response(message.blob, { status: message.status, headers: { 'Content-Type': message.contentType } }));
    }
    window.addEventListener('message', receive);
    return {
      ready,
      async request(path, options, token) {
        const signal = options.signal;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const waitForReady = new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          signal?.addEventListener('abort', abort, { once: true });
          ready.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
        });
        await waitForReady;
        if (closed || !settled) throw new Error('Local bridge is disconnected.');
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { send({ type: 'cancel', id }); operation.reject(new Error('Local bridge request timed out.')); }, /\/files\/|\/download$/.test(path) ? 305000 : 35000);
          const abort = () => { send({ type: 'cancel', id }); operation.reject(new DOMException('Aborted', 'AbortError')); };
          const finish = action => value => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); pending.delete(id); action(value); };
          const operation = { resolve: finish(resolve), reject: finish(reject) };
          pending.set(id, operation);
          signal?.addEventListener('abort', abort, { once: true });
          send({ type: 'request', id, path, method: options.method || 'GET', body: options.body, token });
        });
      },
      close() { if (!closed) { send({ type: 'close' }); fail('Local bridge disconnected.'); } }
    };
  };
})();
