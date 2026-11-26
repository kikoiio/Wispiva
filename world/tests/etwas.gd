extends SceneTree

const APPROACH := Vector3(104.40, 35.05, -120.00)

var failures := 0
var world
var player
var travel_m := 0.0


func _initialize() -> void:
	call_deferred("verify")


func check(condition: bool, detail: String) -> bool:
	if not condition:
		failures += 1
		push_error(detail)
	return condition


func tool(name: String, args: Dictionary = {}, actor: String = "") -> Dictionary:
	return world.handle_line(JSON.stringify({
		"id": "etwas-acceptance",
		"role": "host" if actor.is_empty() else "agent",
		"agentId": actor,
		"tool": name,
		"args": args,
	}))


func result(name: String, args: Dictionary = {}, actor: String = "") -> Dictionary:
	var response := tool(name, args, actor)
	if check(response.ok, "%s (%s) %s failed: %s" % [name, actor, args, response.get("error", {})]):
		return response.result
	return {}


func walk_to(goal: Vector3) -> bool:
	var from: Vector3 = player.global_position
	var path: PackedVector3Array = world.nav_path(from, goal, true)
	if not check(path.size() >= 2 and path[-1].distance_to(goal) < 0.65,
		"Explorer has no route from %s to %s (path end %s)" % [from, goal, path[-1] if path.size() else "none"]):
		return false
	var prior: Vector3 = from
	for i in range(1, path.size()):
		var point := path[i]
		var still := 0
		var frames := 0
		Input.action_press("ui_up")
		while Vector2(player.position.x - point.x, player.position.z - point.z).length() > 0.15:
			player.look_toward(point + Vector3.UP * 1.63)
			await physics_frame
			var next: Vector3 = player.position
			var step := next.distance_to(prior)
			travel_m += step
			still = still + 1 if step < 0.008 else 0
			frames += 1
			prior = next
			if still > 30 or frames > 1400:
				Input.action_release("ui_up")
				return check(false, "Explorer stalled at %s while walking toward %s" % [next, point])
		Input.action_release("ui_up")
	for i in range(2):
		await physics_frame
	return check(player.position.distance_to(goal) < 0.65 and player.is_on_floor(),
		"Explorer ended at %s, expected footing near %s" % [player.position, goal])


func press_interact() -> void:
	var press := InputEventKey.new()
	press.physical_keycode = KEY_E
	press.pressed = true
	Input.parse_input_event(press)
	await process_frame
	press = InputEventKey.new()
	press.physical_keycode = KEY_E
	Input.parse_input_event(press)


func verify() -> void:
	var scene: PackedScene = load("res://scenes/etwas.tscn")
	if not check(scene != null, "The Etwas scene could not load"):
		quit(1)
		return
	world = scene.instantiate()
	root.add_child(world)
	for i in range(5):
		await physics_frame
	player = world.get_node("Explorer")
	var snapshot := result("world_snapshot")
	check(snapshot.get("agents", []).size() in range(6, 9), "The town must have six to eight residents")
	check(snapshot.get("doors", []).size() >= 3, "Three building doors must be registered")
	await verify_explorer()
	verify_residents(snapshot)
	quit(int(failures > 0))


func verify_explorer() -> void:
	var east_bank := Vector3(7.15, 2.6, 0.0)
	var bath_door := Vector3(7.1, 2.6, 8.0)
	if not await walk_to(east_bank) or not await walk_to(bath_door):
		return
	player.look_toward(Vector3(12, 3.88, 8))
	await process_frame
	await press_interact()
	if not check(world.doors.values().any(func(door): return door.open and absf(door.body.position.z - 8.0) < 0.4),
		"E did not open the bathhouse door"):
		return
	if not await walk_to(Vector3(10.7, 2.6, 8.0)):
		return
	await walk_to(Vector3(7.2, 2.6, 6.4))
	await walk_to(Vector3(6.5, 0.48, 13.0))
	await walk_to(Vector3(7.2, 2.6, 6.4))

	var trailhead := Vector3(9, 2.60, -25)
	if not await walk_to(trailhead):
		return
	travel_m = 0.0
	if not await walk_to(APPROACH):
		return
	check(travel_m > 238.0 and travel_m < 361.0,
		"The climb at walking pace must take 2–3 minutes, walked %.1f m" % travel_m)
	print("ETWAS_CLIMB %.1f m at 2 m/s" % travel_m)
	await press_interact()
	check(player.seated, "E must sit at the spring")
	for i in range(38):
		await process_frame
	check(player.seat_blend >= 0.95, "The camera must reach seated eye height")
	await press_interact()
	for i in range(38):
		await process_frame
	check(not player.seated and player.seat_blend <= 0.05, "E must return to standing")
	if not await walk_to(Vector3(77, 18.02, -77)):
		return
	if await walk_to(trailhead):
		print("PASS explorer crossed the bridge, entered the bathhouse, walked the quay stairs, visited the summit and old bath, and returned to town")


func verify_residents(snapshot: Dictionary) -> void:
	for resident in snapshot.get("agents", []):
		var actor := String(resident.id)
		var status := result("status", {}, actor)
		check(status.get("agentId") == actor, "A resident must be able to read their own status")
		result("look", {}, actor)
