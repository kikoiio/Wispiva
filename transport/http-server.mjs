import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { getPublicAsset } from './assets.mjs';

export function createHttpServer({ experience, assetRoot, story }) {
  const streams = new Set();
  const server = http.createServer(async (request, response) => {
    const send = (status, data) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
    const port = server.address()?.port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) return send(403, { ok: false, message: '仅允许本机访问。' });
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    try {
      if (request.method === 'GET' && path === '/api/state') return send(200, experience.state());
      if (request.method === 'GET' && path === '/api/story-state' && story) return send(200, story.state());
      if (request.method === 'GET' && path === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' });
        response.flushHeaders();
        let last = '', heartbeatAt = 0;
        const push = () => {
          if (response.destroyed || response.writableNeedDrain) return;
          try {
            const current = experience.state();
            // A live client needs the current world and event text, not copies of
            // every historical world or unverified model output.
            current.events = current.events?.map(({ world, ...entry }) => entry) ?? [];
            if (current.model?.progress) current.model.progress = { ...current.model.progress, preview: '', elapsedMs: Math.floor(current.model.progress.elapsedMs / 1000) * 1000 };
            const data = JSON.stringify(current);
            if (data !== last) { response.write(`event: state\ndata: ${data}\n\n`); last = data; heartbeatAt = Date.now(); }
            else if (Date.now() - heartbeatAt > 15000) { response.write(': connected\n\n'); heartbeatAt = Date.now(); }
          } catch { response.end(); }
        };
        const timer = setInterval(push, 300); timer.unref();
        const close = () => { clearInterval(timer); streams.delete(response); };
        streams.add(response); response.on('close', close); push(); return;
      }
      const asset = request.method === 'GET' ? getPublicAsset(path === '/' && story ? '/story' : path) : null;
      if (asset) {
        const [file, type] = asset; const body = readFileSync(join(assetRoot, file));
        response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return response.end(body);
      }
      if (request.method === 'GET' && /^\/geometry\/[a-z-]+\.js$/.test(path)) return send(404, { ok: false });
      if (request.method !== 'POST' || !['/api/control', '/api/actor-step', '/api/scene-generate', '/api/world-generate', '/api/creation-chat', '/api/model-cancel', '/api/story-chat', '/api/story-cancel'].includes(path)) return send(404, { ok: false, message: '这个入口不存在。' });
      if (path.startsWith('/api/story-') && !story) return send(404, { ok: false, message: '这个入口不存在。' });
      if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) return send(403, { ok: false, message: '来源不匹配。' });
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { ok: false, message: '需要JSON请求。' });
      const maxBody = path === '/api/control' ? 512 * 1024 : 32768;
      const decoder = new StringDecoder('utf8'); let text = '', bytes = 0;
      for await (const part of request) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        bytes += chunk.length; if (bytes > maxBody) return send(413, { ok: false, message: '请求过大。' });
        text += decoder.write(chunk);
      }
      text += decoder.end();
      let body; try { body = JSON.parse(text); } catch { return send(400, { ok: false, message: '请求格式无效。' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { ok: false, message: '请求必须是对象。' });
      if (path === '/api/control') return send(200, experience.control(body));
      if (path === '/api/model-cancel') return send(200, experience.cancelModel());
      if (path === '/api/story-cancel') return send(200, story.cancel());
      const perform = path === '/api/story-chat' ? story.chat : path === '/api/creation-chat' ? experience.discussStep : path === '/api/world-generate' ? experience.worldStep : path === '/api/scene-generate' ? experience.sceneStep : experience.actorStep;
      if (!perform) return send(404, { ok: false });
      if (!request.headers.accept?.includes('text/event-stream')) return send(200, await perform(body));
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' }); response.flushHeaders();
      const controller = new AbortController(); const disconnect = () => controller.abort(); response.on('close', disconnect);
      let latest = null; const started = performance.now();
      const emit = (event, value) => { if (!response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
      const heartbeat = setInterval(() => { if (latest) emit('progress', { ...latest, elapsedMs: performance.now() - started }); }, 1000); heartbeat.unref();
      try { emit('result', await perform(body, { signal: controller.signal, onProgress: (event) => { latest = event; emit('progress', event); } })); }
      finally { clearInterval(heartbeat); response.off('close', disconnect); response.end(); }
    } catch { if (!response.headersSent) send(500, { ok: false, message: '世界操作未完成，请检查本地存储。' }); else response.end(); }
  });
  server.on('close', () => { for (const stream of streams) stream.end(); experience.close(); });
  const close = server.close.bind(server);
  server.close = (...args) => { for (const stream of streams) stream.end(); return close(...args); };
  return { server, experience };
}
