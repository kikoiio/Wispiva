import assert from "node:assert/strict";
import { installCharacterHooks } from "./hooks/builtins.ts";
import { triggerHooks } from "./hooks/core.ts";
import { worldToolNames } from "./mcp.ts";
import { WorldClient, type WorldResult } from "./world.ts";

installCharacterHooks();

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : Number.NaN;
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function list(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function resultOf(response: WorldResult): Record<string, unknown> {
  return response.result ?? {};
}

async function agentCall(world: WorldClient, agentId: string, tool: string, args: Record<string, unknown>): Promise<WorldResult> {
  const blocked = await triggerHooks("PreToolUse", { name: tool, args, argsJson: JSON.stringify(args) });
  if (blocked) {
    return { id: "", ok: false, error: { code: "forbidden", message: blocked } };
  }
  const response = await world.call("agent", tool, args, agentId);
  await triggerHooks("PostToolUse", {
    name: tool,
    args,
    argsJson: JSON.stringify(args),
    output: JSON.stringify(response),
  });
  return response;
}

function heard(events: unknown[], utterance: string): boolean {
  return events.some((event) => isRecord(event) && event.type === "heard" && event.utterance === utterance);
}

async function walk(world: WorldClient, actor: string, destination: string): Promise<WorldResult> {
  const initial = await agentCall(world, actor, "status", {});
  const started = await agentCall(world, actor, "move_to", { destination, pace: "walk" });
  if (started.result?.pending !== true) return started;
  const action = started.result.action;
  assert.ok(isRecord(action));
  const whileWalking = await agentCall(world, actor, "status", {});
  for (const key of ["x", "y", "z", "clock"]) {
    assert.equal(whileWalking.result?.[key], initial.result?.[key], `starting a walk must not move ${actor} before time advances`);
  }
  let duration = num(action, "finish_at") - num(action, "started_at");
  for (;;) {
    const advanced = await world.call("host", "world_step", { minutes: Math.max(1, duration), stop_on_action: true });
    assert.ok(advanced.ok, JSON.stringify(advanced.error));
    const ready = await world.call("host", "host_pending", { agentId: actor });
    const completion = list(resultOf(ready), "events").find((event) => isRecord(event) && event.type === "action_completed"
      && isRecord(event.result) && isRecord(event.action)
      && event.action.kind === action.kind && event.action.started_at === action.started_at);
    if (isRecord(completion) && isRecord(completion.result)) return { ...started, result: completion.result };
    const state = resultOf(await agentCall(world, actor, "status", {}));
    assert.ok(isRecord(state.action), `${actor} → ${destination} was interrupted: ${JSON.stringify(state)}`);
    duration = num(state.action, "finish_at") - num(resultOf(advanced), "minute");
  }
}

function itemQuantity(inventory: unknown[], id: string): number {
  const item = inventory.find((entry) => isRecord(entry) && entry.id === id);
  return isRecord(item) ? num(item, "qty") : 0;
}

async function provePerception(world: WorldClient): Promise<void> {
  const outside = await agentCall(world, "human_tomas", "look", { focus: "granary" });
  assert.ok(outside.ok);
  const granary = list(resultOf(outside), "visible_places").find((entry) => isRecord(entry) && entry.id === "granary");
  assert.ok(isRecord(granary));
  assert.equal(granary.name, "Granary and Provision Store");
  assert.equal(typeof granary.direction, "string");
  assert.ok(num(granary, "distance_m") < 20);
  const inside = await agentCall(world, "human_greta", "look", { focus: "south" });
  assert.ok(inside.ok);
  assert.equal(list(resultOf(inside), "visible_places").some((entry) => isRecord(entry) && entry.id === "granary"), false);
  const unknown = await agentCall(world, "human_greta", "move_to", { destination: "a place I have never heard of", pace: "walk" });
  assert.equal(unknown.error?.code, "bad_args");
  assert.equal(unknown.error?.message.includes("mine_level2"), false);
  const unrecognized = await agentCall(world, "human_greta", "look", { focus: "a place I have never heard of" });
  assert.equal(unrecognized.error?.code, "bad_args");
}

async function proveInteriors(world: WorldClient): Promise<void> {
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(actor: string, destination: string) {
    const result = resultOf(await walk(world, actor, destination));
    assert.equal(result.arrived, true, `${actor} → ${destination}: ${JSON.stringify(result)}`);
    return result;
  }
  const greta = "human_greta";
  await reach(greta, "35,0,-41.5");
  assert.equal((await agentCall(world, greta, "toggle_lock", { door_id: "tavern_room_3", action: "unlock" })).error?.code, "too_far");
  assert.ok(num(await reach(greta, "tavern_landing"), "y") > 3.5);
  await reach(greta, "tavern_room_3_doorstep");
  const whisper = "A quiet word from upstairs";
  await world.call("host", "host_pending", { agentId: "human_kestrel" });
  await use(greta, "speak", { utterance: whisper, volume: "whisper" });
  const below = resultOf(await world.call("host", "host_pending", { agentId: "human_kestrel" }));
  assert.equal(heard(list(below, "events"), whisper), false);
  for (let room = 1; room <= 4; room++) {
    const door_id = `tavern_room_${room}`;
    const bed = `tavern_bed_${room}`;
    await reach(greta, `${door_id}_doorstep`);
    await use(greta, "toggle_lock", { door_id, action: "unlock" });
    await use(greta, "toggle_lock", { door_id, action: "open" });
    await reach(greta, bed);
    assert.equal((await use(greta, "inspect", { target_id: bed })).kind, "bed");
    await reach(greta, `${door_id}_doorstep`);
    await use(greta, "toggle_lock", { door_id, action: "close" });
    await use(greta, "toggle_lock", { door_id, action: "lock" });
    const view = await use(greta, "look", { focus: bed });
    assert.equal(list(view, "visible_fixtures").some((entry) => isRecord(entry) && entry.id === bed), false);
    const beforeDoor = await use(greta, "status");
    const blocked = resultOf(await walk(world, greta, bed));
    assert.equal(blocked.arrived, false);
    assert.ok(isRecord(blocked.blocked) && blocked.blocked.id === door_id, `${door_id} from ${JSON.stringify(beforeDoor)}: ${JSON.stringify(blocked)}`);
  }
  await reach(greta, "tavern");
  assert.ok(num(await use(greta, "status"), "y") < 1);

  const mira = "human_mira";
  await reach(mira, "guild_archive_doorstep");
  assert.ok(num(await use(mira, "status"), "y") > 4);
  await use(mira, "toggle_lock", { door_id: "guild_archive", action: "unlock" });
  await use(mira, "toggle_lock", { door_id: "guild_archive", action: "open" });
  await reach(mira, "guild_archive_shelves");
  assert.equal((await use(mira, "inspect", { target_id: "guild_archive_shelves" })).kind, "records");
  await reach(mira, "guild_archive_doorstep");
  await use(mira, "toggle_lock", { door_id: "guild_archive", action: "close" });
  await use(mira, "toggle_lock", { door_id: "guild_archive", action: "lock" });
  await reach(mira, "guild_appraisal");
  assert.ok(num(await use(mira, "status"), "y") < 1);
}

async function proveWindows(world: WorldClient): Promise<void> {
  const actor = "human_tomas";
  const shutter = "guild_hall_shutter_2";
  const position = resultOf(await walk(world, actor, "89.43,0,-44"));
  assert.equal(position.arrived, true, JSON.stringify(position));
  async function visibleDesk() {
    const view = await agentCall(world, actor, "look", { focus: "guild_appraisal" });
    assert.ok(view.ok, JSON.stringify(view.error));
    return list(resultOf(view), "visible_fixtures").some(entry => isRecord(entry) && entry.id === "guild_appraisal");
  }
  assert.ok((await agentCall(world, actor, "toggle_lock", { door_id: shutter, action: "open" })).ok);
  assert.equal(await visibleDesk(), true, "open shutters expose the room through a real window opening");
  assert.ok((await agentCall(world, actor, "toggle_lock", { door_id: shutter, action: "close" })).ok);
  assert.equal(await visibleDesk(), false, "closed shutters obscure the same sightline");
  assert.ok((await agentCall(world, actor, "toggle_lock", { door_id: shutter, action: "open" })).ok);
  const throughWindow = resultOf(await walk(world, actor, "90,0,-40.5"));
  assert.equal(throughWindow.arrived, false, "an open window still has a solid sill");
}

async function proveSurvival(world: WorldClient): Promise<void> {
  const patient = "human_garrick";
  const hearth = "town_fire_ring";
  async function step(minutes: number) {
    assert.ok((await world.call("host", "world_step", { minutes })).ok);
  }
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  const reach = resultOf(await walk(world, patient, hearth));
  assert.equal(reach.arrived, true, JSON.stringify(reach));
  async function provision(item_id: string) {
    assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: hearth, item_id })).ok);
    await use(patient, "transfer_item", { action: "pick", item_id, quantity: 1 });
  }
  async function weather(state: string) {
    assert.ok((await world.call("host", "world_inject_event", { kind: "weather", region: "stonebridge", weather: state })).ok);
  }
  async function injure(actor: string, injury: string) {
    assert.ok((await world.call("host", "world_inject_event", { kind: "injury", agentId: actor, injury })).ok);
  }
  await weather("clear");
  await provision("timber");
  assert.equal((await use(patient, "work_craft", { station_id: hearth, recipe_or_task: "light_campfire", minutes: 4 })).pending, true);
  await step(4);
  assert.equal((await use(patient, "inspect", { target_id: hearth })).lit, true);
  assert.equal((await use(patient, "status")).near_fire, true);
  await weather("blizzard");
  assert.equal((await use(patient, "inspect", { target_id: hearth })).lit, false);
  const dry = await use(patient, "status");
  const inside = await use("human_mira", "status");
  assert.equal(inside.sheltered, true);
  for (let boundaries = 0; boundaries < 2; boundaries++) {
    const minute = num(resultOf(await world.call("host", "world_snapshot")), "minute");
    await step(60 - minute % 60);
    await weather("blizzard");
  }
  await step(22);
  const cold = await use(patient, "status");
  assert.ok(num(cold, "wetness") > num(dry, "wetness"));
  assert.ok(num(cold, "warmth") < num(dry, "warmth"));
  assert.equal((await use("human_mira", "status")).wetness, inside.wetness);
  await weather("clear");
  await provision("timber");
  await use(patient, "work_craft", { station_id: hearth, recipe_or_task: "light_campfire", minutes: 4 });
  await step(4);
  const beforeRest = await use(patient, "status");
  await use(patient, "rest", { minutes: 20 });
  await step(20);
  const rested = await use(patient, "status");
  assert.ok(num(rested, "wetness") < num(beforeRest, "wetness"));
  assert.ok(num(rested, "warmth") > num(beforeRest, "warmth"));

  await provision("spring_water");
  assert.ok(num(await use(patient, "transfer_item", { action: "consume", item_id: "spring_water" }), "thirst") < num(rested, "thirst"));
  await provision("apple");
  assert.ok(num(await use(patient, "transfer_item", { action: "consume", item_id: "apple" }), "hunger") < num(rested, "hunger"));

  await injure(patient, "bleeding");
  await injure(patient, "lacerated");
  await provision("bandage");
  await step(7);
  const wounded = await use(patient, "status");
  assert.ok(num(wounded, "blood_loss") >= 7);
  await use(patient, "transfer_item", { action: "treat", item_id: "bandage" });
  await step(5);
  const treated = await use(patient, "status");
  assert.equal(list(treated, "injuries").includes("bleeding"), false);
  assert.ok(num(treated, "blood_loss") < num(wounded, "blood_loss"));

  await injure(patient, "fractured");
  await provision("timber_brace");
  await use(patient, "transfer_item", { action: "treat", item_id: "timber_brace" });
  assert.equal((await use(patient, "status")).splinted, true);
  const terminalPatient = "human_rolf";
  await injure(terminalPatient, "bleeding");
  await step(24);
  assert.equal((await use(terminalPatient, "status")).condition, "conscious");
  const beforeFaint = num(resultOf(await world.call("host", "world_snapshot")), "minute");
  const faint = await world.call("host", "world_step", { minutes: 36, stop_on_action: true });
  assert.equal(num(resultOf(faint), "minute"), beforeFaint + 1);
  assert.equal((await use(terminalPatient, "status")).condition, "unconscious");
  const action = await agentCall(world, terminalPatient, "speak", { utterance: "Help", volume: "normal" });
  assert.equal(action.error?.code, "rejected");
  await step(35);
  assert.equal((await use(terminalPatient, "status")).condition, "dead");
}

async function proveEconomy(world: WorldClient): Promise<void> {
  const poster = "human_aldric";
  const holder = "human_elena";
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(actor: string, destination: string) {
    const result = resultOf(await walk(world, actor, destination));
    assert.equal(result.arrived, true, `${actor} → ${destination}: ${JSON.stringify(result)}`);
  }
  await reach(poster, "guild_board");
  const beforePoster = num(await use(poster, "status"), "sp");
  const beforeHolder = num(await use(holder, "status"), "sp");
  const beforeEscrow = num(await use(poster, "guild_contract", { action: "list" }), "escrow_sp");
  const contract = await use(poster, "guild_contract", {
    action: "post", summary: "Deliver two loaves", reward_sp: 7, delivery_item: "bread", delivery_qty: 2,
  });
  assert.equal(num(await use(poster, "status"), "sp"), beforePoster - 7);
  assert.equal(num(await use(poster, "guild_contract", { action: "list" }), "escrow_sp"), beforeEscrow + 7);
  await reach(holder, "guild_board");
  const contract_id = str(contract, "id");
  await use(holder, "guild_contract", { action: "accept", contract_id });
  const emptyHanded = await agentCall(world, holder, "guild_contract", { action: "complete", contract_id });
  assert.equal(emptyHanded.error?.code, "no_item");
  assert.equal(num(await use(holder, "status"), "sp"), beforeHolder);
  assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: holder, item_id: "bread", quantity: 2 })).ok);
  await use(holder, "transfer_item", { action: "pick", item_id: "bread", quantity: 2 });
  assert.equal((await use(holder, "guild_contract", { action: "complete", contract_id })).state, "complete");
  assert.equal(itemQuantity(list(await use(holder, "status"), "inventory"), "bread"), 0);
  assert.equal(num(await use(holder, "status"), "sp"), beforeHolder + 7);
  assert.equal(num(await use(holder, "guild_contract", { action: "list" }), "escrow_sp"), beforeEscrow);
  assert.equal((await agentCall(world, holder, "guild_contract", { action: "complete", contract_id })).error?.code, "rejected");
  await use(poster, "guild_contract", { action: "collect", contract_id });
  assert.equal(itemQuantity(list(await use(poster, "status"), "inventory"), "bread"), 2);
  assert.equal((await agentCall(world, poster, "guild_contract", { action: "collect", contract_id })).error?.code, "rejected");

  const service = await use(poster, "guild_contract", { action: "post", summary: "Survey the west road", reward_sp: 3 });
  const serviceId = str(service, "id");
  await use(holder, "guild_contract", { action: "accept", contract_id: serviceId });
  assert.equal((await use(holder, "guild_contract", { action: "complete", contract_id: serviceId })).state, "awaiting_confirmation");
  assert.equal(num(await use(holder, "status"), "sp"), beforeHolder + 7);
  assert.equal((await agentCall(world, holder, "guild_contract", { action: "confirm", contract_id: serviceId })).error?.code, "rejected");
  await use(poster, "guild_contract", { action: "confirm", contract_id: serviceId });
  await use(holder, "guild_contract", { action: "complete", contract_id: serviceId });
  assert.equal(num(await use(holder, "status"), "sp"), beforeHolder + 10);
  assert.equal(num(await use(poster, "status"), "sp"), beforePoster - 10);
  assert.equal(num(await use(poster, "guild_contract", { action: "list" }), "escrow_sp"), beforeEscrow);

  assert.equal((await agentCall(world, poster, "trade", {
    partner_id: holder, offer_item: "bread", offer_qty: 3, request_item: "sp", request_qty: 1,
  })).error?.code, "no_item");
  assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: poster, item_id: "iron_bar" })).ok);
  await use(poster, "transfer_item", { action: "pick", item_id: "iron_bar", quantity: 1 });
  const silverBefore = num(await use(poster, "status"), "sp");
  await use(poster, "trade", { partner_id: holder, offer_item: "iron bar", offer_qty: 1, request_item: "sp", request_qty: 1 });
  assert.equal((await use(holder, "trade", {
    partner_id: poster, offer_item: "sp", offer_qty: 1, request_item: "iron_bar", request_qty: 1,
  })).settled, true);
  assert.equal(num(await use(poster, "status"), "sp"), silverBefore + 1);
  assert.equal(itemQuantity(list(await use(poster, "status"), "inventory"), "iron_bar"), 0);
  assert.equal(itemQuantity(list(await use(holder, "status"), "inventory"), "iron_bar"), 1);

  const smith = "human_bram";
  await reach(smith, "forge_anvil");
  for (const [item_id, quantity] of [["iron_bar", 1], ["timber", 1]] as const) {
    assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: smith, item_id, quantity })).ok);
    await use(smith, "transfer_item", { action: "pick", item_id, quantity });
  }
  const stock = list(await use(smith, "status"), "inventory");
  const crafting = await use(smith, "work_craft", { station_id: "forge_anvil", recipe_or_task: "forge_pickaxe", minutes: 30 });
  assert.equal(crafting.pending, true);
  assert.equal(itemQuantity(list(await use(smith, "status"), "inventory"), "iron_pickaxe"), itemQuantity(stock, "iron_pickaxe"));
  assert.ok((await world.call("host", "world_step", { minutes: 30 })).ok);
  const forged = list(await use(smith, "status"), "inventory");
  assert.equal(itemQuantity(forged, "iron_pickaxe"), itemQuantity(stock, "iron_pickaxe") + 1);
  assert.equal(itemQuantity(forged, "iron_bar"), itemQuantity(stock, "iron_bar") - 1);
  assert.equal(itemQuantity(forged, "timber"), itemQuantity(stock, "timber") - 1);

  const appraiser = "human_mira";
  await reach(appraiser, "guild_appraisal");
  assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: appraiser, item_id: "raw_mana_crystal" })).ok);
  await use(appraiser, "transfer_item", { action: "pick", item_id: "raw_mana_crystal", quantity: 1 });
  await use(appraiser, "work_craft", { station_id: "guild_appraisal", recipe_or_task: "cut_light_stone", minutes: 15 });
  assert.ok((await world.call("host", "world_step", { minutes: 15 })).ok);
  const cut = list(await use(appraiser, "status"), "inventory");
  assert.equal(itemQuantity(cut, "lamp_stone"), 1);
  assert.equal(itemQuantity(cut, "raw_mana_crystal"), 0);
}

async function proveTraces(world: WorldClient): Promise<void> {
  const actor = "demon_kael";
  const caster = "human_garrick";
  assert.ok((await world.call("host", "world_inject_event", { kind: "weather", weather: "rain" })).ok);
  const moved = resultOf(await walk(world, actor, "-170,2,15"));
  assert.equal(moved.arrived, true, JSON.stringify(moved));
  const look = resultOf(await agentCall(world, actor, "look", {}));
  const trace = list(look, "visible_traces").find((entry) => isRecord(entry) && entry.kind === "footprints");
  assert.ok(isRecord(trace), JSON.stringify(look));
  const target_id = str(trace, "id");
  const fresh = await agentCall(world, actor, "inspect", { target_id });
  assert.ok(fresh.ok);
  assert.equal("from" in resultOf(fresh), false);
  assert.ok((await world.call("host", "world_inject_event", { kind: "weather", weather: "storm" })).ok);
  assert.ok((await world.call("host", "world_step", { minutes: 30 })).ok);
  const faded = resultOf(await agentCall(world, actor, "inspect", { target_id }));
  assert.ok(num(faded, "clarity") < num(resultOf(fresh), "clarity"));
  assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: actor, item_id: "oil_flask" })).ok);
  assert.ok((await agentCall(world, actor, "transfer_item", { action: "pick", item_id: "oil_flask", quantity: 1 })).ok);
  const spilled = resultOf(await agentCall(world, actor, "transfer_item", { action: "spill", item_id: "oil_flask", quantity: 1 }));
  assert.ok(typeof spilled.trace_id === "string");
  assert.equal(resultOf(await agentCall(world, actor, "inspect", { target_id: spilled.trace_id })).kind, "oil");
  assert.ok((await world.call("host", "world_inject_event", { kind: "injury", agentId: caster, injury: "bleeding" })).ok);
  assert.ok((await world.call("host", "world_step", { minutes: 1 })).ok);
  const blood = resultOf(await agentCall(world, caster, "look", {}));
  assert.ok(list(blood, "visible_traces").some((entry) => isRecord(entry) && entry.kind === "blood"));
  assert.ok((await world.call("host", "world_step", { minutes: 1441 })).ok);
  assert.equal((await agentCall(world, actor, "inspect", { target_id })).error?.code, "bad_args");
}

async function proveMagic(world: WorldClient): Promise<void> {
  const mage = "human_elena";
  const patient = "human_aldric";
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function step(minutes: number) {
    assert.ok((await world.call("host", "world_step", { minutes })).ok);
  }
  assert.equal((await agentCall(world, mage, "suppress_mana", { enabled: true, apparent_level: -1 })).error?.code, "bad_args");
  await use(mage, "suppress_mana", { enabled: true, apparent_level: 10 });
  assert.equal((await agentCall(world, mage, "cast_spell", { spell_name: "barrier", target: "", mana_spend: 56 })).error?.code, "mana");
  const hidden = await use(mage, "sense_mana", { mode: "passive" });
  assert.equal(list(hidden, "signatures").some((entry) => isRecord(entry) && entry.id === "human_mira"), false);
  await world.call("host", "host_pending", { agentId: "human_mira" });
  const pulse = await use(mage, "sense_mana", { mode: "pulse" });
  assert.ok(list(pulse, "signatures").some((entry) => isRecord(entry) && entry.id === "human_mira"));
  const sensed = list(resultOf(await world.call("host", "host_pending", { agentId: "human_mira" })), "events");
  assert.ok(sensed.some((entry) => isRecord(entry) && entry.type === "mana_pulse" && !("from" in entry)));
  await use(mage, "suppress_mana", { enabled: false });
  for (const injury of ["bleeding", "lacerated", "fractured"]) {
    assert.ok((await world.call("host", "world_inject_event", { kind: "injury", agentId: patient, injury })).ok);
  }
  const manaBefore = num(await use(mage, "status"), "mana");
  assert.equal((await use(mage, "cast_spell", { spell_name: "mend", target: patient, mana_spend: 6 })).pending, true);
  assert.equal(num(await use(mage, "status"), "mana"), manaBefore - 6);
  assert.ok(list(await use(patient, "status"), "injuries").includes("bleeding"));
  assert.equal((await agentCall(world, mage, "sense_mana", { mode: "pulse" })).error?.code, "busy");
  await step(1);
  const healed = list(await use(patient, "status"), "injuries");
  assert.equal(healed.includes("bleeding"), false);
  assert.equal(healed.includes("lacerated"), false);
  assert.equal(healed.includes("fractured"), true);
  assert.equal((await agentCall(world, mage, "cast_spell", { spell_name: "mend", target: patient, mana_spend: 6 })).error?.code, "rejected");

  await use(mage, "cast_spell", { spell_name: "barrier", target: "", mana_spend: 10 });
  await step(1);
  const events = list(resultOf(await world.call("host", "host_pending", { agentId: mage })), "events");
  const barrier = events.find((entry) => isRecord(entry) && isRecord(entry.result) && entry.result.spell === "barrier");
  assert.ok(isRecord(barrier) && isRecord(barrier.result));
  const barrierId = str(barrier.result, "body");
  assert.equal((await use(mage, "inspect", { target_id: barrierId })).integrity, 10);
  await step(2);
  assert.equal((await agentCall(world, mage, "inspect", { target_id: barrierId })).error?.code, "bad_args");

  const doorway = resultOf(await walk(world, mage, "85,0,-30"));
  assert.equal(doorway.arrived, true, JSON.stringify(doorway));
  await use(mage, "toggle_lock", { door_id: "guild_entrance", action: "open" });
  const hearth = resultOf(await walk(world, mage, "town_fire_ring"));
  assert.equal(hearth.arrived, true, JSON.stringify(hearth));
  assert.ok((await world.call("host", "world_inject_event", { kind: "weather", region: "stonebridge", weather: "clear" })).ok);
  assert.ok((await world.call("host", "world_inject_event", { kind: "item", place: mage, item_id: "timber" })).ok);
  await use(mage, "transfer_item", { action: "pick", item_id: "timber", quantity: 1 });
  const timber = itemQuantity(list(await use(mage, "status"), "inventory"), "timber");
  await use(mage, "cast_spell", { spell_name: "flame", target: "town_fire_ring", mana_spend: 5 });
  assert.equal((await use(mage, "inspect", { target_id: "town_fire_ring" })).lit, false);
  await step(1);
  assert.equal((await use(mage, "inspect", { target_id: "town_fire_ring" })).lit, true);
  assert.equal(itemQuantity(list(await use(mage, "status"), "inventory"), "timber"), timber - 1);
  assert.ok((await world.call("host", "world_inject_event", { kind: "weather", region: "stonebridge", weather: "rain" })).ok);
  assert.equal((await use(mage, "inspect", { target_id: "town_fire_ring" })).lit, false);
}

async function proveSpire(world: WorldClient): Promise<void> {
  const traveler = "demon_kael";
  async function use(tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, traveler, tool, args);
    assert.ok(response.ok && response.result, `${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(destination: string) {
    const result = resultOf(await walk(world, traveler, destination));
    assert.equal(result.arrived, true, `${destination}: ${JSON.stringify(result)}`);
    return result;
  }
  await reach("sunken_spire");
  await reach("spire_west_gap");
  await reach("spire_floor");
  await reach("spire_ledge");
  assert.ok(Math.abs(num(await use("status"), "y") - 47) < 0.5);
  await reach("spire_inscription");
  const inscription = await use("inspect", { target_id: "spire_inscription" });
  assert.match(str(inscription, "text"), /Forty-five mana/);
  await reach("spire_steps");
  const lower = await reach("spire_vestibule");
  assert.ok(Math.abs(num(lower, "y") - 30) < 0.2);
  assert.equal((await use("look", { focus: "rune_vault" })).view_range_m, 0);
  const darkSlab = await agentCall(world, traveler, "inspect", { target_id: "rune_vault" });
  assert.equal(darkSlab.error?.code, "blocked");
  const ordinary = await agentCall(world, traveler, "toggle_lock", { door_id: "rune_vault", action: "unlock" });
  assert.equal(ordinary.error?.code, "locked");
  await use("cast_spell", { spell_name: "light", target: "", mana_spend: 5 });
  assert.ok((await world.call("host", "world_step", { minutes: 1 })).ok);
  const initial = await use("inspect", { target_id: "rune_vault" });
  assert.equal(initial.mana_sealed, true);
  const view = await use("look", { focus: "rune_vault" });
  assert.ok(!list(view, "visible_fixtures").some((entry) => isRecord(entry) && entry.id === "spire_crystals"));
  const tooWeak = await agentCall(world, traveler, "cast_spell", { spell_name: "unseal", target: "rune_vault", mana_spend: 44 });
  assert.equal(tooWeak.error?.code, "mana");
  const mana = num(await use("status"), "mana");
  const started = await use("cast_spell", { spell_name: "unseal", target: "rune_vault", mana_spend: 45 });
  assert.equal(started.pending, true);
  assert.equal(num(await use("status"), "mana"), mana - 45);
  assert.equal((await use("inspect", { target_id: "rune_vault" })).mana_sealed, true);
  assert.ok((await world.call("host", "world_step", { minutes: 1 })).ok);
  const opened = await use("inspect", { target_id: "rune_vault" });
  assert.equal(opened.mana_sealed, false);
  assert.equal(opened.open, true);
  await reach("spire_crystals");
  const cache = await use("inspect", { target_id: "spire_crystals" });
  assert.equal(cache.remaining_batches, 3);
  const harvest = await use("work_craft", { station_id: "spire_crystals", recipe_or_task: "lift_spire_crystal", minutes: 6 });
  assert.equal(harvest.pending, true);
  assert.ok((await world.call("host", "world_step", { minutes: 6 })).ok);
  assert.equal(itemQuantity(list(await use("status"), "inventory"), "spire_crystal"), 1);
  assert.equal((await use("inspect", { target_id: "spire_crystals" })).remaining_batches, 2);
  await reach("spire_steps");
  await reach("goblin_ravine");
  await reach("wolf_den");
}

async function proveFarms(world: WorldClient): Promise<void> {
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(actor: string, destination: string) {
    const result = resultOf(await walk(world, actor, destination));
    assert.equal(result.arrived, true, `${actor} → ${destination}: ${JSON.stringify(result)}`);
    return result;
  }
  async function step(minutes: number) {
    const result = await world.call("host", "world_step", { minutes });
    assert.ok(result.ok, JSON.stringify(result.error));
  }
  async function work(actor: string, station_id: string, recipe_or_task: string, minutes: number) {
    const result = await use(actor, "work_craft", { station_id, recipe_or_task, minutes });
    assert.equal(result.pending, true);
    await step(minutes);
  }
  const east = "human_owen";
  const west = "human_miller";
  for (const [farmer, base, prior] of [[east, "oakford", "139,2,373.5"], [west, "miller", "-274,3,160"]] as const) {
    const door = base === "oakford" ? "oakford_door" : "miller_door";
    await reach(farmer, base === "oakford" ? "140,2,375" : "-276,3,160");
    await use(farmer, "toggle_lock", { door_id: door, action: "open" });
    await reach(farmer, prior);
    await reach(farmer, `${base}_well`);
    await work(farmer, `${base}_well`, "draw_water", 2);
    await reach(farmer, `${base}_field`);
    await work(farmer, `${base}_field`, "sow_grain", 20);
    const planted = await use(farmer, "inspect", { target_id: `${base}_field` });
    assert.equal(planted.crop_state, "growing");
    const early = await agentCall(world, farmer, "work_craft", { station_id: `${base}_field`, recipe_or_task: "harvest_grain", minutes: 30 });
    assert.equal(early.error?.code, "rejected");
  }
  const oakford = await use(east, "inspect", { target_id: "oakford_field" });
  const remaining = num(oakford, "growth_required") - num(oakford, "growth_minutes");
  await step(remaining - 20000 - 1);
  await step(10000);
  await step(10000);
  assert.equal((await use(east, "inspect", { target_id: "oakford_field" })).crop_state, "growing");
  await step(1);
  for (const [farmer, base] of [[east, "oakford"], [west, "miller"]] as const) {
    assert.equal((await use(farmer, "inspect", { target_id: `${base}_field` })).crop_state, "ripe");
    await work(farmer, `${base}_field`, "harvest_grain", 30);
    assert.equal(itemQuantity(list(await use(farmer, "status"), "inventory"), "grain_sack"), 2);
    assert.equal((await use(farmer, "inspect", { target_id: `${base}_field` })).crop_state, "fallow");
  }
  async function sheepOn(side: "pasture" | "pen"): Promise<number> {
    const snapshot = resultOf(await world.call("host", "world_snapshot"));
    return list(snapshot, "wildlife").filter((animal) => isRecord(animal) && animal.kind === "sheep"
      && (side === "pasture" ? num(animal, "z") < 185 : num(animal, "z") > 185)).length;
  }
  await reach(west, "sheep_pen_gate");
  assert.equal(await sheepOn("pen"), 14);
  await use(west, "toggle_lock", { door_id: "sheep_pen_gate", action: "open" });
  for (let i = 0; i < 4; i++) await step(4);
  assert.equal(await sheepOn("pasture"), 14);
  await work(west, "shepherd_post", "herd_sheep", 5);
  for (let i = 0; i < 4; i++) await step(4);
  assert.equal(await sheepOn("pen"), 14);
  await reach(west, "sheep_pen_gate");
  await use(west, "toggle_lock", { door_id: "sheep_pen_gate", action: "close" });
  await reach(east, "163,2,379.5");
  await use(east, "toggle_lock", { door_id: "root_cellar_door", action: "open" });
  await reach(east, "cellar_bins");
  await use(east, "transfer_item", { action: "store", container_id: "cellar_bins", item_id: "grain_sack", quantity: 1 });
  const stock = list(await use(east, "inspect", { target_id: "cellar_bins" }), "stock");
  assert.equal(itemQuantity(stock, "grain_sack"), 1);
  await use(east, "transfer_item", { action: "pick", item_id: "grain_sack", quantity: 1 });
  const snapshot = resultOf(await world.call("host", "world_snapshot"));
  if (isRecord(snapshot.ferry) && snapshot.ferry.dock === "east") {
    await reach("human_fenn", "ferry_east");
    await reach("human_fenn", "ferry_west");
  }
  const cart_id = "oakford_cart";
  await reach(east, cart_id);
  await use(east, "cart", { cart_id, action: "hitch" });
  const loaded = await use(east, "cart", { cart_id, action: "load", item_id: "grain_sack", quantity: 2 });
  assert.equal(loaded.cargo_kg, 40);
  assert.equal(itemQuantity(list(await use(east, "status"), "inventory"), "grain_sack"), 0);
  await reach(east, "ferry_east");
  // Temporary ballast gives the same cart a load above the ferry's limit.
  const ballast = await world.call("host", "world_inject_event", {
    kind: "item", place: "ferry_east", item_id: "grain_sack", quantity: 8,
  });
  assert.ok(ballast.ok);
  for (const [picked, loaded] of [[2, 2], [2, 2], [2, 2], [2, 1]] as const) {
    await use(east, "transfer_item", { action: "pick", item_id: "grain_sack", quantity: picked });
    await use(east, "cart", { cart_id, action: "load", item_id: "grain_sack", quantity: loaded });
  }
  const tooMuchCargo = await agentCall(world, east, "cart", { cart_id, action: "load", item_id: "grain_sack", quantity: 1 });
  assert.equal(tooMuchCargo.error?.code, "encumbered");
  const tooHeavyForRaft = await agentCall(world, east, "move_to", { destination: "ferry_west", pace: "walk" });
  assert.equal(tooHeavyForRaft.error?.code, "encumbered");
  await use(east, "transfer_item", { action: "drop", item_id: "grain_sack", quantity: 1 });
  for (const quantity of [2, 2, 2, 1]) {
    await use(east, "cart", { cart_id, action: "unload", item_id: "grain_sack", quantity });
    await use(east, "transfer_item", { action: "drop", item_id: "grain_sack", quantity });
  }
  const request = await use(east, "move_to", { destination: "ferry_west", pace: "walk" });
  assert.ok(isRecord(request.action) && request.action.kind === "ferry");
  assert.equal(request.action.cart_id, cart_id);
  const reserved = await use(east, "inspect", { target_id: "ferry_east" });
  assert.equal(reserved.cart_id, cart_id);
  assert.ok(num(reserved, "reserved_kg") > 475 && num(reserved, "reserved_kg") < 600);
  const waited = num(request.action, "wait_minutes");
  assert.equal(waited, 4);
  await step(waited);
  const boarding = await use(east, "status");
  assert.ok(num(boarding, "x") < -24 && num(boarding, "x") > -34);
  const crossingMinutes = num(request.action, "finish_at") - num(request.action, "depart_at");
  await step(crossingMinutes);
  const westDock = await use(east, "inspect", { target_id: "ferry_west" });
  assert.equal(westDock.dock, "west");
  const landed = await use(east, "inspect", { target_id: cart_id });
  assert.ok(num(landed, "x") < -63);
  assert.equal(itemQuantity(list(landed, "cargo"), "grain_sack"), 2);
  const guard = await use("human_garrick", "status");
  if (Math.abs(num(guard, "x") + 30) < 5 && Math.abs(num(guard, "z")) < 1.5) {
    await reach("human_garrick", "-24,0,8");
  }
  await reach(east, "town_square");
  const delivered = await use(east, "inspect", { target_id: cart_id });
  assert.ok(num(delivered, "x") > 40);
  assert.equal(itemQuantity(list(delivered, "cargo"), "grain_sack"), 2);
  await use(east, "cart", { cart_id, action: "unload", item_id: "grain_sack", quantity: 2 });
  await use(east, "cart", { cart_id, action: "unhitch" });
  const provisioner = "human_tomas";
  await reach(provisioner, "20,0,45");
  await use(provisioner, "toggle_lock", { door_id: "granary_door", action: "unlock" });
  await use(provisioner, "toggle_lock", { door_id: "granary_door", action: "open" });
  await reach(provisioner, "21,0,50");
  await reach(east, provisioner);
  const offer = await use(east, "trade", { partner_id: provisioner, offer_item: "grain_sack", offer_qty: 1, request_item: "sp", request_qty: 3 });
  assert.equal(offer.settled, false);
  const paid = await use(provisioner, "trade", { partner_id: east, offer_item: "sp", offer_qty: 3, request_item: "grain_sack", request_qty: 1 });
  assert.equal(paid.settled, true);
  assert.equal(itemQuantity(list(await use(provisioner, "status"), "inventory"), "grain_sack"), 1);
  const date = num(resultOf(await world.call("host", "world_snapshot")), "minute");
  for (let remaining = 30 * 1440 - date; remaining > 0; remaining -= 10080) {
    await step(Math.min(remaining, 10080));
  }
  await reach(east, "oakford_orchard");
  assert.equal((await use(east, "inspect", { target_id: "oakford_orchard" })).in_season, true);
  await work(east, "oakford_orchard", "pick_apples", 8);
  assert.equal(itemQuantity(list(await use(east, "status"), "inventory"), "apple"), 4);
}

async function proveWhisperwood(world: WorldClient): Promise<void> {
  const scout = "elf_lyra";
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(actor: string, destination: string) {
    const result = resultOf(await walk(world, actor, destination));
    assert.equal(result.arrived, true, `${destination}: ${JSON.stringify(result)}`);
    return result;
  }
  async function work(actor: string, station_id: string, recipe_or_task: string, minutes: number) {
    assert.equal((await use(actor, "work_craft", { station_id, recipe_or_task, minutes })).pending, true);
    const advanced = await world.call("host", "world_step", { minutes });
    assert.ok(advanced.ok && list(resultOf(advanced), "woke").includes(actor));
  }
  await reach(scout, "treewatch");
  assert.ok(num(await reach(scout, "treewatch_mid"), "y") > 23);
  await use(scout, "toggle_lock", { door_id: "treewatch_ladder", action: "close" });
  const disconnected = resultOf(await walk(world, scout, "treewatch"));
  assert.equal(disconnected.arrived, false);
  await use(scout, "toggle_lock", { door_id: "treewatch_ladder", action: "open" });
  await reach("elf_sylvar", "520,30.125,41.5");
  assert.ok(num(await reach(scout, "treewatch_east"), "x") > 530);
  assert.ok(num(await reach(scout, "treewatch"), "y") < 19);
  await reach(scout, "spring_basin");
  const sense = await use(scout, "sense_mana", { mode: "passive" });
  assert.ok(list(sense, "signatures").some((entry) => isRecord(entry) && entry.id === "sacred_spring"));
  await work(scout, "spring_basin", "draw_water", 2);
  await reach(scout, "777.5,24,-179.5");
  await reach(scout, "spring_herbs");
  await work(scout, "spring_herbs", "gather_herbs", 5);
  const gathered = list(await use(scout, "status"), "inventory");
  assert.equal(itemQuantity(gathered, "forest_herbs"), 2);
  assert.equal(itemQuantity(gathered, "spring_water"), 1);
  await reach(scout, "town_square");
  await reach(scout, "130,0,-18.7");
  await use(scout, "toggle_lock", { door_id: "chapel_entrance", action: "open" });
  await reach(scout, "human_clara");
  const healer = "human_clara";
  await use(scout, "transfer_item", { action: "give", item_id: "forest_herbs", quantity: 2, target_agent: healer });
  await use(scout, "transfer_item", { action: "give", item_id: "spring_water", quantity: 1, target_agent: healer });
  await reach(healer, "chapel_workbench");
  await work(healer, "chapel_workbench", "herbal_tonic", 12);
  const brewed = await use(healer, "status");
  assert.equal(itemQuantity(list(brewed, "inventory"), "herbal_tonic"), 1);
  const drank = await use(healer, "transfer_item", { action: "consume", item_id: "herbal_tonic", quantity: 1 });
  assert.ok(num(drank, "stamina") > num(brewed, "stamina"));
  assert.equal(itemQuantity(list(await use(healer, "status"), "inventory"), "herbal_tonic"), 0);
  const woodcutter = "dwarf_nori";
  await reach(woodcutter, "border_pines");
  await work(woodcutter, "border_pines", "cut_timber", 15);
  await reach(woodcutter, "charcoal_pit");
  await work(woodcutter, "charcoal_pit", "burn_charcoal", 50);
  const fuel = list(await use(woodcutter, "status"), "inventory");
  assert.equal(itemQuantity(fuel, "timber"), 0);
  assert.equal(itemQuantity(fuel, "charcoal"), 1);
}

async function proveAnvilValley(world: WorldClient): Promise<void> {
  const miner = "dwarf_dori";
  const smith = "human_bram";
  async function use(actor: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, actor, tool, args);
    assert.ok(response.ok && response.result, `${actor} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async function reach(destination: string) {
    const result = resultOf(await walk(world, miner, destination));
    assert.equal(result.arrived, true, `${destination}: ${JSON.stringify(result)}`);
    return result;
  }
  async function work(station_id: string, recipe_or_task: string, minutes: number) {
    const started = await use(miner, "work_craft", { station_id, recipe_or_task, minutes });
    assert.equal(started.pending, true);
    const advanced = await world.call("host", "world_step", { minutes });
    assert.ok(advanced.ok, JSON.stringify(advanced.error));
    assert.ok(list(resultOf(advanced), "woke").includes(miner));
  }

  await reach("ore_vein");
  const exposed = await use(miner, "look", { focus: "ore_vein" });
  assert.ok(list(exposed, "visible_fixtures").some((row) => isRecord(row) && row.id === "ore_vein"));
  const ore = await use(miner, "inspect", { target_id: "ore_vein" });
  assert.equal(ore.recipe_id, "mine_iron");
  await work("ore_vein", "mine_iron", 12);
  assert.equal((await use(miner, "inspect", { target_id: "ore_vein" })).remaining_batches, num(ore, "remaining_batches") - 1);
  const mined = list(await use(miner, "status"), "inventory");
  assert.ok(mined.some((item) => isRecord(item) && item.id === "iron_ore" && item.qty === 1 && item.kg === 12));

  const blocked = resultOf(await walk(world, miner, "crystal_vein"));
  assert.equal(blocked.arrived, false);
  assert.ok(isRecord(blocked.blocked) && blocked.blocked.id === "mine_rubble", JSON.stringify(blocked));
  await reach("mine_rubble");
  const braceCount = itemQuantity(list(await use(miner, "status"), "inventory"), "timber_brace");
  await work("mine_rubble", "clear_rubble", 15);
  assert.equal(itemQuantity(list(await use(miner, "status"), "inventory"), "timber_brace"), braceCount - 1);
  const underground = await reach("crystal_vein");
  assert.equal(underground.y, 14);
  const lit = await use(miner, "look", { focus: "crystal_vein" });
  const signatures = await use(miner, "sense_mana", { mode: "passive" });
  assert.ok(list(signatures, "signatures").some((entry) => isRecord(entry) && entry.id === "crystal_vein"));
  assert.equal(lit.view_range_m, 12);
  const below = await use(miner, "status");
  assert.equal(below.footing, "shallow_water");
  await use(miner, "transfer_item", { action: "drop", item_id: "lantern", quantity: 1 });
  const dark = await use(miner, "look", { focus: "crystal_vein" });
  assert.equal(dark.view_range_m, 0);
  assert.deepEqual(dark.visible_fixtures, []);
  await use(miner, "transfer_item", { action: "pick", item_id: "lantern", quantity: 1 });
  assert.equal((await use(miner, "status")).mass_kg, below.mass_kg);
  await work("crystal_vein", "mine_crystal", 18);
  assert.equal(itemQuantity(list(await use(miner, "status"), "inventory"), "raw_mana_crystal"), 1);

  await reach("anvil_yard");
  await reach("smelter_furnace");
  const fuel = list(await use(miner, "inspect", { target_id: "smelter_furnace" }), "stock");
  await work("smelter_furnace", "iron_bar", 25);
  const fuelAfter = list(await use(miner, "inspect", { target_id: "smelter_furnace" }), "stock");
  assert.equal(itemQuantity(fuelAfter, "charcoal"), itemQuantity(fuel, "charcoal") - 1);
  assert.equal(itemQuantity(fuelAfter, "iron_ore"), itemQuantity(fuel, "iron_ore"));
  const reserve = list(await use(miner, "status"), "inventory");
  assert.equal(itemQuantity(reserve, "iron_ore"), 0);
  assert.ok(reserve.some((item) => isRecord(item) && item.id === "iron_bar" && item.qty === 1 && item.kg === 8));

  const cart_id = "anvil_cart";
  await reach(cart_id);
  await use(miner, "cart", { action: "hitch", cart_id });
  await use(miner, "cart", { action: "load", cart_id, item_id: "iron_bar", quantity: 1 });
  await reach("market_wagon_bay");
  const inTown = await use(miner, "inspect", { target_id: cart_id });
  assert.ok(Math.abs(num(inTown, "x") - 60) < 4);
  assert.equal(itemQuantity(list(inTown, "cargo"), "iron_bar"), 1);
  await use(miner, "cart", { action: "unload", cart_id, item_id: "iron_bar", quantity: 1 });
  await use(miner, "cart", { action: "unhitch", cart_id });
  await reach("human_bram");
  const offer = await use(miner, "trade", {
    partner_id: smith, offer_item: "iron_bar", offer_qty: 1, request_item: "sp", request_qty: 5,
  });
  assert.equal(offer.settled, false);
  const paid = await use(smith, "trade", {
    partner_id: miner, offer_item: "sp", offer_qty: 5, request_item: "iron_bar", request_qty: 1,
  });
  assert.equal(paid.settled, true);
  assert.equal(itemQuantity(list(await use(smith, "status"), "inventory"), "iron_bar"), 1);
  const minerAfter = await use(miner, "status");
  assert.equal(itemQuantity(list(minerAfter, "inventory"), "iron_bar"), 0);
  assert.equal(minerAfter.sp, 17);
}

async function proveGranaryToTavern(world: WorldClient): Promise<void> {
  const greta = "human_greta";
  const tomas = "human_tomas";
  const kestrel = "human_kestrel";

  async function use(agent: string, tool: string, args: Record<string, unknown> = {}) {
    const response = await agentCall(world, agent, tool, args);
    assert.ok(response.ok && response.result, `${agent} ${tool}: ${JSON.stringify(response.error)}`);
    return response.result;
  }

  async function move(agent: string, destination: string) {
    const result = resultOf(await walk(world, agent, destination));
    assert.equal(result.arrived, true, `${agent} → ${destination}: ${JSON.stringify(result)}`);
    return result;
  }

  async function sees(agent: string, id: string, focus = id) {
    const result = await use(agent, "look", { focus });
    return list(result, "visible_fixtures").some((row) => isRecord(row) && row.id === id);
  }

  async function trade(actor: string, partner: string, item: string, price: number) {
    const offer = await use(actor, "trade", {
      partner_id: partner, offer_item: "sp", offer_qty: price, request_item: item, request_qty: 1,
    });
    assert.equal(offer.settled, false);
    const accepted = await use(partner, "trade", {
      partner_id: actor, offer_item: item, offer_qty: 1, request_item: "sp", request_qty: price,
    });
    assert.equal(accepted.settled, true);
  }

  assert.ok(await sees(greta, "inn_oven", "north"));
  await move(greta, "inn_oven");
  const oven = await use(greta, "inspect", { target_id: "inn_oven" });
  assert.equal(oven.recipe_id, "bread");
  assert.deepEqual(oven.recipe, { need: { grain_sack: 1 }, out: { bread: 4 }, minutes: 20 });
  const withoutGrain = await agentCall(world, greta, "work_craft", {
    station_id: "inn_oven", recipe_or_task: "bread", minutes: 20,
  });
  assert.equal(withoutGrain.error?.code, "no_item");

  await move(greta, "35,0,-33");
  await use(greta, "toggle_lock", { door_id: "tavern_entrance", action: "open" });
  await move(greta, "granary_doorstep");
  assert.equal(await sees(greta, "granary_bins"), false);
  await move(tomas, "20,0,45");
  await use(tomas, "toggle_lock", { door_id: "granary_door", action: "unlock" });
  await use(tomas, "toggle_lock", { door_id: "granary_door", action: "open" });
  const primary = await move(tomas, "granary_bins");
  const stock = await use(tomas, "inspect", { target_id: "granary_bins" });
  assert.equal(stock.accessible, true);
  const grainBefore = itemQuantity(list(stock, "stock"), "grain_sack");
  const tooHeavy = await agentCall(world, tomas, "transfer_item", { action: "pick", item_id: "grain_sack", quantity: 4 });
  assert.equal(tooHeavy.error?.code, "encumbered");
  assert.equal(itemQuantity(list(await use(tomas, "status"), "inventory"), "grain_sack"), 0);
  await use(tomas, "transfer_item", { item_id: "grain_sack", action: "pick", quantity: 1 });
  const remaining = await use(tomas, "inspect", { target_id: "granary_bins" });
  assert.equal(itemQuantity(list(remaining, "stock"), "grain_sack"), grainBefore - 1);

  const alternate = await move(greta, "granary_bins");
  assert.notEqual(alternate.x, primary.x, "Greta needs the free space beside Tomas");
  assert.ok(await sees(greta, "granary_bins"));
  await trade(greta, tomas, "grain_sack", 3);

  await move(greta, "tavern_doorstep");
  await move(greta, "inn_oven");
  const before = num(resultOf(await world.call("host", "world_snapshot")), "minute");
  const started = await use(greta, "work_craft", { station_id: "inn_oven", recipe_or_task: "bread", minutes: 20 });
  assert.equal(started.pending, true);
  assert.equal(num(resultOf(await world.call("host", "world_snapshot")), "minute"), before);
  const busy = await use(greta, "status");
  assert.equal(itemQuantity(list(busy, "inventory"), "bread"), 0);
  const blocked = await agentCall(world, greta, "move_to", { destination: "tavern_doorstep", pace: "walk" });
  assert.equal(blocked.error?.code, "busy");

  const resting = await use(kestrel, "rest", { minutes: 5 });
  assert.equal(resting.pending, true);
  const during = resultOf(await world.call("host", "world_step", { minutes: 30, stop_on_action: true }));
  assert.equal(during.minute, before + 5);
  assert.ok(list(during, "woke").includes(kestrel));
  assert.equal(list(during, "woke").includes(greta), false);
  assert.equal(itemQuantity(list(await use(greta, "status"), "inventory"), "bread"), 0);
  const midSpeech = "Is the next batch in the oven?";
  await use(kestrel, "speak", { utterance: midSpeech, volume: "normal" });
  const busyEvents = resultOf(await world.call("host", "host_pending", { agentId: greta }));
  assert.deepEqual(busyEvents.events, []);
  const done = resultOf(await world.call("host", "world_step", { minutes: 25, stop_on_action: true }));
  assert.equal(done.minute, before + 20);
  assert.ok(list(done, "woke").includes(greta));
  const notices = list(resultOf(await world.call("host", "host_pending", { agentId: greta })), "events");
  assert.ok(heard(notices, midSpeech));
  assert.ok(notices.some((event) => isRecord(event) && event.type === "action_completed" && event.minute === before + 20));
  const baked = await use(greta, "status");
  assert.equal(itemQuantity(list(baked, "inventory"), "grain_sack"), 0);
  assert.equal(itemQuantity(list(baked, "inventory"), "bread"), 4);
  assert.equal(baked.action, null);

  await move(kestrel, greta);
  await trade(kestrel, greta, "bread", 1);
  for (const [actor, silver, bread] of [[greta, 46, 3], [tomas, 58, 0], [kestrel, 15, 1]] as const) {
    const status = await use(actor, "status");
    assert.equal(status.sp, silver, actor);
    assert.equal(itemQuantity(list(status, "inventory"), "bread"), bread, actor);
  }
}

async function main(): Promise<void> {
  const names = worldToolNames();
  const hostOnly = ["world_step", "world_snapshot", "world_inject_event", "host_pending", "host_nav"];
  check(
    "world tools live in this host",
    names.length === 15
      && names.every((name) => name.startsWith("mcp__world__") && name.length <= 64)
      && hostOnly.every((name) => !names.includes(`mcp__world__${name}`))
      && !names.some((name) => name.includes("bash")),
    `${names.length} tools`,
  );

  const world = new WorldClient();
  await world.connect();
  const snapshot = await world.call("host", "world_snapshot");
  const agents = list(resultOf(snapshot), "agents");
  check("snapshot has the named cast", snapshot.ok && agents.length === 21, `agents=${agents.length}`);

  try {
    await provePerception(world);
    check("local buildings are discoverable without exposing the map", true, "names, bearings, occlusion, and unknown destinations");
  } catch (error) {
    check("local buildings are discoverable without exposing the map", false, String(error));
  }

  const kael = agents.find((row) => isRecord(row) && row.id === "demon_kael");
  const kaelRecord = isRecord(kael) ? kael : {};
  check("Kael starts on the west road", Math.abs(num(kaelRecord, "x") + 180) < 0.1 && Math.abs(num(kaelRecord, "z") - 15) < 0.1, `x=${num(kaelRecord, "x")} z=${num(kaelRecord, "z")}`);

  const bash = await agentCall(world, "human_garrick", "bash", { command: "cat docs/world-setup/classic-frontier/world.md" });
  check("filesystem tools stay out of the character pool", bash.ok === false && bash.error?.code === "forbidden", bash.error?.message ?? "");

  const step = await agentCall(world, "human_garrick", "world_step", { minutes: 5 });
  check("host tools stay out of the character pool", step.ok === false && step.error?.code === "forbidden", step.error?.message ?? "");

  const aside = await walk(world, "human_garrick", "-22,0,8");
  const asideBody = resultOf(aside);
  check("Garrick steps off the gate", aside.ok && asideBody.arrived === true, `arrived=${String(asideBody.arrived)} blocked=${JSON.stringify(asideBody.blocked)}`);

  const toGate = await walk(world, "demon_kael", "west_gate");
  const gateBody = resultOf(toGate);
  check("Kael walks the west road to the gate", toGate.ok && gateBody.arrived === true && num(gateBody, "x") < -30, `x=${num(gateBody, "x")} points=${num(gateBody, "path_points")} minutes=${num(gateBody, "minutes")} blocked=${JSON.stringify(gateBody.blocked)}`);

  const close = await walk(world, "human_garrick", "-34,0,3");
  check("Garrick comes within whisper range", close.ok && resultOf(close).arrived === true, JSON.stringify(resultOf(close).blocked));

  const quiet = "The west road is empty.";
  const whisper = await agentCall(world, "demon_kael", "speak", { utterance: quiet, volume: "whisper" });
  const garrickPending = await world.call("host", "host_pending", { agentId: "human_garrick" });
  const garrickEvents = list(resultOf(garrickPending), "events");
  check("whisper carries a few meters", whisper.ok && heard(garrickEvents, quiet), `events=${JSON.stringify(garrickEvents)}`);

  const far = "Wolves on the hill!";
  const shout = await agentCall(world, "human_miller", "speak", { utterance: far, volume: "shout" });
  const afterShout = await world.call("host", "host_pending", { agentId: "demon_kael" });
  check("a shout does not cross the valley", shout.ok && !heard(list(resultOf(afterShout), "events"), far), "Kael did not receive Miller");

  const gift = await agentCall(world, "human_kestrel", "transfer_item", { item_id: "arrow", action: "give", target_agent: "human_rolf", quantity: 2 });
  const rolf = await agentCall(world, "human_rolf", "status", {});
  const arrows = list(resultOf(rolf), "inventory").find((item) => isRecord(item) && item.id === "arrow");
  check("adjacent give moves arrows", gift.ok && isRecord(arrows) && num(arrows, "qty") === 2, `qty=${isRecord(arrows) ? num(arrows, "qty") : "none"}`);

  const tooFar = await agentCall(world, "human_kestrel", "transfer_item", { item_id: "arrow", action: "give", target_agent: "human_miller", quantity: 1 });
  check("give beyond 2 m is refused", tooFar.ok === false && tooFar.error?.code === "too_far", tooFar.error?.message ?? "");

  const toDoor = await walk(world, "demon_kael", "guild_doorstep");
  const doorBody = resultOf(toDoor);
  check("Kael reaches the guild doorstep", toDoor.ok && doorBody.arrived === true, `x=${num(doorBody, "x")} z=${num(doorBody, "z")} blocked=${JSON.stringify(doorBody.blocked)}`);

  const hidden = await agentCall(world, "demon_kael", "look", { focus: "human_elena" });
  const hiddenIds = list(resultOf(hidden), "visible_agents").map((row) => isRecord(row) ? row.id : "");
  check("a closed door hides Elena", hidden.ok && !hiddenIds.includes("human_elena"), hiddenIds.join(",") || "nobody");

  const opened = await agentCall(world, "demon_kael", "toggle_lock", { door_id: "guild_entrance", action: "open" });
  const seen = await agentCall(world, "demon_kael", "look", { focus: "human_elena" });
  const seenIds = list(resultOf(seen), "visible_agents").map((row) => isRecord(row) ? row.id : "");
  check("opening the door clears the line of sight", opened.ok && seen.ok && seenIds.includes("human_elena"), seenIds.join(",") || "nobody");

  const elenaAtDoor = await walk(world, "human_elena", "guild_archive_doorstep");
  const noKey = await agentCall(world, "human_elena", "toggle_lock", { door_id: "guild_archive", action: "unlock" });
  check(
    "archive stays shut without the key",
    elenaAtDoor.ok && resultOf(elenaAtDoor).arrived === true && noKey.ok === false && noKey.error?.code === "locked",
    `move=${JSON.stringify(resultOf(elenaAtDoor).blocked)} lock=${noKey.error?.message ?? "open"}`,
  );

  await walk(world, "human_elena", "90,4.1,-35");
  const toArchive = await walk(world, "human_mira", "guild_archive_doorstep");
  const unlocked = await agentCall(world, "human_mira", "toggle_lock", { door_id: "guild_archive", action: "unlock" });
  check("Mira unlocks the archive with her key", toArchive.ok && resultOf(toArchive).arrived === true && unlocked.ok === true, `move=${JSON.stringify(resultOf(toArchive).blocked)} lock=${unlocked.error?.message ?? "open"}`);

  await walk(world, "human_mira", "guild_appraisal");
  try {
    await proveInteriors(world);
    check("inn rooms and guild archive have usable upper floors", true, "stairs, four rooms, beds, archive, locks, and occlusion");
  } catch (error) {
    check("inn rooms and guild archive have usable upper floors", false, String(error));
  }

  const wet = await walk(world, "human_owen", "-45,0,200");
  const wetBody = resultOf(wet);
  check("the river is not a ford", wet.ok && wetBody.arrived !== true && num(wetBody, "x") > -30, `x=${num(wetBody, "x")} reason=${str(wetBody, "reason")}`);

  const pier = await walk(world, "human_fenn", "ferry_east");
  const crossed = await walk(world, "human_fenn", "ferry_west");
  const crossedBody = resultOf(crossed);
  check("the ferry crosses the river", pier.ok && crossed.ok && crossedBody.via === "ferry" && num(crossedBody, "x") < -50, `via=${str(crossedBody, "via")} x=${num(crossedBody, "x")}`);

  const haul = await walk(world, "dwarf_nori", "town_square");
  const haulBody = resultOf(haul);
  check("Anvil road reaches the town square", haul.ok && haulBody.arrived === true && Math.abs(num(haulBody, "x") - 50) < 3 && Math.abs(num(haulBody, "z")) < 3, `x=${num(haulBody, "x")} z=${num(haulBody, "z")} minutes=${num(haulBody, "minutes")} blocked=${JSON.stringify(haulBody.blocked)}`);

  const lookText = JSON.stringify(hidden);
  check("look does not leak private knowledge", !lookText.includes("30%") && !lookText.includes("mana-sealed vault"), "local sight only");

  try {
    await proveGranaryToTavern(world);
    check("grain reaches the tavern and becomes a sale", true, "door, fixture discovery, free approach, grain, bread, clock, and silver");
  } catch (error) {
    check("grain reaches the tavern and becomes a sale", false, String(error));
  }
  try {
    await proveAnvilValley(world);
    check("Anvil Valley supplies Stonebridge with iron", true, "ore, shaft, crystal, furnace, cart road, and silver");
  } catch (error) {
    check("Anvil Valley supplies Stonebridge with iron", false, String(error));
  }

  try {
    await proveWhisperwood(world);
    check("Whisperwood paths connect the canopy and its resources", true, "retractable ladder, bridge, spring, herbs, timber, and charcoal");
  } catch (error) {
    check("Whisperwood paths connect the canopy and its resources", false, String(error));
  }

  try {
    await proveSurvival(world);
    check("rain, cold, food, water, and trauma have physical consequences", true, "fire, shelter, wetness, treatment, splint, and consciousness");
  } catch (error) {
    check("rain, cold, food, water, and trauma have physical consequences", false, String(error));
  }

  const storm = await world.call("host", "world_inject_event", { kind: "weather", region: "whisperwood", weather: "storm" });
  await world.call("host", "world_inject_event", { kind: "weather", region: "stonebridge", weather: "clear" });
  const forest = resultOf(await agentCall(world, "elf_vaelor", "look", {}));
  const town = resultOf(await agentCall(world, "human_greta", "look", {}));
  check("weather is local to its region", storm.ok && forest.weather === "storm" && town.weather !== "storm"
    && num(forest, "view_range_m") < num(town, "view_range_m"), `forest=${forest.weather} town=${town.weather}`);

  const beforeNight = resultOf(await world.call("host", "world_snapshot"));
  const midday = num(beforeNight, "minute");
  const dusk = resultOf(await world.call("host", "world_step", { minutes: 840 - midday }));
  const afterNight = resultOf(await world.call("host", "world_snapshot"));
  const lockedAtDusk = list(afterNight, "doors")
    .find((door) => isRecord(door) && door.id === "west_gate");
  const afterDark = resultOf(await agentCall(world, "human_greta", "look", {}));
  check("dusk closes the gate and reduces visibility", dusk.clock === "Day 1 20:00"
    && isRecord(lockedAtDusk) && lockedAtDusk.lock === "locked" && !lockedAtDusk.open
    && num(afterDark, "view_range_m") <= 35, `clock=${dusk.clock} view=${afterDark.view_range_m}`);
  function moved(kind: string): boolean {
    const previous = list(beforeNight, "wildlife").filter(isRecord);
    return list(afterNight, "wildlife").filter(isRecord).some((row) => {
      const old = previous.find((entry) => entry.id === row.id);
      return row.kind === kind && old !== undefined && (old.x !== row.x || old.z !== row.z);
    });
  }
  check("at dusk goblins leave shelter and wolves range toward the farms", moved("goblin") && moved("wolf"),
    `goblins_moved=${moved("goblin")} wolves_moved=${moved("wolf")}`);
  const dawn = resultOf(await world.call("host", "world_step", { minutes: 600 }));
  const opensAtDawn = list(resultOf(await world.call("host", "world_snapshot")), "doors")
    .find((door) => isRecord(door) && door.id === "west_gate");
  check("next dawn returns to the spring gate schedule", dawn.clock === "Day 2 06:00"
    && dawn.season === "spring" && isRecord(opensAtDawn) && opensAtDawn.lock === "unlocked" && opensAtDawn.open === true,
  `clock=${dawn.clock} season=${dawn.season}`);

  try {
    await proveSpire(world);
    check("The Sunken Spire opens after its seal is broken", true, "western breach, tower ledge, stair, seal, mana, and crystals");
  } catch (error) {
    check("The Sunken Spire opens after its seal is broken", false, String(error));
  }

  try {
    await proveFarms(world);
    check("The farms grow grain and ship it to Stonebridge", true, "seed, water, maturation, harvest, ferry, and silver");
  } catch (error) {
    check("The farms grow grain and ship it to Stonebridge", false, String(error));
  }

  try {
    await proveEconomy(world);
    check("guild delivery, service confirmation, and processing conserve goods and silver", true, "escrow, payout, collection, tools, and light stones");
  } catch (error) {
    check("guild delivery, service confirmation, and processing conserve goods and silver", false, String(error));
  }

  try {
    await proveTraces(world);
    check("local traces persist and weather erodes them", true, "footprints, blood, oil, observation, and decay");
  } catch (error) {
    check("local traces persist and weather erodes them", false, String(error));
  }

  try {
    await proveMagic(world);
    check("magic observes suppression, concentration, healing, fuel, and expiry", true, "mana, pulses, pending spells, wounds, fire, and barriers");
  } catch (error) {
    check("magic observes suppression, concentration, healing, fuel, and expiry", false, String(error));
  }

  try {
    await proveWindows(world);
    check("window shutters control real sight openings", true, "open and closed sightlines, solid sills");
  } catch (error) {
    check("window shutters control real sight openings", false, String(error));
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  world.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

const scenario = process.argv[2];
if (scenario === undefined) {
  await main();
} else {
  const scenarios = new Map([
    ["interiors", proveInteriors],
    ["windows", proveWindows],
    ["perception", provePerception],
    ["survival", proveSurvival],
    ["farms", proveFarms],
    ["spire", proveSpire],
    ["whisperwood", proveWhisperwood],
    ["anvil", proveAnvilValley],
    ["tavern", proveGranaryToTavern],
    ["economy", proveEconomy],
    ["traces", proveTraces],
    ["magic", proveMagic],
  ]);
  const proof = scenarios.get(scenario);
  assert.ok(proof, `unknown scenario ${scenario}`);
  const world = new WorldClient();
  await world.connect();
  try {
    await proof(world);
    console.log(`PASS ${scenario}`);
  } finally {
    world.close();
  }
}
