'use strict';
(() => {
  const relay = globalThis.MediaRelay;
  if (window !== window.top || !relay.allowedPage(location.href)) return;
  let port = null;
  let nonce = null;
  let heartbeat = null;
  const pending = new Set();
  const reply = message => window.postMessage({ namespace: relay.namespace, nonce, ...message }, location.origin);
  const disconnect = () => {
    if (!port) return;
    const old = port;
    port = null;
    clearInterval(heartbeat);
    heartbeat = null;
    pending.clear();
    try { old.disconnect(); } catch { /* Port already ended. */ }
  };
  const forward = message => {
    if (!port) return;
    try { port.postMessage(message); }
    catch {
      disconnect();
      reply({ type: 'closed', error: 'The extension connection ended. Reconnect to continue.' });
      nonce = null;
    }
  };
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || !message || message.namespace !== relay.namespace || !relay.safeId(message.nonce)) return;
    if (message.type === 'hello') {
      if (port && nonce !== message.nonce) return;
      if (!port) {
        nonce = message.nonce;
        port = chrome.runtime.connect({ name: relay.namespace });
        const current = port;
        // MV3 ports need traffic to stay available while this page is open.
        // This ends on navigation/disconnect and keeps no tab or UI open.
        heartbeat = setInterval(() => {
          if (current === port) forward({ namespace: relay.namespace, type: 'ping', nonce });
        }, 20000);
        current.onMessage.addListener(result => {
          if (current !== port || !result || result.namespace !== relay.namespace || result.nonce !== nonce) return;
          if (result.type === 'ready') { reply({ type: 'ready', extensionId: result.extensionId }); return; }
          if (!pending.has(result.id)) return;
          if (!['headers', 'chunk', 'complete', 'error'].includes(result.type)) return;
          if (result.type === 'chunk' && (typeof result.base64 !== 'string' || result.base64.length > 65536 || !Number.isSafeInteger(result.seq))) return;
          reply(result);
          if (result.type === 'complete' || result.type === 'error') pending.delete(result.id);
        });
        current.onDisconnect.addListener(() => {
          if (port !== current) return;
          port = null;
          clearInterval(heartbeat);
          heartbeat = null;
          pending.clear();
          reply({ type: 'closed', error: 'The extension connection ended. Reconnect to continue.' });
          nonce = null;
        });
      }
      forward({ namespace: relay.namespace, type: 'hello', nonce });
      return;
    }
    if (!port || message.nonce !== nonce) return;
    if (message.type === 'close') { disconnect(); nonce = null; return; }
    if ((message.type === 'cancel' || message.type === 'ack') && pending.has(message.id)) {
      if (message.type === 'ack' && (!Number.isSafeInteger(message.seq) || message.seq < 0)) return;
      forward({ namespace: relay.namespace, nonce, type: message.type, id: message.id, seq: message.seq });
      return;
    }
    if (message.type !== 'request') return;
    if (!relay.validRequest(message)) { if (relay.safeId(message.id)) reply({ type: 'error', id: message.id, error: 'The extension rejected an invalid local request.' }); return; }
    if (pending.has(message.id)) return;
    if (pending.size >= relay.maxRequests) { reply({ type: 'error', id: message.id, error: 'Too many local requests. Wait for existing downloads.' }); return; }
    pending.add(message.id);
    forward({ namespace: relay.namespace, nonce, type: 'request', id: message.id, path: message.path, method: message.method, body: message.body, token: message.token });
  });
  window.addEventListener('pagehide', disconnect);
})();
