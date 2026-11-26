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
	print("PASS all %d registered forest trees and the spring return have physical routes" % checked)
	world.queue_free()
	await process_frame
	quit(0)
