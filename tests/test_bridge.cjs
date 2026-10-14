'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bridgeSource = fs.readFileSync(path.join(__dirname, '../web/bridge.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '../web/bridge-client.js'), 'utf8');
const namespace = 'local-media-bridge-v1';
const nonce = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const origin = 'https://private.example';
const token = 'disposable-test-token-private-123';
function timers() {
  const active = new Map(); let serial = 0;
  return { active, setTimeout(fn) { active.set(++serial, fn); return serial; }, clearTimeout(id) { active.delete(id); }, setInterval(fn) { active.set(++serial, fn); return serial; }, clearInterval(id) { active.delete(id); } };
}
function forbiddenStorage() { return new Proxy({}, { get() { throw new Error('Browser storage must not be accessed'); }, set() { throw new Error('Browser storage must not be written'); } }); }
function harness(deferred = false) {
  const sent = [], calls = [], listeners = {}, elements = {};
  const opener = { postMessage(data, target) { sent.push({ data, target }); } };
  const clock = timers();
  const window = { opener, addEventListener(name, fn) { listeners[name] = fn; }, close() {} };
  const context = { window, document: { getElementById(id) { return elements[id] ||= { textContent: '', addEventListener() {} }; } }, localStorage: forbiddenStorage(), sessionStorage: forbiddenStorage(), console: { log() { throw new Error('No logging'); } }, AbortController, Blob, URL, ...clock,
    async fetch(url, options) {
      calls.push({ url, options });
      if (deferred && url !== '/api/health') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      return url === '/api/health' ? new Response(JSON.stringify({ allowed_origins: [origin] }), { headers: { 'Content-Type': 'application/json' } }) : new Response(new Uint8Array([0, 255, 17]), { headers: { 'Content-Type': 'application/octet-stream' } });
    }
  };
  vm.runInNewContext(bridgeSource, context);
  return { sent, calls, opener, async event(data, eventOrigin = origin, source = opener) { await listeners.message({ data: { namespace, nonce, ...data }, origin: eventOrigin, source }); }, clock };
}

test('popup accepts only configured exact origin and original opener', async () => {
  const h = harness();
  await h.event({ type: 'hello' }, 'https://evil.example');
  await h.event({ type: 'hello' }, origin, {});
  await h.event({ type: 'hello' }, 'null');
  assert.equal(h.sent.length, 0);
  await h.event({ type: 'request', id, path: '/api/extract', method: 'POST', token, body: JSON.stringify({ url: 'https://youtu.be/BaW_jenozKc' }) });
  assert.equal(h.calls.length, 1); // only unprivileged local health discovery
  await h.event({ type: 'hello' });
  assert.equal(h.sent[0].data.type, 'ready');
  assert.equal(h.sent[0].target, origin);
  await h.event({ type: 'hello', nonce: '99999999-9999-4999-8999-999999999999' });
  assert.equal(h.sent.length, 1);
});

test('popup rejects arbitrary routes, methods, malformed bodies and token injection', async () => {
  const h = harness(); await h.event({ type: 'hello' });
  const invalid = [
    { path: 'https://evil.example/api/health', method: 'GET' },
    { path: '//evil.example/api/health', method: 'GET' },
    { path: '/api/health?token=secret', method: 'GET' },
    { path: '/api/../server/app.py', method: 'GET' },
    { path: '/api/health', method: 'DELETE' },
    { path: '/api/health', method: 'GET', body: '{}' },
    { path: '/api/extract', method: 'POST', body: JSON.stringify({ url: 'x', proxy: 'evil' }) },
    { path: '/api/extract', method: 'POST', body: 'null' },
    { path: '/api/extract', method: 'POST', body: '{' },
    { path: '/api/extract', method: 'POST', body: '{"url":"x"}', token: 'bad\r\nheader' },
    { path: '/api/extract', method: 'POST', body: '{"url":"x"}', token: undefined },
    { path: '/api/jobs/' + 'a'.repeat(32) + '/download', method: 'POST', body: '{"item_ids":["../../secret"]}' }
  ];
  for (const value of invalid) await h.event({ type: 'request', id, token, ...value });
  assert.equal(h.calls.length, 1);
});

test('popup forwards exact API request and binary Blob with correlated ID and no leaked token', async () => {
  const h = harness(); await h.event({ type: 'hello' });
  await h.event({ type: 'request', id, path: '/api/jobs/' + 'a'.repeat(32) + '/files/1', method: 'GET', token });
  const call = h.calls[1];
  assert.ok(call.url.startsWith('/api/'));
  assert.equal(call.options.headers.Authorization, 'Bearer ' + token);
  assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.referrerPolicy, 'no-referrer');
  const response = h.sent.at(-1);
  assert.equal(response.data.id, id); assert.equal(response.data.nonce, nonce); assert.equal(response.target, origin);
  assert.deepEqual([...new Uint8Array(await response.data.blob.arrayBuffer())], [0, 255, 17]);
  assert.ok(!JSON.stringify(h.sent).includes(token));
  await h.event({ type: 'close' });
  assert.equal(h.clock.active.size, 0);
});

test('popup caps concurrency, rejects duplicate IDs and wrong nonce, aborts on close', async () => {
  const h = harness(true); await h.event({ type: 'hello' });
  const operations = [];
  const request = { type: 'request', path: '/api/jobs/' + 'a'.repeat(32), method: 'GET', token };
  operations.push(h.event({ ...request, id }));
  await new Promise(resolve => setImmediate(resolve));
  await h.event({ ...request, id });
  assert.equal(h.calls.length, 2);
  for (let i = 0; i < 7; i++) operations.push(h.event({ ...request, id: randomUUID() }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 9);
  const duplicate = h.event({ ...request, id: '33333333-3333-4333-8333-333333333333' });
  await duplicate;
  await h.event({ ...request, id, nonce: '99999999-9999-4999-8999-999999999999' });
  assert.equal(h.calls.length, 9);
  await h.event({ type: 'close' });
  await Promise.all(operations);
  assert.ok(h.calls.slice(1).every(call => call.options.signal.aborted));
  assert.equal(h.clock.active.size, 0);
});

test('client uses clean popup URL, rejects spoofed response, correlates Blob and cancels safely', async () => {
  const sent = [], listeners = {}, opened = []; const clock = timers();
  const popup = { closed: false, close() { this.closed = true; }, postMessage(data, target) { sent.push({ data, target }); } };
  const window = { open(url) { opened.push(url); return popup; }, addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; } };
  vm.runInNewContext(clientSource, { window, crypto: { randomUUID }, URL, Blob, Response, DOMException, localStorage: forbiddenStorage(), sessionStorage: forbiddenStorage(), ...clock });
  const client = window.createLocalMediaBridge('http://127.0.0.1:8765');
  assert.deepEqual(opened, ['http://127.0.0.1:8765/bridge.html']);
  const helloTimer = [...clock.active.values()][0]; helloTimer();
  const sessionNonce = sent[0].data.nonce;
  const event = (data, eventOrigin = 'http://127.0.0.1:8765', source = popup) => listeners.message({ data: { namespace, nonce: sessionNonce, ...data }, origin: eventOrigin, source });
  event({ type: 'ready' }, 'https://evil.example');
  event({ type: 'ready' }, 'http://127.0.0.1:8765', {});
  event({ type: 'ready' }); await client.ready;
  const operation = client.request('/api/health', {}, token);
  await new Promise(resolve => setImmediate(resolve));
  const request = sent.find(m => m.data.type === 'request').data;
  event({ type: 'response', id: 'wrong-id', status: 200, blob: new Blob(['wrong']) });
  event({ type: 'response', id: request.id, status: 200, blob: new Blob(['spoofed']) }, 'https://evil.example');
  event({ type: 'response', id: request.id, status: 200, contentType: 'text/plain', blob: new Blob(['correct']) });
  assert.equal(await (await operation).text(), 'correct');
  assert.ok(!opened.join('').includes(token));
  const aborter = new AbortController();
  const cancelled = client.request('/api/health', { signal: aborter.signal });
  await new Promise(resolve => setImmediate(resolve)); aborter.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(sent.at(-1).data.type, 'cancel');
  client.close(); assert.equal(clock.active.size, 0); assert.equal(popup.closed, true);
});
