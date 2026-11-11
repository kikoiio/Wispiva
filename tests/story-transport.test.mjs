import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from '../transport/http-server.mjs';
import { createStoryExperience } from '../creation/story-experience.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
class Reply extends EventEmitter {
  headersSent = false; destroyed = false; chunks = [];
  writeHead(code, headers) { this.code = code; this.headers = headers; this.headersSent = true; }
  flushHeaders() {}
  write(chunk) { this.chunks.push(String(chunk)); return true; }
  end(chunk) { if (chunk !== undefined) this.write(chunk); if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
  get text() { return this.chunks.join(''); }
  get json() { return JSON.parse(this.text); }
}
function fixture(t) {
  const story = createStoryExperience({ configLoader: () => { throw new Error('offline'); } });
  const experience = { state: story.state, control: () => ({ ok: false }), cancelModel: story.cancel, close: story.close };
  const { server } = createHttpServer({ experience, assetRoot: root, story });
  server.address = () => ({ port: 5175 }); t.after(() => server.emit('close'));
  return async (path, body, headers = {}) => {
    const request = Readable.from(body ? [JSON.stringify(body)] : []);
    request.url = path; request.method = body ? 'POST' : 'GET';
    request.headers = { host: '127.0.0.1:5175', ...(body ? { 'content-type': 'application/json' } : {}), ...headers };
    const response = new Reply(); await server.listeners('request')[0](request, response); return response;
  };
}

test('story homepage imports a complete public browser graph and exposes no creation wizard', async t => {
  const invoke = fixture(t), page = await invoke('/');
  assert.equal(page.code, 200); assert.match(page.text, /\/ui\/story-app\.js/);
  assert.doesNotMatch(page.text, /creation-mode|creation-chat|world-generate|生成世界|上传文本/);
  const importMap = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(page.text)[1]).imports;
  const pending = ['/ui/story-app.js', '/ui/story.css'], visited = new Set();
  for (const path of pending) {
    if (visited.has(path)) continue; visited.add(path);
    const response = await invoke(path); assert.equal(response.code, 200, path);
    if (path.endsWith('.css')) continue;
    for (const match of response.text.matchAll(/\bimport\s*(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g)) {
      const specifier = importMap[match[1]] ?? match[1];
      assert.match(specifier, /^(?:\.|\/)/, path);
      pending.push(new URL(specifier, `http://127.0.0.1${path}`).pathname);
    }
  }
  for (const path of ['/spatial/red-headed-world.js', '/spatial/story-navigation.js', '/rendering/story-scene.js', '/rendering/story-mesh.js', '/vendor/three.core.js']) assert(visited.has(path), path);
});

test('story navigation works through JSON and SSE while generic creation is unavailable', async t => {
  const invoke = fixture(t);
  assert.equal((await invoke('/api/story-state')).json.model.configured, false);
  const result = await invoke('/api/story-chat', { message: '去当铺' });
  assert.equal(result.json.ok, true); assert.equal(result.json.focus, 'pawnshop');
  const streamed = await invoke('/api/story-chat', { message: '看看地道' }, { accept: 'text/event-stream' });
  assert.equal(streamed.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.match(streamed.text, /event: result\ndata: .*"focus":"tunnel"/);
  for (const path of ['/api/creation-chat', '/api/world-generate', '/api/actor-step']) assert.equal((await invoke(path, { message: '创建一个世界' })).code, 404);
  assert.equal((await invoke('/api/story-chat', { message: '去当铺' }, { origin: 'https://elsewhere.invalid' })).code, 403);
  assert.equal((await invoke('/api/story-cancel', {})).json.ok, true);
});
