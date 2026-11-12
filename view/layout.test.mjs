import assert from "node:assert/strict";
import test from "node:test";
import { buildMap, tileKey } from "./layout.mjs";
import { story } from "./world.mjs";

test("rooms stay apart and every link has a road outside them", () => {
  const map = buildMap(story);
  for (let index = 0; index < map.locations.length; index += 1) {
    for (const other of map.locations.slice(index + 1)) {
      const apart = map.locations[index].x + map.locations[index].w <= other.x
        || other.x + other.w <= map.locations[index].x
        || map.locations[index].y + map.locations[index].h <= other.y
        || other.y + other.h <= map.locations[index].y;
      assert.equal(apart, true, `${map.locations[index].id} 与 ${other.id} 重叠`);
    }
  }

  const interiors = new Set();
  for (const location of map.locations) {
    for (let y = location.y; y < location.y + location.h; y += 1) {
      for (let x = location.x; x < location.x + location.w; x += 1) {
        interiors.add(tileKey({ x, y }));
      }
    }
  }
  for (const road of map.roadTiles) {
    assert.equal(interiors.has(tileKey(road)), false, `路进了房间 ${tileKey(road)}`);
    assert.ok(road.y < map.waterTop);
  }
  assert.equal(map.routes.length, story.links.length);
  for (const route of map.routes) {
    assert.ok(route.outside.length >= 1);
    const from = map.locations.find((location) => location.id === route.from);
    const onBorder = route.fromEntrance.x === from.x
      || route.fromEntrance.x === from.x + from.w - 1
      || route.fromEntrance.y === from.y
      || route.fromEntrance.y === from.y + from.h - 1;
    assert.equal(onBorder, true);
  }
});
