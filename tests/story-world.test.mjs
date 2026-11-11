import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedHeadedWorld } from '../spatial/red-headed-world.js';
import { createStoryNavigation } from '../spatial/story-navigation.js';
import { compileStoryChunks } from '../rendering/story-mesh.js';
import { createStoryExperience } from '../creation/story-experience.mjs';

const world = createRedHeadedWorld();
const navigation = createStoryNavigation(world);
const placeMap = new Map(world.places.map(place => [place.id, place]));
const point = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

test('the authored neighborhood has unique cells, complete materials and finite detail geometry', () => {
  const occupied = new Set(), propIds = new Set();
  const layers = new Set(['ground', 'exterior', 'roof', 'interior', 'underground']);
  assert.equal(world.unit, 0.5);
  for (const cell of world.cells) {
    assert.equal(cell.length, 6);
    assert(cell.slice(0, 3).every(Number.isInteger));
    const key = cell.slice(0, 3).join(',');
    assert(!occupied.has(key), `overlapping voxel ${key}`); occupied.add(key);
    assert(world.materials[cell[3]], `unknown material ${cell[3]}`);
    assert(cell[4] && layers.has(cell[5]));
  }
  for (const prop of world.props) {
    assert(!propIds.has(prop.id), `duplicate prop ${prop.id}`); propIds.add(prop.id);
    assert(point(prop.position) && point(prop.size) && prop.size.every(value => value > 0), prop.id);
    assert(['box', 'lamp', 'sign'].includes(prop.kind), prop.id);
    assert(world.materials[prop.material], prop.id);
    assert(prop.site && layers.has(prop.layer), prop.id);
    assert(Number.isFinite(prop.rotation ?? 0), prop.id);
    if (prop.chapters) assert(prop.chapters.every(id => world.chapters.some(chapter => chapter.id === id)), prop.id);
  }
  assert(point(world.overview.position) && point(world.overview.target));
});

test('all story destinations connect and their original entries support an unobstructed person', () => {
  for (const id of ['baker-street', 'sitting-room', 'coburg-square', 'pawnshop', 'pawn-cellar', 'pope-court',
    'league-office', 'bank', 'bank-vault', 'tunnel', 'music-hall', 'restaurant', 'king-edward']) assert(placeMap.has(id), id);
  assert.equal(placeMap.size, world.places.length);
  const connected = new Set([world.places[0].id]);
  for (let pass = 0; pass < world.places.length; pass++) {
    for (const route of world.routes) {
      assert(placeMap.has(route.from) && placeMap.has(route.to), route.id);
      assert(route.points.length > 1 && route.points.every(point), route.id);
      if (connected.has(route.from) || connected.has(route.to)) { connected.add(route.from); connected.add(route.to); }
    }
  }
  assert.equal(connected.size, placeMap.size);
  for (const place of world.places) {
    assert(point(place.entry) && point(place.position), place.id);
    assert(point(place.bounds.min) && point(place.bounds.max), place.id);
    assert(point(place.camera.position) && point(place.camera.target), place.id);
    assert(navigation.canStand(place.entry), `blocked original entry: ${place.id}`);
    assert.equal(navigation.floorAt(place.entry[0], place.entry[2], place.entry[1]), place.entry[1], `unsupported entry: ${place.id}`);
    assert.deepEqual(navigation.spawn(place), place.entry, `spawn must not hide a blocked entry: ${place.id}`);
  }
});

function walkRoute(route, reverse) {
  const points = reverse ? [...route.points].reverse() : route.points;
  let position = [...points[0]];
  const label = `${route.id} ${reverse ? 'return' : 'outbound'}`;
  assert(navigation.canStand(position), `${label} blocked start`);
  for (let index = 1; index < points.length; index++) {
    const start = [...position], destination = points[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(destination[0] - start[0], destination[2] - start[2]) / 0.1));
    for (let step = 1; step <= steps; step++) {
      const x = start[0] + (destination[0] - start[0]) * step / steps;
      const z = start[2] + (destination[2] - start[2]) * step / steps;
      position = navigation.move(position, x - position[0], z - position[2]);
      assert(Math.hypot(position[0] - x, position[2] - z) < 0.02,
        `${label} blocked segment ${index} at ${JSON.stringify(position)}, heading to ${JSON.stringify(destination)}`);
    }
    assert(Math.abs(position[1] - destination[1]) <= 0.55, `${label} wrong floor ${index}: ${position[1]}`);
  }
  assert(Math.abs(position[1] - points.at(-1)[1]) < 0.01, `${label} did not reach the destination floor`);
}

test('every street, doorway, staircase and tunnel route is physically walkable in both directions', () => {
  for (const route of world.routes) {
    if (route.mode === 'travel') continue;
    walkRoute(route, false); walkRoute(route, true);
  }
});

test('each chapter places characters on a floor without intersections with walls or furniture', () => {
  for (const notice of world.props.filter(prop => prop.text?.includes('红发会已解散'))) {
    assert(!notice.chapters?.includes('league'), 'the closure notice must not appear while the league is operating');
    assert(notice.chapters?.includes('investigation'));
  }
  for (const resident of world.residents) {
    for (const chapter of world.chapters) {
      const state = resident.states[chapter.id];
      if (!state) continue;
      assert(placeMap.has(state.placeId), `${resident.id} ${chapter.id}`);
      assert(point(state.position), resident.id);
      assert(navigation.canStand(state.position), `${resident.id} intersects scenery in ${chapter.id}`);
      assert.equal(navigation.floorAt(state.position[0], state.position[2], state.position[1]), state.position[1],
        `${resident.id} floats in ${chapter.id}`);
    }
  }
});

test('chat accepts every visible destination and local directions stay within this authored world', async () => {
  let calls = 0;
  const story = createStoryExperience({ configLoader: () => ({ llm: {} }), invokeModel: async () => {
    calls++; return { ok: true, content: '继续探索吧。' };
  } });
  for (const place of world.places) {
    const result = await story.chat({ message: '这里有什么？', placeId: place.id });
    assert(result.ok, `chat rejects visible destination ${place.id}`);
  }
  assert.equal(calls, world.places.length);
  for (const message of ['去烟草店', '去报摊', '去麦克法兰马车厂', '去护膝工厂', '去舰队街', '去波普法院', '去餐厅', '去爱德华国王街']) {
    const result = await story.chat({ message });
    assert(result.ok && placeMap.has(result.focus), message);
  }
  assert.equal(calls, world.places.length);
});

test('the complete neighborhood compiles to bounded, finite render buffers', () => {
  const transparentMaterials = new Set(Object.entries(world.materials).filter(([, value]) => value.transparent).map(([name]) => name));
  const chunks = compileStoryChunks(world.cells, world.unit, { transparentMaterials });
  let quads = 0, bytes = 0;
  for (const chunk of chunks) for (const geometry of chunk.geometries) {
    assert(geometry.positions.every(Number.isFinite) && geometry.normals.every(Number.isFinite));
    assert(geometry.uvs.every(Number.isFinite));
    assert(geometry.indices.every(index => index < geometry.positions.length / 3));
    assert.equal(geometry.positions.length, geometry.quads * 12);
    quads += geometry.quads;
    bytes += geometry.positions.byteLength + geometry.normals.byteLength + geometry.uvs.byteLength + geometry.indices.byteLength;
  }
  assert(quads < world.cells.length, 'hidden faces and coplanar surfaces must be merged');
  assert(bytes < 32 * 1024 * 1024, `geometry grew to ${Math.round(bytes / 1024 / 1024)} MiB`);
});
