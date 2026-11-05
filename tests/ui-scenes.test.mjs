import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { createSceneSlots } from '../ui/scenes.js';

class MemoryNode {
  constructor(tag, content = '', className = '') {
    this.tag = tag; this.content = content; this.className = className;
    this.children = []; this.parentNode = null; this.dataset = {}; this.listeners = new Map();
  }
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  setAttribute() {}
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { this.listeners.get('click')?.(); }
}
const createNode = (...args) => new MemoryNode(...args);
const settle = async () => { await flush(); await flush(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const worldState = (revision = 0) => ({
  world: { environment: { weather: 'sun' } }, scene: { document: {}, revision },
  revision, worldMinute: revision, paused: true,
});
const voxelState = (revision = 0) => ({ revision, cells: [], objects: [], actors: [] });
function renderer(host, initial) {
  return {
    host, initial, updates: [], disposed: false, frames: 0, cutaways: [],
    update(next) { assert(!this.disposed); this.updates.push(next); },
    dispose() { this.disposed = true; host.replaceChildren(); },
    frame() { assert(!this.disposed); this.frames++; },
    cutaway(value) { assert(!this.disposed); this.cutaways.push(value); },
  };
}
function setup(options = {}) {
  const hosts = { draft: createNode('div'), voxel: createNode('div'), world: createNode('div') };
  const instances = [], changes = [];
  const create = async (host, next) => { const scene = renderer(host, next); instances.push(scene); return scene; };
  const slots = createSceneSlots({
    hosts, createNode, onVoxelChange: (phase, next) => changes.push({ phase, next }),
    loadScene: async () => ({ createScene: create }),
    loadVoxelScene: async () => ({ createVoxelScene: create }),
    ...options,
  });
  return { hosts, instances, changes, slots };
}

test('world scene reuses a mount and only updates for a visible world change', async () => {
  const { hosts, instances, slots } = setup();
  const initial = worldState();
  slots.syncScene('world', 'one', initial);
  await settle();
  const mount = hosts.world.children[0], scene = instances[0];
  assert.equal(scene.initial, initial);
  slots.syncScene('world', 'one', structuredClone(initial));
  assert.equal(scene.updates.length, 1);
  const next = worldState(1);
  slots.syncScene('world', 'one', next);
  assert.equal(scene.updates.at(-1), next);
  assert.equal(hosts.world.children[0], mount);
  assert.equal(instances.length, 1);
  slots.syncScene('world', 'one', { ...next, scene: null });
  assert.equal(scene.disposed, true);
  assert.equal(hosts.world.children.length, 0);
});

test('pending voxel creation accepts the newest snapshot and later actor movement without rebuilding', async () => {
  const gate = deferred();
  let scene;
  const { hosts, changes, slots } = setup({ loadVoxelScene: async () => ({ createVoxelScene: (host, next) => {
    scene = renderer(host, next); return gate.promise;
  } }) });
  slots.syncVoxel('voxel', 'one', voxelState());
  await settle();
  const latest = voxelState(2);
  slots.syncVoxel('voxel', 'one', latest);
  gate.resolve(scene);
  await settle();
  assert.equal(scene.updates.at(-1), latest);
  assert.equal(hosts.voxel.dataset.revision, '2');
  assert.equal(hosts.voxel.textContent, '');
  assert.deepEqual(changes.map(entry => entry.phase), ['loading', 'ready']);
  assert.equal(changes.at(-1).next, latest);
  slots.syncVoxel('voxel', 'one', structuredClone(latest));
  assert.equal(scene.updates.length, 1);
  const moved = { ...latest, actors: [{ id: 'lin', position: [1, 0, 1] }] };
  slots.syncVoxel('voxel', 'one', moved);
  assert.equal(scene.updates.length, 2);
  assert.equal(scene.updates.at(-1), moved);
});

test('late voxel completion cannot attach to a replacement mount or announce stale readiness', async () => {
  const gate = deferred();
  let oldScene, calls = 0;
  const { hosts, changes, slots } = setup({ loadVoxelScene: async () => ({ createVoxelScene: async (host, next) => {
    const scene = renderer(host, next);
    if (++calls === 1) { oldScene = scene; await gate.promise; }
    return scene;
  } }) });
  slots.syncVoxel('voxel', 'old', voxelState());
  await settle();
  slots.syncVoxel('voxel', 'new', voxelState(3));
  await settle();
  const currentMount = hosts.voxel.children[0], count = changes.length;
  gate.resolve();
  await settle();
  assert.equal(oldScene.disposed, true);
  assert.equal(hosts.voxel.children[0], currentMount);
  assert.equal(hosts.voxel.dataset.revision, '3');
  assert.equal(changes.length, count);
  assert.equal(slots.voxelReady, true);
});

test('suspension invalidates a pending import even after resume and preserves the new mount', async () => {
  const gate = deferred();
  let imports = 0, creations = 0;
  const module = { createScene: async (host, next) => { creations++; return renderer(host, next); } };
  const { hosts, slots } = setup({ loadScene: () => ++imports === 1 ? gate.promise : Promise.resolve(module) });
  slots.syncScene('draft', 'old', worldState());
  slots.suspend();
  slots.syncScene('draft', 'blocked', worldState());
  assert.equal(imports, 1);
  assert.equal(hosts.draft.children.length, 0);
  slots.resume();
  slots.syncScene('draft', 'new', worldState(1));
  await settle();
  const mount = hosts.draft.children[0];
  gate.resolve(module);
  await settle();
  assert.equal(creations, 1);
  assert.equal(hosts.draft.children[0], mount);
});

test('renderer update failure waits for an explicit retry using the latest snapshot', async () => {
  const { hosts, instances, changes, slots } = setup();
  slots.syncVoxel('voxel', 'one', voxelState());
  await settle();
  instances[0].update = () => { throw new Error('synthetic update failure'); };
  slots.syncVoxel('voxel', 'one', voxelState(1));
  assert.equal(instances[0].disposed, true);
  assert.equal(slots.voxelReady, false);
  assert.equal(changes.at(-1).phase, 'failed');
  assert.match(hosts.voxel.textContent, /重新载入画面/);
  const retry = hosts.voxel.children[0].children.at(-1), latest = voxelState(2);
  slots.syncVoxel('voxel', 'one', latest);
  await settle();
  assert.equal(instances.length, 1);
  retry.click();
  await settle();
  assert.equal(instances[1].initial, latest);
  assert.equal(slots.voxelReady, true);
  retry.click();
  await settle();
  assert.equal(instances.length, 2, 'a detached retry must not replace the recovered scene');
});

test('late creation rejection never replaces a recovered world slot', async () => {
  const gate = deferred();
  let calls = 0;
  const { hosts, slots } = setup({ loadScene: async () => ({ createScene: async (host, next) => {
    if (++calls === 1) return gate.promise;
    return renderer(host, next);
  } }) });
  slots.syncScene('world', 'old', worldState());
  await settle();
  slots.syncScene('world', 'new', worldState(1));
  await settle();
  const mount = hosts.world.children[0];
  gate.reject(new Error('late failure'));
  await settle();
  assert.equal(hosts.world.children[0], mount);
  assert.doesNotMatch(hosts.world.textContent, /late failure|重新载入/);
});

test('camera controls target the active voxel slot and reset interior mode on replacement', async () => {
  const { instances, slots } = setup();
  slots.syncVoxel('voxel', 'one', voxelState());
  slots.syncVoxel('draft', 'preview', voxelState());
  await settle();
  slots.frameVoxel();
  assert.equal(instances[0].frames, 1);
  assert.equal(instances[1].frames, 0);
  assert.equal(slots.toggleVoxelInterior(), true);
  slots.syncVoxel('voxel', 'one', voxelState(1));
  assert.equal(slots.toggleVoxelInterior(), false);
  assert.deepEqual(instances[0].cutaways, [true, false]);
  slots.toggleVoxelInterior();
  slots.syncVoxel('voxel', 'two', voxelState());
  await settle();
  assert.equal(slots.toggleVoxelInterior(), true);
  assert.deepEqual(instances[2].cutaways, [true]);
  slots.suspend();
  slots.frameVoxel();
  assert.equal(slots.toggleVoxelInterior(), false);
  assert.equal(slots.voxelReady, false);
  assert(instances.every(scene => scene.disposed));
});

test('one renderer throwing during disposal does not prevent all slots from being released', async () => {
  const { hosts, instances, slots } = setup();
  slots.syncScene('draft', 'draft', worldState());
  slots.syncScene('world', 'world', worldState());
  slots.syncVoxel('voxel', 'voxel', voxelState());
  await settle();
  instances[0].dispose = () => { throw new Error('synthetic disposal failure'); };
  slots.suspend();
  assert.equal(instances[1].disposed, true);
  assert.equal(instances[2].disposed, true);
  assert(Object.values(hosts).every(host => host.children.length === 0));
  assert.equal(slots.voxelReady, false);
});
