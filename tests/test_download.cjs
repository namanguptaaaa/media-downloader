const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const mode of ['extension', 'direct']) test(`${mode}: save picker opens before fetching and chunks go directly to disk`, async () => {
  const events = [], written = [], elements = new Map();
  const node = id => { if (!elements.has(id)) elements.set(id, {value:'',checked:false,listeners:{},addEventListener(n,f){this.listeners[n]=f;},replaceChildren(){},focus(){},removeAttribute(){}});return elements.get(id); };
  const health = () => new Response(JSON.stringify({status:'ok',yt_dlp:'fixture',gallery_dl:'fixture',ffmpeg:true}));
  let cancel = false;
  const sink = {async write(chunk){events.push('write');written.push(Buffer.from(chunk));},async close(){events.push('close');},async abort(){events.push('abort');}};
  const window = {location:{origin:'https://namanguptaaaa.github.io',hostname:'namanguptaaaa.github.io',protocol:'https:'},addEventListener(){},async showSaveFilePicker(options){events.push('picker');assert.equal(options.suggestedName,'fixture.mp4');if(cancel)throw new DOMException('Cancelled','AbortError');return {async createWritable(){events.push('open');return sink;}};}, createLocalMediaExtension(){return {close(){},async request(url,options){if(url==='/api/health')return health();events.push('fetch');await options.onChunk(new Uint8Array([1,2,3]));await options.onChunk(new Uint8Array([4,5]));options.onProgress(5,5);const response=new Response();response.blob=()=>{throw new Error('Must not buffer streamed file');};return response;}};}};
  const context = vm.createContext({window,document:{getElementById:node},URL,Headers,AbortController,DOMException,setTimeout,clearTimeout, async fetch(url){if(url.endsWith('/api/health'))return health();events.push('fetch');return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.enqueue(new Uint8Array([4,5]));controller.close();}}));}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8'),context);
  node('connection-mode').value=mode;node('endpoint').value='http://127.0.0.1:8765';node('token').value='disposable-local-token';
  await node('connection-form').listeners.submit({preventDefault(){}});
  events.length=0;
  await vm.runInContext("download('/api/jobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/files/1','fixture.mp4')",context);
  assert.deepEqual(events,['picker','open','fetch','write','write','close']);
  assert.deepEqual(Buffer.concat(written),Buffer.from([1,2,3,4,5]));
  assert.equal(node('status-text').textContent,'File saved to your selected location.');
  cancel=true;events.length=0;
  await vm.runInContext("download('/api/jobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/files/1','fixture.mp4')",context);
  assert.deepEqual(events,['picker'],'Cancelling Save as must not start a transfer');
  assert.equal(node('status-text').textContent,'Save cancelled.');
});
