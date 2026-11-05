import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, eventParser } from '../ui/transport.js';

function queuedTransport(responses) {
  const requests = [];
  const transport = createTransport({
    fetch: async (path, init) => {
      requests.push({ path, ...init });
      assert(responses.length, `unexpected request ${path}`);
      return responses.shift();
    },
    TextDecoder,
  });
  return { transport, requests };
}

test('JSON requests preserve headers, body, cancellation signal and server diagnostics', async () => {
  const state = { creation: { mode: 'create' } };
  const diagnostics = [{ path: 'draftId', message: '草稿已更新。' }];
  const { transport, requests } = queuedTransport([
    Response.json(state),
    Response.json({ diagnostics }, { status: 409 }),
    Response.json({ ok: false, message: '保留服务提示。', diagnostics }, { status: 422 }),
  ]);
  const { signal } = new AbortController();
  assert.deepEqual(await transport.readState(signal), state);
  assert.deepEqual(await transport.postJSON('/api/control', { type: 'world-accept', draftId: 'old' }, signal), {
    ok: false, message: '操作未完成（HTTP 409）。', diagnostics,
  });
  assert.deepEqual(await transport.postJSON('/api/control', {}, signal), { ok: false, message: '保留服务提示。', diagnostics });
  assert.deepEqual(requests[0], { path: '/api/state', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(requests[1].headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.deepEqual(JSON.parse(requests[1].body), { type: 'world-accept', draftId: 'old' });
  assert.equal(requests[1].signal, signal);
});

test('JSON request failures retain HTTP status in recoverable errors', async () => {
  const { transport } = queuedTransport([new Response('', { status: 503 }), new Response('unreadable', { status: 502 })]);
  await assert.rejects(transport.readState(), /状态读取失败（HTTP 503）/);
  await assert.rejects(transport.postJSON('/api/control', {}), /没有返回可读结果（HTTP 502）/);
});

test('subscription leaves reconnect to EventSource and suppresses replaced or closed sources', () => {
  const sources = [], states = [];
  let errors = 0, invalid = 0;
  class MemorySource {
    constructor(path) { this.path = path; this.readyState = 0; this.handlers = new Map(); this.closed = false; sources.push(this); }
    addEventListener(name, callback) { this.handlers.set(name, callback); }
    close() { this.closed = true; this.readyState = 2; }
    emit(name, data) { this.readyState = name === 'state' ? 1 : 0; this.handlers.get(name)?.({ data }); }
  }
  const transport = createTransport({
    EventSource: MemorySource,
    fetch() { assert.fail('subscription must not fetch or poll'); },
    TextDecoder,
  });
  const callbacks = {
    onState(state) { if (!state.creation) throw new Error('invalid state'); states.push(state); },
    onInvalidState() { invalid++; },
    onError() { errors++; },
  };
  transport.subscribe(callbacks);
  assert.equal(sources[0].path, '/api/events');
  assert.equal(transport.connecting, true);
  sources[0].emit('error');
  assert.equal(errors, 1);
  assert.equal(sources.length, 1);
  sources[0].emit('state', '{broken');
  sources[0].emit('state', '{}');
  assert.equal(invalid, 2);
  sources[0].emit('state', '{"creation":{"mode":"create"}}');
  assert.equal(transport.connecting, false);
  assert.equal(states.length, 1);
  transport.subscribe(callbacks);
  assert.equal(sources[0].closed, true);
  assert.equal(sources.length, 2);
  sources[0].emit('state', '{"creation":{"mode":"world"}}');
  sources[0].emit('error');
  assert.equal(states.length, 1);
  assert.equal(errors, 1);
  transport.closeSubscription();
  assert.equal(sources[1].closed, true);
  sources[1].emit('state', '{"creation":{"mode":"world"}}');
  sources[1].emit('error');
  assert.equal(states.length, 1);
  assert.equal(errors, 1);
  assert.equal(transport.connecting, false);
});

test('state reading still works without EventSource support', async () => {
  const { transport, requests } = queuedTransport([Response.json({ revision: 1 })]);
  transport.subscribe({ onState() { assert.fail('no EventSource'); } });
  assert.equal(transport.connecting, false);
  assert.deepEqual(await transport.readState(), { revision: 1 });
  transport.closeSubscription();
  assert.equal(requests.length, 1);
});

test('event parser ignores comments and unknown event types and joins multiline JSON data', () => {
  const events = [];
  const parse = eventParser((type, value) => events.push({ type, value }));
  const wire = ': heartbeat\r\nevent: ignored\r\ndata: not JSON\r\n\r\nevent: progress\rdata: {\rdata: "phase": "receiving"\rdata: }\r\revent: result\ndata: {"ok":true,"message":"灯室"}\n\n';
  for (const character of wire) parse(character);
  assert.deepEqual(events, [
    { type: 'progress', value: { phase: 'receiving' } },
    { type: 'result', value: { ok: true, message: '灯室' } },
  ]);
});

function responseStream(wire, { end = false, cancelError = false } = {}) {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(wire);
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      if (end) controller.close();
    },
    cancel() { cancelled = true; if (cancelError) throw new Error('synthetic cancellation failure'); },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  return { response, get cancelled() { return cancelled; } };
}
const currentRequest = () => ({ signal: new AbortController().signal, isCurrent: () => true, onProgress() {} });

test('stream returns the first complete result and releases its reader even when cancellation fails', async () => {
  const stream = responseStream('event: progress\ndata: {"phase":"receiving"}\n\nevent: result\ndata: {"ok":true,"message":"灯室"}\n\n', { cancelError: true });
  const { transport, requests } = queuedTransport([stream.response]);
  const options = currentRequest(), progress = [];
  options.onProgress = (value) => progress.push(value);
  assert.deepEqual(await transport.streamStep('/api/creation-chat', { message: '灯室', conversationRevision: 2 }, options), { ok: true, message: '灯室' });
  assert.deepEqual(progress, [{ phase: 'receiving' }]);
  assert.equal(stream.cancelled, true);
  assert.equal(stream.response.body.locked, false);
  assert.equal(requests[0].signal, options.signal);
  assert.equal(requests[0].headers.Accept, 'text/event-stream');
  assert.deepEqual(JSON.parse(requests[0].body), { message: '灯室', conversationRevision: 2 });
});

test('malformed, invalid and truncated stream results release the reader and report recovery errors', async () => {
  for (const [wire, error] of [
    ['event: result\ndata: {broken}\n\n', /格式不完整/],
    ['event: result\ndata: {"message":"missing ok"}\n\n', /回复结果不完整/],
    ['event: progress\ndata: {"phase":"receiving"}\n\n', /未收到完整回复/],
  ]) {
    const stream = responseStream(wire, { end: true });
    const { transport } = queuedTransport([stream.response]);
    await assert.rejects(transport.streamStep('/api/world-generate', {}, currentRequest()), error);
    assert.equal(stream.response.body.locked, false);
  }
});

test('an obsolete stream cannot deliver progress or a result to its controller', async () => {
  const stream = responseStream('event: progress\ndata: {"phase":"receiving"}\n\nevent: result\ndata: {"ok":true}\n\n', { end: true });
  const { transport } = queuedTransport([stream.response]);
  await assert.rejects(transport.streamStep('/api/world-generate', {}, {
    ...currentRequest(), isCurrent: () => false, onProgress() { assert.fail('obsolete progress'); },
  }), /未收到完整回复/);
  assert.equal(stream.response.body.locked, false);
});

test('stream rejects non-SSE replies and preserves HTTP failure diagnostics', async () => {
  const plain = responseStream('not SSE');
  plain.response.headers.set('content-type', 'application/json');
  const { transport } = queuedTransport([
    plain.response,
    Response.json({ message: '消息未保存。', diagnostics: [{ path: 'message' }] }, { status: 422 }),
    new Response('unreadable', { status: 503 }),
  ]);
  await assert.rejects(transport.streamStep('/api/creation-chat', {}, currentRequest()), /没有收到回复流/);
  assert.equal(plain.cancelled, true);
  assert.deepEqual(await transport.streamStep('/api/creation-chat', {}, currentRequest()), {
    ok: false, message: '消息未保存。', diagnostics: [{ path: 'message' }],
  });
  assert.deepEqual(await transport.streamStep('/api/creation-chat', {}, currentRequest()), { ok: false, message: '请求失败（HTTP 503）。' });
});
