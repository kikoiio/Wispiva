import test from 'node:test';
import assert from 'node:assert/strict';
import { compileStoryChunks } from '../rendering/story-mesh.js';
import { createStoryNavigation } from '../spatial/story-navigation.js';

test('a solid cube emits six merged outward surfaces with metric coordinates', () => {
  const cells = [];
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) cells.push([x, y, z, 'brick', 'house', 'exterior']);
  const chunks = compileStoryChunks(cells, 0.5);
  assert.equal(chunks.length, 1); assert.equal(chunks[0].geometries[0].quads, 6);
  const geometry = chunks[0].geometries[0];
  assert(geometry.positions.every(value => value >= 0 && value <= 1));
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const points = [0, 1, 2].map(offset => [...geometry.positions.slice(geometry.indices[index + offset] * 3, geometry.indices[index + offset] * 3 + 3)]);
    const a = points[1].map((value, axis) => value - points[0][axis]);
    const b = points[2].map((value, axis) => value - points[0][axis]);
    const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const expected = geometry.normals.slice(geometry.indices[index] * 3, geometry.indices[index] * 3 + 3);
    assert(normal.reduce((dot, value, axis) => dot + value * expected[axis], 0) > 0);
  }
});

test('hiding a roof preserves the closed surface of the wall underneath', () => {
  const chunks = compileStoryChunks([[0, 0, 0, 'brick', 'house', 'exterior'], [0, 1, 0, 'roof', 'house', 'roof']], 0.5);
  assert.equal(chunks.length, 2);
  assert(chunks.every(chunk => chunk.geometries[0].quads === 6));
  assert.deepEqual(chunks.map(chunk => chunk.layer).sort(), ['exterior', 'roof']);
});

test('chunk boundaries remove shared opaque faces across positive and negative coordinates', () => {
  for (const x of [-1, 31]) {
    const chunks = compileStoryChunks([[x, 0, 0, 'stone', 'street', 'ground'], [x + 1, 0, 0, 'stone', 'street', 'ground']], 0.5);
    assert.equal(chunks.reduce((total, chunk) => total + chunk.geometries.reduce((sum, geometry) => sum + geometry.quads, 0), 0), 10);
  }
});

test('walking uses real floors, blocks walls and furniture, and climbs half-meter stairs', () => {
  const cells = [];
  for (let x = -4; x < 6; x++) for (let z = -4; z < 5; z++) cells.push([x, -1, z, 'stone', 'room', 'ground']);
  for (let y = 0; y < 5; y++) for (let z = -4; z < 5; z++) if (z !== 0 && z !== 1) cells.push([2, y, z, 'brick', 'room', 'exterior']);
  cells.push([-2, 0, -3, 'wood', 'room', 'interior']);
  const world = { unit: 0.5, cells, props: [{ kind: 'box', position: [-1, 0.75, 1.5], size: [0.8, 1.5, 0.8] }], places: [] };
  const nav = createStoryNavigation(world);
  assert(nav.canStand([0, 0, 0.5]));
  assert.deepEqual(nav.move([0.6, 0, 0.5], 0.65, 0), [1.25, 0, 0.5]);
  assert.deepEqual(nav.move([0.6, 0, -0.5], 0.65, 0), [0.6, 0, -0.5]);
  assert.equal(nav.canStand([-1, 0, 1.5]), false);
  const step = nav.move([-0.65, 0, -1.25], -0.2, 0);
  assert(Math.abs(step[0] + 0.85) < 1e-9); assert.equal(step[1], 0.5); assert.equal(step[2], -1.25);
});
