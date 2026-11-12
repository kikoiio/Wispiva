import assert from "node:assert/strict";
import test from "node:test";
import { buildMap, tileKey } from "./layout.mjs";
import { ROAD, WALL, WATER, floorColor, paintMap, pixel } from "./paint.mjs";
import { story } from "./world.mjs";

test("painted pixels follow the room, the road, and the water", () => {
  const map = buildMap(story);
  const image = paintMap(map);
  assert.equal(image.width, map.gridWidth * map.tileSize);
  assert.equal(image.height, map.gridHeight * map.tileSize);

  const road = map.roadTiles[0];
  assert.deepEqual(center(image, map, road).slice(0, 3), ROAD);

  for (const location of map.locations) {
    assert.deepEqual(center(image, map, location.spawn).slice(0, 3), floorColor(location));
    for (const entrance of location.entrances) {
      assert.deepEqual(center(image, map, entrance).slice(0, 3), floorColor(location));
    }
    const wall = { x: location.x, y: location.y };
    if (!location.entrances.some((entrance) => tileKey(entrance) === tileKey(wall))) {
      assert.deepEqual(center(image, map, wall).slice(0, 3), WALL);
    }
  }

  const water = pixel(image, map.tileSize, map.waterTop * map.tileSize);
  assert.deepEqual(water.slice(0, 3), WATER);
});

function center(image, map, tile) {
  const tileSize = map.tileSize;
  return pixel(image, tile.x * tileSize + Math.floor(tileSize / 2), tile.y * tileSize + Math.floor(tileSize / 2));
}
