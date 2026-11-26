extends RefCounted

const BodyState = preload("res://body_state.gd")
var world

func _init(world_root) -> void:
	world = world_root

func advance_beast(beast, target: Vector3, distance: float) -> void:
	if beast.pos.distance_to(target) < 1.2:
		return
	var changed: bool = not beast.has("route_target") or beast.route_target.distance_to(target) > 5.0
	if changed or not beast.has("route"):
		var start := NavigationServer3D.map_get_closest_point(world.map_rid, beast.pos)
		var goal := NavigationServer3D.map_get_closest_point(world.map_rid, target)
		beast["route"] = world.nav_path(start, goal, true)
		beast.route = world.avoid_blocker_on_path(beast, start, goal, beast.route)
		beast["route_index"] = 1
		beast["route_target"] = target
	if beast.route.size() < 2:
		return
	var speed_factor: float = world.speed_mpm(beast, "walk") / 84.0
	var step: Dictionary = world.walk_path(beast, beast.route, beast.route_index, distance * speed_factor)
	var prior: Vector3 = beast.pos
	world.set_pos(beast, step.pos)
	beast.route_index = step.index
	if step.walked > 0.02:
		beast.visual.rotation.y = atan2(prior.x - beast.pos.x, prior.z - beast.pos.z)
	if step.blocked != null or step.index >= beast.route.size():
		beast.erase("route")

func seen(beast, other, reach: float) -> bool:
	return world.can_see(beast, other.pos + Vector3.UP * world.eye(other), other.body, reach, false)

func step(minutes: int) -> void:
	var hour: int = world.clock_hour()
	var night := hour >= 20 or hour < 5
	var winter: bool = world.season() == "winter"
	for beast in world.wildlife:
		var weather: String = world.local_weather(beast.pos)
		var sheltered: bool = beast.pos.distance_to(beast.home) < 12.0 and beast.kind != "sheep"
		BodyState.step(beast, minutes, world.ambient_temperature(weather, hour) + 8.0, false, sheltered, false, true, not night)
		if beast.dead or beast.unconscious:
			beast.visual.rotation.z = PI * 0.5
			continue
		if beast.kind == "sheep":
			world.step_sheep(beast, minutes)
			continue
		if beast.kind == "goblin" and int(beast.get("raid_until", 0)) > world.minute:
			advance_beast(beast, beast.home, 6.0 * minutes)
			continue
		var hungry: bool = beast.hunger >= 30.0
		if not night or not hungry:
			advance_beast(beast, beast.home, 5.0 * minutes)
			continue
		if beast.kind == "wolf":
			step_wolf(beast, minutes, winter)
		elif beast.kind == "goblin":
			step_goblin(beast, minutes, winter)

func step_wolf(beast, minutes: int, winter: bool) -> void:
	var prey = null
	var nearest := 250.0 if winter else 160.0
	for sheep in world.wildlife:
		if sheep.kind != "sheep" or sheep.dead or sheep.unconscious:
			continue
		var distance: float = beast.pos.distance_to(sheep.pos)
		if distance < nearest and seen(beast, sheep, nearest):
			prey = sheep
			nearest = distance
	var target := Vector3(-272, 3, 181.8) if prey == null else prey.pos as Vector3
	advance_beast(beast, target, 8.0 * minutes)
	if prey != null and world.patient_in_reach(beast, prey, 1.8):
		BodyState.bleed(prey, 12.0)
		beast.hunger = 0.0
		beast.thirst = 0.0
		world.leave_trace("blood", prey.pos)
		world.emit_noise(prey.pos, 65.0, "A sheep cries out as a wolf bites it.")
	for person in world.agents:
		if not person.dead and world.patient_in_reach(beast, person, 1.6):
			BodyState.injure(person, "lacerated")
			BodyState.injure(person, "bleeding")
			world.push_event(person, {"type": "attack", "from": beast.id, "text": "A wolf bites you."})

func step_goblin(beast, minutes: int, winter: bool) -> void:
	var wagon: Dictionary = {}
	var nearest := 250.0 if winter else 160.0
	for cart in world.carts.values():
		if world.qty_of(cart.items, "grain_sack") == 0 and world.qty_of(cart.items, "iron_ore") == 0:
			continue
		var point: Vector3 = cart.body.global_position
		var distance: float = beast.pos.distance_to(point)
		if distance < nearest and world.can_see(beast, point, cart.body, nearest, false):
			wagon = cart
			nearest = distance
	var target := Vector3(-480, world.ground_y(-480, -220), -220) if wagon.is_empty() else wagon.body.global_position as Vector3
	if not wagon.is_empty():
		for guard in world.agents:
			if guard.dead or guard.unconscious or guard.pos.distance_to(target) > 12.0:
				continue
			if seen(beast, guard, 170.0):
				advance_beast(beast, beast.home, 6.0 * minutes)
				return
	advance_beast(beast, target, 6.0 * minutes)
	if wagon.is_empty() or beast.pos.distance_to(target) > 3.0 or not world.can_see(beast, target, wagon.body, 4.0, false):
		return
	var item_id := "grain_sack" if world.qty_of(wagon.items, "grain_sack") > 0 else "iron_ore"
	var item: Dictionary = world.item_stack(wagon.items, item_id)
	if world.mass_of(beast) + float(item.kg) > 45.0:
		advance_beast(beast, beast.home, 6.0 * minutes)
		return
	world.move_inventory_stack(wagon.items, beast.items, item_id, 1)
	beast["raid_until"] = world.minute + 1440
	world.emit_noise(target, 20.0, "Cargo is dragged from a cart.")
	world.leave_trace("footprints", beast.pos)
