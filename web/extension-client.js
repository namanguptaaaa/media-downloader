'use strict';
(() => {
  const namespace = 'local-media-extension-v1';
  window.createLocalMediaExtension = function(onClosed) {
    const nonce = crypto.randomUUID();
    const origin = window.location.origin;
    const pending = new Map();
    let closed = false;
    let connected = false;
    let resolveReady;
    let rejectReady;
    const missing = 'Chrome extension not detected. Download the extension below, unzip it, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extension folder. Reload this page and connect again. No extra window is opened.';
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
    const send = data => { if (!closed) window.postMessage({ namespace, nonce, ...data }, origin); };
    const hello = setInterval(() => send({ type: 'hello' }), 250);
    const startup = setTimeout(() => { send({ type: 'close' }); shutdown(missing); }, 8000);
    function shutdown(message, notify = false) {
      if (closed) return;
      closed = true;
      clearInterval(hello); clearTimeout(startup);
      window.removeEventListener('message', receive);
      rejectReady(new Error(message));
      for (const operation of pending.values()) operation.reject(new Error(message));
      pending.clear();
      if (notify) onClosed?.(message);
    }
    function receive(event) {
      const message = event.data;
      if (closed || event.source !== window || event.origin !== origin || !message || message.namespace !== namespace || message.nonce !== nonce) return;
      if (message.type === 'ready') {
        if (message.extensionId !== 'ifalbjaplddiebbnbecaalonfpojnamk') return;
        connected = true; clearInterval(hello); clearTimeout(startup); resolveReady(); return;
      }
      if (message.type === 'closed') { shutdown('Background extension disconnected. Reload this page and reconnect.', true); return; }
      if (!pending.has(message.id)) return;
      const operation = pending.get(message.id);
      if (message.type === 'error') { operation.reject(new Error(typeof message.error === 'string' ? message.error : 'Background extension request failed.')); return; }
      if (message.type === 'headers') {
        if (operation.headers || !Number.isInteger(message.status) || message.status < 200 || message.status > 599 || typeof message.contentType !== 'string' || message.contentType.length > 256 || /[\r\n]/.test(message.contentType)) { operation.invalid(); return; }
        operation.headers = { status: message.status, contentType: message.contentType, length: Number.isSafeInteger(message.length) && message.length > 0 ? message.length : null };
        operation.touch(); return;
      }
      if (message.type === 'chunk') {
        if (!operation.headers || operation.processing || message.seq !== operation.sequence || typeof message.base64 !== 'string' || message.base64.length > 65536) { operation.invalid(); return; }
        try {
          const binary = atob(message.base64);
          if (binary.length > 49152 || operation.size + binary.length > 4 * 1024 ** 3 + 1024 ** 2) throw new Error();
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          operation.processing = true;
          void (async () => {
            try {
              if (operation.headers.status < 400 && operation.onChunk) await operation.onChunk(bytes);
              else operation.chunks.push(bytes);
              if (pending.get(message.id) !== operation) return;
              operation.size += bytes.length; operation.sequence += 1; operation.processing = false; operation.touch();
              operation.onProgress?.(operation.size, operation.headers.length);
              send({ type: 'ack', id: message.id, seq: message.seq });
            } catch { operation.invalid(); }
          })();
        } catch { operation.invalid(); }
        return;
      }
      if (message.type === 'complete') {
        if (!operation.headers || operation.processing) { operation.invalid(); return; }
        try {
          const { status, contentType } = operation.headers;
          const body = [204, 205, 304].includes(status) ? null : new Blob(operation.chunks, { type: contentType });
          operation.resolve(new Response(body, { status, headers: { 'Content-Type': contentType } }));
        } catch { operation.invalid(); }
      }
    }
    window.addEventListener('message', receive);
    send({ type: 'hello' });
    return {
      ready,
      async request(path, options = {}, token) {
        const signal = options.signal;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          signal?.addEventListener('abort', abort, { once: true });
          ready.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
        });
        if (closed || !connected) throw new Error('Background extension disconnected. Reload this page and reconnect.');
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (pending.size >= 8) throw new Error('Too many background requests. Wait for the current download.');
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          let timeout;
          const abort = () => { send({ type: 'cancel', id }); operation.reject(new DOMException('Aborted', 'AbortError')); };
          const finish = action => value => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); pending.delete(id); operation.chunks.length = 0; action(value); };
          const operation = {
            chunks: [], sequence: 0, size: 0, headers: null, processing: false,
            onChunk: options.onChunk, onProgress: options.onProgress,
            resolve: finish(resolve), reject: finish(reject),
            invalid() { send({ type: 'cancel', id }); operation.reject(new Error('Background extension returned an invalid media response. Reconnect and try again.')); },
            touch() { clearTimeout(timeout); timeout = setTimeout(() => { send({ type: 'cancel', id }); operation.reject(new Error('Background extension request timed out. Check the companion and reconnect.')); }, /\/files\/|\/download$/.test(path) ? 300000 : 35000); }
          };
          pending.set(id, operation); operation.touch();
          signal?.addEventListener('abort', abort, { once: true });
          send({ type: 'request', id, path, method: options.method || 'GET', body: options.body, token });
        });
      },
      close() { if (!closed) { send({ type: 'close' }); shutdown('Background extension disconnected.'); } }
    };
  };
})();
