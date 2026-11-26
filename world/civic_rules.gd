extends RefCounted

const WATCH := ["human_garrick", "human_aldric"]
const WARDENS := ["elf_sylvar", "elf_lyra"]
const WEEK := 10080

var world
var treasury_sp := 0
var leases: Dictionary = {}
var logging_permits: Dictionary = {}
var offenses: Dictionary = {}
var custody: Dictionary = {}

func _init(world_root) -> void:
	world = world_root

func use(agent, args: Dictionary) -> Dictionary:
	var action := str(args.get("action", "status"))
	var target_id := str(args.get("target_id", ""))
	if action == "status":
		var own_leases: Array = []
		for stall in leases:
			if leases[stall].owner == agent.id and int(leases[stall].until) > world.minute:
				own_leases.append({"stall_id": stall, "until_minute": leases[stall].until})
		return world.ok({"market_weekly_sp": 2, "loaded_bridge_cart_sp": 1, "leases": own_leases, "logging_permit": logging_permits.get(agent.id, {}), "restrained": custody.has(agent.id)})
	if action == "lease_stall":
		var fixture: Dictionary = world.fixtures.get(target_id, {})
		if fixture.is_empty() or fixture.spec.kind != "stall":
			return world.fail("bad_args", "name a visible market stall")
		var inaccessible: Dictionary = world.fixture_access_error(agent, fixture)
		if not inaccessible.is_empty():
			return inaccessible
		var current: Dictionary = leases.get(target_id, {})
		if int(current.get("until", -1)) > world.minute:
			if current.owner != agent.id:
				return world.fail("busy", "another merchant has leased this stall")
			return world.ok({"stall_id": target_id, "paid_sp": 0, "until_minute": current.until})
		if world.coin_quantity(agent, "sp") < 2:
			return world.fail("no_item", "a weekly market lease costs two silver")
		world.take_stack(agent, "sp", 2)
		treasury_sp += 2
		leases[target_id] = {"owner": agent.id, "until": world.minute + WEEK}
		return world.ok({"stall_id": target_id, "paid_sp": 2, "until_minute": world.minute + WEEK})
	if action == "grant_logging":
		if agent.id not in WARDENS:
			return world.fail("forbidden", "the forest wardens issue logging permits")
		var logger = world.agents_by_id.get(target_id)
		if logger == null or not world.patient_in_reach(agent, logger, 3.0):
			return world.fail("too_far", "the logger must be beside you")
		var trees := int(args.get("quantity", 1))
		if trees < 1 or trees > 5:
			return world.fail("bad_args", "grant between one and five trees")
		logging_permits[target_id] = {"issuer": agent.id, "remaining": trees, "until_minute": world.minute + WEEK}
		world.push_event(logger, {"type": "permit", "text": "A warden grants you a logging permit.", "remaining_trees": trees, "until_minute": world.minute + WEEK})
		return world.ok(logging_permits[target_id])
	if action == "arrest" or action == "release":
		if agent.id not in WATCH and agent.id not in WARDENS:
			return world.fail("forbidden", "a watch officer or forest warden is required")
		var target = world.agents_by_id.get(target_id)
		if target == null or target.id == agent.id or not world.patient_in_reach(agent, target, 2.5):
			return world.fail("too_far", "the person must be within physical reach")
		if action == "release":
			if not custody.has(target_id):
				return world.fail("rejected", "that person is free")
			custody.erase(target_id)
			world.move_stack(target, agent, "manacles", 1)
			offenses.erase(target_id)
			world.push_event(target, {"type": "custody", "restrained": false})
			return world.ok({"target_id": target_id, "restrained": false})
		if custody.has(target_id):
			return world.ok({"target_id": target_id, "restrained": true})
		var witnessed: Dictionary = offenses.get(target_id, {}).get(agent.id, {})
		if witnessed.is_empty() or target.dead or target.unconscious:
			return world.fail("rejected", "a witnessed offense and a conscious living suspect are required")
		var town: Dictionary = world.layout.town_wall
		var p: Vector3 = target.pos
		if agent.id in WATCH and (p.x < town.x0 or p.x > town.x1 or p.z < town.z0 or p.z > town.z1):
			return world.fail("rejected", "the watch has jurisdiction inside the town walls")
		if agent.id in WARDENS and p.x <= 320.0:
			return world.fail("rejected", "the wardens have jurisdiction inside the protected forest")
		if not world.move_stack(agent, target, "manacles", 1):
			return world.fail("no_item", "you need a set of manacles")
		custody[target_id] = agent.id
		if world.pending_actions.has(target_id):
			var interrupted: Dictionary = world.pending_actions[target_id]
			world.pending_actions.erase(target_id)
			world.travel_actions.erase(target_id)
			if interrupted.kind == "unseal":
				world.doors[interrupted.door_id].rune_material.emission_enabled = false
			world.push_event(target, {"type": "action_interrupted", "action": interrupted, "reason": "restrained"})
		world.push_event(target, {"type": "custody", "restrained": true, "from": agent.id, "reason": witnessed.reason})
		return world.ok({"target_id": target_id, "restrained": true})
	return world.fail("bad_args", "use status, lease_stall, grant_logging, arrest, or release")

func market_error(seller) -> Dictionary:
	var nearest: Dictionary = {}
	var distance := 3.5
	for fixture in world.fixtures.values():
		if fixture.spec.kind != "stall" or seller.pos.distance_to(fixture.body.position) >= distance:
			continue
		nearest = fixture
		distance = seller.pos.distance_to(fixture.body.position)
	if not nearest.is_empty():
		var lease: Dictionary = leases.get(nearest.spec.id, {})
		if lease.get("owner", "") != seller.id or int(lease.get("until", -1)) <= world.minute:
			return world.fail("rejected", "lease this market stall before selling from it")
	return {}

func note_logging(logger, at: Vector3) -> void:
	if at.x <= 320.0:
		return
	var permit: Dictionary = logging_permits.get(logger.id, {})
	if int(permit.get("until_minute", -1)) > world.minute and int(permit.get("remaining", 0)) > 0:
		permit.remaining -= 1
		return
	observe_offense(logger, "unpermitted logging")

func note_taking(actor, container: Dictionary) -> void:
	var owners: Array = container.get("owners", [])
	if not owners.is_empty() and actor.id not in owners:
		observe_offense(actor, "taking goods from someone else's store")

func observe_offense(actor, reason: String) -> void:
	for witness in world.agents:
		if witness.id == actor.id or witness.dead or witness.unconscious:
			continue
		if not world.can_see(witness, actor.pos + Vector3.UP * world.eye(actor), actor.body, world.view_range(witness), world.flat_dist(witness.pos, actor.pos) > 2.0):
			continue
		world.push_event(witness, {"type": "witnessed", "from": actor.id, "text": reason, "minute": world.minute})
		if witness.id in WATCH or witness.id in WARDENS:
			if not offenses.has(actor.id):
				offenses[actor.id] = {}
			offenses[actor.id][witness.id] = {"reason": reason, "minute": world.minute}

func bridge_crossing_distance(points: PackedVector3Array) -> float:
	var distance := 0.0
	for index in range(1, points.size()):
		var a := points[index - 1]
		var b := points[index]
		if (a.x < -45.0 and b.x >= -45.0) or (a.x > -45.0 and b.x <= -45.0):
			var crossing := a.lerp(b, (-45.0 - a.x) / (b.x - a.x))
			if absf(crossing.z) < 5.0 and absf(crossing.y) < 2.0:
				return distance + a.distance_to(crossing)
		distance += a.distance_to(b)
	return -1.0
