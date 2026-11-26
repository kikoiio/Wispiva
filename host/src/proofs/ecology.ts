import assert from "node:assert/strict";
import type { WorldClient, WorldResult } from "../world.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), `expected object ${JSON.stringify(value)}`);
  return value;
}

function values(state: Record<string, unknown>, key: string): unknown[] {
  const value = state[key];
  assert.ok(Array.isArray(value), `expected ${key} array ${JSON.stringify(state)}`);
  return value;
}

function rows(state: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return values(state, key).map(record);
}

function number(state: Record<string, unknown>, key: string): number {
  const value = state[key];
  assert.ok(typeof value === "number" && Number.isFinite(value), `expected numeric ${key} ${JSON.stringify(state)}`);
  return value;
}

function resultOf(response: WorldResult): Record<string, unknown> {
  assert.ok(response.ok && response.result, JSON.stringify(response));
  return response.result;
}

function entity(state: Record<string, unknown>, field: string, id: unknown): Record<string, unknown> {
  const found = rows(state, field).find(entry => entry.id === id);
  assert.ok(found, `missing ${field} entity ${String(id)}`);
  return found;
}

function quantity(state: Record<string, unknown>, item: string, field = "items"): number {
  return rows(state, field).filter(stack => stack.id === item).reduce((sum, stack) => {
    const count = number(stack, "qty");
    assert.ok(Number.isSafeInteger(count) && count > 0, `invalid finite stack ${JSON.stringify(stack)}`);
    return sum + count;
  }, 0);
}

function distance(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return Math.hypot(number(a, "x") - number(b, "x"), number(a, "y") - number(b, "y"), number(a, "z") - number(b, "z"));
}

async function use(world: WorldClient, actor: string, tool: string, args: Record<string, unknown> = {}) {
  const response = await world.call("agent", tool, args, actor);
  assert.ok(response.ok, `${actor} ${tool} ${JSON.stringify(args)} ${JSON.stringify(response)}`);
  return resultOf(response);
}

async function host(
  world: WorldClient,
  tool: "world_step" | "world_snapshot" | "world_inject_event" | "host_pending",
  args: Record<string, unknown> = {},
) {
  return resultOf(await world.call("host", tool, args));
}

async function pending(world: WorldClient, actor: string) {
  return rows(await host(world, "host_pending", { agentId: actor }), "events");
}

async function reach(world: WorldClient, actor: string, destination: string, events: Record<string, unknown>[] = []) {
  let arrived = await use(world, actor, "move_to", { destination, pace: "walk" });
  if (arrived.pending === true) {
    const action = record(arrived.action);
    for (let attempt = 0; attempt < 64; attempt++) {
      const before = await use(world, actor, "status");
      const remaining = number(action, "finish_second") - number(before, "elapsed_seconds");
      await host(world, "world_step", { seconds: Math.max(60, Math.ceil(remaining)), stop_on_action: true });
      const received = await pending(world, actor);
      events.push(...received);
      const completed = received.find(event => event.type === "action_completed"
        && record(event.action).kind === action.kind
        && record(event.action).started_second === action.started_second);
      if (completed !== undefined) {
        arrived = record(completed.result);
        break;
      }
      const after = await use(world, actor, "status");
      assert.deepEqual(after.action, action, `${actor} walk interrupted ${JSON.stringify(after)}`);
      assert.ok(number(after, "elapsed_seconds") > number(before, "elapsed_seconds"), "world_step must advance the walk");
    }
  }
  assert.equal(arrived.arrived, true, `${actor} -> ${destination} ${JSON.stringify(arrived)}`);
  return arrived;
}

async function atHour(world: WorldClient, hour: number) {
  const snapshot = await host(world, "world_snapshot");
  const minutes = (hour * 60 - (number(snapshot, "minute") + 360) % 1440 + 1440) % 1440;
  if (minutes > 0) await host(world, "world_step", { minutes });
  await host(world, "world_inject_event", { kind: "weather", weather: "clear" });
}

async function supply(world: WorldClient, actor: string, item: string) {
  const before = quantity(await use(world, actor, "status"), item, "inventory");
  await host(world, "world_inject_event", { kind: "item", place: actor, item_id: item, quantity: 1 });
  await use(world, actor, "transfer_item", { action: "pick", item_id: item, quantity: 1 });
  assert.equal(quantity(await use(world, actor, "status"), item, "inventory"), before + 1);
}

async function inspectFlock(world: WorldClient, events: Record<string, unknown>[] = []) {
  const sheep: { id: string; condition: unknown; injuries: unknown[] }[] = [];
  for (let column = 0; column < 7; column++) {
    await reach(world, "human_miller", `${-279 + column * 2.2},3,192`, events);
    for (const row of [0, 1]) {
      const id = `miller_sheep_${String(column + row * 7 + 1).padStart(2, "0")}`;
      const inspected = await use(world, "human_miller", "inspect", { target_id: id });
      sheep.push({ id, condition: inspected.condition, injuries: values(inspected, "injuries") });
    }
  }
  return sheep;
}

export async function proveWolfPredation(world: WorldClient): Promise<void> {
  const shepherd = "human_miller";
  const gate = "sheep_pen_gate";
  const bite = "A sheep cries out as a wolf bites it.";
  await host(world, "world_inject_event", { kind: "weather", weather: "clear" });
  await reach(world, shepherd, "-276,3,160");
  await use(world, shepherd, "toggle_lock", { door_id: "miller_door", action: "open" });
  await reach(world, shepherd, "-274,3,160");
  await reach(world, shepherd, gate);
  await use(world, shepherd, "toggle_lock", { door_id: gate, action: "close" });
  await atHour(world, 19);

  // Sheep stay at their home positions after 19:00, including while Miller enters.
  await use(world, shepherd, "toggle_lock", { door_id: gate, action: "open" });
  await reach(world, shepherd, "-272,3,186.6");
  await use(world, shepherd, "toggle_lock", { door_id: gate, action: "close" });
  const protectedFlock = await inspectFlock(world);
  for (const sheep of protectedFlock) {
    assert.equal(sheep.condition, "conscious", `${sheep.id} must start alive and conscious`);
    assert.deepEqual(sheep.injuries, [], `${sheep.id} must start uninjured`);
  }
  const beforeNight = await host(world, "world_snapshot");
  assert.equal(rows(beforeNight, "wildlife").filter(beast => beast.kind === "sheep").length, 14);
  const wolves = rows(beforeNight, "wildlife").filter(beast => beast.kind === "wolf");
  assert.equal(wolves.length, 4, "run ecology before the field and magic proofs consume the wolves");
  assert.ok(wolves.every(wolf => wolf.condition === "conscious"), "predation requires four living wolves");
  await atHour(world, 20);
  assert.ok(number(await host(world, "world_snapshot"), "minute") >= 840, "wolves must accrue hunger through natural world time");
  await pending(world, shepherd);

  let nearPen = false;
  for (let attempt = 0; attempt < 36; attempt++) {
    await host(world, "world_step", { minutes: 5 });
    const snapshot = await host(world, "world_snapshot");
    assert.equal(entity(snapshot, "doors", gate).open, false);
    nearPen = rows(snapshot, "wildlife").some(beast => beast.kind === "wolf" && beast.condition === "conscious"
      && distance(beast, { x: -272, y: 3, z: 185 }) < 30);
    if (nearPen) break;
  }
  assert.ok(nearPen, "hungry wolves must actually approach the closed pen within three night hours");
  await host(world, "world_step", { minutes: 30 });
  const closedEvents = await pending(world, shepherd);
  assert.deepEqual(await inspectFlock(world, closedEvents), protectedFlock, "a closed pen must protect every sheep from injury");
  assert.equal(closedEvents.some(event => event.type === "noise" && event.text === bite), false);

  await reach(world, shepherd, "-270.1,3,187");
  assert.equal((await use(world, shepherd, "inspect", { target_id: gate })).open, false);
  await pending(world, shepherd);
  const openEvents: Record<string, unknown>[] = [];
  assert.equal((await use(world, shepherd, "toggle_lock", { door_id: gate, action: "open" })).open, true);
  let entered = false;
  for (let attempt = 0; attempt <= 60; attempt++) {
    if (attempt > 0) await host(world, "world_step", { minutes: 1 });
    const snapshot = await host(world, "world_snapshot");
    entered ||= rows(snapshot, "wildlife").some(beast => beast.kind === "wolf"
      && number(beast, "x") > -282 && number(beast, "x") < -262
      && number(beast, "z") > 185 && number(beast, "z") < 203);
    openEvents.push(...await pending(world, shepherd));
    if (openEvents.some(event => event.type === "noise" && event.text === bite)) break;
  }
  assert.ok(entered, "opening the real gate must let a wolf physically enter the pen");
  assert.ok(openEvents.some(event => event.type === "noise" && event.text === bite), "Miller must hear an actual wolf bite");
  await host(world, "world_step", { minutes: 10 });
  const wounded = await inspectFlock(world);
  assert.ok(wounded.some(sheep => sheep.injuries.includes("lacerated") && sheep.injuries.includes("bleeding")),
    `an inspected sheep must acquire real bite injuries ${JSON.stringify(wounded)}`);
}

export async function proveGoblinRaids(world: WorldClient): Promise<void> {
  const hauler = "human_owen";
  const guard = "human_garrick";
  const cart = "oakford_cart";
  const cargoIds = ["grain_sack", "iron_ore"];
  const raid = "Cargo is dragged from a cart.";
  await host(world, "world_inject_event", { kind: "weather", weather: "clear" });
  await reach(world, "demon_kael", "-120,1,24");
  await reach(world, guard, "-28,0,0");
  await use(world, guard, "toggle_lock", { door_id: "west_gate", action: "unlock" });
  await use(world, guard, "toggle_lock", { door_id: "west_gate", action: "open" });
  await reach(world, guard, "-24,0,8");
  await reach(world, hauler, "140,2,375");
  await use(world, hauler, "toggle_lock", { door_id: "oakford_door", action: "open" });
  await reach(world, hauler, "139,2,373.5");
  await reach(world, hauler, cart);
  const empty = await use(world, hauler, "inspect", { target_id: cart });
  assert.equal(empty.handler, "");
  assert.deepEqual(rows(empty, "cargo"), [], "the finite cargo proof requires an empty Oakford cart");
  await use(world, hauler, "cart", { cart_id: cart, action: "hitch" });
  for (const destination of ["town_square", "-36,0,0", "-72,0,0", "west_road", "miller_croft", "-400,12,40", "-520,24,-220"]) {
    await reach(world, hauler, destination);
  }
  const parked = await use(world, hauler, "cart", { cart_id: cart, action: "unhitch" });
  assert.equal(parked.handler, "");
  assert.ok(distance(parked, { x: -520, y: 24, z: -220 }) < 4, "the physical cart must follow Owen along ruins_trail");
  for (const destination of ["-36,0,0", "-72,0,0", "west_road", "miller_croft", "-400,12,40", "-515,24,-220"]) {
    await reach(world, guard, destination);
  }
  for (const item of cargoIds) {
    await supply(world, hauler, item);
    const before = quantity(await use(world, hauler, "status"), item, "inventory");
    const loaded = await use(world, hauler, "cart", { cart_id: cart, action: "load", item_id: item, quantity: 1 });
    assert.equal(quantity(loaded, item, "cargo"), 1);
    assert.equal(quantity(await use(world, hauler, "status"), item, "inventory"), before - 1);
  }
  await reach(world, hauler, "-512.5,23.25,-203.75");
  const visible = await use(world, hauler, "look", { focus: guard });
  assert.ok(rows(visible, "visible_agents").some(actor => actor.id === guard), "the guard must be locally visible beside the cart");
  assert.ok(rows(await use(world, hauler, "look", { focus: cart }), "visible_fixtures").some(fixture => fixture.id === cart));

  const initial = await host(world, "world_snapshot");
  const goblins = rows(initial, "wildlife").filter(beast => beast.kind === "goblin");
  assert.equal(goblins.length, 6);
  assert.ok(goblins.every(beast => beast.condition === "conscious"), "the raid proof requires living goblins");
  const initialLoot = cargoIds.map(item => ({ item, count: goblins.reduce((sum, beast) => sum + quantity(beast, item), 0) }));
  function conserved(snapshot: Record<string, unknown>) {
    const wagon = entity(snapshot, "carts", cart);
    assert.equal(wagon.handler, "");
    for (const coordinate of ["x", "y", "z"]) assert.equal(wagon[coordinate], parked[coordinate], "the unhitched cart must stay parked");
    for (const { item, count } of initialLoot) {
      const remaining = quantity(wagon, item, "cargo");
      const loot = rows(snapshot, "wildlife").filter(beast => beast.kind === "goblin")
        .reduce((sum, beast) => sum + quantity(beast, item), 0);
      assert.ok(remaining <= 1, `${item} cargo must remain finite`);
      assert.equal(remaining + loot, 1 + count, `${item} must move intact from the cart into goblin inventories`);
    }
  }
  async function livingGuard(snapshot: Record<string, unknown>) {
    const state = await use(world, guard, "status");
    assert.ok(state.condition === "conscious" || state.condition === "hypothermic", "deterrence requires a living, conscious guard");
    const wagon = entity(snapshot, "carts", cart);
    assert.ok(distance(state, wagon) < 12, "the guard must stay inside the real deterrence radius");
    assert.ok(rows(snapshot, "agents").filter(actor => actor.id !== guard).every(actor => distance(actor, wagon) > 12),
      "Garrick must be the only actor guarding the cart");
  }
  function unguarded(snapshot: Record<string, unknown>) {
    const wagon = entity(snapshot, "carts", cart);
    assert.ok(rows(snapshot, "agents").every(actor => distance(actor, wagon) > 12), "every actor must leave the cart unguarded");
  }

  await atHour(world, 20);
  await pending(world, hauler);
  await pending(world, guard);
  const guardedEvents: Record<string, unknown>[] = [];
  const previousDistances = new Map<unknown, number>();
  let retreated = false;
  for (let attempt = 0; attempt < 36; attempt++) {
    await host(world, "world_step", { minutes: 5 });
    const snapshot = await host(world, "world_snapshot");
    conserved(snapshot);
    await livingGuard(snapshot);
    for (const item of cargoIds) assert.equal(quantity(entity(snapshot, "carts", cart), item, "cargo"), 1, "visible guards must prevent a raid");
    for (const beast of rows(snapshot, "wildlife").filter(entry => entry.kind === "goblin")) {
      const current = distance(beast, entity(snapshot, "carts", cart));
      const previous = previousDistances.get(beast.id);
      retreated ||= previous !== undefined && previous < 170 && current > previous + 2;
      previousDistances.set(beast.id, current);
    }
    guardedEvents.push(...await pending(world, hauler), ...await pending(world, guard));
  }
  assert.ok(retreated, "a goblin must approach the guarded cart and retreat while its cargo stays intact");
  assert.equal(guardedEvents.some(event => event.type === "noise" && event.text === raid), false);

  const raidEvents: Record<string, unknown>[] = [];
  await reach(world, guard, "-510,23,-204", raidEvents);
  let snapshot = await host(world, "world_snapshot");
  for (let attempt = 0; attempt < 120; attempt++) {
    unguarded(snapshot);
    conserved(snapshot);
    raidEvents.push(...await pending(world, hauler), ...await pending(world, guard));
    if (cargoIds.every(item => quantity(entity(snapshot, "carts", cart), item, "cargo") === 0)) break;
    await host(world, "world_step", { minutes: 1 });
    snapshot = await host(world, "world_snapshot");
  }
  unguarded(snapshot);
  conserved(snapshot);
  raidEvents.push(...await pending(world, hauler), ...await pending(world, guard));
  for (const item of cargoIds) assert.equal(quantity(entity(snapshot, "carts", cart), item, "cargo"), 0, "hungry goblins must steal both finite cargo items");
  assert.ok(raidEvents.some(event => event.type === "noise" && event.text === raid), "nearby witnesses must hear actual cargo theft");
  const retained = rows(snapshot, "wildlife").filter(beast => beast.kind === "goblin");
  await host(world, "world_step", { minutes: 60 });
  const later = await host(world, "world_snapshot");
  conserved(later);
  for (const item of cargoIds) assert.equal(quantity(entity(later, "carts", cart), item, "cargo"), 0, "depleted cargo must stay empty");
  for (const beast of retained) {
    const returned = entity(later, "wildlife", beast.id);
    assert.deepEqual(rows(returned, "items"), rows(beast, "items"), "each goblin must retain its stolen loot after an hour");
    const stole = cargoIds.some(item => quantity(beast, item) > quantity(entity(initial, "wildlife", beast.id), item));
    if (stole) assert.ok(distance(returned, entity(later, "carts", cart)) > 12, "a sated looter must retreat while retaining its cargo");
  }
}

// Run after civic, before acceptance cases that injure wolves or advance seasons.
export async function proveEcology(world: WorldClient): Promise<void> {
  await proveWolfPredation(world);
  await proveGoblinRaids(world);
}
