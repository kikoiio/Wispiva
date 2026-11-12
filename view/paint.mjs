/** Draw the map from the grid. Rooms, roads, and water stay on their own tiles. */

import { tileKey } from "./layout.mjs";

export const GRASS = [126, 168, 92];
export const GRASS_DARK = [98, 146, 74];
export const WATER = [78, 148, 178];
export const WATER_DARK = [58, 124, 158];
export const ROAD = [196, 164, 108];
export const ROAD_EDGE = [150, 116, 70];
export const WALL = [62, 52, 48];
export const WOOD = [196, 154, 102];
export const STONE = [176, 170, 150];
export const SAND = [214, 186, 132];

export function paintMap(map) {
  const tile = map.tileSize;
  const image = createImage(map.gridWidth * tile, map.gridHeight * tile);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      setPixel(image, x, y, terrainColor(x, y, map.waterTop * tile));
    }
  }
  paintRoads(image, map);
  for (const location of map.locations) paintLocation(image, map, location);
  return image;
}

export function floorColor(location) {
  if (location.kind === "indoor") return WOOD;
  if (location.kind === "waterfront") return SAND;
  return STONE;
}

export function paintSprite(actor) {
  const image = createImage(16, 24);
  const coat = hsl(actor.hue, 0.46, 0.4);
  const skin = [236, 198, 160];
  fillRect(image, 4, 1, 8, 7, skin);
  fillRect(image, 5, 4, 2, 2, [42, 34, 30]);
  fillRect(image, 9, 4, 2, 2, [42, 34, 30]);
  fillRect(image, 3, 8, 10, 10, coat);
  fillRect(image, 4, 18, 3, 5, [64, 52, 44]);
  fillRect(image, 9, 18, 3, 5, [64, 52, 44]);
  return image;
}

export function createImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function pixel(image, x, y) {
  const index = (y * image.width + x) * 4;
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]];
}

function paintRoads(image, map) {
  const tile = map.tileSize;
  const roads = new Set(map.roadTiles.map((item) => tileKey(item)));
  for (const road of map.roadTiles) {
    const x = road.x * tile;
    const y = road.y * tile;
    fillRect(image, x, y, tile, tile, ROAD_EDGE);
    const left = roads.has(tileKey({ x: road.x - 1, y: road.y })) ? 0 : 3;
    const right = roads.has(tileKey({ x: road.x + 1, y: road.y })) ? 0 : 3;
    const top = roads.has(tileKey({ x: road.x, y: road.y - 1 })) ? 0 : 3;
    const bottom = roads.has(tileKey({ x: road.x, y: road.y + 1 })) ? 0 : 3;
    fillRect(image, x + left, y + top, tile - left - right, tile - top - bottom, ROAD);
  }
}

function paintLocation(image, map, location) {
  const tile = map.tileSize;
  const originX = location.x * tile;
  const originY = location.y * tile;
  fillRect(image, originX, originY, location.w * tile, location.h * tile, floorColor(location));
  paintProps(image, location, tile);
  const openings = new Set(location.entrances.map((entrance) => tileKey(entrance)));
  for (let x = location.x; x < location.x + location.w; x += 1) {
    paintWall(image, tile, openings, x, location.y);
    paintWall(image, tile, openings, x, location.y + location.h - 1);
  }
  for (let y = location.y; y < location.y + location.h; y += 1) {
    paintWall(image, tile, openings, location.x, y);
    paintWall(image, tile, openings, location.x + location.w - 1, y);
  }
}

function paintWall(image, tile, openings, x, y) {
  if (openings.has(tileKey({ x, y }))) return;
  fillRect(image, x * tile, y * tile, tile, tile, WALL);
}

function paintProps(image, location, tile) {
  const x = (location.x + 1) * tile + 4;
  const y = (location.y + 1) * tile + 4;
  if (location.kind === "indoor") {
    fillRect(image, x, y, 8, 12, [112, 78, 52]);
    return;
  }
  if (location.kind === "waterfront") {
    fillRect(image, x, y, 12, 4, [168, 122, 74]);
    fillRect(image, x, y + 6, 12, 4, [168, 122, 74]);
    return;
  }
  if (location.id === "market") {
    fillRect(image, x, y, 12, 4, [176, 64, 52]);
    fillRect(image, x, y + 4, 12, 8, [232, 214, 180]);
    return;
  }
  fillRect(image, x, y, 4, 12, WALL);
  fillRect(image, x + 8, y, 4, 12, WALL);
}

function terrainColor(x, y, waterTopPx) {
  if (y >= waterTopPx) return ((y >> 3) % 2 === 0) ? WATER : WATER_DARK;
  const block = ((x >> 3) * 3) ^ ((y >> 3) * 7);
  return (block & 3) === 0 ? GRASS_DARK : GRASS;
}

function setPixel(image, x, y, color) {
  const index = (y * image.width + x) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = 255;
}

function fillRect(image, x, y, width, height, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(image.width, x + width);
  const y1 = Math.min(image.height, y + height);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) setPixel(image, px, py, color);
  }
}

function hsl(hue, saturation, lightness) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lightness - c / 2;
  const channel = hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
      : hp < 3 ? [0, c, x]
        : hp < 4 ? [0, x, c]
          : hp < 5 ? [x, 0, c]
            : [c, 0, x];
  return channel.map((value) => Math.round((value + m) * 255));
}
