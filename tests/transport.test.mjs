import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from '../transport/http-server.mjs';
import { createCampExperience, createPrototypeExperience, createCampServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = {
  world: { title: 'Current world' },
  events: [{ id: 'event-1', text: 'A committed action', world: { historical: true } }],
  model: { progress: { preview: 'unverified output', elapsedMs: 2345, phase: 'receiving' } },
};

class Reply extends EventEmitter {
  chunks = [];
  headersSent = false;
  destroyed = false;
  writableNeedDrain = false;
  writeHead(code, headers) { this.code = code; this.headers = headers; this.headersSent = true; }
  flushHeaders() {}
  write(chunk) { this.chunks.push(Buffer.from(chunk)); return !this.writableNeedDrain; }
  end(chunk) {
    if (chunk !== undefined) this.write(chunk);
    if (!this.destroyed) { this.destroyed = true; this.emit('close'); }
  }
  get text() { return Buffer.concat(this.chunks).toString('utf8'); }
  get json() { return JSON.parse(this.text); }
}

function tempDirectory(t) {
  const base = join(root, '.tmp', 'transport-tests');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t, overrides = {}, assetRoot = root) {
  const calls = [];
  const experience = {
    state: () => structuredClone(state),
    control: body => { calls.push(['control', body]); return { ok: true, body }; },
    cancelModel: () => { calls.push(['cancel']); return { ok: true }; },
    close: () => calls.push(['close']),
    ...Object.fromEntries(['actorStep', 'sceneStep', 'worldStep', 'discussStep'].map(name => [name,
      async (body, options) => {
        calls.push([name, body]);
        options?.onProgress({ phase: 'receiving', elapsedMs: 12 });
        return { ok: true, name, body };
      }])),
    ...overrides,
  };
  const { server } = createHttpServer({ experience, assetRoot });
  server.address = () => ({ port: 5175 });
  let closed = false;
  server.once('close', () => { closed = true; });
  t.after(() => { if (!closed) server.emit('close'); });
  const invoke = async (path, { method = 'GET', headers = {}, body, parts, response = new Reply() } = {}) => {
    const request = Readable.from(parts ?? (body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]));
    request.method = method; request.url = path;
    request.headers = { host: '127.0.0.1:5175', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers };
    await server.listeners('request')[0](request, response);
    return response;
  };
  return { server, experience, calls, invoke };
}

test('canonical browser module imports and import-map targets are served with safe asset headers', async t => {
  const f = fixture(t);
  const html = await f.invoke('/');
  assert.equal(html.code, 200);
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(html.text, /src="\/ui\/app\.js"/);
  assert.match(html.text, /href="\/ui\/style\.css"/);
  const importMap = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html.text)[1]).imports;
  const pending = ['/ui/app.js', '/ui/style.css', ...Object.values(importMap)];
  const visited = new Set();
  for (const path of pending) {
    if (visited.has(path)) continue;
    visited.add(path);
    const response = await f.invoke(path);
    assert.equal(response.code, 200, path);
    assert.equal(response.headers['cache-control'], 'no-store', path);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
    if (path.endsWith('.css')) continue;
    assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8', path);
    // Walk the browser's literal module imports without importing or rendering
    // any browser code. This catches a moved file's unserved dependencies.
    for (const match of response.text.matchAll(/\b(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*)['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? match[2];
      const target = importMap[specifier] ?? specifier;
      assert.match(target, /^(?:\.|\/)/, `unmapped import ${specifier} in ${path}`);
      pending.push(new URL(target, `http://127.0.0.1${path}`).pathname);
    }
  }
  for (const path of ['/ui/transport.js', '/residents/actor-location-summary.mjs', '/rendering/scene.js', '/rendering/voxel-scene.js', '/spatial/scene-validation.js']) {
    assert(visited.has(path), `${path} must be reachable from the page`);
  }
  for (const [legacy, canonical] of [
    ['/app.js', '/ui/app.js'], ['/style.css', '/ui/style.css'],
    ['/actor-location-summary.mjs', '/residents/actor-location-summary.mjs'],
    ['/scene.js', '/rendering/scene.js'], ['/geometry/scene-document.js', '/spatial/scene-document.js'],
  ]) assert.equal((await f.invoke(legacy)).text, (await f.invoke(canonical)).text);
});

test('the injected asset root serves only explicitly public files', async t => {
  const assetRoot = tempDirectory(t);
  for (const file of ['ui/index.html', 'ui/transport.js', 'ui/private.js', 'rendering/private.js', 'spatial/private.js', '.data/state.json']) {
    mkdirSync(dirname(join(assetRoot, file)), { recursive: true });
    writeFileSync(join(assetRoot, file), file);
  }
  const f = fixture(t, {}, assetRoot);
  assert.equal((await f.invoke('/')).text, 'ui/index.html');
  assert.equal((await f.invoke('/ui/transport.js')).text, 'ui/transport.js');
  for (const path of [
    '/server.mjs', '/package.json', '/creation/world-runtime.mjs', '/storage/files.mjs',
    '/simulation/core.mjs', '/residents/actor.mjs', '/model/config.mjs', '/rendering/scene-check.mjs',
    '/ui/private.js', '/rendering/private.js', '/spatial/private.js', '/.data/state.json',
    '/ui/../.data/state.json', '/ui/%2e%2e/.data/state.json', '/ui/%2e%2e%2f.data/state.json',
    '/geometry/private.js', '/__proto__', '/constructor',
  ]) assert.equal((await f.invoke(path)).code, 404, path);
  assert.deepEqual((await f.invoke('/geometry/private.js')).json, { ok: false });
});

test('loopback host, POST origin, method, content-type and JSON protections retain their responses', async t => {
  const f = fixture(t);
  for (const host of ['example.com:5175', '127.0.0.1:1234', 'localhost', '[::1]:5175']) {
    const response = await f.invoke('/api/state', { headers: { host } });
    assert.equal(response.code, 403); assert.equal(response.json.message, '仅允许本机访问。');
  }
  assert.equal((await f.invoke('/api/state', { headers: { host: 'localhost:5175' } })).code, 200);
  const post = (body, headers = {}) => f.invoke('/api/control', { method: 'POST', body, headers });
  const foreign = await post({}, { origin: 'https://example.com' });
  assert.equal(foreign.code, 403); assert.equal(foreign.json.message, '来源不匹配。');
  for (const origin of ['http://127.0.0.1:5175', 'http://localhost:5175']) assert.equal((await post({}, { origin })).code, 200);
  assert.equal((await post({}, { 'content-type': 'text/plain' })).code, 415);
  assert.equal((await post({}, { 'content-type': 'application/json; charset=utf-8' })).code, 200);
  for (const body of ['{', 'null', '[]', 'true', '"text"']) assert.equal((await post(body)).code, 400, body);
  assert.equal((await f.invoke('/api/state', { method: 'PUT', body: {} })).code, 404);
  assert.equal((await f.invoke('/api/missing', { method: 'POST', body: {} })).code, 404);
});

test('JSON decoding preserves split UTF-8 and applies each route limit to bytes', async t => {
  const f = fixture(t);
  const body = { message: '中文🧭' }, encoded = Buffer.from(JSON.stringify(body));
  const split = await f.invoke('/api/control', { method: 'POST', parts: [...encoded].map(byte => Buffer.from([byte])) });
  assert.deepEqual(split.json.body, body);
  for (const [path, limit] of [['/api/control', 512 * 1024], ['/api/actor-step', 32768]]) {
    const text = JSON.stringify({ text: 'a'.repeat(limit - Buffer.byteLength(JSON.stringify({ text: '' }))) });
    assert.equal((await f.invoke(path, { method: 'POST', body: text })).code, 200, path);
    const oversized = await f.invoke(path, { method: 'POST', body: `${text} ` });
    assert.equal(oversized.code, 413); assert.equal(oversized.json.message, '请求过大。');
  }
  const wide = JSON.stringify({ text: '中'.repeat(12000) });
  assert(wide.length < 32768 && Buffer.byteLength(wide) > 32768);
  assert.equal((await f.invoke('/api/actor-step', { method: 'POST', body: wide })).code, 413);
});

test('JSON and SSE endpoints dispatch to the injected experience and preserve progress and results', async t => {
  const f = fixture(t);
  assert.deepEqual((await f.invoke('/api/state')).json, state);
  for (const [path, name] of [
    ['/api/actor-step', 'actorStep'], ['/api/scene-generate', 'sceneStep'],
    ['/api/world-generate', 'worldStep'], ['/api/creation-chat', 'discussStep'],
  ]) {
    const body = { instruction: 'A request' };
    assert.deepEqual((await f.invoke(path, { method: 'POST', body })).json, { ok: true, name, body });
    const response = await f.invoke(path, { method: 'POST', body, headers: { accept: 'text/event-stream' } });
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(response.headers['x-accel-buffering'], 'no');
    assert.match(response.text, /event: progress\ndata: .*receiving/);
    assert.match(response.text, new RegExp(`event: result\\ndata: .*${name}`));
    assert.equal(response.destroyed, true);
    assert.equal(response.listenerCount('close'), 0);
  }
  assert.equal((await f.invoke('/api/model-cancel', { method: 'POST', body: {} })).json.ok, true);
  assert.deepEqual(f.calls.at(-1), ['cancel']);
  const camp = fixture(t, { worldStep: undefined, discussStep: undefined });
  for (const path of ['/api/world-generate', '/api/creation-chat']) {
    const response = await camp.invoke(path, { method: 'POST', body: {}, headers: { accept: 'text/event-stream' } });
    assert.equal(response.code, 404); assert.deepEqual(response.json, { ok: false });
  }
});

test('live state SSE strips history worlds and previews and closes with the HTTP server', async t => {
  const f = fixture(t);
  const response = await f.invoke('/api/events');
  assert.equal(response.headers['cache-control'], 'no-cache, no-transform');
  const frame = JSON.parse(response.text.split('\ndata: ')[1]);
  assert.deepEqual(frame.events, [{ id: 'event-1', text: 'A committed action' }]);
  assert.deepEqual(frame.model.progress, { preview: '', elapsedMs: 2000, phase: 'receiving' });
  assert.deepEqual((await f.invoke('/api/state')).json, state);
  const closed = new Promise(resolve => f.server.once('close', resolve));
  f.server.close();
  assert.equal(response.destroyed, true);
  await closed;
  assert.deepEqual(f.calls, [['close']]);
});

test('disconnecting a model SSE request aborts its signal and removes its listener', { timeout: 2000 }, async t => {
  let started, signal;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(t, {
    actorStep: async (_body, options) => {
      signal = options.signal;
      options.onProgress({ phase: 'receiving' }); started();
      return new Promise(resolve => signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }), { once: true }));
    },
  });
  const response = new Reply();
  const pending = f.invoke('/api/actor-step', { method: 'POST', body: {}, headers: { accept: 'text/event-stream' }, response });
  await ready;
  response.end();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(response.listenerCount('close'), 0);
  assert.doesNotMatch(response.text, /event: result/);
});

test('operation errors keep the generic JSON error or end an already-started SSE response', async t => {
  const fail = () => { throw new Error('private implementation details'); };
  const f = fixture(t, { control: fail, actorStep: fail });
  const json = await f.invoke('/api/control', { method: 'POST', body: {} });
  assert.equal(json.code, 500);
  assert.deepEqual(json.json, { ok: false, message: '世界操作未完成，请检查本地存储。' });
  const stream = await f.invoke('/api/actor-step', { method: 'POST', body: {}, headers: { accept: 'text/event-stream' } });
  assert.equal(stream.code, 200); assert.equal(stream.destroyed, true); assert.equal(stream.text, '');
  assert.equal(stream.listenerCount('close'), 0);
});

test('root exports and withCreation=false preserve camp startup and saved-state compatibility', t => {
  assert.equal(typeof createCampExperience, 'function');
  assert.equal(typeof createPrototypeExperience, 'function');
  const stateFile = join(tempDirectory(t), 'state.json');
  const options = { withCreation: false, stateFile, configLoader: () => { throw new Error('startup must not load model config'); } };
  const first = createCampServer(options);
  first.experience.control({ type: 'pause' });
  const before = first.experience.state();
  first.server.emit('close');
  const second = createCampServer(options);
  try {
    const after = second.experience.state();
    assert.equal(after.instanceId, before.instanceId);
    assert.deepEqual(after.world, before.world);
    assert.deepEqual(after.actors, before.actors);
    assert.equal(after.world.actors.length, 2);
    assert.equal(after.creation, undefined);
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).experience.pending, false);
  } finally { second.server.emit('close'); }
});
