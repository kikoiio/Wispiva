import assert from "node:assert/strict";
import test from "node:test";
import { buildMap, tileKey } from "./layout.mjs";
import { pathTiles, tilesInside } from "./walk.mjs";
import { story } from "./world.mjs";

test("a move starts at the old spot, follows the road, and ends at the new spot", () => {
  const map = buildMap(story);
  const places = new Map(story.actors.map((actor) => [actor.id, actor.place]));
  for (const beat of story.beats) {
    const actor = story.actors.find((item) => item.id === beat.actor);
    const fromId = places.get(beat.actor);
    const path = pathTiles(map, fromId, beat.to);
    assert.ok(path, `${actor.name} 没有去 ${beat.to} 的路`);
    const from = map.locations.find((location) => location.id === fromId);
    const to = map.locations.find((location) => location.id === beat.to);
    assert.deepEqual(path[0], from.spawn);
    assert.deepEqual(path.at(-1), to.spawn);

    const foreign = new Set();
    for (const location of map.locations) {
      if (location.id === fromId || location.id === beat.to) continue;
      for (const tile of tilesInside(location)) foreign.add(tileKey(tile));
    }
    for (const tile of path) {
      assert.equal(foreign.has(tileKey(tile)), false, `${actor.name} 的路穿过了别人的房间`);
    }
    places.set(beat.actor, beat.to);
  }
});
