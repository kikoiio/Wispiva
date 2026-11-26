extends SceneTree

func _initialize() -> void:
	call_deferred("verify_navigation")

func clear_route(world, actor, destination: Vector3) -> bool:
	var start := NavigationServer3D.map_get_closest_point(world.map_rid, actor.pos)
	var goal := NavigationServer3D.map_get_closest_point(world.map_rid, destination)
	if goal.distance_to(destination) > 3.0:
		return false
	for optimized in [true, false]:
		var path: PackedVector3Array = world.nav_path(start, goal, optimized)
		if path.size() >= 2 and path[-1].distance_to(goal) < 0.1 and world.walk_path(actor, path).blocked == null:
			return true
	return false

func verify_navigation() -> void:
	var world = load("res://main.tscn").instantiate()
	root.add_child(world)
	await physics_frame
	await physics_frame
	await physics_frame
	for other in world.actors():
		other.body.collision_layer = 0
	var actor = world.agents_by_id["human_elena"]
	var checked := 0
	for id in world.fixtures:
		if not str(id).begins_with("tree_"):
			continue
		var fixture: Dictionary = world.fixtures[id]
		var reachable := false
		world.set_pos(actor, Vector3(340, 12, 20))
		for point in fixture.spec.approaches:
			if clear_route(world, actor, world.v3(point)):
				reachable = true
				break
		if not reachable:
			push_error("Registered forest resource has no physically clear route: " + str(id))
			quit(1)
			return
		checked += 1
	world.set_pos(actor, Vector3(780, 24, -181))
	if not clear_route(world, actor, Vector3(290, world.ground_y(290, 20), 20)):
		push_error("The spring return route collides with the timber stand")
		quit(1)
		return
	world.set_pos(actor, Vector3(-178, 2, 15))
	var looked: Dictionary = world.handle_line(JSON.stringify({"role": "agent", "agentId": actor.id, "tool": "look", "args": {"focus": "traveler_kael"}}))
	var scholar_seen := false
	for person in looked.result.visible_agents:
		if person.id == "traveler_kael":
			scholar_seen = true
		if person.id == "demon_kael":
			push_error("Observation exposed a hidden identity")
			quit(1)
			return
	if not scholar_seen:
		push_error("The public scholar identifier must resolve to the visible person")
		quit(1)
		return
	for trial in [["elf_sylvar", "longbow", "wolf_1"], ["elf_sylvar", "elven_blade", "wolf_1"], ["elf_lyra", "bow", "wolf_2"], ["dwarf_torin", "steel_axe", "wolf_3"], ["demon_kael", "dark_dagger", "wolf_4"]]:
		var fighter = world.agents_by_id[trial[0]]
		var target = world.find_wild(trial[2])
		world.set_pos(fighter, Vector3(340, 12, 20))
		world.set_pos(target, Vector3(341, 12, 20))
		var arrows: int = world.qty_of(fighter.items, "arrow")
		var attack: Dictionary = world.dispatch("agent", fighter.id, "attack", {"target_id": target.id, "weapon": trial[1]})
		if not attack.ok or not attack.result.pending:
			push_error("Starting specialist weapon is unusable: " + str(trial))
			quit(1)
			return
		world.advance(0.1)
		if "bleeding" not in target.injuries or (trial[1] in ["bow", "longbow"] and world.qty_of(fighter.items, "arrow") != arrows - 1):
			push_error("Specialist weapon must cause a real impact and consume its ammunition")
			quit(1)
			return
	var smith = world.agents_by_id.dwarf_torin
	world.set_pos(smith, Vector3(113.5, 0, 36.5))
	world.tool_inject({"kind": "item", "place": smith.id, "item_id": "iron_bar", "quantity": 1})
	world.dispatch("agent", smith.id, "transfer_item", {"action": "pick", "item_id": "iron_bar", "quantity": 1})
	var forged: Dictionary = world.dispatch("agent", smith.id, "work_craft", {"station_id": "forge_anvil", "recipe_or_task": "forge_nails", "minutes": 15})
	if not forged.ok or not forged.result.pending:
		push_error("Torin's master hammer cannot perform an ordinary forging recipe")
		quit(1)
		return
	world.advance(15.0)
	if world.qty_of(smith.items, "iron_nails") != 20 or world.qty_of(smith.items, "iron_bar") != 0 or world.tool_uses(world.item_stack(smith.items, "forging_hammer"))[0] != 119:
		push_error("Forging must consume iron and master-hammer durability and produce nails")
		quit(1)
		return
	var driver = world.agents_by_id.human_owen
	world.set_pos(driver, Vector3(-180, 2, 15))
	driver.cart_id = "oakford_cart"
	var wagon: Dictionary = world.carts.oakford_cart
	wagon.body.global_transform = Transform3D(Basis.looking_at(Vector3.LEFT), Vector3(-177.45, 2.65, 15))
	var start := NavigationServer3D.map_get_closest_point(world.cart_map_rid, driver.pos)
	var goal := NavigationServer3D.map_get_closest_point(world.cart_map_rid, Vector3(-292, 3, 152))
	var cart_path: PackedVector3Array = world.nav_path(start, goal, true, true)
	var journey: Dictionary = world.walk_path(driver, cart_path)
	if cart_path.size() < 2 or journey.blocked != null or journey.pos.distance_to(goal) > 0.1:
		push_error("The Miller cart road must avoid the steep shoulder: " + str(journey.blocked))
		quit(1)
		return
	world.set_pos(driver, Vector3(140, 2, 368))
	wagon.body.global_transform = Transform3D(Basis.looking_at(Vector3.FORWARD), Vector3(140, 2.65, 370.55))
	start = NavigationServer3D.map_get_closest_point(world.cart_map_rid, driver.pos)
	goal = NavigationServer3D.map_get_closest_point(world.cart_map_rid, Vector3(50, 0, 0))
	cart_path = world.nav_path(start, goal, true, true)
	journey = world.walk_path(driver, cart_path)
	if cart_path.size() < 2 or journey.blocked != null or journey.pos.distance_to(goal) > 0.1:
		push_error("The Oakford cart must clear the town gate and its turn: " + str(journey.blocked))
		quit(1)
		return
	print("PASS all %d registered forest trees and the spring return have physical routes" % checked)
	print("PASS disguised public targets resolve through the ordinary observation interface")
	print("PASS starting specialist weapons and the master forging hammer are usable")
	print("PASS carts follow graded roads and clear the town gate without striking its jamb")
	world.queue_free()
	await process_frame
	quit(0)
