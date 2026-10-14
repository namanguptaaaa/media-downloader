'use strict';
(() => {
  const namespace = 'local-media-bridge-v1';
  const opener = window.opener;
  const pending = new Map();
  let session = null;
  let closed = false;
  const setStatus = message => { document.getElementById('bridge-status').textContent = message; };
  const health = fetch('/api/health', { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(data => { if (!Array.isArray(data.allowed_origins)) throw new Error(); return data; })
    .catch(() => { setStatus('The local companion could not provide its trusted origins. Update or restart it, then reconnect.'); return null; });
  if (!opener) setStatus('Open this bridge using Connect to server on your downloader page.');

  function safeId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value); }
  function validateRequest(message) {
    if (!safeId(message.id) || !['GET', 'POST'].includes(message.method) || typeof message.path !== 'string') return false;
    const get = message.method === 'GET' && (message.path === '/api/health' || /^\/api\/jobs\/[a-f0-9]{32}(?:\/files\/[0-9]{1,8})?$/.test(message.path));
    const post = message.method === 'POST' && (message.path === '/api/extract' || /^\/api\/jobs\/[a-f0-9]{32}\/download$/.test(message.path));
    if (!(get || post) || (message.token !== undefined && (typeof message.token !== 'string' || message.token.length > 4096 || /[\r\n]/.test(message.token)))) return false;
    if (message.path !== '/api/health' && !message.token) return false;
    if (get) return message.body === undefined;
    if (typeof message.body !== 'string' || message.body.length > 8192) return false;
    try {
      const body = JSON.parse(message.body);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
      if (message.path === '/api/extract') return Object.keys(body).length === 1 && typeof body.url === 'string' && body.url.length <= 2048;
      return Object.keys(body).length === 1 && Array.isArray(body.item_ids) && body.item_ids.length > 0 && body.item_ids.length <= 100 && body.item_ids.every(id => typeof id === 'string' && /^[0-9]{1,8}$/.test(id));
    } catch { return false; }
  }
  function reply(data) {
    if (!closed && session) opener.postMessage({ namespace, nonce: session.nonce, ...data }, session.origin);
  }
  function close() {
    reply({ type: 'closed' });
    closed = true;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    session = null;
    setStatus('Disconnected. You can close this window.');
  }
  window.addEventListener('message', async event => {
    if (closed || !opener || event.source !== opener || !event.data || event.data.namespace !== namespace || !safeId(event.data.nonce)) return;
    const config = await health;
    if (closed || !config || !config.allowed_origins.includes(event.origin)) return;
    const message = event.data;
    if (message.type === 'hello') {
      if (session && (session.origin !== event.origin || session.nonce !== message.nonce)) return;
      session = { origin: event.origin, nonce: message.nonce };
      setStatus(`Connected to ${event.origin}. Keep this window open while using the downloader.`);
      reply({ type: 'ready' });
      return;
    }
    if (!session || event.origin !== session.origin || message.nonce !== session.nonce) return;
    if (message.type === 'close') { close(); window.close(); return; }
    if (message.type === 'cancel' && safeId(message.id)) { pending.get(message.id)?.abort(); return; }
    if (message.type !== 'request' || !validateRequest(message)) return;
    if (pending.has(message.id) || pending.size >= 8) return;
    const controller = new AbortController();
    pending.set(message.id, controller);
    const timeout = setTimeout(() => controller.abort(), /\/files\/|\/download$/.test(message.path) ? 300000 : 30000);
    try {
      const headers = {};
      if (message.token) headers.Authorization = `Bearer ${message.token}`;
      if (message.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(message.path, { method: message.method, headers, body: message.body, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      const blob = await response.blob();
      if (!controller.signal.aborted) reply({ type: 'response', id: message.id, status: response.status, contentType: response.headers.get('Content-Type') || 'application/octet-stream', blob });
    } catch { reply({ type: 'response', id: message.id, error: 'Local bridge request failed or timed out. Check the companion and reconnect.' }); }
    finally { clearTimeout(timeout); pending.delete(message.id); }
  });
  document.getElementById('bridge-close').addEventListener('click', () => { close(); window.close(); });
  window.addEventListener('pagehide', close);
})();
