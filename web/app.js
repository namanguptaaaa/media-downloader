'use strict';
const $ = id => document.getElementById(id);
let connection = null;
let generation = 0;
let controller = null;
let currentJob = null;
let selected = new Set();
let busy = false;
let downloading = false;
let downloadController = null;
function localHost(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host) || /\.(local|internal)$/.test(host) || /^\[f[cd][0-9a-f]{2}:/i.test(host);
}
function connectionMode() {
  const mode = $('connection-mode').value;
  const extension = mode === 'extension';
  $('endpoint').readOnly = extension;
  if (extension) $('endpoint').value = 'http://127.0.0.1:8765';
  $('trust-server').disabled = extension;
  $('extension-help').hidden = !extension;
  $('server-help').textContent = extension ? 'The extension connects to the companion on your machine at this fixed address, without an extra window.' : mode === 'bridge' ? 'This optional method opens a local window. Keep it open while downloading. Use HTTP localhost.' : 'Use localhost, a private IP address, or your private HTTPS server. This method makes direct requests.';
}
$('connection-mode').value = localHost(window.location.hostname) || window.location.protocol !== 'https:' ? 'direct' : 'extension';
connectionMode();
$('connection-mode').addEventListener('change', () => { if (connection) disconnect(); connectionMode(); });

function status(message, type = '') {
  $('status-text').textContent = message;
  $('status').className = `status ${type}`;
  $('status-icon').textContent = type === 'error' ? '!' : type === 'success' ? '✓' : '○';
}

function endpoint(value) {
  const parsed = new URL(value.trim());
  const host = parsed.hostname.toLowerCase();
  const ipv4 = host.split('.').map(Number);
  const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && ipv4.every(n => n >= 0 && n <= 255);
  const privateV4 = isV4 && (ipv4[0] === 127 || ipv4[0] === 10 || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31));
  const privateV6 = host === '[::1]' || /^\[f[cd][0-9a-f]{2}:/i.test(host);
  const privateName = host === 'localhost' || /\.(localhost|local|internal)$/.test(host);
  const trustedHost = parsed.protocol === 'https:' && $('trust-server').checked;
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '') || !(privateV4 || privateV6 || privateName || trustedHost)) {
    throw new Error('Enter a local or private HTTP(S) server address, or acknowledge that you control a custom HTTPS server. Use no embedded credentials, path, or query.');
  }
  return parsed.origin;
}

async function request(path, options = {}, authenticated = true) {
  if (!connection) throw new Error('Connect your private server first.');
  const headers = new Headers(options.headers || {});
  if (authenticated) headers.set('Authorization', `Bearer ${connection.token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  let response;
  try {
    const adapter = connection.extension || connection.bridge;
    response = adapter ? await adapter.request(path, options, authenticated ? connection.token : undefined) : await fetch(connection.endpoint + path, { ...options, headers, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (connection?.extension || connection?.bridge) throw error;
    throw new Error('Cannot reach the private server. Check its address, that it is running, and that this page’s origin is allowed by its CORS configuration. A browser may also require local network permission or HTTPS for a remote private server.');
  }
  if (!response.ok) {
    let detail;
    try { const data = await response.json(); detail = typeof data.detail === 'string' ? data.detail : typeof data.error === 'string' ? data.error : null; } catch { /* Fall back to status. */ }
    throw new Error(response.status === 401 || response.status === 403 ? 'Access denied. Check the server token and allowed page origin, then reconnect.' : detail || `Server request failed (${response.status}).`);
  }
  return response;
}

function stop(reset = false) {
  generation += 1;
  controller?.abort();
  downloadController?.abort();
  controller = null;
  busy = false;
  $('progress-area').hidden = true;
  $('extract').disabled = !connection;
  if (reset) {
    currentJob = null;
    selected.clear();
    $('results').hidden = true;
    $('media-list').replaceChildren();
  }
}

function disconnect() {
  stop(true);
  connection?.bridge?.close();
  connection?.extension?.close();
  connection = null;
  $('token').value = '';
  $('media-url').disabled = true;
  $('extract').disabled = true;
  $('disconnect').hidden = true;
  $('connection-badge').textContent = 'Disconnected';
  $('connection-badge').className = 'badge';
  $('dependency-notice').hidden = true;
  $('connection-panel').open = true;
  status('Disconnected. Connect your private server to continue.');
}

$('connection-form').addEventListener('submit', async event => {
  event.preventDefault();
  stop(true);
  const attempt = generation;
  let checkTimeout;
  let timedOut = false;
  $('connect').disabled = true;
  try {
    const address = endpoint($('endpoint').value);
    const token = $('token').value.trim();
    if (!token) throw new Error('Paste the access token from your server terminal.');
    connection?.bridge?.close();
    connection?.extension?.close();
    connection = { endpoint: address, token };
    const serverURL = new URL(address);
    const loopback = serverURL.hostname === 'localhost' || serverURL.hostname.endsWith('.localhost') || serverURL.hostname === '[::1]' || /^127\./.test(serverURL.hostname);
    if ($('connection-mode').value === 'extension') {
      if (address !== 'http://127.0.0.1:8765') throw new Error('The Chrome extension uses http://127.0.0.1:8765. Choose Direct connection for your private server.');
      connection.extension = window.createLocalMediaExtension(message => { disconnect(); status(message, 'error'); });
    } else if ($('connection-mode').value === 'bridge') {
      if (serverURL.protocol !== 'http:' || !loopback) throw new Error('The optional bridge needs an HTTP localhost companion address. Choose Direct connection for a private HTTPS server.');
      connection.bridge = window.createLocalMediaBridge(address, message => { disconnect(); status(message, 'error'); });
    }
    controller = new AbortController();
    const checkController = controller;
    checkTimeout = setTimeout(() => { timedOut = true; checkController.abort(); }, 15000);
    status(connection.extension ? 'Connecting through the Chrome extension in the background…' : connection.bridge ? 'Opening your local bridge. Keep its window open while this page checks the server…' : 'Checking your private server…');
    const health = await (await request('/api/health', { signal: controller.signal }, false)).json();
    if (attempt !== generation) return;
    if (health.status !== 'ok') throw new Error('The server did not report a healthy connection.');
    $('connection-badge').textContent = health.demo ? 'Demo · sample files' : connection.extension ? 'Background extension connected' : connection.bridge ? 'Local bridge connected' : 'Server connected';
    $('connection-badge').className = `badge ${health.demo ? 'demo' : 'connected'}`;
    const missing = [];
    if (!health.yt_dlp) missing.push('yt-dlp (video extraction)');
    if (!health.gallery_dl) missing.push('gallery-dl (image extraction)');
    if (!health.ffmpeg) missing.push('FFmpeg (merging highest-quality video and audio)');
    if (health.js_runtime === false || health.js_runtime === null) missing.push('a supported JavaScript runtime such as Deno (YouTube extraction)');
    if (health.yt_dlp_ejs === null || health.yt_dlp_ejs === false) missing.push('yt-dlp-ejs (YouTube JavaScript challenge support)');
    const notices = [];
    if (connection.extension) notices.push('Background extension connected to your local companion. You can keep using this tab; no bridge window is needed.');
    if (connection.bridge) notices.push('Local bridge connected. Keep its window open while extracting and downloading. Links and credentials pass only to your local companion.');
    if (health.demo) notices.push('Demo mode: extraction returns local sample files. It does not download the supplied link.');
    if (missing.length && !health.demo) notices.push(`Install missing server dependencies: ${missing.join(', ')}. Restart the server after installation.`);
    $('dependency-notice').textContent = notices.join(' ');
    $('dependency-notice').hidden = !notices.length;
    $('disconnect').hidden = false;
    $('media-url').disabled = false;
    $('extract').disabled = false;
    $('connection-panel').open = false;
    $('token').value = '';
    status('Server available. Paste a link to extract media. The token will be checked when extraction starts.', 'success');
    $('media-url').focus();
  } catch (error) {
    if (attempt !== generation || (error.name === 'AbortError' && !timedOut)) return;
    disconnect();
    status(timedOut ? 'The server did not respond within 15 seconds. Check its address and try again.' : error.message, 'error');
  } finally { clearTimeout(checkTimeout); $('connect').disabled = false; }
});
$('disconnect').addEventListener('click', disconnect);

function mediaURL(value) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use an HTTPS media link without embedded credentials.');
  const host = parsed.hostname.toLowerCase();
  const domains = ['youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'instagram.com', 'reddit.com', 'redd.it'];
  if (!domains.some(domain => host === domain || host.endsWith('.' + domain))) throw new Error('Use a YouTube, X / Twitter, Instagram, or Reddit link.');
  return parsed.href;
}

const delay = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});

function updateOptions() {
  const format = $('export-format').value;
  const original = format === 'original';
  const audio = format === 'mp3' || format === 'wav';
  $('video-quality').hidden = audio;
  $('max-height').disabled = audio;
  $('audio-quality').hidden = format !== 'mp3';
  $('audio-bitrate').disabled = format !== 'mp3';
  $('start-seconds').disabled = original;
  $('end-seconds').disabled = original;
  if (original) { $('start-seconds').value = '0'; $('end-seconds').value = ''; }
  const help = { original: 'Keep the original video without conversion. Original images are always included unchanged.', mp4: 'MP4 converts video to H.264 and audio to AAC for compatibility. Re-encoding changes quality; original images stay unchanged.', mp3: 'Extract audio and convert it to MP3. Original images stay unchanged.', wav: 'Decode audio to uncompressed WAV. This does not improve source quality; original images stay unchanged.' };
  $('format-help').textContent = help[format];
  $('trim-help').textContent = original ? 'Choose MP4, MP3, or WAV to trim video/audio. Images are unaffected.' : 'Optional clip boundaries, up to 86,400 seconds. End must be after start and within the source duration. Images are unaffected.';
}
function extractionPayload(url) {
  const format = $('export-format').value;
  if (!['original', 'mp4', 'mp3', 'wav'].includes(format)) throw new Error('Choose a supported export format.');
  const audio = format === 'mp3' || format === 'wav';
  const height = $('max-height').value;
  const max_height = audio || height === '' ? null : Number(height);
  const audio_bitrate = format === 'mp3' ? Number($('audio-bitrate').value) : 320;
  const start_seconds = secondsNumber($('start-seconds').value, 0);
  const end_seconds = $('end-seconds').value.trim() === '' ? null : secondsNumber($('end-seconds').value);
  if (max_height !== null && ![360, 480, 720, 1080, 1440, 2160, 4320].includes(max_height)) throw new Error('Choose a supported maximum video resolution.');
  if (![128, 192, 256, 320].includes(audio_bitrate)) throw new Error('Choose a supported MP3 bitrate.');
  if (!Number.isFinite(start_seconds) || start_seconds < 0 || start_seconds > 86400 || (end_seconds !== null && (!Number.isFinite(end_seconds) || end_seconds <= start_seconds || end_seconds > 86400))) throw new Error('Enter valid clip seconds: start from 0 to 86,400; end must be after start and no later than 86,400.');
  if (format === 'original' && (start_seconds !== 0 || end_seconds !== null)) throw new Error('Choose MP4, MP3, or WAV to trim video/audio.');
  if (format === 'original' && max_height === null) return { url };
  return { url, options: { format, max_height, audio_bitrate, start_seconds, end_seconds } };
}
function secondsNumber(value, empty = NaN) { return value.trim() === '' ? empty : Number(value); }
$('export-format').addEventListener('change', updateOptions);
$('reset-options').addEventListener('click', () => {
  $('export-format').value = 'original'; $('max-height').value = ''; $('audio-bitrate').value = '320'; $('start-seconds').value = '0'; $('end-seconds').value = ''; updateOptions();
});
updateOptions();

$('extract-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !connection) return;
  stop(true);
  const attempt = generation;
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const url = mediaURL($('media-url').value);
    busy = true;
    $('extract').disabled = true;
    $('progress-area').hidden = false;
    $('progress').removeAttribute('value');
    status('Starting extraction on your private server…');
    const initial = await (await request('/api/extract', { method: 'POST', body: JSON.stringify(extractionPayload(url)), signal })).json();
    if (!initial.id) throw new Error('The server did not return a job ID.');
    while (attempt === generation) {
      const job = await (await request(`/api/jobs/${encodeURIComponent(initial.id)}`, { signal })).json();
      if (attempt !== generation) return;
      if (job.state === 'error') throw new Error(typeof job.error === 'string' ? job.error : 'Extraction failed. Check server dependencies and authentication cookies.');
      if (job.state === 'ready') {
        currentJob = job;
        renderResults(job);
        const partial = Array.isArray(job.warnings) && job.warnings.length;
        status(job.items?.length ? (partial ? 'Some media is ready. Review extraction warnings below before downloading.' : 'Your media is ready. Select files to download.') : 'Extraction completed without downloadable media.', job.items?.length && !partial ? 'success' : '');
        $('results-title').focus();
        break;
      }
      if (!['queued', 'running'].includes(job.state)) throw new Error('The server returned an unknown extraction state.');
      const activity = job.downloaded_bytes > 0 ? ` · ${bytes(job.downloaded_bytes)} received${job.speed_bytes > 0 ? ` · ${bytes(job.speed_bytes)}/s` : ''}` : '';
      status((job.phase || (job.state === 'queued' ? 'Queued on your server…' : 'Extracting media…')) + activity);
      if (Number.isFinite(job.progress)) $('progress').value = Math.max(0, Math.min(100, job.progress));
      else $('progress').removeAttribute('value');
      await delay(1000, signal);
    }
  } catch (error) {
    if (attempt === generation && error.name !== 'AbortError') status(error.message, 'error');
  } finally {
    if (attempt === generation) { busy = false; $('extract').disabled = !connection; $('progress-area').hidden = true; }
  }
});
$('stop-waiting').addEventListener('click', () => { stop(); status('Stopped waiting. The server may still be processing this job. Paste a link to start another extraction.'); });

function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Size unavailable';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let index = -1;
  do { value /= 1024; index += 1; } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

function updateSelection() {
  const count = currentJob?.items?.length || 0;
  $('select-all').checked = count > 0 && selected.size === count;
  $('select-all').indeterminate = selected.size > 0 && selected.size < count;
  $('download-selected').disabled = !selected.size || downloading;
  $('download-selected').textContent = downloading ? 'Preparing download…' : `Download selected ZIP (${selected.size})`;
}

function renderResults(job) {
  const items = Array.isArray(job.items) ? job.items : [];
  selected = new Set(items.map(item => item.id));
  $('results-title').textContent = job.title || 'Your media';
  $('results-title').tabIndex = -1;
  $('result-platform').textContent = job.platform || 'MEDIA';
  $('result-count').textContent = `${items.length} ${items.length === 1 ? 'file' : 'files'}`;
  const warnings = Array.isArray(job.warnings) ? job.warnings.filter(value => typeof value === 'string') : [];
  $('result-warnings').textContent = warnings.length ? `Extraction warnings: ${warnings.join(' ')}` : '';
  $('result-warnings').hidden = !warnings.length;
  $('media-list').replaceChildren();
  for (const item of items) {
    const row = document.createElement('li'); row.className = 'media-item';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.itemId = item.id; checkbox.setAttribute('aria-label', `Select ${item.filename}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(item.id) : selected.delete(item.id); updateSelection(); });
    const symbol = document.createElement('span'); symbol.className = 'media-symbol'; symbol.textContent = item.kind === 'image' ? '▧' : item.kind === 'audio' ? '♫' : '▷'; symbol.setAttribute('aria-hidden', 'true');
    const info = document.createElement('div'); info.className = 'media-info';
    const name = document.createElement('p'); name.className = 'media-name'; name.textContent = item.filename;
    const meta = document.createElement('p'); meta.className = 'media-meta'; meta.textContent = `${item.kind === 'image' ? 'IMAGE' : item.kind === 'audio' ? 'AUDIO' : 'VIDEO'} · ${bytes(item.size)}`;
    info.append(name, meta);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Download ↓'; button.setAttribute('aria-label', `Download ${item.filename}`);
    button.addEventListener('click', () => download(`/api/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(item.id)}`, item.filename, {}, button));
    row.append(checkbox, symbol, info, button); $('media-list').append(row);
  }
  $('results').hidden = false;
  updateSelection();
}
$('select-all').addEventListener('change', () => {
  const checked = $('select-all').checked;
  selected = new Set(checked ? currentJob.items.map(item => item.id) : []);
  for (const checkbox of $('media-list').querySelectorAll('input[type=checkbox]')) checkbox.checked = checked;
  updateSelection();
});

async function download(path, filename, options = {}, button = null) {
  if (downloading || !connection) return;
  const attempt = generation;
  downloading = true;
  downloadController = new AbortController();
  if (button) button.disabled = true;
  updateSelection();
  let sink = null;
  let saved = false;
  try {
    // Invoke the picker in this click's activation, before waiting for network.
    // Chrome streams to disk with bounded buffers; no extension permissions added.
    if (typeof window.showSaveFilePicker === 'function' && !connection.bridge) {
      status('Choose where to save. Transfer starts as soon as you confirm.');
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      if (attempt !== generation) return;
      sink = await handle.createWritable();
    }
    let lastUpdate = 0;
    const onProgress = (received, total) => {
      const now = Date.now();
      if (attempt !== generation || now - lastUpdate < 200) return;
      lastUpdate = now;
      status(`Saving ${bytes(received)}${total > 0 ? ` of ${bytes(total)} · ${Math.min(100, Math.round(received / total * 100))}%` : ''}…`);
    };
    status(sink ? 'Streaming files to your selected file…' : 'Transferring files to browser memory…');
    const response = await request(path, { ...options, signal: downloadController.signal, onChunk: sink ? chunk => sink.write(chunk) : undefined, onProgress });
    if (sink) {
      if (!connection.extension) {
        const reader = response.body.getReader();
        let received = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await sink.write(value); received += value.byteLength;
            onProgress(received, Number(response.headers.get('Content-Length')));
          }
        } finally { reader.releaseLock(); }
      }
      if (attempt !== generation) return;
      await sink.close(); saved = true;
      status('File saved to your selected location.', 'success');
      return;
    }
    const blob = await response.blob();
    if (attempt !== generation) return;
    const blobURL = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = blobURL; anchor.download = filename; anchor.hidden = true;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobURL), 60000);
    status('Download handed to your browser. Check your downloads folder.', 'success');
  } catch (error) { if (attempt === generation) status(error.name === 'AbortError' ? 'Save cancelled.' : error.message, error.name === 'AbortError' ? '' : 'error'); }
  finally { downloadController?.abort(); if (sink && !saved) { try { await sink.abort(); } catch { /* Writer already closed. */ } } downloading = false; if (button) button.disabled = false; updateSelection(); }
}
$('download-selected').addEventListener('click', () => {
  if (!currentJob || !selected.size) return;
  download(`/api/jobs/${encodeURIComponent(currentJob.id)}/download`, 'local-media.zip', { method: 'POST', body: JSON.stringify({ item_ids: [...selected] }) });
});
window.addEventListener('pagehide', () => { controller?.abort(); downloadController?.abort(); connection?.bridge?.close(); connection?.extension?.close(); connection = null; $('token').value = ''; });
