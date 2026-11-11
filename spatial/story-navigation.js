const cellKey = (x, y, z) => `${x},${y},${z}`;
const feetRadius = 0.22, bodyHeight = 1.7, maxStep = 0.55, maxDrop = 0.8;
const samples = [[0, 0], [-feetRadius, -feetRadius], [feetRadius, -feetRadius], [-feetRadius, feetRadius], [feetRadius, feetRadius]];

export function createStoryNavigation(world) {
  const { unit } = world;
  const cells = new Map(world.cells.map(cell => [cellKey(...cell.slice(0, 3)), cell]));
  const boxes = world.props.filter(prop => prop.kind === 'box' && prop.solid !== false);
  const boxBuckets = new Map(), bucketSize = 8, contextCache = new Map();
  for (const box of boxes) {
    const radius = Math.hypot(box.size[0], box.size[2]) / 2;
    for (let x = Math.floor((box.position[0] - radius) / bucketSize); x <= Math.floor((box.position[0] + radius) / bucketSize); x++)
      for (let z = Math.floor((box.position[2] - radius) / bucketSize); z <= Math.floor((box.position[2] + radius) / bucketSize); z++) {
        const key = `${x},${z}`;
        if (!boxBuckets.has(key)) boxBuckets.set(key, []);
        boxBuckets.get(key).push(box);
      }
  }
  const nearbyBoxes = (x, z) => {
    const result = new Set();
    for (const [dx, dz] of samples) for (const box of boxBuckets.get(`${Math.floor((x + dx) / bucketSize)},${Math.floor((z + dz) / bucketSize)}`) || []) result.add(box);
    return [...result];
  };
  function contextBuildings(x, z) {
    if (!world.environment) return [];
    const environment = world.environment, size = environment.blockSize, [ox, oz] = environment.origin, result = [];
    for (let ix = Math.floor((x - feetRadius - ox) / size); ix <= Math.floor((x + feetRadius - ox) / size); ix++)
      for (let iz = Math.floor((z - feetRadius - oz) / size); iz <= Math.floor((z + feetRadius - oz) / size); iz++) {
        const key = `${ix},${iz}`;
        if (!contextCache.has(key)) {
          const block = createLondonBlock(environment, ix, iz);
          contextCache.set(key, [...block.buildings, ...(block.colliders || [])]);
          if (contextCache.size > 48) contextCache.delete(contextCache.keys().next().value);
        }
        result.push(...contextCache.get(key));
      }
    return result;
  }
  const at = (x, y, z) => cells.get(cellKey(Math.floor(x / unit), Math.floor(y / unit), Math.floor(z / unit)));
  const insideBox = (x, z, prop, margin = 0) => {
    const dx = x - prop.position[0], dz = z - prop.position[2], angle = prop.rotation || 0;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return Math.abs(cosine * dx - sine * dz) < prop.size[0] / 2 + margin &&
      Math.abs(sine * dx + cosine * dz) < prop.size[2] / 2 + margin;
  };
  function canStand(position) {
    const [x, y, z] = position;
    for (const [dx, dz] of samples) {
      for (let gy = Math.floor((y + 0.07) / unit); gy <= Math.floor((y + bodyHeight) / unit); gy++) {
        const cell = at(x + dx, (gy + 0.5) * unit, z + dz);
        if (cell && cell[3] !== 'water') return false;
      }
    }
    if (nearbyBoxes(x, z).some(prop => prop.position[1] - prop.size[1] / 2 < y + bodyHeight &&
      prop.position[1] + prop.size[1] / 2 > y + 0.1 && insideBox(x, z, prop, feetRadius))) return false;
    return !contextBuildings(x, z).some(building => building.bounds.min[1] < y + bodyHeight && building.bounds.max[1] > y + 0.1 &&
      x + feetRadius > building.bounds.min[0] && x - feetRadius < building.bounds.max[0] &&
      z + feetRadius > building.bounds.min[2] && z - feetRadius < building.bounds.max[2]);
  }
  function floorAt(x, z, nearY) {
    let floor = -Infinity;
    for (const [dx, dz] of samples) {
      for (let gy = Math.floor((nearY + maxStep) / unit) - 1; gy >= Math.floor((nearY - maxDrop) / unit) - 1; gy--) {
        const cell = at(x + dx, (gy + 0.5) * unit, z + dz);
        const top = (gy + 1) * unit;
        if (cell && cell[3] !== 'water' && top <= nearY + maxStep + 0.001 && top >= nearY - maxDrop) {
          floor = Math.max(floor, top); break;
        }
      }
    }
    for (const prop of nearbyBoxes(x, z)) {
      const top = prop.position[1] + prop.size[1] / 2;
      if (top <= nearY + maxStep && top >= nearY - maxDrop && insideBox(x, z, prop)) floor = Math.max(floor, top);
    }
    if (world.terrain && world.terrain.height <= nearY + maxStep && world.terrain.height >= nearY - maxDrop &&
        !world.terrain.exclusions.some(bounds => x >= bounds.min[0] && x <= bounds.max[0] && z >= bounds.min[1] && z <= bounds.max[1]))
      floor = Math.max(floor, world.terrain.height);
    return Number.isFinite(floor) ? floor : null;
  }
  function move(position, dx, dz) {
    const result = [...position];
    for (const [axis, delta] of [[0, dx], [2, dz]]) {
      if (!delta) continue;
      const candidate = [...result]; candidate[axis] += delta;
      const floor = floorAt(candidate[0], candidate[2], result[1]);
      if (floor === null) continue;
      candidate[1] = floor;
      if (canStand(candidate)) result.splice(0, 3, ...candidate);
    }
    return result;
  }
  function locate(position) {
    return world.places.filter(place => position.every((value, axis) =>
      value >= place.bounds.min[axis] - 0.15 && value <= place.bounds.max[axis] + 0.15))
      .sort((a, b) => Number(b.interior) - Number(a.interior) ||
        a.bounds.max.reduce((volume, value, axis) => volume * (value - a.bounds.min[axis]), 1) -
        b.bounds.max.reduce((volume, value, axis) => volume * (value - b.bounds.min[axis]), 1))[0];
  }
  function spawn(place) {
    for (const anchor of [place.entry, place.position]) {
      if (!anchor) continue;
      for (const distance of [0, 0.5, 1, 1.5, 2, 3]) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
          const candidate = [anchor[0] + dx * distance, anchor[1], anchor[2] + dz * distance];
          const floor = floorAt(candidate[0], candidate[2], candidate[1]);
          if (floor === null) continue;
          candidate[1] = floor;
          if (canStand(candidate)) return candidate;
        }
      }
    }
    return null;
  }
  return { canStand, floorAt, move, locate, spawn };
}
import { createLondonBlock } from './london-blocks.js';

