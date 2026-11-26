extends SceneTree

const SHOTS := [
	["town", Vector3(18.0, 12.8, 24.0), Vector3(-1.9, 2.6, -10.0), 58.0],
	["bridge", Vector3(-4.5, 4.7, 0.4), Vector3(9.8, 2.9, 6.7), 65.0],
	["quay", Vector3(6.38, 2.0, 13.1), Vector3(-1.0, 2.0, -0.2), 71.0],
	["inn", Vector3(-8.75, 3.13, -5.0), Vector3(-15.5, 2.85, -5.2), 69.0],
	["old-bath", Vector3(77.0, 19.63, -70.8), Vector3(77.6, 19.62, -80.7), 65.0],
	["trail", Vector3(100.45, 37.69, -106.7), Vector3(101.8, 36.7, -116.9), 70.0],
	["spring", Vector3(104.42, 36.86, -119.7), Vector3(104.2, 36.05, -145.0), 59.0],
]

func _initialize() -> void:
	call_deferred("capture")

func freeze() -> void:
	for frame in 8:
		await process_frame
	await RenderingServer.frame_post_draw

func save_shot(shot: String) -> bool:
	var frame := root.get_texture().get_image()
	return frame != null and frame.save_png("res://captures/" + shot + ".png") == OK

func capture() -> void:
	var scene = load("res://scenes/etwas.tscn").instantiate()
	root.add_child(scene)
	var player: CharacterBody3D = scene.get_node("Explorer")
	player.get_node("Overlay").hide()
	await physics_frame
	await physics_frame
	await physics_frame
	for person in scene.agents:
		person.nameplate.hide()
	var camera := Camera3D.new()
	scene.add_child(camera)
	camera.current = true
	camera.near = 0.06
	camera.far = 420.0
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://captures"))
	for shot in SHOTS:
		camera.fov = shot[3]
		camera.look_at_from_position(shot[1], shot[2])
		await freeze()
		if not save_shot(shot[0]):
			push_error("Screenshot failed for " + shot[0])
			quit(1)
			return
	camera.current = false
	player.camera.current = true
	player.position = Vector3(104.40, 35.13, -120.00)
	await physics_frame
	await physics_frame
	player.interact()
	if not player.seated:
		push_error("Pool seat did not engage")
		quit(1)
		return
	await create_timer(1.5).timeout
	await freeze()
	if not save_shot("spring-seated"):
		push_error("Could not capture the seated view")
		quit(1)
		return
	player.interact()
	if player.seated:
		push_error("Pool seat did not release")
		quit(1)
		return
	quit()
