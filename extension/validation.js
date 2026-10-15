'use strict';
// Shared inert validation; both isolated content and background enforce it.
globalThis.MediaRelay = Object.freeze({
  namespace: 'local-media-extension-v1',
  endpoint: 'http://127.0.0.1:8765',
  chunkBytes: 49152,
  maxRequests: 8,
  maxBytes: 4 * 1024 ** 3 + 1024 ** 2,
  safeId: value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value),
  validOptions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['format', 'max_height', 'audio_bitrate', 'start_seconds', 'end_seconds'].includes(key))) return false;
    const { format = 'original', max_height = null, audio_bitrate = 320, start_seconds = 0, end_seconds = null } = value;
    if (!['original', 'mp4', 'mp3', 'wav'].includes(format) || (max_height !== null && ![360, 480, 720, 1080, 1440, 2160, 4320].includes(max_height)) || ![128, 192, 256, 320].includes(audio_bitrate)) return false;
    if (!Number.isFinite(start_seconds) || start_seconds < 0 || start_seconds > 86400 || (end_seconds !== null && (!Number.isFinite(end_seconds) || end_seconds <= start_seconds || end_seconds > 86400))) return false;
    if (['mp3', 'wav'].includes(format) && max_height !== null) return false;
    if (format !== 'mp3' && audio_bitrate !== 320) return false;
    return format !== 'original' || (start_seconds === 0 && end_seconds === null);
  },
  allowedPage(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://namanguptaaaa.github.io' && url.pathname.startsWith('/media-downloader/');
    } catch { return false; }
  },
  validRequest(message) {
    if (!message || !this.safeId(message.id) || !this.safeId(message.nonce) || !['GET', 'POST'].includes(message.method) || typeof message.path !== 'string') return false;
    const get = message.method === 'GET' && (message.path === '/api/health' || /^\/api\/jobs\/[a-f0-9]{32}(?:\/files\/[0-9]{1,8})?$/.test(message.path));
    const post = message.method === 'POST' && (message.path === '/api/extract' || /^\/api\/jobs\/[a-f0-9]{32}\/download$/.test(message.path));
    if (!(get || post)) return false;
    if (message.token !== undefined && (typeof message.token !== 'string' || message.token.length > 4096 || !/^[\x21-\x7e]+$/.test(message.token))) return false;
    if (message.path !== '/api/health' && !message.token) return false;
    if (get) return message.body === undefined;
    if (typeof message.body !== 'string' || new TextEncoder().encode(message.body).byteLength > 8192) return false;
    try {
      const body = JSON.parse(message.body);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
      if (message.path === '/api/extract') return Object.keys(body).every(key => ['url', 'options'].includes(key)) && typeof body.url === 'string' && body.url.length <= 2048 && (!Object.hasOwn(body, 'options') || this.validOptions(body.options));
      return Object.keys(body).length === 1 && Array.isArray(body.item_ids) && body.item_ids.length > 0 && body.item_ids.length <= 100 && body.item_ids.every(id => typeof id === 'string' && /^[0-9]{1,8}$/.test(id));
    } catch { return false; }
  }
});
