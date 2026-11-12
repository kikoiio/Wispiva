/** Tile paths a person can walk. The logical place changes before the picture finishes. */

import { tileKey } from "./layout.mjs";

export function pathTiles(map, fromId, toId) {
  const route = map.routes.find((item) => item.from === fromId && item.to === toId)
    || map.routes.find((item) => item.from === toId && item.to === fromId);
  if (!route) return null;
  const forward = route.from === fromId;
  const from = map.locations.find((location) => location.id === fromId);
  const to = map.locations.find((location) => location.id === toId);
  const leave = forward ? route.fromEntrance : route.toEntrance;
  const arrive = forward ? route.toEntrance : route.fromEntrance;
  const outside = forward ? route.outside : [...route.outside].reverse();
  return dedupe([
    ...leaveRoom(from, leave),
    ...outside,
    ...enterRoom(to, arrive),
  ]);
}

function leaveRoom(location, entrance) {
  return [...orthogonal(location.spawn, innerStep(location, entrance)), entrance];
}

function enterRoom(location, entrance) {
  return [entrance, ...orthogonal(innerStep(location, entrance), location.spawn)];
}

function innerStep(location, entrance) {
  return {
    x: clamp(entrance.x, location.x + 1, location.x + location.w - 2),
    y: clamp(entrance.y, location.y + 1, location.y + location.h - 2),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function tilesInside(location) {
  const tiles = [];
  for (let y = location.y; y < location.y + location.h; y += 1) {
    for (let x = location.x; x < location.x + location.w; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function orthogonal(from, to) {
  const tiles = [{ x: from.x, y: from.y }];
  const xStep = Math.sign(to.x - from.x);
  for (let x = from.x; x !== to.x; x += xStep) {
    tiles.push({ x: x + xStep, y: from.y });
  }
  const yStep = Math.sign(to.y - tiles.at(-1).y);
  if (yStep !== 0) {
    for (let y = tiles.at(-1).y; y !== to.y; y += yStep) {
      tiles.push({ x: to.x, y: y + yStep });
    }
  }
  return tiles;
}

function dedupe(tiles) {
  const result = [];
  for (const tile of tiles) {
    const previous = result.at(-1);
    if (previous && tileKey(previous) === tileKey(tile)) continue;
    result.push({ x: tile.x, y: tile.y });
  }
  return result;
}
