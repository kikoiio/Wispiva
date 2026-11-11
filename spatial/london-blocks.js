const DEFAULT_BLOCK_SIZE = 96;
const DEFAULT_ORIGIN = [52, -44];
const SITE = 'london-context';
const EXCLUSION_CLEARANCE = 0.001;

function finitePair(value, fallback) {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
    ? [value[0], value[1]]
    : fallback;
}

function normalizedExclusions(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const min = finitePair(item?.min, null), max = finitePair(item?.max, null);
    if (!min || !max || max[0] <= min[0] || max[1] <= min[1]) return [];
    return [{ min, max }];
  });
}

function seededRandom(seed, ix, iz) {
  let state = ((Math.trunc(seed) >>> 0) ^ Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iz | 0, 0x85ebca77)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(a, b) {
  return a.minX < b.max[0] && a.maxX > b.min[0] && a.minZ < b.max[1] && a.maxZ > b.min[1];
}

function subtractRect(rect, exclusion) {
  const x0 = Math.max(rect.x0, exclusion.min[0]);
  const x1 = Math.min(rect.x1, exclusion.max[0]);
  const z0 = Math.max(rect.z0, exclusion.min[1]);
  const z1 = Math.min(rect.z1, exclusion.max[1]);
  if (x1 <= x0 || z1 <= z0) return [rect];
  const pieces = [];
  if (z0 > rect.z0) pieces.push({ x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: z0 });
  if (z1 < rect.z1) pieces.push({ x0: rect.x0, x1: rect.x1, z0: z1, z1: rect.z1 });
  if (x0 > rect.x0) pieces.push({ x0: rect.x0, x1: x0, z0, z1 });
  if (x1 < rect.x1) pieces.push({ x0: x1, x1: rect.x1, z0, z1 });
  return pieces;
}

/** Make one deterministic 96 m Victorian London street block. */
export function createLondonBlock(environment = {}, ix, iz) {
  if (!Number.isInteger(ix) || !Number.isInteger(iz)) {
    throw new TypeError('London block indices ix and iz must be integers.');
  }

  const blockSize = Number.isFinite(environment?.blockSize) && environment.blockSize > 0
    ? environment.blockSize
    : DEFAULT_BLOCK_SIZE;
  const origin = finitePair(environment?.origin, DEFAULT_ORIGIN);
  const seed = Number.isFinite(environment?.seed) ? environment.seed : 1890;
  const exclusions = normalizedExclusions(environment?.exclusions);
  const x0 = origin[0] + ix * blockSize, z0 = origin[1] + iz * blockSize;
  const x1 = x0 + blockSize, z1 = z0 + blockSize;
  if (![x0, z0, x1, z1].every(Number.isFinite)) throw new RangeError('London block coordinates must remain finite.');
  const centerX = (x0 + x1) / 2, centerZ = (z0 + z1) / 2;
  const random = seededRandom(seed, ix, iz);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const id = `london:${ix}:${iz}`;
  const props = [], surfaces = [], buildings = [], colliders = [];
  let propSerial = 0, surfaceSerial = 0;

  const excludedAabb = (minX, minZ, maxX, maxZ) => {
    const aabb = {
      minX: minX - EXCLUSION_CLEARANCE, minZ: minZ - EXCLUSION_CLEARANCE,
      maxX: maxX + EXCLUSION_CLEARANCE, maxZ: maxZ + EXCLUSION_CLEARANCE,
    };
    return exclusions.some((exclusion) => overlaps(aabb, exclusion));
  };

  function addSurfaceRect(rect, material, key) {
    let pieces = [rect];
    for (const exclusion of exclusions) pieces = pieces.flatMap((piece) => subtractRect(piece, exclusion));
    for (const original of pieces) {
      const piece = { ...original };
      for (const exclusion of exclusions) {
        if (Math.abs(piece.x1 - exclusion.min[0]) < 1e-8) piece.x1 -= EXCLUSION_CLEARANCE;
        if (Math.abs(piece.x0 - exclusion.max[0]) < 1e-8) piece.x0 += EXCLUSION_CLEARANCE;
        if (Math.abs(piece.z1 - exclusion.min[1]) < 1e-8) piece.z1 -= EXCLUSION_CLEARANCE;
        if (Math.abs(piece.z0 - exclusion.max[1]) < 1e-8) piece.z0 += EXCLUSION_CLEARANCE;
      }
      const width = piece.x1 - piece.x0, depth = piece.z1 - piece.z0;
      if (width <= 0 || depth <= 0) continue;
      surfaces.push({
        id: `${id}:surface:${key}:${surfaceSerial++}`,
        position: [(piece.x0 + piece.x1) / 2, 0, (piece.z0 + piece.z1) / 2],
        size: [width, depth], material, site: SITE, layer: 'ground',
      });
    }
  }

  function addSurface(centerX, centerZ, width, depth, material, key) {
    addSurfaceRect({
      x0: centerX - width / 2, x1: centerX + width / 2,
      z0: centerZ - depth / 2, z1: centerZ + depth / 2,
    }, material, key);
  }

  function addProp(kind, position, size, material, detail, rotation = 0) {
    const [width, height, depth] = size;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const halfX = (Math.abs(width * c) + Math.abs(depth * s)) / 2;
    const halfZ = (Math.abs(width * s) + Math.abs(depth * c)) / 2;
    if (excludedAabb(position[0] - halfX, position[2] - halfZ, position[0] + halfX, position[2] + halfZ)) return false;
    const prop = {
      id: `${id}:prop:${String(propSerial++).padStart(4, '0')}`,
      kind, position, size, material, site: SITE, layer: 'exterior', solid: false, detail,
    };
    if (rotation) prop.rotation = rotation;
    props.push(prop);
    return true;
  }

  const box = (position, size, material, detail = 'detail', rotation = 0) =>
    addProp('box', position, size, material, detail, rotation);

  function addBoxCollider(key, position, size) {
    colliders.push({
      id: `${id}:collider:${key}`,
      bounds: {
        min: [position[0] - size[0] / 2, position[1] - size[1] / 2, position[2] - size[2] / 2],
        max: [position[0] + size[0] / 2, position[1] + size[1] / 2, position[2] + size[2] / 2],
      },
    });
  }

  function blockingBox(key, position, size, material, detail = 'street') {
    if (!box(position, size, material, detail)) return false;
    addBoxCollider(key, position, size);
    return true;
  }

  // The street grid is centered on each block edge. Neighboring blocks produce
  // matching street halves; four uninterrupted junctions remain open.
  addSurface(x0, centerZ, 14, blockSize, 'roadway', 'road-west');
  addSurface(x1, centerZ, 14, blockSize, 'roadway', 'road-east');
  addSurface(centerX, z0, blockSize, 14, 'roadway', 'road-north');
  addSurface(centerX, z1, blockSize, 14, 'roadway', 'road-south');
  for (const edgeX of [x0, x1]) for (const offset of [-8, 8]) {
    addSurface(edgeX + offset, centerZ, 2, blockSize, 'pavement', `walk-${edgeX}-${offset}`);
  }
  for (const edgeZ of [z0, z1]) for (const offset of [-8, 8]) {
    addSurface(centerX, edgeZ + offset, blockSize, 2, 'pavement', `walk-${edgeZ}-${offset}`);
  }
  addSurface(centerX, centerZ, blockSize - 18, blockSize - 18, 'cobble', 'inner-court');

  const sidePlans = [
    { name: 'west', axis: 'z', normal: [-1, 0], face: x0 + 10.4, along0: z0 + 14.6, along1: z1 - 14.6 },
    { name: 'east', axis: 'z', normal: [1, 0], face: x1 - 10.4, along0: z0 + 14.6, along1: z1 - 14.6 },
    { name: 'north', axis: 'x', normal: [0, -1], face: z0 + 10.4, along0: x0 + 14.6, along1: x1 - 14.6 },
    { name: 'south', axis: 'x', normal: [0, 1], face: z1 - 10.4, along0: x0 + 14.6, along1: x1 - 14.6 },
  ];

  function facadePoint(plan, along, y, offset = 0) {
    if (plan.axis === 'z') return [plan.face + plan.normal[0] * offset, y, along];
    return [along, y, plan.face + plan.normal[1] * offset];
  }

  function facadeBox(plan, along, y, alongSize, height, material, detail = 'detail', thickness = 0.12, offset = 0.06) {
    const position = facadePoint(plan, along, y, offset + thickness / 2);
    const size = plan.axis === 'z' ? [thickness, height, alongSize] : [alongSize, height, thickness];
    return box(position, size, material, detail);
  }

  function addWindow(plan, along, y, width, height, bay = false) {
    const faceOffset = bay ? 0.5 : 0.055;
    const frameMaterial = 'stone';
    facadeBox(plan, along, y, width, height, 'glass', 'detail', 0.07, faceOffset);
    for (const sign of [-1, 1]) {
      facadeBox(plan, along + sign * (width / 2 + 0.07), y, 0.13, height + 0.2, frameMaterial, 'detail', 0.17, faceOffset);
    }
    facadeBox(plan, along, y + height / 2 + 0.07, width + 0.28, 0.14, frameMaterial, 'detail', 0.2, faceOffset);
    facadeBox(plan, along, y - height / 2 - 0.08, width + 0.42, 0.16, frameMaterial, 'detail', 0.24, faceOffset + 0.03);
    facadeBox(plan, along, y, 0.075, height - 0.18, 'iron', 'detail', 0.09, faceOffset + 0.07);
    facadeBox(plan, along, y - 0.06, width - 0.14, 0.075, 'panel-walnut', 'detail', 0.09, faceOffset + 0.08);
    if (bay) {
      for (const sign of [-1, 1]) {
        const p = facadePoint(plan, along + sign * (width / 2), y, 0.27);
        const size = plan.axis === 'z' ? [0.52, height, 0.1] : [0.1, height, 0.52];
        box(p, size, 'brick-light', 'detail');
      }
      facadeBox(plan, along, y - height / 2 - 0.32, width + 0.45, 0.16, 'stone', 'detail', 0.9, 0.26);
    }
  }

  function addRoof(plan, body, wallTop, roofMaterial, stories, width, depth, buildingId) {
    const tiers = 3 + Math.floor(random() * 3);
    const roofRise = tiers * 0.48;
    const alongX = plan.axis === 'x';
    const span = depth + 0.55;
    const stepDepth = span / (2 * tiers);
    const ridge = alongX ? (body.z0 + body.z1) / 2 : (body.x0 + body.x1) / 2;
    const lowEdge = ridge - span / 2;
    const highEdge = ridge + span / 2;
    const beamLength = width + 0.5;
    for (let tier = 0; tier < tiers; tier++) {
      const band = stepDepth + 0.08;
      const y = wallTop + 0.32 + tier * 0.48;
      for (const fromLow of [true, false]) {
        const distance = (tier + 0.5) * stepDepth;
        const cross = fromLow ? lowEdge + distance : highEdge - distance;
        const position = alongX ? [centerOf(body.x0, body.x1), y, cross] : [cross, y, centerOf(body.z0, body.z1)];
        const size = alongX ? [beamLength, 0.56, band] : [band, 0.56, beamLength];
        box(position, size, tier === tiers - 1 && roofMaterial === 'roof-red' ? 'roof-red' : roofMaterial, 'structure');
      }
    }
    // Eaves and the ridge cap give the stair-stepped slopes a crisp silhouette.
    const eaveY = wallTop + 0.28;
    if (alongX) {
      for (const edge of [body.z0 - 0.28, body.z1 + 0.28]) box([centerOf(body.x0, body.x1), eaveY, edge], [width + 0.7, 0.16, 0.18], 'iron', 'structure');
      box([centerOf(body.x0, body.x1), wallTop + roofRise + 0.5, ridge], [width + 0.54, 0.24, 0.5], roofMaterial, 'structure');
    } else {
      for (const edge of [body.x0 - 0.28, body.x1 + 0.28]) box([edge, eaveY, centerOf(body.z0, body.z1)], [0.18, 0.16, width + 0.7], 'iron', 'structure');
      box([ridge, wallTop + roofRise + 0.5, centerOf(body.z0, body.z1)], [0.5, 0.24, width + 0.54], roofMaterial, 'structure');
    }

    const chimneyCount = stories >= 3 && random() > 0.28 ? 2 : 1;
    for (let chimney = 0; chimney < chimneyCount; chimney++) {
      const along = body.along0 + width * (chimneyCount === 1 ? 0.75 : chimney === 0 ? 0.23 : 0.77);
      const cross = ridge + (chimney % 2 ? 0.7 : -0.7);
      const position = alongX ? [along, wallTop + roofRise + 1.18, cross] : [cross, wallTop + roofRise + 1.18, along];
      const chimneySize = alongX ? [0.76, 2.35, 0.74] : [0.74, 2.35, 0.76];
      box(position, chimneySize, chimney % 2 ? 'brick-soot' : 'brick', 'structure');
      const collar = [...position]; collar[1] += 0.72;
      box(collar, alongX ? [0.9, 0.18, 0.86] : [0.86, 0.18, 0.9], 'stone', 'detail');
      const cap = [...position]; cap[1] += 1.22;
      box(cap, alongX ? [0.92, 0.16, 0.9] : [0.9, 0.16, 0.92], 'brick-soot', 'detail');
    }
    return wallTop + roofRise + 2.5;
  }

  function centerOf(a, b) { return (a + b) / 2; }

  function createHouse(plan, along0, width, depth, stories, style, serial) {
    const normal = plan.normal;
    const body = { along0, along1: along0 + width };
    if (plan.axis === 'z') {
      body.x0 = normal[0] < 0 ? plan.face : plan.face - depth;
      body.x1 = body.x0 + depth; body.z0 = along0; body.z1 = along0 + width;
    } else {
      body.z0 = normal[1] < 0 ? plan.face : plan.face - depth;
      body.z1 = body.z0 + depth; body.x0 = along0; body.x1 = along0 + width;
    }
    const roofMaterial = style.roof;
    const wallTop = 3.15 + (stories - 1) * 2.52;
    const roofFootprint = {
      minX: body.x0 - 1.5, maxX: body.x1 + 1.5,
      minZ: body.z0 - 1.5, maxZ: body.z1 + 1.5,
    };
    const buildingId = `${id}:building:${plan.name}-${serial}`;
    // Steps, roof overhangs, bays, and chimneys stay inside this reserved envelope.
    if (excludedAabb(roofFootprint.minX, roofFootprint.minZ, roofFootprint.maxX, roofFootprint.maxZ)) return null;

    const height = addRoof(plan, body, wallTop, roofMaterial, stories, width, depth, buildingId);
    const wallPosition = [centerOf(body.x0, body.x1), wallTop / 2, centerOf(body.z0, body.z1)];
    box(wallPosition, [body.x1 - body.x0, wallTop, body.z1 - body.z0], style.brick, 'structure');

    buildings.push({
      id: buildingId,
      bounds: { min: [body.x0, 0, body.z0], max: [body.x1, height, body.z1] },
    });

    const frontage = plan.axis === 'z' ? body.x0 + (normal[0] < 0 ? 0 : depth) : body.z0 + (normal[1] < 0 ? 0 : depth);
    const baseMaterial = style.stone ? 'stone' : 'brick-light';
    facadeBox(plan, (body.along0 + body.along1) / 2, 0.32, width + 0.22, 0.48, baseMaterial, 'detail', 0.25, 0.06);
    for (let floor = 1; floor < stories; floor++) {
      facadeBox(plan, (body.along0 + body.along1) / 2, 3.08 + (floor - 1) * 2.52, width + 0.42, 0.17, 'stone', 'detail', 0.24, 0.08);
    }
    facadeBox(plan, (body.along0 + body.along1) / 2, wallTop - 0.12, width + 0.58, 0.24, 'stone', 'detail', 0.3, 0.1);
    for (const along of [body.along0 + 0.25, body.along1 - 0.25]) {
      facadeBox(plan, along, wallTop / 2, 0.24, wallTop, style.stone ? 'stone' : 'brick-light', 'detail', 0.22, 0.08);
    }

    const doorAlong = (body.along0 + body.along1) / 2 + (style.shop ? 0 : (serial % 2 ? 1.85 : -1.85));
    const doorWidth = style.shop ? 1.3 : 1.18;
    facadeBox(plan, doorAlong, 1.1, doorWidth, 2.12, 'panel-walnut', 'detail', 0.12, 0.1);
    for (const side of [-1, 1]) facadeBox(plan, doorAlong + side * (doorWidth / 2 + 0.09), 1.14, 0.16, 2.28, 'stone', 'detail', 0.2, 0.1);
    facadeBox(plan, doorAlong, 2.3, doorWidth + 0.32, 0.18, 'stone', 'detail', 0.24, 0.11);
    facadeBox(plan, doorAlong, 2.56, doorWidth * 0.82, 0.36, 'glass', 'detail', 0.08, 0.1);
    facadeBox(plan, doorAlong, 2.57, 0.07, 0.34, 'iron', 'detail', 0.09, 0.16);
    facadeBox(plan, doorAlong, 0.04, doorWidth + 0.65, 0.12, 'stone', 'detail', 0.5, 0.42);
    facadeBox(plan, doorAlong, 0.19, doorWidth + 0.38, 0.16, 'stone', 'detail', 0.4, 0.2);
    const knob = facadePoint(plan, doorAlong + doorWidth * 0.31, 1.03, 0.19);
    box(knob, [0.09, 0.09, 0.09], 'brass', 'detail');
    for (const inset of [-0.28, 0.28]) facadeBox(plan, doorAlong + inset, 1.02, 0.055, 1.52, 'wood', 'detail', 0.05, 0.18);

    const upperCenters = [
      body.along0 + width * 0.22,
      body.along0 + width * 0.5,
      body.along0 + width * 0.78,
    ];
    if (style.shop) {
      for (const fraction of [0.25, 0.75]) addWindow(plan, body.along0 + width * fraction, 1.58, 2.55, 1.8);
    } else {
      for (const fraction of [0.25, 0.75]) addWindow(plan, body.along0 + width * fraction, 1.62, 1.58, 1.52);
    }
    for (let floor = 1; floor < stories; floor++) {
      const y = 4.02 + (floor - 1) * 2.52;
      for (let window = 0; window < upperCenters.length; window++) {
        addWindow(plan, upperCenters[window], y, 1.5, 1.66,
          style.bay && floor === 1 && window === 1);
      }
    }

    const backPlan = { ...plan, normal: [-normal[0], -normal[1]],
      face: plan.axis === 'z' ? (normal[0] < 0 ? body.x1 : body.x0) : (normal[1] < 0 ? body.z1 : body.z0) };
    for (let floor = 0; floor < stories; floor++) {
      const y = floor === 0 ? 1.6 : 4.02 + (floor - 1) * 2.52;
      for (const fraction of [0.28, 0.72]) {
        const along = body.along0 + width * fraction;
        facadeBox(backPlan, along, y, 1.32, 1.68, 'stone', 'detail', 0.13, 0.05);
        facadeBox(backPlan, along, y, 1.08, 1.42, 'glass', 'detail', 0.07, 0.19);
      }
    }

    if (style.shop) {
      const awningY = 3.02;
      const awning = facadePoint(plan, (body.along0 + body.along1) / 2, awningY, 0.82);
      box(awning, plan.axis === 'z' ? [1.1, 0.2, width * 0.82] : [width * 0.82, 0.2, 1.1], style.awning, 'detail');
      for (const fraction of [0.12, 0.88]) {
        const bracket = facadePoint(plan, body.along0 + width * fraction, awningY - 0.2, 0.43);
        box(bracket, plan.axis === 'z' ? [0.12, 0.42, 0.12] : [0.12, 0.42, 0.12], 'iron', 'detail');
      }
      facadeBox(plan, (body.along0 + body.along1) / 2, 2.72, width * 0.66, 0.14, 'panel-walnut', 'detail', 0.12, 0.16);
    }

    // A short, walled rear garden keeps the interior legible as yards and mews.
    const rearDepth = 5.2;
    const rearFace = plan.axis === 'z'
      ? (normal[0] < 0 ? body.x1 + rearDepth : body.x0 - rearDepth)
      : (normal[1] < 0 ? body.z1 + rearDepth : body.z0 - rearDepth);
    const rear = plan.axis === 'z'
      ? [rearFace, 0.72, (body.along0 + body.along1) / 2]
      : [(body.along0 + body.along1) / 2, 0.72, rearFace];
    const rearWallSize = plan.axis === 'z' ? [0.2, 1.44, width] : [width, 1.44, 0.2];
    blockingBox(`${buildingId}:rear-wall`, rear, rearWallSize, 'brick-light', 'structure');
    for (const along of [body.along0 + 0.25, body.along1 - 0.25]) {
      const sideWall = plan.axis === 'z'
        ? [rearFace + (normal[0] < 0 ? -rearDepth / 2 : rearDepth / 2), 0.62, along]
        : [along, 0.62, rearFace + (normal[1] < 0 ? -rearDepth / 2 : rearDepth / 2)];
      const sideWallSize = plan.axis === 'z' ? [rearDepth + 0.2, 1.24, 0.16] : [0.16, 1.24, rearDepth + 0.2];
      blockingBox(`${buildingId}:garden-wall-${along}`, sideWall, sideWallSize, 'brick-light', 'detail');
    }
    if (serial % 3 === 0) {
      const barrel = plan.axis === 'z'
        ? [normal[0] < 0 ? body.x1 + 2.2 : body.x0 - 2.2, 0.48, body.along0 + width * 0.8]
        : [body.along0 + width * 0.8, 0.48, normal[1] < 0 ? body.z1 + 2.2 : body.z0 - 2.2];
      addBarrel(barrel, `${buildingId}:barrel`);
    }
    return { id: buildingId, height, frontage };
  }

  function addBarrel(position, key = `${id}:barrel-${propSerial}`) {
    blockingBox(`${key}:body`, [position[0], 0.3, position[2]], [0.76, 0.6, 0.76], 'wood', 'street');
    box([position[0], 0.53, position[2]], [0.68, 0.12, 0.68], 'panel-walnut', 'detail');
    for (const y of [0.13, 0.4]) box([position[0], y, position[2]], [0.82, 0.07, 0.82], 'iron', 'detail');
  }

  function placeLamp(x, z) {
    if (excludedAabb(x - 0.45, z - 0.45, x + 0.45, z + 0.45)) return;
    box([x, 0.16, z], [0.48, 0.24, 0.48], 'iron', 'street');
    blockingBox(`lamp-post-${x}-${z}`, [x, 1.52, z], [0.16, 2.65, 0.16], 'iron', 'street');
    box([x, 2.88, z], [0.38, 0.12, 0.38], 'brass', 'detail');
    box([x, 3.12, z], [0.32, 0.42, 0.32], 'brass', 'detail');
    box([x, 3.36, z], [0.5, 0.1, 0.5], 'iron', 'detail');
    addProp('lamp', [x, 3.15, z], [0.25, 0.32, 0.25], 'brass', 'street');
  }

  function addTree(x, z) {
    const treeBox = { minX: x - 2.5, maxX: x + 2.5, minZ: z - 2.5, maxZ: z + 2.5 };
    if (excludedAabb(treeBox.minX, treeBox.minZ, treeBox.maxX, treeBox.maxZ) ||
        buildings.some((building) => overlaps(treeBox, { min: [building.bounds.min[0], building.bounds.min[2]], max: [building.bounds.max[0], building.bounds.max[2]] }))) return false;
    blockingBox(`tree-trunk-${x}-${z}`, [x, 1.35, z], [0.48, 2.7, 0.48], 'wood', 'street');
    box([x, 3.15, z], [2.8, 1.1, 2.8], 'paint-green', 'street');
    box([x, 3.95, z], [2.0, 1.0, 2.0], 'paint-green', 'street');
    box([x, 4.65, z], [1.1, 0.65, 1.1], 'paint-green', 'street');
    return true;
  }

  function addCart(x, z) {
    const cart = { minX: x - 1.25, maxX: x + 1.25, minZ: z - 0.95, maxZ: z + 0.95 };
    if (excludedAabb(cart.minX, cart.minZ, cart.maxX, cart.maxZ) ||
        buildings.some((building) => overlaps(cart, { min: [building.bounds.min[0], building.bounds.min[2]], max: [building.bounds.max[0], building.bounds.max[2]] }))) return false;
    blockingBox(`handcart-${x}-${z}`, [x, 0.78, z], [1.5, 0.38, 0.88], 'wood', 'street');
    box([x, 1.04, z], [1.42, 0.12, 0.8], 'panel-walnut', 'detail');
    for (const side of [-1, 1]) {
      const wheelZ = z + side * 0.52;
      box([x, 0.38, wheelZ], [0.72, 0.13, 0.12], 'iron', 'street');
      box([x, 0.38, wheelZ], [0.12, 0.72, 0.12], 'iron', 'street');
      box([x - 0.91, 0.46, z + side * 0.3], [0.95, 0.09, 0.09], 'wood', 'detail');
    }
    box([x + 0.7, 0.93, z], [0.12, 0.12, 0.92], 'wood', 'detail');
    return true;
  }

  // Four attached terraces, each with a broad passage to its rear mews.
  for (const plan of sidePlans) {
    const length = plan.along1 - plan.along0;
    const gapWidths = [0.45, 2.8, 0.55];
    const gaps = gapWidths.map((gap, index) => gap + (index === 1 ? random() * 0.5 : random() * 0.18));
    const totalGap = gaps.reduce((sum, value) => sum + value, 0);
    const usable = length - totalGap;
    const rawWidths = Array.from({ length: 4 }, () => 0.85 + random() * 0.3);
    const rawTotal = rawWidths.reduce((sum, value) => sum + value, 0);
    const widths = rawWidths.map((value) => usable * value / rawTotal);
    let along = plan.along0;
    for (let index = 0; index < 4; index++) {
      const styleRoll = random();
      const shop = index === 1 && styleRoll < 0.72 || index === 3 && styleRoll < 0.24;
      const stories = 2 + Math.floor(random() * 3);
      const width = widths[index];
      const depth = index === 0 || index === 3 ? 3 + random() * 0.35 : 9.6 + random() * 2.7;
      const style = {
        shop,
        bay: !shop && random() < 0.42,
        brick: pick(['brick', 'brick-red', 'brick-soot', 'brick-light']),
        roof: random() < 0.19 ? 'roof-red' : 'roof-slate',
        awning: pick(['paint-green', 'paint-cream', 'paint-black']),
        stone: random() < 0.27,
      };
      createHouse(plan, along, width, depth, stories, style, index);
      along += width + (gaps[index] || 0);
    }
  }

  // A pair of mews workshops gives the broad shared rear court a London service lane.
  const mews = [
    { x: centerX - 14, z: centerZ - 3.6, width: 13.4, depth: 8.2, side: 'north' },
    { x: centerX + 0.8, z: centerZ + 4.8, width: 13.8, depth: 8.6, side: 'south' },
  ];
  for (let index = 0; index < mews.length; index++) {
    const shed = mews[index];
    const plan = {
      name: `mews-${index}`, axis: 'x', normal: [0, index === 0 ? -1 : 1],
      face: shed.side === 'north' ? shed.z : shed.z + shed.depth,
    };
    const style = {
      shop: false, bay: false, brick: index ? 'brick-soot' : 'brick-red',
      roof: index ? 'roof-slate' : 'roof-red', awning: 'paint-green', stone: true,
    };
    createHouse(plan, shed.x, shed.width, shed.depth, 2, style, `mews-${index}`);
  }

  // Gas lamps stand well beyond the four open junction corners.
  for (const edgeX of [x0, x1]) for (const along of [z0 + 31, z1 - 31]) placeLamp(edgeX + (edgeX === x0 ? 8 : -8), along);
  for (const edgeZ of [z0, z1]) for (const along of [x0 + 31, x1 - 31]) placeLamp(along, edgeZ + (edgeZ === z0 ? 8 : -8));

  addTree(centerX - 12, centerZ + 15);
  addCart(centerX + 0.5, centerZ - 13.5);
  addBarrel([centerX + 19, 0.5, centerZ + 18]);

  return {
    id,
    bounds: { min: [x0, 0, z0], max: [x1, 28, z1] },
    props,
    surfaces,
    buildings,
    colliders,
  };
}
