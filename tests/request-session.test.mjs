import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestSession } from '../creation/request-session.mjs';

test('creation requests have one owner and ignore progress from a completed request', () => {
  const session = createRequestSession();
  const first = session.start('discussion');
  assert.throws(() => session.start('creation'), /already active/);
  first.publish({ phase: 'receiving', outputCharacters: 12 });
  const view = session.snapshot(); view.progress.phase = 'changed outside';
  assert.equal(session.snapshot().progress.phase, 'receiving');
  first.finish();
  const second = session.start('creation');
  second.publish({ phase: 'verifying' });
  first.publish({ phase: 'receiving' }); first.finish();
  assert.equal(session.pending, true);
  assert.equal(session.snapshot().kind, 'creation');
  assert.equal(session.snapshot().progress.phase, 'verifying');
  second.finish();
});

test('cancellation at finalization keeps the request active without saving a pending replay marker', () => {
  const session = createRequestSession();
  const request = session.start('discussion');
  assert.deepEqual(session.checkpoint(), { pending: true, pendingKind: 'discussion' });
  request.finalize();
  assert.deepEqual(session.cancel(), { finalizing: true });
  assert.equal(request.signal.aborted, true);
  assert.equal(session.pending, true);
  assert.deepEqual(session.checkpoint(), { pending: false, pendingKind: 'discussion' });
  session.setResult({ ok: false, reason: 'cancelled' });
  request.finish();
  assert.deepEqual(session.checkpoint(), { pending: false, pendingKind: null });
  assert.equal(session.snapshot().lastResult.reason, 'cancelled');
  assert.equal(session.snapshot().progress, null);
  assert.equal(session.cancel(), null);
});

test('request cancellation follows the caller only until the request finishes', () => {
  const session = createRequestSession();
  const caller = new AbortController();
  const finished = session.start('creation', { signal: caller.signal });
  finished.finish(); caller.abort();
  assert.equal(finished.signal.aborted, false, 'completed requests must detach their abort listener');
  const cancelled = session.start('creation', { signal: caller.signal });
  assert.equal(cancelled.signal.aborted, true, 'an already aborted caller must prevent work');
  cancelled.finish();
});

test('a progress consumer failure cannot interrupt finalization or leave the request locked', () => {
  const session = createRequestSession();
  const request = session.start('discussion', { onProgress() { throw Error('disconnected'); }, context: { callCount: 1 } });
  request.updateContext({ loopIteration: 2, loopMax: 3, callCount: 2 });
  request.publish({ phase: 'committing' });
  assert.equal(session.snapshot().progress.callCount, 2);
  assert.equal(session.snapshot().progress.loopIteration, 2);
  request.finalize(); request.finish();
  assert.equal(session.pending, false);
});
