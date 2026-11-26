extends RefCounted

const BodyState = preload("res://body_state.gd")
const WEAPONS := {"steel_sword": 2.2, "shortsword": 2.0, "hand_axe": 1.8, "shortbow": 35.0}

var world

func _init(world_root) -> void:
	world = world_root

func creature(id: String):
	return world.agents_by_id.get(id, world.find_wild(id))

func attack_target_error(actor, action: Dictionary) -> Dictionary:
	var target = creature(action.target_id)
	var body: Node3D
	var point: Vector3
	if target != null:
		if target.id == actor.id or target.dead:
			return world.fail("rejected", "choose another living creature")
		body = target.body
		point = target.pos + Vector3.UP * world.eye(target)
	else:
		for barrier in world.barriers:
			if str(barrier.body.name) == action.target_id and barrier.body.visible:
				body = barrier.body
				point = body.global_position
				break
		if body == null:
			return world.fail("bad_args", "choose a visible creature or barrier")
	if not world.can_see(actor, point, body, float(WEAPONS[action.weapon]), false):
		return world.fail("blocked", "the target is out of weapon reach or behind cover")
	return {}

func attack(actor, args: Dictionary) -> Dictionary:
	var weapon := str(args.get("weapon", ""))
	if not WEAPONS.has(weapon) or world.qty_of(actor.items, weapon) < 1:
		return world.fail("no_item", "equip an owned sword, hand axe, or shortbow")
	if actor.stamina < 10.0:
		return world.fail("rejected", "you are too exhausted to attack")
	var action := {"kind": "attack", "target_id": str(args.get("target_id", "")), "weapon": weapon, "duration_seconds": 4 if weapon == "shortbow" else 2}
	var invalid := attack_target_error(actor, action)
	if not invalid.is_empty():
		return invalid
	if weapon == "shortbow" and not world.take_stack(actor, "arrow", 1):
		return world.fail("no_item", "a bow shot consumes one arrow")
	actor.stamina -= 6.0
	world.watch_note(actor, "Aiming" if weapon == "shortbow" else "Striking", Color(1.0, 0.6, 0.4))
	return world.start_action(actor, 1, action)

func finish_attack(actor, action: Dictionary) -> Dictionary:
	var invalid := attack_target_error(actor, action)
	if not invalid.is_empty():
		return {"applied": false, "error": invalid.error}
	var target = creature(action.target_id)
	if target == null:
		for barrier in world.barriers:
			if str(barrier.body.name) != action.target_id:
				continue
			var integrity := maxi(0, int(barrier.body.get_meta("mana_integrity")) - 8)
			barrier.body.set_meta("mana_integrity", integrity)
			if integrity == 0:
				barrier.body.hide()
				barrier.body.collision_layer = 0
				barrier.nav = false
				world.navigation_dirty = true
			return {"applied": true, "target_id": action.target_id, "integrity": integrity}
	var armored: bool = world.qty_of(target.items, "chain_shirt") > 0 or world.qty_of(target.items, "leather_armor") > 0
	BodyState.bleed(target, 2.0 if armored else 8.0)
	world.leave_trace("blood", target.pos)
	world.emit_noise(target.pos, 20.0, "A weapon strikes flesh.")
	world.civic_rules.observe_offense(actor, "attacking a creature")
	if not target.wild:
		world.push_event(target, {"type": "attack", "from": actor.id, "weapon": action.weapon, "injuries": target.injuries.duplicate()})
	return {"applied": true, "target_id": target.id, "injuries": target.injuries.duplicate()}

func utility_error(actor, action: Dictionary) -> Dictionary:
	var target := str(action.target)
	if action.spell == "derust":
		var door: Dictionary = world.doors.get(target, {})
		if door.is_empty() or door.material != "iron" or float(door.rust) <= 0.0:
			return world.fail("rejected", "choose a rusted iron door")
		if not world.can_see(actor, door.body.global_position, door.body, 3.5, false):
			return world.fail("blocked", "the iron surface is out of reach or behind cover")
		if action.mana_spend < 3:
			return world.fail("mana", "rust removal needs at least three mana")
	if action.spell == "stone_mend":
		var fixture: Dictionary = world.fixtures.get(target, {})
		if fixture.is_empty() or not fixture.has("integrity") or fixture.integrity >= 1.0:
			return world.fail("rejected", "choose cracked masonry with material remaining")
		var inaccessible: Dictionary = world.fixture_access_error(actor, fixture)
		if not inaccessible.is_empty():
			return inaccessible
		if action.mana_spend < 6 or world.qty_of(actor.items, "stone_fragment") < 1:
			return world.fail("no_item", "stone mending needs six mana and one salvaged stone fragment")
	return {}

func barrier_pose(actor, action: Dictionary) -> Transform3D:
	var direction := Vector3(cos(float(action.cast_yaw)), 0, sin(float(action.cast_yaw)))
	var directions := {"north": Vector3.FORWARD, "south": Vector3.BACK, "east": Vector3.RIGHT, "west": Vector3.LEFT}
	direction = directions.get(str(action.target), direction)
	return Transform3D(Basis.looking_at(direction), actor.pos + direction * 1.6 + Vector3.UP)

func barrier_error(actor, action: Dictionary) -> Dictionary:
	if str(action.target) not in ["", "front", "north", "south", "east", "west"]:
		return world.fail("bad_args", "place a barrier in front or toward a cardinal direction")
	var pose := barrier_pose(actor, action)
	if not world.can_see(actor, pose.origin, null, 3.0, false):
		return world.fail("blocked", "there is no clear line to the barrier site")
	var shape := BoxShape3D.new()
	shape.size = Vector3(1.2, 1.9, 0.3)
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.transform = pose
	query.collision_mask = world.MOVE_MASK
	query.exclude = [actor.body.get_rid()]
	if not world.space().intersect_shape(query, 1).is_empty():
		return world.fail("blocked", "a barrier needs unoccupied space")
	return {}

func finish_utility(actor, action: Dictionary) -> Dictionary:
	if action.spell == "derust":
		var door: Dictionary = world.doors[action.target]
		door.rust = maxf(0.0, float(door.rust) - float(action.mana_spend) * 0.1)
		return {"spell": action.spell, "applied": true, "target": action.target, "rust": door.rust}
	var fixture: Dictionary = world.fixtures[action.target]
	world.take_stack(actor, "stone_fragment", 1)
	fixture.integrity = minf(1.0, float(fixture.integrity) + float(action.mana_spend) * 0.025)
	for child in fixture.body.get_children():
		if child is MeshInstance3D:
			child.material_override = world.flat_mat(world.COL.stone.lightened(float(fixture.integrity) * 0.12))
	return {"spell": action.spell, "applied": true, "target": action.target, "integrity": fixture.integrity}
