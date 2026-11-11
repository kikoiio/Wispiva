const clone = value => structuredClone(value);

// One owner for cancellation, request progress and pending-save markers.
export function createRequestSession(lastResult = null) {
  let active = null;
  const model = { pending: false, kind: 'creation', actorId: null, progress: null, lastResult };
  return {
    get pending() { return active !== null; },
    snapshot() {
      return clone({ ...model, progress: active && model.progress ? { ...model.progress, elapsedMs: performance.now() - active.startedAt } : null });
    },
    checkpoint() { return { pending: Boolean(active && !active.finalizing), pendingKind: active ? model.kind : null }; },
    setResult(result) { model.lastResult = result; },
    cancel() {
      if (!active) return null;
      active.controller.abort();
      return { finalizing: active.finalizing };
    },
    start(kind, { signal, onProgress, context = {} } = {}) {
      if (active) throw new Error('A creation request is already active');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const request = { controller, startedAt: performance.now(), finalizing: false };
      active = request;
      Object.assign(model, { pending: true, kind, lastResult: null, progress: null });
      return {
        signal: controller.signal,
        startedAt: request.startedAt,
        get progress() { return model.progress; },
        updateContext(next) { Object.assign(context, next); },
        publish(progress) {
          if (active !== request) return;
          model.progress = { ...progress, ...context, elapsedMs: performance.now() - request.startedAt };
          try { onProgress?.(model.progress); } catch { /* Disconnect is represented by signal. */ }
        },
        finalize() { request.finalizing = true; },
        finish() {
          signal?.removeEventListener('abort', abort);
          if (active === request) { active = null; model.pending = false; }
        },
      };
    },
  };
}
