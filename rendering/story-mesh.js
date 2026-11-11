const directions = [
  { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];
const key = (x, y, z) => `${x},${y},${z}`;

// Keep independently removable layers closed at their boundaries. A roof can
// disappear without leaving holes in the top of the wall beneath it.
export function compileStoryChunks(cells, unit, { chunkSize = 32, transparentMaterials = new Set(['glass']) } = {}) {
  const occupied = new Map(cells.map(cell => [key(cell[0], cell[1], cell[2]), cell]));
  const groups = new Map();
  for (const cell of cells) {
    const [x, y, z, material, site, layer] = cell;
    const id = `${Math.floor(x / chunkSize)},${Math.floor(y / chunkSize)},${Math.floor(z / chunkSize)}:${site}:${layer}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, site, layer, planes: new Map(), min: [x, y, z], max: [x + 1, y + 1, z + 1] };
      groups.set(id, group);
    }
    for (let axis = 0; axis < 3; axis++) {
      group.min[axis] = Math.min(group.min[axis], cell[axis]);
      group.max[axis] = Math.max(group.max[axis], cell[axis] + 1);
    }
    for (const { axis, sign } of directions) {
      const adjacent = [x, y, z]; adjacent[axis] += sign;
      const neighbor = occupied.get(key(...adjacent));
      if (neighbor && neighbor[4] === site && neighbor[5] === layer &&
          (!transparentMaterials.has(neighbor[3]) || neighbor[3] === material)) continue;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const plane = cell[axis] + Number(sign > 0);
      const planeId = `${axis}:${sign}:${plane}`;
      let mask = group.planes.get(planeId);
      if (!mask) { mask = { axis, sign, plane, u, v, pixels: new Map() }; group.planes.set(planeId, mask); }
      mask.pixels.set(`${cell[u]},${cell[v]}`, { u: cell[u], v: cell[v], material });
    }
  }
  const compiled = [];
  for (const group of groups.values()) {
    const buffers = new Map();
    for (const mask of group.planes.values()) {
      const { axis, sign, plane, u, v, pixels } = mask;
      while (pixels.size) {
        const pixel = pixels.values().next().value;
        const { u: left, v: bottom, material } = pixel;
        let width = 1, height = 1;
        while (pixels.get(`${left + width},${bottom}`)?.material === material) width++;
        scan: while (true) {
          for (let column = 0; column < width; column++) {
            if (pixels.get(`${left + column},${bottom + height}`)?.material !== material) break scan;
          }
          height++;
        }
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) pixels.delete(`${left + column},${bottom + row}`);
        let data = buffers.get(material);
        if (!data) { data = { material, positions: [], normals: [], uvs: [], indices: [], quads: 0 }; buffers.set(material, data); }
        const base = data.positions.length / 3;
        const normal = [0, 0, 0]; normal[axis] = sign;
        for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]]) {
          const position = [0, 0, 0];
          position[axis] = plane * unit; position[u] = (left + du) * unit; position[v] = (bottom + dv) * unit;
          data.positions.push(...position); data.normals.push(...normal);
          // Wall patterns keep their vertical texture axis aligned with world Y.
          data.uvs.push(...(axis === 0 ? [dv, du] : [du, dv]));
        }
        data.indices.push(...(sign > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
        data.quads++;
      }
    }
    compiled.push({ id: group.id, site: group.site, layer: group.layer,
      bounds: { min: group.min.map(value => value * unit), max: group.max.map(value => value * unit) },
      geometries: [...buffers.values()].map(data => ({ material: data.material, quads: data.quads,
        positions: new Float32Array(data.positions), normals: new Float32Array(data.normals),
        uvs: new Float32Array(data.uvs), indices: new Uint32Array(data.indices) })),
    });
  }
  return compiled;
}
