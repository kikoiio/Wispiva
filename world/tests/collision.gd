extends SceneTree

class CollisionWorld extends "res://world.gd":
	func _ready() -> void:
		pass

	func _process(_delta: float) -> void:
		pass

	func ground_y(_x: float, z: float) -> float:
		return z * 0.75

func _initialize() -> void:
	call_deferred("verify_collision")

func verify_collision() -> void:
	var world := CollisionWorld.new()
	root.add_child(world)
	world.layout = {"platforms": []}
	var body := StaticBody3D.new()
	world.add_child(body)
	var actor := {"id": "walker", "pos": Vector3.ZERO, "height": 1.75, "radius": 0.35, "body": body, "cart_id": ""}
	world.agents = [actor]
	world.add_solid("late_obstacle", Vector3(49, 0.9, 0), Vector3(0.2, 1.8, 2), "wood", true, null, world.L_WORLD, Color.WHITE)
	await physics_frame
	await physics_frame
	var path := PackedVector3Array([Vector3.ZERO, Vector3(50, 0, 0)])
	var preview: Dictionary = world.walk_path(actor, path)
	if preview.blocked == null or preview.blocked.id != "late_obstacle":
		push_error("A long path preview missed an obstacle near its endpoint")
		quit(1)
		return
	var step: Dictionary
	for _index in range(6):
		step = world.walk_path(actor, path, 1, 10.0)
		world.set_pos(actor, step.pos)
		if step.blocked != null:
			break
	if step.blocked == null or step.blocked.id != preview.blocked.id or step.pos.distance_to(preview.pos) > 0.05:
		push_error("Preview and time-stepped movement stopped at different contacts")
		quit(1)
		return
	print("PASS long and time-stepped paths agree on collision")
	world.add_solid("slope_obstacle", Vector3(0, 2.2, 1), Vector3(0.2, 0.8, 0.2), "wood", true, null, world.L_WORLD, Color.WHITE)
	if not world.blocked_point(0, 0):
		push_error("A sloping navigation cell missed a head-height obstacle at its edge")
		quit(1)
		return
	print("PASS sloping cells exclude obstacles across their whole height range")
	world.queue_free()
	await process_frame
	quit(0)
