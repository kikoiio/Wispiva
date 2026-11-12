import assert from "node:assert/strict";
import test from "node:test";
import { buildWorld3D, createCamera, drawWorld3D, pickWorld3D, projectPoint } from "./world3d.mjs";

test("builds a spatial model from arbitrary locations, links, and current actors", () => {
  const model = buildWorld3D({
    locations: [
      { id: "hill", name: "山门", kind: "outdoor" },
      { id: "dock", name: "浮桥", kind: "waterfront" },
      { id: "hall", name: "议事厅", kind: "indoor" },
    ],
    links: [["hill", "dock"], ["dock", "hall"]],
    actors: [{ id: "a", name: "巡守", place: "hill", hue: 12 }, { id: "b", name: "船夫", place: "dock", hue: 210 }],
  });

  assert.deepEqual(model.locations.map((item) => item.id), ["hill", "dock", "hall"]);
  assert.equal(model.roads.length, 2);
  assert.deepEqual(model.actors.map((item) => item.place), ["hill", "dock"]);
  assert.ok(model.locations.every((item) => Number.isFinite(item.x) && Number.isFinite(item.z)));
  assert.notEqual(model.actors[0].color, model.actors[1].color);
  const hill = model.locations.find((item) => item.id === "hill");
  assert.ok(model.actors[0].z > hill.z + hill.depth / 2, "people stand in front of their place model");
});

test("uses perspective depth and can pick a person and an unoccupied place", () => {
  const model = buildWorld3D({
    locations: [{ id: "gate", name: "城门" }, { id: "well", name: "井边" }],
    links: [["gate", "well"]],
    actors: [{ id: "watcher", name: "守门人", place: "gate", hue: 32 }],
  });
  const camera = createCamera(model);
  const width = 900;
  const height = 600;
  const actor = model.actors[0];
  const personPoint = projectPoint({ x: actor.x, y: actor.height * 0.72, z: actor.z }, camera, width, height);
  assert.deepEqual(pickWorld3D(model, camera, width, height, personPoint.x, personPoint.y), { type: "actor", id: "watcher" });

  const place = model.locations.find((item) => item.id === "well");
  const placePoint = projectPoint({ x: place.x, y: place.height, z: place.z }, camera, width, height);
  assert.deepEqual(pickWorld3D(model, camera, width, height, placePoint.x, placePoint.y), { type: "location", id: "well" });

  const near = projectPoint({ x: 0, y: 0, z: 0 }, { ...camera, distance: 8 }, width, height);
  const far = projectPoint({ x: 0, y: 0, z: 0 }, { ...camera, distance: 16 }, width, height);
  assert.ok(near.depth < far.depth);
  assert.ok(near.scale > far.scale);
});

test("draw order keeps the ground under roads before depth-sorted buildings", () => {
  const model = buildWorld3D({
    locations: [{ id: "a", name: "甲" }, { id: "b", name: "乙" }],
    links: [["a", "b"]],
    actors: [],
  });
  const fills = [];
  const context = {
    setTransform() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { fills.push(this.fillStyle); },
    stroke() {},
    roundRect() {},
    measureText(text) { return { width: text.length * 6 }; },
    fillText() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect() { return { width: 800, height: 600 }; },
    getContext() { return context; },
  };
  drawWorld3D(canvas, model, createCamera(model));
  assert.equal(fills[0], "#667d55");
  assert.equal(fills[1], "#b99d6a");
});
