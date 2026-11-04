import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrototypeExperience } from '../server.mjs';
import { projectVoxelActors } from '../voxel-bindings.mjs';
import { createGeneratedFixture } from '../world-definition.mjs';
import { buildDiscussionMessages } from '../creation-dialogue.mjs';
import { inspectVoxelSpaces } from '../geometry/voxel-inspection.js';

const base = resolve('.tmp/prototype');
const fill = { op: 'fill', from: [0, 0, 0], to: [2, 0, 0], material: 'wood' };
const output = (commands, extra = {}) => ({ reply: '已经全部建好了。', summary: '作者要的一小片木屋起点。', ready: true, commands, ...extra });
const reply = value => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
function fixture(t, handler, { timeoutMs } = {}) {
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'creation-recovery-'));
  const inputs = [];
  const options = { stateFile: join(directory, 'state.json'), configLoader: () => ({ llm: { baseUrl: 'https://fixture.invalid/v1', model: 'fixture', apiKey: 'synthetic', ...(timeoutMs ? { timeoutMs } : {}) } }),
    fetchImpl: async (_url, init) => { const input = JSON.parse(JSON.parse(init.body).input.at(-1).content); inputs.push(input); return reply(await handler(input, inputs.length, directory)); } };
  let experience = createPrototypeExperience(options);
  t.after(() => { experience.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, inputs, get experience() { return experience; }, reload() { experience.close(); experience = createPrototypeExperience(options); return experience; } };
}

test('large scene context is losslessly packed without hiding holes, materials or object identities', () => {
  const cells = [];
  for (let x = -10; x <= 10; x++) for (let z = -5; z <= 5; z++) {
    if (x === 0 && z === 0) continue;
    cells.push({ position: [x, 0, z], material: x < 0 ? 'wood' : 'grass' });
  }
  const objects = [{ id: 'room', name: '房间', kind: 'building', from: [-10, 0, -5], to: [10, 3, 5] }];
  const messages = buildDiscussionMessages({messages:[],summary:'',ready:false,revision:0}, null, null, {revision:3,cells,objects});
  const context = JSON.parse(messages.at(-1).content).voxel;
  assert(context.regions?.length < cells.length / 5, 'large scene should use exact compact regions');
  const expanded = context.regions.flatMap(r => Array.from({length:r.to[0]-r.from[0]+1}, (_,i) => ({position:[r.from[0]+i,r.from[1],r.from[2]],material:r.material})));
  const sorted = v => v.map(c=>JSON.stringify(c)).sort();
  assert.deepEqual(sorted(expanded), sorted(cells));
  assert.deepEqual(context.objects,objects);
  assert.equal(context.cellCount,cells.length);
  assert(JSON.stringify(context).length < JSON.stringify({revision:3,cells,objects}).length / 2);
});

test('build prompt requires same-request object registration before using objectId', () => {
  const messages = buildDiscussionMessages({ messages: [], summary: '', ready: false, revision: 0 }, null, null,
    { revision: 0, cells: [], objects: [] }, { mode: 'loop' });
  assert(messages[0].content.includes('写入命令带 objectId 时，commands 中必须同时包含 id 完全相同的 op:"object" 定义'));
  assert(messages[0].content.includes('完整建筑只登记一个 kind:"building" 对象'));
  assert(messages[0].content.includes('恰好清空地板上方两格'));
});

test('large exact part membership is packed without crashing the next model request', async t => {
  const f = fixture(t, (input, n) => {
    if (n === 2) {
      const object = input.voxel.objects.find(o => o.id === 'roof');
      assert(object.memberRegions.length > 0);
      const expanded = object.memberRegions.flatMap(r => Array.from({ length: r.to[0] - r.from[0] + 1 }, (_, i) => [r.from[0] + i, r.from[1], r.from[2]]));
      assert.deepEqual(expanded.map(p => p.join()).sort(), f.experience.state().creation.voxel.objects[0].members.map(p => p.join()).sort());
    }
    return output(n === 1 ? [
      { op: 'roof', from: [-4, 5, -4], to: [4, 8, 4], material: 'roof', objectId: 'roof' },
      { op: 'object', id: 'roof', name: '屋顶', kind: 'roof', from: [-4, 5, -4], to: [4, 8, 4] },
    ] : [{ op: 'paint-object', id: 'roof', material: 'stone' }]);
  });
  assert.equal((await f.experience.discussStep({ message: '造屋顶', mode: 'build' })).ok, true);
  const painted = await f.experience.discussStep({ message: '换石色', mode: 'build' });
  assert.equal(painted.ok, true, painted.message);
  assert.equal(f.inputs.length, 2);
  assert(painted.state.creation.voxel.cells.every(c => c.material === 'stone'));
});

test('build results distinguish text-only, committed and identical operations using real revisions', async t => {
  const f = fixture(t, (_input, n) => output(n === 1 ? [] : [fill]));
  const noCommands = await f.experience.discussStep({ message: '现在搭木墙', mode: 'build' });
  assert.equal(noCommands.ok, false);
  assert.equal(noCommands.reason, 'no-building-commands');
  assert.equal(noCommands.attempt.outcome, 'not-built');
  assert.equal(noCommands.state.creation.voxel.revision, 0);
  const built = await f.experience.discussStep({ message: '现在搭木墙', mode: 'build' });
  assert.equal(built.ok, true);
  assert.equal(built.attempt.outcome, 'committed');
  assert.equal(built.attempt.fromRevision, 0);
  assert.equal(built.attempt.toRevision, built.state.creation.voxel.revision);
  assert.equal(built.attempt.changes.cells, 3);
  assert.equal(built.state.creation.dialogue.ready, true);
  const unchanged = await f.experience.discussStep({ message: '同样的木墙', mode: 'build' });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.attempt.outcome, 'unchanged');
  assert.equal(unchanged.state.creation.voxel.revision, 1);
  assert.equal(unchanged.attempt.changes.cells, 0);
  assert.equal(unchanged.state.creation.attempts.length, 3);
  assert.deepEqual(f.reload().state().creation.attempts.at(-1), unchanged.attempt);
});

test('automatic build loop rereads the committed voxel state and repairs the next reported issue', async t => {
  const f = fixture(t, (input, n) => {
    assert.equal(input.requestMode, 'loop');
    assert.equal(input.loopContext.iteration, n);
    if (n === 1) {
      assert.equal(input.voxel.revision, 0);
      return output([
        { op: 'fill', from: [-1, 0, -1], to: [5, 0, 5], material: 'grass' },
        { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
        { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
        { op: 'roof', from: [-1, 4, -1], to: [5, 7, 5], material: 'roof', objectId: 'roof' },
        { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 7, 4] },
        { op: 'object', id: 'roof', name: '屋顶', kind: 'roof', from: [-1, 4, -1], to: [5, 7, 5] },
      ]);
    }
    assert.equal(input.voxel.revision, 1);
    assert(input.loopContext.previousDiagnostics.some(d => /no-entrance/.test(d.path)));
    return output([
      { op: 'fill', from: [2, 1, 4], to: [2, 2, 4], material: null, objectId: 'house' },
      { op: 'fill', from: [2, 0, 5], to: [2, 0, 5], material: 'grass' },
    ]);
  });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.inputs.length, 2);
  assert.equal(result.attempt.outcome, 'committed');
  assert.equal(result.attempt.loop.iterations.length, 2);
  assert.equal(result.attempt.fromRevision, 0);
  assert.equal(result.attempt.toRevision, 2);
  assert.deepEqual(result.attempt.diagnostics, []);
  assert.equal(result.state.creation.dialogue.ready, true);
  assert.equal(inspectVoxelSpaces(result.state.creation.voxel).issues.length, 0);
});

test('automatic build loop does not accept an empty initial scene as complete without commands', async t => {
  const f = fixture(t, () => output([]));
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop', maxIterations: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-building-commands');
  assert.equal(result.attempt.outcome, 'not-built');
  assert.equal(result.attempt.loop.iterations.length, 1);
  assert.equal(result.attempt.loop.iterations[0].outcome, 'stalled');
  assert.equal(result.state.creation.voxel.revision, 0);
  assert.equal(result.state.creation.voxel.cells.length, 0);
});

test('automatic build loop reports partial completion when the iteration limit leaves diagnostics', async t => {
  const f = fixture(t, (input, n) => {
    assert.equal(input.loopContext.iteration, n);
    if (n === 1) return output([
      { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
      { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
      { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 3, 4] },
    ]);
    return output([{ op: 'fill', from: [n, 0, 6], to: [n, 0, 6], material: 'grass' }]);
  });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'loop-limit');
  assert.equal(result.attempt.outcome, 'partial');
  assert.equal(result.attempt.loop.iterations.length, 4);
  assert.equal(result.attempt.toRevision, 4);
  assert(result.attempt.diagnostics.some(d => /no-entrance/.test(d.path)));
  assert.equal(result.state.creation.voxel.revision, 4);
});

test('automatic build loop keeps earlier commits when a later request is cancelled', async t => {
  const f = fixture(t, async (input, n) => {
    if (n === 1) return output([
      { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
      { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
      { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 3, 4] },
    ]);
    setTimeout(() => f.experience.cancelModel(), 5);
    await new Promise(resolve => setTimeout(resolve, 20));
    return output([{ op: 'fill', from: [5, 0, 5], to: [5, 0, 5], material: 'grass' }]);
  });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cancelled');
  assert.equal(result.attempt.outcome, 'partial');
  assert.equal(result.attempt.loop.iterations.length, 1);
  assert.equal(result.state.creation.voxel.revision, 1);
  assert.equal(result.state.creation.voxel.cells.length, 73);
});

test('automatic build loop preserves earlier commits when a later model request fails', async t => {
  const f = fixture(t, (_input, n) => {
    if (n === 1) return output([
      { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
      { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
      { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 3, 4] },
    ]);
    throw new Error('fixture network failure');
  });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network-error');
  assert.equal(result.attempt.outcome, 'partial');
  assert.equal(result.attempt.loop.iterations.length, 1);
  assert.equal(result.attempt.toRevision, 1);
  assert.equal(result.state.creation.voxel.revision, 1);
  assert.equal(f.reload().state().creation.attempts.at(-1).outcome, 'partial');
});

test('automatic build loop times out a stalled request and keeps earlier commits', async t => {
  const f = fixture(t, (_input, n) => n === 1 ? output([
    { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
    { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
    { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 3, 4] },
  ]) : new Promise(() => {}), { timeoutMs: 20 });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.equal(result.attempt.outcome, 'partial');
  assert.equal(result.attempt.toRevision, 1);
  assert.equal(result.state.creation.voxel.revision, 1);
  assert(result.attempt.diagnostics.some(item => /no-entrance/.test(item.path)));
});

test('restart recovers a committed automatic build loop interruption as partial', async t => {
  const f = fixture(t, (_input, n) => {
    if (n !== 1) throw new Error('fixture network failure');
    return output([
    { op: 'fill', from: [0, 0, 0], to: [4, 0, 4], material: 'wood', objectId: 'house' },
    { op: 'walls', from: [0, 1, 0], to: [4, 3, 4], material: 'wood', objectId: 'house' },
    { op: 'object', id: 'house', name: '木屋', kind: 'building', from: [0, 0, 0], to: [4, 3, 4] },
    ]);
  });
  const result = await f.experience.discussStep({ message: '自动建一间能走进去的木屋', mode: 'loop' });
  assert.equal(result.attempt.outcome, 'partial');
  f.experience.close();

  const stateFile = join(f.directory, 'state.json');
  const creationFile = join(f.directory, 'creation.json');
  const saved = JSON.parse(readFileSync(creationFile, 'utf8'));
  const attempt = saved.attempts.at(-1);
  attempt.outcome = 'pending';
  writeFileSync(creationFile, `${JSON.stringify(saved)}\n`);

  const recovered = createPrototypeExperience({ stateFile });
  try {
    const state = recovered.state();
    const restored = state.creation.attempts.at(-1);
    assert.equal(restored.outcome, 'partial');
    assert.equal(restored.reason, 'interrupted');
    assert.equal(restored.toRevision, 1);
    assert(restored.diagnostics.some(item => /no-entrance/.test(item.path)));
    assert.match(restored.message, /已保存 1 轮修改/);
    assert.equal(state.creation.voxel.revision, 1);
    assert.equal(state.creation.voxel.cells.length, 73);
  } finally {
    recovered.close();
  }
});

test('automatic build loop refuses a stale voxel revision before requesting the model', async t => {
  const f = fixture(t, () => output([fill]));
  const built = await f.experience.discussStep({ message: '先搭一段木墙', mode: 'build' });
  assert.equal(built.state.creation.voxel.revision, 1);
  const stale = await f.experience.discussStep({ message: '继续自动检查', mode: 'loop', baseVoxelRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-basis');
  assert.equal(f.inputs.length, 1);
  assert.equal(stale.state.creation.voxel.revision, 1);
});

test('automatic build loop stops and records an unchanged command as no progress', async t => {
  const f = fixture(t, () => output([fill]));
  const built = await f.experience.discussStep({ message: '先搭一段木墙', mode: 'build' });
  assert.equal(built.state.creation.voxel.revision, 1);
  const result = await f.experience.discussStep({ message: '自动继续建造', mode: 'loop' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'loop-no-progress');
  assert.equal(result.attempt.outcome, 'failed');
  assert.equal(result.attempt.loop.iterations.length, 1);
  assert.equal(result.attempt.loop.iterations[0].outcome, 'unchanged');
  assert.equal(result.state.creation.voxel.revision, 1);
});

test('discussion mode cannot build even when a model returns commands', async t => {
  const f = fixture(t, () => output([fill]));
  const r = await f.experience.discussStep({ message: '先讨论木墙怎么搭', mode: 'discuss' });
  assert.equal(r.state.creation.voxel.cells.length, 0);
  assert.equal(r.attempt.outcome, 'discussion');
  assert.match(r.attempt.message, /讨论/);
});

test('air is deterministically empty space rather than an invented material', async t => {
  const f = fixture(t, (_input, n) => output([{ ...fill, material: n === 1 ? 'wood' : 'air' }]));
  await f.experience.discussStep({ message: '木墙', mode: 'build' });
  const cleared = await f.experience.discussStep({ message: '清空这面墙', mode: 'build' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.attempt.changes.removed, 3);
  assert.deepEqual(cleared.state.creation.voxel.cells, []);
  assert.match(cleared.attempt.adjustments[0].message, /air/);
});

test('the literal null string clears cells and replace matches without guessing materials', async t => {
  const f = fixture(t, (_input, n) => output(n === 1 ? [fill] : n === 2
    ? [{ ...fill, material: ' null ' }]
    : [{ ...fill, op: 'replace', match: 'null', material: 'glass' }]));
  await f.experience.discussStep({ message: '木墙', mode: 'build' });
  const cleared = await f.experience.discussStep({ message: '清空木墙', mode: 'build' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.attempt.changes.removed, 3);
  assert.match(cleared.attempt.adjustments[0].message, /null/);
  const replaced = await f.experience.discussStep({ message: '空格放玻璃', mode: 'build' });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.state.creation.voxel.cells.length, 3);
});

test('a material failure remains in the conversation and explicit retry reuses the intent against the latest scene', async t => {
  const f = fixture(t, (_input, n) => output([{ ...fill, material: n === 1 ? 'copper' : 'wood' }]));
  const failed = await f.experience.discussStep({ message: '给木屋加窗', mode: 'build' });
  assert.equal(failed.reason, 'invalid-building');
  assert.equal(failed.state.creation.dialogue.messages.at(-1).attemptId, failed.attempt.id);
  assert.match(failed.attempt.diagnostics[0].path, /commands\[0\].material/);
  assert.match(failed.attempt.diagnostics[0].message, /copper/);
  const originalUserId = failed.attempt.userMessageId;
  const reloaded = f.reload();
  assert.equal(f.inputs.length, 1, 'restart must not retry');
  const retried = await reloaded.discussStep({ retryAttemptId: failed.attempt.id });
  assert.equal(retried.ok, true);
  assert.equal(retried.attempt.userMessageId, originalUserId);
  assert.equal(retried.attempt.retryOf, failed.attempt.id);
  assert.equal(retried.state.creation.dialogue.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(f.inputs[1].previousAttempt.reason, 'invalid-building');
  assert.equal(f.inputs[1].voxel.revision, 0);
  assert.equal((await reloaded.discussStep({ retryAttemptId: failed.attempt.id })).reason, 'stale-attempt');
  assert.equal(f.inputs.length, 2);
});

test('retry after undo observes the current basis rather than replaying old model commands', async t => {
  const f = fixture(t, (_input, n) => output([{ ...fill, material: n === 2 ? 'copper' : 'wood' }]));
  await f.experience.discussStep({ message: '木墙', mode: 'build' });
  const failed = await f.experience.discussStep({ message: '加窗', mode: 'build' });
  f.experience.control({ type: 'voxel-undo', baseRevision: 1 });
  const r = await f.experience.discussStep({ retryAttemptId: failed.attempt.id });
  assert.equal(r.ok, true);
  assert.equal(f.inputs[2].voxel.revision, 2);
  assert.deepEqual(f.inputs[2].voxel.cells, []);
});

test('unordered box corners are normalized; ambiguous roof heights and unknown materials fail atomically', async t => {
  const f = fixture(t, (_input, n) => output(n === 1 ? [{ ...fill, from: [2, 0, 0], to: [0, 0, 0] }]
    : [fill, { op: 'roof', from: [0, 5, 0], to: [4, 2, 4], material: 'wood' }]));
  const r = await f.experience.discussStep({ message: '搭墙', mode: 'build' });
  assert.equal(r.ok, true);
  assert.equal(r.state.creation.voxel.cells.length, 3);
  assert(r.attempt.adjustments.length);
  const failed = await f.experience.discussStep({ message: '搭屋顶', mode: 'build' });
  assert.equal(failed.ok, false);
  assert.equal(failed.state.creation.voxel.revision, r.state.creation.voxel.revision);
  assert.deepEqual(failed.state.creation.voxel.cells, r.state.creation.voxel.cells);
});

test('invalid reply and cancellation retain a recoverable attempt without creating blocks', async t => {
  const f = fixture(t, () => ({ nonsense: true }));
  const failed = await f.experience.discussStep({ message: '搭屋', mode: 'build' });
  assert.equal(failed.reason, 'invalid-discussion');
  assert.equal(failed.state.creation.attempts.at(-1).outcome, 'failed');
  assert.equal(failed.state.creation.dialogue.messages.at(-1).attemptId, failed.attempt.id);
  const controller = new AbortController(); controller.abort();
  const cancelled = await f.experience.discussStep({ retryAttemptId: failed.attempt.id }, { signal: controller.signal });
  assert.equal(cancelled.reason, 'cancelled');
  assert.equal(cancelled.attempt.outcome, 'cancelled');
  assert.equal(cancelled.state.creation.voxel.revision, 0);
  assert.equal(f.inputs.length, 1);
});

test('failed atomic save cannot report or expose a built scene; recovery preserves the intent', async t => {
  const f = fixture(t, (_input, _n, dir) => {
    renameSync(join(dir, 'creation.json'), join(dir, 'creation.backup'));
    mkdirSync(join(dir, 'creation.json'));
    return output([fill]);
  });
  const r = await f.experience.discussStep({ message: '搭墙', mode: 'build' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'save-error');
  assert.equal(r.state.creation.voxel.revision, 0);
  assert.deepEqual(r.state.creation.voxel.cells, []);
  assert.equal(r.state.creation.dialogue.messages[0].text, '搭墙');
  rmSync(join(f.directory, 'creation.json'), { recursive: true });
  renameSync(join(f.directory, 'creation.backup'), join(f.directory, 'creation.json'));
  const recovered = f.reload();
  assert.equal(recovered.state().creation.attempts.at(-1).outcome, 'failed');
  assert.equal(f.inputs.length, 1);
});

test('attempt timing records real calls and validation without inventing first-token measurements', async t => {
  const f = fixture(t, () => output([fill]));
  const r = await f.experience.discussStep({ message: '搭墙', mode: 'build' });
  assert.equal(r.attempt.timings.calls.length, 1);
  assert.equal(r.attempt.timings.calls[0].firstTextMs, null, 'non-stream fixture has no observed first token');
  for (const key of ['totalMs', 'modelMs', 'validationMs', 'commitMs']) assert(r.attempt.timings[key] >= 0, key);
  const disk = JSON.parse(readFileSync(join(f.directory, 'creation.json'), 'utf8'));
  assert.equal(disk.pending, false);
  assert.equal(disk.attempts.at(-1).outcome, 'committed');
});

test('stale client requests do not start a model call and cancelling at commit cannot change the scene', async t => {
  const f = fixture(t, () => output([fill]));
  const stale = await f.experience.discussStep({ message: '木墙', baseVoxelRevision: 7 });
  assert.equal(stale.reason, 'stale-basis'); assert.equal(f.inputs.length, 0);
  const r = await f.experience.discussStep({ message: '木墙', mode: 'build' }, { onProgress(p) { if (p.phase === 'committing') f.experience.cancelModel(); } });
  assert.equal(r.reason, 'cancelled'); assert.equal(r.attempt.outcome, 'cancelled');
  assert.deepEqual(r.state.creation.voxel.cells, []);
  assert.equal(f.reload().state().creation.voxel.revision, 0);
});

test('voxel people use observed locations with exact semantic matches and real headroom', () => {
  const cells = [0, 1, 2].flatMap(x => [0, 1, 2].map(z => ({ position: [x, 0, z], material: 'wood' })));
  const voxel = { cells, objects: [{ id: 'room', name: '木屋', kind: 'building', from: [0, 0, 0], to: [2, 3, 2] }] };
  const world = { places: [{ id: 'room', name: '木屋' }, { id: 'other', name: '未建造地点' }], actors: [{ id: 'old-man', name: '老人', location: 'room' }] };
  assert.deepEqual(projectVoxelActors({ world, voxel })[0].position, [1.5, 1, 1.5]);
  world.actors[0].location = 'other';
  assert.deepEqual(projectVoxelActors({ world, voxel }), [], 'unmatched places cannot invent a position');
  world.actors[0].location = 'room';
  for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) cells.push({ position: [x, 1, z], material: 'wood' }, { position: [x, 2, z], material: 'wood' });
  assert.deepEqual(projectVoxelActors({ world, voxel }), [], 'solid spaces cannot contain a visible person');
});

test('voxel people stand above a flat area with solid support and clear headroom', () => {
  const cells = [0, 1, 2].flatMap(x => [0, 1, 2].map(z => ({ position: [x, 0, z], material: 'wood' })));
  const voxel = { cells, objects: [{ id: 'courtyard', name: '庭院', kind: 'area', from: [0, 0, 0], to: [2, 0, 2] }] };
  const world = { places: [{ id: 'courtyard', name: '庭院' }], actors: [{ id: 'old-man', name: '老人', location: 'courtyard' }] };
  const actors = projectVoxelActors({ world, voxel });
  assert.equal(actors.length, 1, 'a supported flat area must retain its actor');
  assert.equal(actors[0].id, 'old-man');
  assert.deepEqual(actors[0].position, [1.5, 1, 1.5]);
});

test('voxel people are not projected onto an area made entirely of water', () => {
  const cells = [0, 1, 2].flatMap(x => [0, 1, 2].map(z => ({ position: [x, 0, z], material: 'water' })));
  const voxel = { cells, objects: [{ id: 'lake', name: '湖', kind: 'area', from: [0, 0, 0], to: [2, 0, 2] }] };
  const world = { places: [{ id: 'lake', name: '湖' }], actors: [{ id: 'old-man', name: '老人', location: 'lake' }] };
  assert.deepEqual(projectVoxelActors({ world, voxel }), []);
});

test('an unsaved generated origin is not offered for confirmation', async t => {
  const f = fixture(t, (_input, _n, dir) => {
    renameSync(join(dir, 'creation.json'), join(dir, 'creation.backup'));
    mkdirSync(join(dir, 'creation.json'));
    return createGeneratedFixture();
  });
  let r;
  try { r = await f.experience.worldStep({ description: '小型观测站' }); }
  finally {
    rmSync(join(f.directory, 'creation.json'), { recursive: true });
    renameSync(join(f.directory, 'creation.backup'), join(f.directory, 'creation.json'));
  }
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'save-error');
  assert.equal(r.state.creation.draft, null);
  assert.equal(r.state.model.pending, false);
});
