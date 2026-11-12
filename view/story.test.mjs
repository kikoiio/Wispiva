import assert from "node:assert/strict";
import test from "node:test";
import { buildPages, endCursor } from "./story.mjs";

const locations = [
  { id: "gate", name: "城门" },
  { id: "market", name: "市集" },
  { id: "well", name: "汲水处" },
];

test("a spoken line stays on that place, and a move lands on the destination", () => {
  const world = {
    locations,
    actors: [
      { id: "a", name: "商人", place: "market" },
      { id: "b", name: "学徒", place: "well" },
    ],
    events: [
      { tick: 0, agent: "b", action: "speak", ok: true, text: "陪我走一趟城门吧。" },
      { tick: 1, agent: "a", action: "wait", ok: true, text: "商人留在市集。" },
      { tick: 1, agent: "b", action: "wait", ok: true, text: "学徒留在市集。" },
      { tick: 2, agent: "b", action: "move", ok: true, text: "学徒从市集到了汲水处。" },
    ],
  };
  const pages = buildPages(world);
  assert.equal(pages[0].kind, "title");
  assert.equal(pages.length, 3);
  assert.equal(pages[1].placeId, "market");
  assert.deepEqual(pages[1].lines.map((line) => line.actorId), ["b"]);
  assert.equal(pages[2].placeId, "well");
  assert.ok(pages[2].present.includes("b"));
  assert.equal(pages[2].present.includes("a"), false);
});

test("a quiet beat in the middle is skipped, and the latest quiet beat stays", () => {
  const world = {
    locations,
    actors: [{ id: "a", name: "商人", place: "market" }],
    events: [
      { tick: 0, agent: "a", action: "speak", ok: true, text: "开门。" },
      { tick: 1, agent: "a", action: "wait", ok: true, text: "商人留在市集。" },
      { tick: 2, agent: "a", action: "wait", ok: true, text: "商人留在市集。" },
    ],
  };
  const pages = buildPages(world);
  assert.deepEqual(pages.map((page) => page.tick), [undefined, 0, 2]);
  assert.equal(pages[2].lines.length, 0);
});

test("the same beat repeated in a row is one page", () => {
  const world = {
    locations,
    actors: [{ id: "a", name: "商人", place: "market" }],
    events: [
      { tick: 0, agent: "a", action: "speak", ok: true, text: "开门。" },
      { tick: 1, agent: "a", action: "speak", ok: true, text: "开门。" },
      { tick: 2, agent: "a", action: "speak", ok: true, text: "换一句。" },
    ],
  };
  const pages = buildPages(world);
  assert.equal(pages.length, 3);
  assert.equal(pages[1].tickFrom, 0);
  assert.equal(pages[1].tickTo, 1);
  assert.equal(pages[2].tick, 2);
});

test("the book opens with the latest page on the right", () => {
  assert.equal(endCursor(1), 0);
  assert.equal(endCursor(4), 2);
  assert.equal(endCursor(5), 3);
});

test("an actor only enters the story at its join event", () => {
  const newcomer = { id: "new", name: "新来的", place: "market", hue: 42, goal: "找人" };
  const world = {
    locations,
    actors: [
      { id: "regular", name: "商人", place: "market" },
      newcomer,
    ],
    events: [
      {
        tick: 0, agent: "regular", action: "speak", ok: true, location: "market",
        actor: { id: "regular", name: "商人", place: "market" }, text: "今天开门。",
      },
      { tick: 0, agent: "new", action: "join", ok: true, location: "market", actor: newcomer, text: "新来的进入市集。" },
      { tick: 1, agent: "new", action: "speak", ok: true, location: "market", actor: newcomer, text: "我到了。" },
    ],
  };

  const pages = buildPages(world);
  const beforeJoin = pages.find((page) => page.tick === 0 && page.lines?.some((line) => line.actorId === "regular"));
  const joinScene = pages.find((page) => page.lines?.some((line) => world.events[line.eventIndex].action === "join"));
  assert.equal(beforeJoin.present.includes("new"), false);
  assert.ok(joinScene?.present.includes("new"));
});

test("an archived actor keeps scenes recorded before leaving", () => {
  const departed = { id: "gone", name: "离开的人", place: "market", hue: 24, goal: "回家" };
  const world = {
    locations,
    actors: [{ id: "still-here", name: "留下的人", place: "gate" }],
    archivedActors: [departed],
    events: [
      { tick: 0, agent: "gone", action: "speak", ok: true, location: "market", actor: departed, text: "我先去看看。" },
      { tick: 1, agent: "still-here", action: "speak", ok: true, location: "market", actor: { id: "still-here", name: "留下的人", place: "market" }, text: "离开之前。" },
      { tick: 1, agent: "gone", action: "leave", ok: true, location: "market", actor: departed, text: "离开的人离开了市集。" },
      { tick: 1, agent: "still-here", action: "speak", ok: true, location: "market", actor: { id: "still-here", name: "留下的人", place: "market" }, text: "离开之后。" },
      { tick: 2, agent: "still-here", action: "speak", ok: true, location: "gate", actor: { id: "still-here", name: "留下的人", place: "gate" }, text: "我还在这里。" },
    ],
  };

  const pages = buildPages(world);
  const earlierScene = pages.find((page) => page.tick === 0 && page.placeId === "market");
  assert.deepEqual(earlierScene?.lines.map((line) => line.actorId), ["gone"]);
  assert.ok(earlierScene.present.includes("gone"));
  const afterDeparture = pages.find((page) => page.lines?.some((line) => world.events[line.eventIndex].text === "离开之后。"));
  assert.ok(afterDeparture);
  assert.equal(afterDeparture.present.includes("gone"), false);
  assert.equal(pages.find((page) => page.tick === 2)?.present.includes("gone"), false);
});

test("joining between actions on the same tick cannot change the earlier scene", () => {
  const a = { id: "a", name: "甲", place: "market" };
  const b = { id: "b", name: "乙", place: "market" };
  const scenes = buildPages({
    locations, actors: [a, b], events: [
      { tick: 0, agent: "a", action: "speak", ok: true, location: "market", actor: a, text: "加入之前。" },
      { tick: 0, agent: "b", action: "join", ok: true, location: "market", actor: b, text: "乙进入。" },
      { tick: 0, agent: "a", action: "speak", ok: true, location: "market", actor: a, text: "加入之后。" },
    ],
  }).filter((page) => page.kind === "scene");
  assert.deepEqual(scenes[0].present, ["a"]);
  assert.ok(scenes.at(-1).present.includes("b"));
});

test("leaving between actions on the same tick preserves the earlier presence", () => {
  const a = { id: "a", name: "甲", place: "market" };
  const b = { id: "b", name: "乙", place: "market" };
  const scenes = buildPages({
    locations, actors: [b], archivedActors: [a], events: [
      { tick: 0, agent: "a", action: "speak", ok: true, location: "market", actor: a, text: "离开之前。" },
      { tick: 0, agent: "a", action: "leave", ok: true, location: "market", actor: a, text: "甲离开。" },
      { tick: 0, agent: "b", action: "speak", ok: true, location: "market", actor: b, text: "离开之后。" },
    ],
  }).filter((page) => page.kind === "scene");
  assert.ok(scenes[0].present.includes("a"));
  assert.ok(!scenes.at(-1).present.includes("a"));
});
