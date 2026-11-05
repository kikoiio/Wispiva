const text = (value, fallback) => typeof value === 'string' && value.trim() ? value : fallback;

// Parse SSE across arbitrary CR / LF / CRLF chunk boundaries. UTF-8 decoding
// happens in streamStep so split multibyte characters reach this parser intact.
export function eventParser(onEvent) {
  let line = '', skipLF = false, type = 'message', data = [], size = 0;
  const consume = () => {
    if (line === '') {
      const event = type, payload = data.join('\n'), hasData = data.length > 0;
      type = 'message'; data = []; size = 0;
      if (hasData && (event === 'progress' || event === 'result')) {
        let value;
        try { value = JSON.parse(payload); } catch { throw new Error('回复流格式不完整，请检查连接后重试。'); }
        onEvent(event, value);
      }
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') type = value;
      if (field === 'data') { data.push(value); size += value.length; }
    }
    line = '';
  };
  return (chunk) => {
    for (const char of chunk) {
      if (skipLF) { skipLF = false; if (char === '\n') continue; }
      if (char === '\r' || char === '\n') { consume(); skipLF = char === '\r'; }
      else line += char;
      if (line.length + size > 4 * 1024 * 1024) throw new Error('单次回复过长，已停止读取。请重新连接查看最新状态。');
    }
  };
}

// The controller owns state versions and request cancellation. Transport owns
// browser protocol details and the single, automatically reconnecting SSE source.
export function createTransport({ fetch, EventSource, TextDecoder }) {
  let source = null;

  async function readState(signal) {
    const response = await fetch('/api/state', { cache: 'no-store', headers: { Accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(`状态读取失败（HTTP ${response.status}）。`);
    return response.json();
  }

  async function postJSON(path, body, signal) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal });
    const result = await response.json().catch(() => { throw new Error(`服务没有返回可读结果（HTTP ${response.status}）。`); });
    if (!response.ok && result.ok !== false) return { ...result, ok: false, message: text(result.message, `操作未完成（HTTP ${response.status}）。`) };
    return result;
  }

  async function streamStep(path, body, { signal, isCurrent, onProgress }) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      return { ...result, ok: false, message: text(result.message, `请求失败（HTTP ${response.status}）。`) };
    }
    if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      await response.body?.cancel();
      throw new Error('没有收到回复流，请重新连接后重试。');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let result = null;
    const parse = eventParser((event, data) => {
      if (result || !isCurrent()) return;
      if (event === 'progress') onProgress(data);
      else {
        if (typeof data?.ok !== 'boolean') throw new Error('回复结果不完整，请重新连接查看最新状态。');
        result = data;
      }
    });
    try {
      while (!result) {
        const { value, done } = await reader.read();
        parse(done ? decoder.decode() : decoder.decode(value, { stream: true }));
        if (done) break;
      }
      if (!result) throw new Error('连接中断，未收到完整回复。请重新连接查看已保存内容，再继续。');
      return result;
    } finally {
      try { await reader.cancel(); } catch {}
      reader.releaseLock();
    }
  }

  function closeSubscription() {
    source?.close(); source = null;
  }

  function subscribe({ onState, onInvalidState, onError }) {
    closeSubscription();
    if (typeof EventSource !== 'function') return;
    const stream = new EventSource('/api/events'); source = stream;
    stream.addEventListener('state', (event) => {
      if (source !== stream) return;
      try { onState(JSON.parse(event.data)); }
      catch { onInvalidState(); }
    });
    stream.addEventListener('error', () => {
      if (source === stream) onError();
    });
  }

  return { readState, postJSON, streamStep, subscribe, closeSubscription, get connecting() { return source?.readyState === 0; } };
}
