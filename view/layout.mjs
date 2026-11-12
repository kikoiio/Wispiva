/** Place rooms on a grid and cut roads through the gaps between them. */

const GAP = 3;
const MARGIN = 2;
const SHELF = 28;

export function tileKey(tile) {
  return `${tile.x},${tile.y}`;
}

export function buildMap(story) {
  const locations = placeLocations(story.locations);
  const gridWidth = Math.max(...locations.map((location) => location.x + location.w)) + MARGIN;
  const occupiedBottom = Math.max(...locations.map((location) => location.y + location.h));
  const waterTop = occupiedBottom + 1;
  const gridHeight = waterTop + 4;
  const blocked = blockInteriors(locations);

  const routes = [];
  for (const [fromId, toId] of story.links) {
    const from = byId(locations, fromId);
    const to = byId(locations, toId);
    const fromEntrance = entranceToward(from, to);
    const toEntrance = entranceToward(to, from);
    const fromDoor = stepOutside(fromEntrance);
    const toDoor = stepOutside(toEntrance);
    assertOpen(fromDoor, blocked, gridWidth, gridHeight, `${fromId} 的门口`);
    assertOpen(toDoor, blocked, gridWidth, gridHeight, `${toId} 的门口`);
    const outside = routeOutside(fromDoor, toDoor, blocked, gridWidth, gridHeight, waterTop);
    if (!outside) {
      throw new Error(`没有路：${fromId} → ${toId}`);
    }
    from.entrances.push(fromEntrance);
    to.entrances.push(toEntrance);
    routes.push({ from: fromId, to: toId, fromEntrance, toEntrance, outside });
  }

  const roadTiles = uniqueTiles(routes.flatMap((route) => route.outside));
  return {
    name: story.name,
    tileSize: story.tileSize,
    gridWidth,
    gridHeight,
    waterTop,
    locations,
    routes,
    roadTiles,
  };
}

function placeLocations(definitions) {
  const placed = [];
  let cursorX = MARGIN;
  let cursorY = MARGIN;
  let rowHeight = 0;
  for (const definition of definitions) {
    if (placed.length > 0 && cursorX + definition.w + MARGIN > SHELF) {
      cursorY += rowHeight + GAP;
      cursorX = MARGIN;
      rowHeight = 0;
    }
    const spawn = {
      x: cursorX + Math.floor(definition.w / 2),
      y: cursorY + Math.floor(definition.h / 2),
    };
    placed.push({ ...definition, x: cursorX, y: cursorY, spawn, entrances: [] });
    rowHeight = Math.max(rowHeight, definition.h);
    cursorX += definition.w + GAP;
  }
  return placed;
}

function entranceToward(location, other) {
  const originX = location.x + location.w / 2;
  const originY = location.y + location.h / 2;
  const dx = other.x + other.w / 2 - originX;
  const dy = other.y + other.h / 2 - originY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const side = dx >= 0 ? "east" : "west";
    return {
      x: side === "east" ? location.x + location.w - 1 : location.x,
      y: clamp(Math.round(originY), location.y + 1, location.y + location.h - 2),
      side,
    };
  }
  const side = dy >= 0 ? "south" : "north";
  return {
    x: clamp(Math.round(originX), location.x + 1, location.x + location.w - 2),
    y: side === "south" ? location.y + location.h - 1 : location.y,
    side,
  };
}

function stepOutside(entrance) {
  const step = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[entrance.side];
  return { x: entrance.x + step[0], y: entrance.y + step[1] };
}

function blockInteriors(locations) {
  const blocked = new Set();
  for (const location of locations) {
    for (let y = location.y; y < location.y + location.h; y += 1) {
      for (let x = location.x; x < location.x + location.w; x += 1) {
        blocked.add(tileKey({ x, y }));
      }
    }
  }
  return blocked;
}

function routeOutside(start, goal, blocked, gridWidth, gridHeight, waterTop) {
  const goalId = tileKey(goal);
  if (tileKey(start) === goalId) return [start];
  const queue = [start];
  const seen = new Set([tileKey(start)]);
  const previous = new Map();
  while (queue.length > 0) {
    const here = queue.shift();
    for (const next of neighbors(here)) {
      if (next.x < 0 || next.y < 0 || next.x >= gridWidth || next.y >= gridHeight) continue;
      if (next.y >= waterTop) continue;
      const id = tileKey(next);
      if (seen.has(id) || blocked.has(id)) continue;
      seen.add(id);
      previous.set(id, here);
      if (id === goalId) return rewind(next, previous);
      queue.push(next);
    }
  }
  return null;
}

function neighbors(tile) {
  return [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ];
}

function rewind(goal, previous) {
  const tiles = [goal];
  let cursor = tileKey(goal);
  while (previous.has(cursor)) {
    const prior = previous.get(cursor);
    tiles.push(prior);
    cursor = tileKey(prior);
  }
  return tiles.reverse();
}

function uniqueTiles(tiles) {
  const seen = new Set();
  const unique = [];
  for (const tile of tiles) {
    const id = tileKey(tile);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(tile);
  }
  return unique;
}

function assertOpen(tile, blocked, gridWidth, gridHeight, label) {
  if (tile.x < 0 || tile.y < 0 || tile.x >= gridWidth || tile.y >= gridHeight || blocked.has(tileKey(tile))) {
    throw new Error(`${label}被堵住了`);
  }
}

function byId(locations, id) {
  const location = locations.find((item) => item.id === id);
  if (!location) throw new Error(`没有地点：${id}`);
  return location;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
