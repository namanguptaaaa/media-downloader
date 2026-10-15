'use strict';
importScripts('validation.js');
const relay = globalThis.MediaRelay;
const ports = new Set();
let activeRequests = 0;

chrome.runtime.onConnect.addListener(port => {
  const sender = port.sender;
  if (port.name !== relay.namespace || !sender || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !relay.allowedPage(sender.url) || ports.size >= 8) {
    port.disconnect();
    return;
  }
  ports.add(port);
  const pending = new Map();
  let nonce = null;
  let disconnected = false;
  const send = message => {
    if (!disconnected) {
      try { port.postMessage({ namespace: relay.namespace, nonce, ...message }); }
      catch { stop(); }
    }
  };
  function abort(operation) {
    operation.controller.abort();
    operation.ackReject?.(new Error('cancelled'));
  }
  function stop() {
    if (disconnected) return;
    disconnected = true;
    ports.delete(port);
    for (const operation of pending.values()) abort(operation);
  }
  port.onDisconnect.addListener(stop);
  port.onMessage.addListener(message => {
    if (disconnected || !message || message.namespace !== relay.namespace || !relay.safeId(message.nonce)) return;
    if (message.type === 'hello') {
      if (nonce && nonce !== message.nonce) return;
      nonce = message.nonce;
      send({ type: 'ready', extensionId: chrome.runtime.id });
      return;
    }
    if (!nonce || message.nonce !== nonce) return;
    if (message.type === 'ping') { send({ type: 'pong' }); return; }
    if (message.type === 'close') { stop(); port.disconnect(); return; }
    if (message.type === 'cancel' && relay.safeId(message.id)) { const operation = pending.get(message.id); if (operation) abort(operation); return; }
    if (message.type === 'ack' && relay.safeId(message.id) && Number.isSafeInteger(message.seq)) {
      const operation = pending.get(message.id);
      if (operation && operation.seq === message.seq && operation.ackResolve) operation.ackResolve();
      return;
    }
    if (message.type !== 'request') return;
    if (!relay.validRequest(message)) { if (relay.safeId(message.id)) send({ type: 'error', id: message.id, error: 'The extension rejected an invalid local request.' }); return; }
    if (pending.has(message.id)) return;
    if (pending.size >= relay.maxRequests || activeRequests >= relay.maxRequests) { send({ type: 'error', id: message.id, error: 'Too many local requests. Wait for existing downloads.' }); return; }
    const operation = { controller: new AbortController(), seq: 0 };
    pending.set(message.id, operation);
    activeRequests++;
    void request(message, operation);
  });

  async function request(message, operation) {
    const media = /\/files\/|\/download$/.test(message.path);
    let timer;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => abort(operation), media ? 300000 : 30000); };
    touch();
    let reader;
    try {
      const headers = {};
      if (message.token) headers.Authorization = `Bearer ${message.token}`;
      if (message.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(relay.endpoint + message.path, { method: message.method, headers, body: message.body, signal: operation.controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      // Credentials are never persisted, logged, or reflected to the page.
      delete headers.Authorization;
      message.token = undefined;
      message.body = undefined;
      const length = Number(response.headers.get('Content-Length'));
      if (Number.isFinite(length) && length > relay.maxBytes) throw new Error('limit');
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = /filename="([A-Za-z0-9_.-]{1,200})"/.exec(disposition)?.[1];
      send({ type: 'headers', id: message.id, status: response.status, contentType: response.headers.get('Content-Type') || 'application/octet-stream', filename, length: Number.isFinite(length) && length > 0 ? length : null });
      if (response.body) {
        reader = response.body.getReader();
        let total = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          touch();
          total += result.value.byteLength;
          if (total > relay.maxBytes) throw new Error('limit');
          for (let start = 0; start < result.value.byteLength; start += relay.chunkBytes) {
            if (operation.controller.signal.aborted) throw new Error('cancelled');
            const chunk = result.value.subarray(start, start + relay.chunkBytes);
            let binary = '';
            for (const byte of chunk) binary += String.fromCharCode(byte);
            const ack = new Promise((resolve, reject) => { operation.ackResolve = resolve; operation.ackReject = reject; });
            const ackTimer = setTimeout(() => operation.ackReject?.(new Error('ack timeout')), 15000);
            send({ type: 'chunk', id: message.id, seq: operation.seq, base64: btoa(binary) });
            try { await ack; } finally { clearTimeout(ackTimer); operation.ackResolve = null; operation.ackReject = null; }
            operation.seq++;
          }
        }
      }
      if (!operation.controller.signal.aborted) send({ type: 'complete', id: message.id });
    } catch {
      send({ type: 'error', id: message.id, error: 'Local companion request failed, was cancelled, or timed out. Check the companion and reconnect.' });
    } finally {
      message.token = undefined;
      message.body = undefined;
      clearTimeout(timer);
      operation.controller.abort();
      if (reader) { try { await reader.cancel(); } catch { /* Stream already closed. */ } }
      pending.delete(message.id);
      activeRequests--;
    }
  }
});
