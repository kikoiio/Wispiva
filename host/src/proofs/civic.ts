import assert from "node:assert/strict";
import type { WorldClient, WorldResult } from "../world.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, context: string): Record<string, unknown> {
  assert.ok(isRecord(value), context);
  return value;
}

function rows(value: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const entries = value[key];
  assert.ok(Array.isArray(entries), `expected ${key} array in ${JSON.stringify(value)}`);
  return entries.map((entry: unknown) => record(entry, `invalid ${key} entry`));
}

function number(value: Record<string, unknown>, key: string): number {
  const result = value[key];
  assert.ok(typeof result === "number" && Number.isFinite(result), `expected numeric ${key} in ${JSON.stringify(value)}`);
  return result;
}

function string(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  assert.ok(typeof result === "string", `expected string ${key} in ${JSON.stringify(value)}`);
  return result;
}

function quantity(state: Record<string, unknown>, item: string, field = "inventory"): number {
  const stack = rows(state, field).find(entry => entry.id === item);
  return stack === undefined ? 0 : number(stack, "qty");
}

function resultOf(response: WorldResult, context: string): Record<string, unknown> {
  assert.ok(response.ok && response.result, `${context} ${JSON.stringify(response)}`);
  return response.result;
}

async function use(world: WorldClient, actor: string, tool: string, args: Record<string, unknown> = {}) {
  return resultOf(await world.call("agent", tool, args, actor), `${actor} ${tool} ${JSON.stringify(args)}`);
}

async function host(
  world: WorldClient,
  tool: "world_step" | "world_snapshot" | "world_inject_event" | "host_pending",
  args: Record<string, unknown> = {},
) {
  return resultOf(await world.call("host", tool, args), `${tool} ${JSON.stringify(args)}`);
}

async function denied(world: WorldClient, actor: string, tool: string, args: Record<string, unknown>, code: string) {
  const response = await world.call("agent", tool, args, actor);
  const context = `${actor} ${tool} ${JSON.stringify(args)} ${JSON.stringify(response)}`;
  assert.equal(response.ok, false, context);
  assert.equal(response.error?.code, code, context);
  return response.error?.message ?? "";
}

async function finish(world: WorldClient, actor: string, tool: string, args: Record<string, unknown>) {
  const started = await use(world, actor, tool, args);
  if (started.pending !== true) return started;
  const action = record(started.action, `missing ${actor} action`);
  const startedSecond = number(action, "started_second");
  const kind = string(action, "kind");
  for (let attempt = 0; attempt < 64; attempt++) {
    const before = await use(world, actor, "status");
    const remaining = number(action, "finish_second") - number(before, "elapsed_seconds");
    await host(world, "world_step", { seconds: Math.max(60, Math.ceil(remaining)), stop_on_action: true });
    const events = rows(await host(world, "host_pending", { agentId: actor }), "events");
    const completed = events.find(event => {
      if (event.type !== "action_completed") return false;
      const completedAction = record(event.action, `missing completed ${actor} action`);
      return completedAction.kind === kind && completedAction.started_second === startedSecond;
    });
    if (completed !== undefined) {
      return completed.result === undefined ? completed : record(completed.result, `invalid ${actor} completion`);
    }
    const state = await use(world, actor, "status");
    const pending = record(state.action, `${actor} ${tool} interrupted ${JSON.stringify(state)}`);
    assert.equal(pending.kind, kind, `${actor} action changed`);
    assert.equal(pending.started_second, startedSecond, `${actor} action changed`);
    assert.ok(number(state, "elapsed_seconds") > number(before, "elapsed_seconds"), "world_step must advance time");
  }
  assert.fail(`${actor} ${tool} did not complete within 64 advances ${JSON.stringify(args)}`);
}

async function reach(world: WorldClient, actor: string, destination: string) {
  const arrived = await finish(world, actor, "move_to", { destination, pace: "walk" });
  assert.equal(arrived.arrived, true, `${actor} -> ${destination} ${JSON.stringify(arrived)}`);
  return arrived;
}

async function supply(world: WorldClient, actor: string, item: string, count: number) {
  await host(world, "world_inject_event", { kind: "item", place: actor, item_id: item, quantity: count });
  await use(world, actor, "transfer_item", { action: "pick", item_id: item, quantity: count });
}

async function treasury(world: WorldClient): Promise<number> {
  return number(await host(world, "world_snapshot"), "treasury_sp");
}

async function proveMarket(world: WorldClient): Promise<void> {
  const seller = "dwarf_nori";
  const buyer = "human_garrick";
  const stall = "stall_0";
  async function balances() {
    const selling = await use(world, seller, "status");
    const buying = await use(world, buyer, "status");
    return {
      seller: { sp: number(selling, "sp"), nails: quantity(selling, "iron_nails") },
      buyer: { sp: number(buying, "sp"), nails: quantity(buying, "iron_nails") },
    };
  }
  const sale = (price: number) => ({
    partner_id: buyer, offer_item: "iron_nails", offer_qty: 1, request_item: "sp", request_qty: price,
  });
  const purchase = (price: number) => ({
    partner_id: seller, offer_item: "sp", offer_qty: price, request_item: "iron_nails", request_qty: 1,
  });

  await reach(world, seller, "town_square");
  await supply(world, seller, "iron_nails", 2);
  await reach(world, buyer, seller);
  const fees = await use(world, seller, "civic", { action: "status" });
  assert.equal(fees.market_weekly_sp, 2);
  assert.equal(fees.loaded_bridge_cart_sp, 1);
  assert.equal(rows(fees, "leases").some(lease => lease.stall_id === stall), false);

  // The seller can offer away from the market, then move before the buyer accepts.
  assert.equal((await use(world, seller, "trade", sale(1))).settled, false);
  await reach(world, seller, stall);
  const view = await use(world, seller, "look", { focus: stall });
  assert.ok(rows(view, "visible_fixtures").some(fixture => fixture.id === stall && fixture.kind === "stall"));
  assert.equal((await use(world, seller, "inspect", { target_id: stall })).kind, "stall");
  const atStall = await use(world, seller, "status");
  await reach(world, buyer, [number(atStall, "x") - 1.4, number(atStall, "y"), number(atStall, "z")].join(","));
  const unpaid = await balances();
  const initialTreasury = await treasury(world);
  assert.match(await denied(world, buyer, "trade", purchase(1), "rejected"), /lease/);
  assert.deepEqual(await balances(), unpaid, "rejected buyer settlement must conserve goods and silver");
  assert.match(await denied(world, seller, "trade", sale(1), "rejected"), /lease/);

  // A different price leaves a buyer-initiated offer for the seller to answer.
  assert.equal((await use(world, buyer, "trade", purchase(2))).settled, false);
  assert.match(await denied(world, seller, "trade", sale(2), "rejected"), /lease/);
  assert.deepEqual(await balances(), unpaid, "unleased offers in either direction must conserve goods and silver");
  assert.equal(await treasury(world), initialTreasury);

  const minute = number(await host(world, "world_snapshot"), "minute");
  const leased = await use(world, seller, "civic", { action: "lease_stall", target_id: stall });
  assert.equal(leased.stall_id, stall);
  assert.equal(leased.paid_sp, 2);
  assert.equal(leased.until_minute, minute + 10080);
  const paid = await balances();
  assert.deepEqual(paid, { seller: { ...unpaid.seller, sp: unpaid.seller.sp - 2 }, buyer: unpaid.buyer });
  assert.equal(await treasury(world), initialTreasury + 2);

  await host(world, "world_step", { minutes: 1 });
  const repeated = await use(world, seller, "civic", { action: "lease_stall", target_id: stall });
  assert.equal(repeated.paid_sp, 0);
  assert.equal(repeated.until_minute, leased.until_minute, "repeating a lease must preserve its expiry");
  const ownLease = rows(await use(world, seller, "civic", { action: "status" }), "leases").filter(lease => lease.stall_id === stall);
  assert.deepEqual(ownLease, [{ stall_id: stall, until_minute: leased.until_minute }]);
  await denied(world, buyer, "civic", { action: "lease_stall", target_id: stall }, "busy");
  assert.equal(rows(await use(world, buyer, "civic", { action: "status" }), "leases").some(lease => lease.stall_id === stall), false);
  assert.deepEqual(await balances(), paid, "idempotent and competing lease requests must preserve balances");
  assert.equal(await treasury(world), initialTreasury + 2);

  assert.equal((await use(world, seller, "trade", sale(2))).settled, true);
  assert.deepEqual(await balances(), {
    seller: { sp: paid.seller.sp + 2, nails: paid.seller.nails - 1 },
    buyer: { sp: paid.buyer.sp - 2, nails: paid.buyer.nails + 1 },
  });
  const beforeSecondSale = await balances();
  assert.equal((await use(world, seller, "trade", sale(1))).settled, false);
  assert.deepEqual(await balances(), beforeSecondSale, "an offer alone must preserve balances");
  assert.equal((await use(world, buyer, "trade", purchase(1))).settled, true);
  assert.deepEqual(await balances(), {
    seller: { sp: beforeSecondSale.seller.sp + 1, nails: beforeSecondSale.seller.nails - 1 },
    buyer: { sp: beforeSecondSale.buyer.sp - 1, nails: beforeSecondSale.buyer.nails + 1 },
  });
  assert.equal(await treasury(world), initialTreasury + 2, "market sales must only pay the recorded lease fee");
  await reach(world, buyer, "54,0,-2");
  await reach(world, seller, "42,0,-2");
}

async function proveBridgeToll(world: WorldClient): Promise<void> {
  const hauler = "dwarf_nori";
  const guard = "human_garrick";
  const cart = "anvil_cart";
  await reach(world, guard, "-28,0,0");
  await use(world, guard, "toggle_lock", { door_id: "west_gate", action: "unlock" });
  await use(world, guard, "toggle_lock", { door_id: "west_gate", action: "open" });
  await reach(world, guard, "-24,0,8");
  await reach(world, hauler, cart);
  const parked = await use(world, hauler, "inspect", { target_id: cart });
  assert.equal(parked.handler, "", "the civic proof requires an unhitched Anvil cart");
  assert.deepEqual(rows(parked, "cargo"), [], "the civic proof requires an empty Anvil cart");
  await use(world, hauler, "cart", { cart_id: cart, action: "hitch" });
  await reach(world, hauler, "60,0,-96");
  await reach(world, hauler, "60,0,-82");
  await reach(world, hauler, "-36,0,0");
  const before = await use(world, hauler, "status");
  const initialTreasury = await treasury(world);
  assert.ok(number(before, "x") > -45);
  assert.ok(Math.abs(number(before, "z")) < 5);

  await reach(world, hauler, "-72,0,0");
  assert.equal(number(await use(world, hauler, "status"), "sp"), number(before, "sp"));
  assert.equal(await treasury(world), initialTreasury, "an empty cart crossing must be free");
  await supply(world, hauler, "iron_ore", 1);
  const inventory = quantity(await use(world, hauler, "status"), "iron_ore");
  const loaded = await use(world, hauler, "cart", { cart_id: cart, action: "load", item_id: "iron_ore", quantity: 1 });
  assert.equal(quantity(loaded, "iron_ore", "cargo"), 1);
  assert.equal(loaded.cargo_kg, 12);
  assert.equal(quantity(await use(world, hauler, "status"), "iron_ore"), inventory - 1);
  await host(world, "host_pending", { agentId: hauler });

  let crossings = 0;
  for (const destination of ["-36,0,0", "-72,0,0"]) {
    const arrived = await reach(world, hauler, destination);
    crossings++;
    assert.equal(number(arrived, "x") > -45, crossings === 1);
    assert.ok(Math.abs(number(arrived, "z")) < 5);
    assert.ok(Math.abs(number(arrived, "y")) < 2);
    const state = await use(world, hauler, "status");
    assert.equal(number(state, "sp"), number(before, "sp") - crossings, "each loaded crossing costs one silver");
    assert.equal(await treasury(world), initialTreasury + crossings);
    const cargo = await use(world, hauler, "inspect", { target_id: cart });
    assert.equal(quantity(cargo, "iron_ore", "cargo"), 1);
    assert.equal(number(cargo, "x") > -45, crossings === 1, "the loaded cart must physically cross the bridge");
  }
  const unloaded = await use(world, hauler, "cart", { cart_id: cart, action: "unload", item_id: "iron_ore", quantity: 1 });
  assert.equal(quantity(unloaded, "iron_ore", "cargo"), 0);
  assert.equal(quantity(await use(world, hauler, "status"), "iron_ore"), inventory);
  await use(world, hauler, "transfer_item", { action: "drop", item_id: "iron_ore", quantity: 1 });
  await reach(world, hauler, "-36,0,0");
  assert.equal(number(await use(world, hauler, "status"), "sp"), number(before, "sp") - 2);
  assert.equal(await treasury(world), initialTreasury + 2, "the unloaded return crossing must be free");
  await reach(world, hauler, "market_wagon_bay");
  await use(world, hauler, "cart", { cart_id: cart, action: "unhitch" });
}

async function proveLogging(world: WorldClient): Promise<void> {
  const logger = "dwarf_nori";
  const warden = "elf_lyra";
  const trees = ["tree_3", "tree_15", "tree_27"];
  assert.ok(quantity(await use(world, logger, "status"), "hand_axe") > 0);
  await denied(world, logger, "civic", { action: "grant_logging", target_id: logger, quantity: 2 }, "forbidden");
  for (const [index, tree] of trees.entries()) {
    await reach(world, logger, tree);
    assert.ok(number(await use(world, logger, "status"), "x") > 320, `${tree} must be inside the protected forest`);
    const seen = await use(world, logger, "look", { focus: tree });
    assert.ok(rows(seen, "visible_fixtures").some(fixture => fixture.id === tree && fixture.kind === "timber"));
    const inspected = await use(world, logger, "inspect", { target_id: tree });
    assert.equal(inspected.recipe_id, "cut_timber");
    assert.equal(inspected.remaining_batches, 1);
    await reach(world, warden, logger);
    const nearby = await use(world, warden, "look", { focus: logger });
    assert.ok(rows(nearby, "visible_agents").some(agent => agent.id === logger), "the warden must see the logger locally");
    await host(world, "host_pending", { agentId: warden });
    if (index === 0) {
      const permit = await use(world, warden, "civic", { action: "grant_logging", target_id: logger, quantity: 2 });
      assert.equal(permit.issuer, warden);
      assert.equal(permit.remaining, 2);
      assert.ok(number(permit, "until_minute") > number(await host(world, "world_snapshot"), "minute"));
      assert.deepEqual((await use(world, logger, "civic", { action: "status" })).logging_permit, permit);
    }
    const before = quantity(await use(world, logger, "status"), "timber");
    const completed = await finish(world, logger, "work_craft", { station_id: tree, recipe_or_task: "cut_timber", minutes: 15 });
    assert.equal(record(completed.produced, "logging must finish producing timber").timber, 2);
    assert.equal(quantity(await use(world, logger, "status"), "timber"), before + 2);
    const permit = record((await use(world, logger, "civic", { action: "status" })).logging_permit, "missing logging permit");
    assert.equal(permit.remaining, Math.max(1 - index, 0), "each protected tree must consume one permitted tree");
    const events = rows(await host(world, "host_pending", { agentId: warden }), "events");
    const witnessed = events.filter(event => event.type === "witnessed" && event.from === logger && event.text === "unpermitted logging");
    assert.equal(witnessed.length, index === 2 ? 1 : 0, "only logging beyond the quota should create a locally witnessed offense");
    await denied(world, logger, "inspect", { target_id: tree }, "depleted");
  }
  await use(world, logger, "transfer_item", { action: "drop", item_id: "timber", quantity: 6 });
}

async function openEntrance(world: WorldClient, actor: string, door: string): Promise<void> {
  const approach = await finish(world, actor, "move_to", { destination: door, pace: "walk" });
  if (approach.arrived !== true) {
    assert.equal(record(approach.blocked, `cannot approach ${door}`).id, door, JSON.stringify(approach));
  }
  await use(world, actor, "toggle_lock", { door_id: door, action: "open" });
}

async function proveLockAndCustody(world: WorldClient): Promise<void> {
  const owner = "human_greta";
  const suspect = "human_rolf";
  const guard = "human_garrick";
  const door = "tavern_room_1";
  const doorstep = "tavern_room_1_doorstep";
  await openEntrance(world, owner, "tavern_entrance");
  await reach(world, owner, doorstep);
  await use(world, owner, "toggle_lock", { door_id: door, action: "close" });
  await use(world, owner, "toggle_lock", { door_id: door, action: "lock" });
  await reach(world, owner, "tavern");
  await reach(world, suspect, doorstep);
  const initial = await use(world, suspect, "status");
  assert.equal(quantity(initial, "room_keys"), 0, "the suspect must lack the room key");
  assert.ok(quantity(initial, "hand_axe") > 0, "forcing requires an actual axe");
  assert.equal(quantity(initial, "smith_hammer"), 0, "the repair check requires a suspect without a smith hammer");
  const locked = await use(world, suspect, "inspect", { target_id: door });
  assert.equal(locked.lock, "locked");
  assert.equal(locked.open, false);
  await denied(world, suspect, "toggle_lock", { door_id: door, action: "unlock" }, "locked");
  await denied(world, suspect, "toggle_lock", { door_id: door, action: "open" }, "locked");
  await reach(world, guard, "tavern_landing");
  assert.ok(rows(await use(world, guard, "look", { focus: suspect }), "visible_agents").some(agent => agent.id === suspect));
  await denied(world, guard, "civic", { action: "arrest", target_id: suspect }, "rejected");
  await host(world, "host_pending", { agentId: guard });
  const guardBefore = await use(world, guard, "status");
  const suspectBefore = await use(world, suspect, "status");
  assert.ok(quantity(guardBefore, "manacles") > 0, "the arrest requires physical manacles");
  const forced = await finish(world, suspect, "toggle_lock", { door_id: door, action: "force" });
  assert.equal(forced.door_id, door);
  assert.equal(forced.lock, "broken");
  const broken = await use(world, suspect, "inspect", { target_id: door });
  assert.equal(broken.lock, "broken");
  assert.equal(broken.open, false);
  const witnessEvents = rows(await host(world, "host_pending", { agentId: guard }), "events");
  assert.ok(witnessEvents.some(event => event.type === "witnessed" && event.from === suspect && event.text === "forcing a locked entrance"));
  const traceId = string(forced, "trace_id");
  const view = await use(world, suspect, "look", { focus: door });
  assert.ok(rows(view, "visible_traces").some(trace => trace.id === traceId && trace.kind === "broken_lock"));
  assert.equal((await use(world, suspect, "inspect", { target_id: traceId })).kind, "broken_lock");

  assert.equal((await use(world, guard, "civic", { action: "arrest", target_id: suspect })).restrained, true);
  const restrained = await use(world, suspect, "status");
  assert.equal(restrained.restrained, true);
  assert.equal(quantity(restrained, "manacles"), quantity(suspectBefore, "manacles") + 1);
  assert.equal(quantity(await use(world, guard, "status"), "manacles"), quantity(guardBefore, "manacles") - 1);
  assert.equal((await use(world, guard, "civic", { action: "arrest", target_id: suspect })).restrained, true);
  assert.equal(quantity(await use(world, guard, "status"), "manacles"), quantity(guardBefore, "manacles") - 1);
  assert.equal(quantity(await use(world, suspect, "status"), "manacles"), quantity(suspectBefore, "manacles") + 1);
  assert.match(await denied(world, suspect, "move_to", { destination: "tavern_landing", pace: "walk" }, "rejected"), /restrain/);
  const afterDeniedMove = await use(world, suspect, "status");
  for (const key of ["x", "y", "z", "elapsed_seconds", "action"]) {
    assert.deepEqual(afterDeniedMove[key], restrained[key], `restrained movement must preserve ${key}`);
  }
  assert.equal((await use(world, guard, "civic", { action: "release", target_id: suspect })).restrained, false);
  const released = await use(world, suspect, "status");
  assert.equal(released.restrained, false);
  assert.equal(quantity(released, "manacles"), quantity(suspectBefore, "manacles"));
  assert.equal(quantity(await use(world, guard, "status"), "manacles"), quantity(guardBefore, "manacles"));
  assert.equal((await use(world, suspect, "civic", { action: "status" })).restrained, false);
  await denied(world, guard, "civic", { action: "arrest", target_id: suspect }, "rejected");
  await reach(world, guard, "-24,0,8");

  await denied(world, suspect, "toggle_lock", { door_id: door, action: "lock" }, "rejected");
  await supply(world, suspect, "lock_mechanism", 1);
  const withoutHammer = await use(world, suspect, "status");
  await denied(world, suspect, "toggle_lock", { door_id: door, action: "repair" }, "no_item");
  assert.equal(quantity(await use(world, suspect, "status"), "lock_mechanism"), quantity(withoutHammer, "lock_mechanism"));
  await supply(world, suspect, "smith_hammer", 1);
  const repair = await finish(world, suspect, "toggle_lock", { door_id: door, action: "repair" });
  assert.equal(repair.door_id, door);
  assert.equal(repair.lock, "unlocked");
  const repaired = await use(world, suspect, "status");
  assert.equal(quantity(repaired, "lock_mechanism"), quantity(withoutHammer, "lock_mechanism") - 1);
  assert.equal(quantity(repaired, "smith_hammer"), 1);
  assert.equal((await use(world, suspect, "inspect", { target_id: door })).lock, "unlocked");
  await use(world, suspect, "toggle_lock", { door_id: door, action: "open" });
  await use(world, suspect, "toggle_lock", { door_id: door, action: "close" });
  await reach(world, suspect, "town_square");
  await reach(world, owner, doorstep);
  assert.equal((await use(world, owner, "toggle_lock", { door_id: door, action: "lock" })).lock, "locked");
  await reach(world, owner, "tavern");
}

// Run before the acceptance cases that advance weeks or consume these forest trees.
export async function proveCivic(world: WorldClient): Promise<void> {
  await proveMarket(world);
  await proveBridgeToll(world);
  await proveLogging(world);
  await proveLockAndCustody(world);
}
