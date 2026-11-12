const TAU = Math.PI * 2;
const KIND_COLORS = {
  indoor: "#a8794c",
  waterfront: "#b58b55",
  outdoor: "#9c6945",
};

/** Make a deterministic spatial model from the current world snapshot. */
export function buildWorld3D(world = {}) {
  const locations = Array.isArray(world.locations) ? world.locations : [];
  const links = normalizeLinks(world.links, locations);
  const positions = layout(locations, links);
  const nodes = locations.map((location, index) => {
    const sizeX = number(location.w ?? location.width, 2);
    const sizeZ = number(location.h ?? location.depth, 2);
    const kind = location.kind || location.type || "outdoor";
    const pos = positions[index] || { x: 0, z: 0 };
    return {
      ...location,
      x: pos.x,
      y: 0,
      z: pos.z,
      width: clamp(1.3 + Math.sqrt(sizeX) * 0.2, 1.35, 2.4),
      depth: clamp(1.25 + Math.sqrt(sizeZ) * 0.18, 1.3, 2.25),
      height: kind === "waterfront" ? 0.62 : kind === "indoor" ? 1.0 : 0.88,
      kind,
      color: KIND_COLORS[kind] || KIND_COLORS.outdoor,
    };
  });
  const byId = new Map(nodes.map((location) => [location.id, location]));
  const roads = links
    .map(([from, to]) => ({ from: byId.get(from), to: byId.get(to) }))
    .filter((road) => road.from && road.to);
  const groups = new Map();
  const actors = (Array.isArray(world.actors) ? world.actors : []).map((actor) => {
    const place = byId.get(actor.place) || nodes[0] || { x: 0, z: 0 };
    const slot = groups.get(actor.place) || 0;
    groups.set(actor.place, slot + 1);
    const count = (Array.isArray(world.actors) ? world.actors : []).filter((item) => item.place === actor.place).length;
    const spread = (slot - (count - 1) / 2) * 0.34;
    const hue = ((Number(actor.hue) || hash(actor.id || actor.name)) % 360 + 360) % 360;
    return {
      ...actor,
      x: place.x + spread,
      y: 0,
      z: place.z + (place.depth || 0) / 2 + 0.45,
      hue,
      color: hueColor(hue, 46, 42),
      accent: hueColor((hue + 42 + hash(actor.id || actor.name) % 50) % 360, 58, 57),
      height: 1.18 + (hash(actor.id || actor.name) % 4) * 0.07,
      variant: hash(actor.id || actor.name) % 3,
    };
  });
  const extent = Math.max(3, ...nodes.map((item) => Math.abs(item.x) + item.width), ...nodes.map((item) => Math.abs(item.z) + item.depth));
  return { locations: nodes, roads, actors, extent };
}

export function createCamera(model) {
  const xs = model.locations.map((location) => location.x);
  const zs = model.locations.map((location) => location.z);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minZ = zs.length ? Math.min(...zs) : 0;
  const maxZ = zs.length ? Math.max(...zs) : 0;
  return {
    yaw: 0.72,
    pitch: 0.58,
    distance: Math.max(6.5, model.extent * 2.45),
    target: { x: (minX + maxX) / 2, y: 0.2, z: (minZ + maxZ) / 2 },
  };
}

/** Perspective projection into CSS pixel coordinates; y in the model points up. */
export function projectPoint(point, camera, width, height) {
  const dx = point.x - camera.target.x;
  const dy = point.y - camera.target.y;
  const dz = point.z - camera.target.z;
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const right = cy * dx - sy * dz;
  const up = -sy * sp * dx + cp * dy - cy * sp * dz;
  const depth = camera.distance - (sy * cp * dx + sp * dy + cy * cp * dz);
  if (depth <= 0.1) return null;
  const focal = Math.min(width, height) * 0.92;
  const scale = focal / depth;
  return { x: width / 2 + right * scale, y: height / 2 - up * scale, depth, scale };
}

export function pickWorld3D(model, camera, width, height, x, y) {
  const hits = [];
  for (const actor of model.actors) {
    const point = projectPoint({ x: actor.x, y: actor.height * 0.72, z: actor.z }, camera, width, height);
    if (!point) continue;
    const radius = clamp(point.scale * 0.38, 17, 42);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= radius) hits.push({ type: "actor", id: actor.id, depth: point.depth, distance });
  }
  for (const location of model.locations) {
    const corners = [
      [location.x - location.width / 2, location.z - location.depth / 2],
      [location.x + location.width / 2, location.z - location.depth / 2],
      [location.x + location.width / 2, location.z + location.depth / 2],
      [location.x - location.width / 2, location.z + location.depth / 2],
    ].map(([px, pz]) => projectPoint({ x: px, y: location.height, z: pz }, camera, width, height));
    if (corners.some((corner) => !corner)) continue;
    if (insidePolygon(x, y, corners)) {
      const center = projectPoint({ x: location.x, y: location.height, z: location.z }, camera, width, height);
      hits.push({ type: "location", id: location.id, depth: center?.depth ?? Infinity, distance: 0 });
    }
  }
  hits.sort((a, b) => a.depth - b.depth || a.distance - b.distance || (a.type === "actor" ? -1 : 1));
  return hits[0] ? { type: hits[0].type, id: hits[0].id } : null;
}

/** Draw a small generated town with painter-sorted faces and real perspective. */
export function drawWorld3D(canvas, model, camera, selected = null) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#d8e4df");
  sky.addColorStop(0.58, "#e7ddbf");
  sky.addColorStop(1, "#b8aa82");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const items = [];
  const half = model.extent + 2;
  pushPoly(items, [[-half, -0.08, -half], [half, -0.08, -half], [half, -0.08, half], [-half, -0.08, half]], "#667d55", null, 0);
  for (const road of model.roads) {
    const dx = road.to.x - road.from.x;
    const dz = road.to.z - road.from.z;
    const length = Math.hypot(dx, dz) || 1;
    const px = -dz / length * 0.17;
    const pz = dx / length * 0.17;
    pushPoly(items, [
      [road.from.x + px, 0, road.from.z + pz], [road.to.x + px, 0, road.to.z + pz],
      [road.to.x - px, 0, road.to.z - pz], [road.from.x - px, 0, road.from.z - pz],
    ], "#b99d6a", "#89764f", 1);
  }
  for (const location of model.locations) addLocation(items, location);
  for (const actor of model.actors) addActor(items, actor);
  items.sort((a, b) => (a.layer ?? 2) - (b.layer ?? 2) || itemDepth(b, camera) - itemDepth(a, camera));
  for (const item of items) paintItem(context, item, camera, width, height);
  drawLabels(context, model, camera, width, height);
  drawSelection(context, model, camera, selected, width, height);
}

function layout(locations, links) {
  if (!locations.length) return [];
  const explicit = locations.every((location) => Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.y)));
  if (explicit) {
    const raw = locations.map((location) => ({ x: Number(location.x) + number(location.w, 0) / 2, z: Number(location.y) + number(location.h, 0) / 2 }));
    const minX = Math.min(...raw.map((point) => point.x));
    const maxX = Math.max(...raw.map((point) => point.x));
    const minZ = Math.min(...raw.map((point) => point.z));
    const maxZ = Math.max(...raw.map((point) => point.z));
    const scale = 6 / Math.max(1, maxX - minX, maxZ - minZ);
    return raw.map((point) => ({ x: (point.x - (minX + maxX) / 2) * scale, z: (point.z - (minZ + maxZ) / 2) * scale }));
  }

  const count = locations.length;
  const points = locations.map((_, index) => {
    const angle = index * 2.399963229728653;
    const radius = count < 2 ? 0 : 1.6 + Math.sqrt(count) * 0.28;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, vx: 0, vz: 0 };
  });
  const indexById = new Map(locations.map((location, index) => [location.id, index]));
  const edges = links.map(([from, to]) => [indexById.get(from), indexById.get(to)]).filter(([a, b]) => a != null && b != null);
  for (let pass = 0; pass < 56; pass += 1) {
    const fx = points.map(() => 0);
    const fz = points.map(() => 0);
    for (let a = 0; a < count; a += 1) for (let b = a + 1; b < count; b += 1) {
      const dx = points[a].x - points[b].x;
      const dz = points[a].z - points[b].z;
      const distance2 = Math.max(0.05, dx * dx + dz * dz);
      const force = 0.085 / distance2;
      fx[a] += dx * force; fz[a] += dz * force;
      fx[b] -= dx * force; fz[b] -= dz * force;
    }
    for (const [a, b] of edges) {
      const dx = points[b].x - points[a].x;
      const dz = points[b].z - points[a].z;
      const distance = Math.max(0.01, Math.hypot(dx, dz));
      const force = (distance - 2.8) * 0.026;
      fx[a] += dx / distance * force; fz[a] += dz / distance * force;
      fx[b] -= dx / distance * force; fz[b] -= dz / distance * force;
    }
    for (let index = 0; index < count; index += 1) {
      const point = points[index];
      point.vx = (point.vx + fx[index] - point.x * 0.003) * 0.72;
      point.vz = (point.vz + fz[index] - point.z * 0.003) * 0.72;
      point.x += point.vx;
      point.z += point.vz;
    }
  }
  return points;
}

function normalizeLinks(links, locations) {
  const ids = new Set(locations.map((location) => location.id));
  return (Array.isArray(links) ? links : []).map((link) => {
    const from = Array.isArray(link) ? link[0] : link.from ?? link.source ?? link.a;
    const to = Array.isArray(link) ? link[1] : link.to ?? link.target ?? link.b;
    return [typeof from === "object" ? from?.id : from, typeof to === "object" ? to?.id : to];
  }).filter(([from, to]) => ids.has(from) && ids.has(to));
}

function addLocation(items, location) {
  const x = location.x; const z = location.z; const w = location.width; const d = location.depth;
  if (location.kind === "waterfront") {
    pushPoly(items, [[x - w, -0.04, z - d], [x + w, -0.04, z - d], [x + w, -0.04, z + d], [x - w, -0.04, z + d]], "#4e9dad", "#397b8a", 1);
  }
  addBox(items, x, 0.02, z, w * 1.18, 0.14, d * 1.18, "#c7ae7b");
  addBox(items, x, 0.14, z, w, location.height, d, location.color);
  if (location.kind === "outdoor") addGableRoof(items, location);
  else addBox(items, x, location.height + 0.02, z, w * 1.12, 0.16, d * 1.12, "#66594b");

  const windowColor = "#e8d495";
  for (const offset of [-0.31, 0.31]) {
    pushPoly(items, [[x + offset, 0.5, z + d / 2 + 0.008], [x + offset + 0.17, 0.5, z + d / 2 + 0.008], [x + offset + 0.17, 0.74, z + d / 2 + 0.008], [x + offset, 0.74, z + d / 2 + 0.008]], windowColor, "#715335");
  }
}

function addGableRoof(items, location) {
  const { x, z, width: w, depth: d, height: h } = location;
  const x0 = x - w * 0.62; const x1 = x + w * 0.62;
  const z0 = z - d * 0.62; const z1 = z + d * 0.62;
  const ridge = h + 0.48;
  pushPoly(items, [[x0, h, z1], [x, ridge, z1], [x1, h, z1]], "#754337", "#4e332c");
  pushPoly(items, [[x1, h, z0], [x, ridge, z0], [x0, h, z0]], "#87503b", "#4e332c");
  pushPoly(items, [[x0, h, z0], [x, ridge, z0], [x, ridge, z1], [x0, h, z1]], "#a45d40", "#4e332c");
  pushPoly(items, [[x, ridge, z0], [x1, h, z0], [x1, h, z1], [x, ridge, z1]], "#8e4937", "#4e332c");
}

function addActor(items, actor) {
  const x = actor.x; const z = actor.z; const height = actor.height;
  items.push({ ellipse: { x, y: 0.015, z, rx: 0.27, rz: 0.16 }, color: "rgba(42, 48, 36, 0.28)" });
  addBox(items, x - 0.08, 0.08, z, 0.09, height * 0.31, 0.12, "#4c4036");
  addBox(items, x + 0.08, 0.08, z, 0.09, height * 0.31, 0.12, "#4c4036");
  if (actor.variant === 1) addBox(items, x, 0.34, z - 0.11, 0.38, 0.59, 0.08, actor.accent);
  addBox(items, x, 0.34, z, 0.34, 0.58 + actor.variant * 0.035, 0.23, actor.color);
  addBox(items, x - 0.24, 0.4, z, 0.1, 0.38, 0.12, actor.color);
  addBox(items, x + 0.24, 0.4, z, 0.1, 0.38, 0.12, actor.color);
  items.push({ ellipse: { x, y: height * 0.83, z, rx: 0.14, rz: 0.14 }, color: "#d9aa7d", outline: "#5b4031" });
  addBox(items, x, height * 0.9, z - 0.015, 0.27, 0.1, 0.26, "#493b32");
  addBox(items, x, 0.72, z + 0.122, 0.31, 0.08, 0.025, actor.accent);
}

function addBox(items, x, y, z, width, height, depth, color) {
  const x0 = x - width / 2; const x1 = x + width / 2;
  const y0 = y; const y1 = y + height;
  const z0 = z - depth / 2; const z1 = z + depth / 2;
  const faces = [
    [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1.16],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 1],
    [[[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 0.82],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.72],
    [[[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.86],
  ];
  for (const [points, amount] of faces) pushPoly(items, points, shade(color, amount), "rgba(55, 44, 31, 0.45)");
}

function pushPoly(items, points, color, stroke = null, layer = 2) {
  items.push({ points: points.map(([x, y, z]) => ({ x, y, z })), color, stroke, layer });
}

function paintItem(context, item, camera, width, height) {
  if (item.ellipse) {
    const center = projectPoint(item.ellipse, camera, width, height);
    if (!center) return;
    context.beginPath();
    context.ellipse(center.x, center.y, Math.max(1, center.scale * item.ellipse.rx), Math.max(1, center.scale * item.ellipse.rz * 0.62), 0, 0, TAU);
    context.fillStyle = item.color;
    context.fill();
    if (item.outline) { context.strokeStyle = item.outline; context.lineWidth = 1; context.stroke(); }
    return;
  }
  const projected = item.points.map((point) => projectPoint(point, camera, width, height));
  if (projected.some((point) => !point)) return;
  context.beginPath();
  context.moveTo(projected[0].x, projected[0].y);
  for (const point of projected.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fillStyle = item.color;
  context.fill();
  if (item.stroke) { context.strokeStyle = item.stroke; context.lineWidth = 0.7; context.stroke(); }
}

function drawLabels(context, model, camera, width, height) {
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const location of model.locations) {
    const point = projectPoint({ x: location.x, y: location.height + 0.68, z: location.z }, camera, width, height);
    if (point) badge(context, location.name, point.x, point.y, 13, "#fff3d3", "#61472c");
  }
  for (const actor of model.actors) {
    const point = projectPoint({ x: actor.x, y: actor.height + 0.08, z: actor.z }, camera, width, height);
    if (point) badge(context, actor.name, point.x, point.y, 11, "rgba(255,250,230,.94)", "#504333");
  }
}

function badge(context, text, x, y, fontSize, fill, ink) {
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  const width = context.measureText(text).width + 14;
  const height = fontSize + 10;
  context.fillStyle = fill;
  context.strokeStyle = "rgba(64, 49, 30, .65)";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x - width / 2, y - height / 2, width, height, 5);
  context.fill(); context.stroke();
  context.fillStyle = ink;
  context.fillText(text, x, y + 0.5);
}

function drawSelection(context, model, camera, selected, width, height) {
  if (!selected) return;
  const location = model.locations.find((item) => item.id === selected.id && selected.type === "location");
  const actor = model.actors.find((item) => item.id === selected.id && selected.type === "actor");
  const center = location || actor;
  if (!center) return;
  const radiusX = location ? location.width * 0.62 : 0.35;
  const radiusZ = location ? location.depth * 0.62 : 0.26;
  const points = Array.from({ length: 32 }, (_, index) => {
    const angle = TAU * index / 32;
    return projectPoint({ x: center.x + Math.cos(angle) * radiusX, y: 0.05, z: center.z + Math.sin(angle) * radiusZ }, camera, width, height);
  }).filter(Boolean);
  if (points.length < 3) return;
  context.beginPath(); context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.strokeStyle = "#f3c45d"; context.lineWidth = 3; context.stroke();
}

function averageDepth(points, camera) {
  if (!points?.length) return camera.distance;
  let total = 0;
  for (const point of points) {
    const dx = point.x - camera.target.x; const dy = point.y - camera.target.y; const dz = point.z - camera.target.z;
    total += camera.distance - (Math.sin(camera.yaw) * Math.cos(camera.pitch) * dx + Math.sin(camera.pitch) * dy + Math.cos(camera.yaw) * Math.cos(camera.pitch) * dz);
  }
  return total / points.length;
}

function itemDepth(item, camera) {
  return averageDepth(item.points || (item.ellipse ? [item.ellipse] : null), camera);
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]; const b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hueColor(h, s, l) {
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const hp = h / 60; const x = c * (1 - Math.abs(hp % 2 - 1)); const m = l / 100 - c / 2;
  const raw = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return `#${raw.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function shade(color, factor) {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map((part) => clamp(Math.round(part * factor), 0, 255));
  return `#${channels.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function hash(value = "") {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
