'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const origin = 'https://namanguptaaaa.github.io';
const pageURL = origin + '/media-downloader/';
const extensionId = 'ifalbjaplddiebbnbecaalonfpojnamk';
const namespace = 'local-media-extension-v1';
const token = 'disposable-only-test-token-123456';
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }, emit(...args) { return listeners.map(fn => fn(...args)); } }; }
function ports(sender) {
  const left = { name: namespace, onMessage: event(), onDisconnect: event() };
  const right = { name: namespace, sender, onMessage: event(), onDisconnect: event() };
  const sent = []; let disconnected = false;
  left.postMessage = data => { const value = clone(data); sent.push({ from: 'content', data: value }); queueMicrotask(() => right.onMessage.emit(value)); };
  right.postMessage = data => { const value = clone(data); sent.push({ from: 'worker', data: value }); queueMicrotask(() => left.onMessage.emit(value)); };
  left.disconnect = right.disconnect = () => { if (!disconnected) { disconnected = true; left.onDisconnect.emit(); right.onDisconnect.emit(); } };
  return { left, right, sent, get disconnected() { return disconnected; } };
}
function storageTrap() { return new Proxy({}, { get() { throw new Error('No storage access permitted'); } }); }
function workerHarness(sender = { id: extensionId, url: pageURL, frameId: 0 }, fetchImpl) {
  const calls = [], onConnect = event();
  const context = { chrome: { runtime: { id: extensionId, onConnect, lastError: undefined }, storage: storageTrap() }, URL, AbortController, Uint8Array, Blob, Response, Headers, TextEncoder, btoa, atob, setTimeout, clearTimeout, console: { log() { throw new Error('No logging permitted'); } }, async fetch(url, options) { calls.push({ url, options, authorizationAtFetch: options.headers.Authorization }); return fetchImpl ? fetchImpl(url, options) : new Response('fixture'); } };
  const sandbox = vm.createContext(context);
  context.importScripts = file => vm.runInContext(source('extension/' + file), sandbox);
  vm.runInContext(source('extension/background.js'), sandbox);
  const pair = ports(sender); onConnect.emit(pair.right);
  return { ...pair, pair, calls, context, send(data) { pair.left.postMessage(data); }, async flush() { await new Promise(resolve => setImmediate(resolve)); } };
}

test('manifest has only local companion network access and packaged executable code', () => {
  const manifest = JSON.parse(source('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.length > 0);
  assert.ok(manifest.host_permissions.every(value => /^http:\/\/127\.0\.0\.1(?::8765)?\//.test(value)), manifest.host_permissions);
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.ok(!manifest.permissions?.some(value => ['cookies', 'history', 'tabs', 'storage', 'webRequest'].includes(value)));
  assert.ok(manifest.content_scripts.every(script => script.matches.every(value => value === pageURL + '*')));
  assert.ok(!/https?:\/\//.test(manifest.background.service_worker));
});

test('worker rejects wrong extension, frame, host and project path before fetching', async () => {
  for (const sender of [undefined, { id: 'evil', url: pageURL, frameId: 0 }, { id: extensionId, url: pageURL, frameId: 1 }, { id: extensionId, url: 'https://evil.example/media-downloader/', frameId: 0 }, { id: extensionId, url: origin + '/different-project/', frameId: 0 }]) {
    const h = workerHarness(sender === undefined ? null : sender);
    h.send({ namespace, nonce: randomUUID(), type: 'hello' }); await h.flush();
    assert.equal(h.pair.disconnected, true);
    assert.equal(h.calls.length, 0);
  }
});

test('worker rejects misuse and arbitrary endpoints, preserving exact route/token bounds', async () => {
  const h = workerHarness(); const nonce = randomUUID();
  h.send({ namespace, nonce, type: 'hello' }); await h.flush();
  const invalid = [
    { path: 'https://evil.example/api/health', method: 'GET' },
    { path: '//evil.example/api/health', method: 'GET' },
    { path: '/api/health?token=secret', method: 'GET' },
    { path: '/api/../server/app.py', method: 'GET' },
    { path: '/api/health', method: 'DELETE' },
    { path: '/api/health', method: 'GET', body: '{}' },
    { path: '/api/extract', method: 'POST', body: '{"url":"x","proxy":"evil"}' },
    { path: '/api/extract', method: 'POST', body: '{"url":"x"}', token: 'bad\r\nheader' },
    { path: '/api/extract', method: 'POST', body: '{"url":"x"}', token: undefined },
    { path: '/api/jobs/' + 'a'.repeat(32) + '/download', method: 'POST', body: '{"item_ids":["../../secret"]}' },
    { path: '/api/jobs/' + 'a'.repeat(32) + '/download', method: 'POST', body: JSON.stringify({ item_ids: Array(101).fill('1') }) }
  ];
  for (const value of invalid) h.send({ namespace, nonce, type: 'request', id: randomUUID(), token, ...value });
  await h.flush(); assert.equal(h.calls.length, 0);
  h.send({ namespace, nonce, type: 'close' });
});

test('worker chunks survive Chrome JSON serialization, demand ordered acknowledgements and cancel', async () => {
  const bytes = new Uint8Array(110000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const h = workerHarness(undefined, () => new Response(bytes, { headers: { 'Content-Type': 'application/zip' } }));
  const nonce = randomUUID(), id = randomUUID();
  h.send({ namespace, nonce, type: 'hello' }); await h.flush();
  h.send({ namespace, nonce, id, type: 'request', path: '/api/jobs/' + 'a'.repeat(32) + '/download', method: 'POST', body: '{"item_ids":["1"]}', token });
  await h.flush();
  assert.equal(h.calls[0].url, 'http://127.0.0.1:8765/api/jobs/' + 'a'.repeat(32) + '/download');
  assert.equal(h.calls[0].authorizationAtFetch, 'Bearer ' + token);
  assert.equal(h.calls[0].options.redirect, 'error'); assert.equal(h.calls[0].options.credentials, 'omit');
  const chunks = () => h.pair.sent.filter(m => m.from === 'worker' && m.data.type === 'chunk').map(m => m.data);
  assert.equal(chunks().length, 1);
  h.send({ namespace, nonce, id, type: 'ack', seq: 9 }); await h.flush(); assert.equal(chunks().length, 1);
  for (let seq = 0; seq < 3; seq++) { assert.equal(chunks()[seq].seq, seq); h.send({ namespace, nonce, id, type: 'ack', seq }); await h.flush(); }
  assert.equal(h.pair.sent.at(-1).data.type, 'complete');
  assert.deepEqual(Buffer.concat(chunks().map(c => Buffer.from(c.base64, 'base64'))), Buffer.from(bytes));
  assert.ok(chunks().every(c => c.base64.length <= 65536));
  assert.ok(!JSON.stringify(h.pair.sent.filter(m => m.from === 'worker')).includes(token));
  const cancelledId = randomUUID(); h.send({ namespace, nonce, id: cancelledId, type: 'request', path: '/api/health', method: 'GET' }); await h.flush();
  h.send({ namespace, nonce, id: cancelledId, type: 'cancel' }); await h.flush();
  assert.ok(h.calls[1].options.signal.aborted);
  h.send({ namespace, nonce, type: 'close' }); await h.flush();
});

test('complete page/content/worker pipeline transports multichunk ZIP bytes and closes without popups', async () => {
  const bytes = new Uint8Array(120000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
  bytes.set([80, 75, 3, 4]); // ZIP header controls survive binary transport
  const h = workerHarness(undefined, () => new Response(bytes, { headers: { 'Content-Type': 'application/zip' } }));
  const listeners = new Map(), posted = [];
  const window = { location: { href: pageURL, origin, hostname: 'namanguptaaaa.github.io', protocol: 'https:' }, open() { throw new Error('Extension transport must not open windows'); }, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, postMessage(data, target) { assert.equal(target, origin); posted.push(data); queueMicrotask(() => { for (const fn of [...(listeners.get('message') || [])]) fn({ data, origin, source: window }); }); } };
  window.top = window;
  const shared = { window, location: window.location, URL, Blob, Response, Uint8Array, TextEncoder, DOMException, AbortController, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: storageTrap(), sessionStorage: storageTrap() };
  let connectCount = 0;
  const contentContext = vm.createContext({ ...shared, chrome: { runtime: { connect(options) { connectCount++; assert.equal(options.name, namespace); return h.pair.left; } } } });
  vm.runInContext(source('extension/validation.js'), contentContext);
  vm.runInContext(source('extension/content.js'), contentContext);
  for (const fn of listeners.get('message')) {
    fn({ data: { namespace, nonce: randomUUID(), type: 'hello' }, source: {}, origin });
    fn({ data: { namespace, nonce: randomUUID(), type: 'hello' }, source: window, origin: 'https://evil.example' });
  }
  assert.equal(connectCount, 0);
  vm.runInNewContext(source('web/extension-client.js'), { ...shared, crypto: { randomUUID } });
  const client = window.createLocalMediaExtension(); await client.ready;
  window.postMessage({ namespace, nonce: randomUUID(), type: 'request', id: randomUUID(), path: '/api/health', method: 'GET' }, origin);
  await h.flush(); assert.equal(h.calls.length, 0);
  const response = await client.request('/api/jobs/' + 'a'.repeat(32) + '/download', { method: 'POST', body: '{"item_ids":["1"]}' }, token);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes));
  assert.equal(posted.filter(m => m.type === 'ack').length, 3);
  assert.ok(!JSON.stringify(posted.filter(m => ['headers', 'chunk', 'complete', 'ready'].includes(m.type))).includes(token));
  client.close(); await h.flush(); assert.equal(h.pair.disconnected, true);
});

test('worker nonce and concurrency limits block unhandshaken, duplicate and overflow requests', async () => {
  const h = workerHarness(undefined, (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
  const nonce = randomUUID(), id = randomUUID();
  const request = { namespace, nonce, id, type: 'request', path: '/api/health', method: 'GET' };
  h.send(request); await h.flush(); assert.equal(h.calls.length, 0);
  h.send({ namespace, nonce, type: 'hello' }); await h.flush();
  h.send({ ...request, nonce: randomUUID() }); await h.flush(); assert.equal(h.calls.length, 0);
  h.send(request); h.send(request); await h.flush(); assert.equal(h.calls.length, 1);
  for (let i = 0; i < 8; i++) h.send({ ...request, id: randomUUID() });
  await h.flush(); assert.equal(h.calls.length, 8);
  h.send({ namespace, nonce, type: 'close' }); await h.flush();
  assert.ok(h.calls.every(call => call.options.signal.aborted));
});

test('hosted application defaults to extension and missing extension never opens fallback window', async () => {
  const elements = new Map(); let bridgeCalls = 0, popupCalls = 0;
  const node = id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: false, disabled: false, checked: false, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, replaceChildren() {}, focus() {}, removeAttribute() {} }); return elements.get(id); };
  const missing = 'Chrome extension not detected. Install it and reconnect. No extra window is opened.';
  const window = { location: { origin, hostname: 'namanguptaaaa.github.io', protocol: 'https:' }, addEventListener() {}, open() { popupCalls++; throw new Error('Must not open popup'); }, createLocalMediaBridge() { bridgeCalls++; throw new Error('Must not fallback'); }, createLocalMediaExtension() { return { close() {}, async request() { throw new Error(missing); } }; } };
  vm.runInNewContext(source('web/app.js'), { window, document: { getElementById: node }, URL, Headers, AbortController, DOMException, setTimeout, clearTimeout, fetch() { throw new Error('Must use extension adapter'); } });
  assert.equal(node('connection-mode').value, 'extension');
  node('token').value = token;
  await node('connection-form').listeners.submit({ preventDefault() {} });
  assert.equal(bridgeCalls, 0); assert.equal(popupCalls, 0);
  assert.equal(node('status-text').textContent, missing);
  assert.equal(node('token').value, '');
});
