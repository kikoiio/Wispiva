extends "res://scenes/etwas_world.gd"

const SPRING := preload("res://assets/etwas/spring.gdshader")
const STEAM := preload("res://assets/etwas/steam.gdshader")
const GRASS := preload("res://assets/etwas/grass.gdshader")
const SHELF := preload("res://assets/etwas/shelf.gdshader")
const FOLIAGE := preload("res://assets/etwas/foliage.gdshader")
const WEATHERED_STONE := preload("res://assets/etwas/weathered_stone.gdshader")
const RIVER := preload("res://assets/etwas/river.gdshader")

@onready var explorer: CharacterBody3D = $Explorer
@onready var sources: Node3D = $Steam

var steam: Array[Dictionary] = []
var steam_age := 0.0
var stone_materials := {}


func _ready() -> void:
	get_window().title = "埃托维斯河谷 · Etwas"
	$Sun.look_at_from_position(Vector3(-0.58, 0.39, -0.70), Vector3.ZERO)
	dress_meshes($EtwasLandscape)
	dress_meshes($EtwasValley)
	dress_meshes($EtwasTown)
	if DisplayServer.get_name() != "headless":
		light_room(Vector3(-12.8, 3.45, -5.75), 4.4, 1.05)
		light_room(Vector3(13.0, 4.65, 8.1), 3.9, 0.82)
		light_room(Vector3(13.5, 4.46, -9.4), 3.45, 0.87)
		make_steam(Vector3(105.24, 34.9, -123.15), 1.24, 0.76, 0.46, 11)
		make_steam(Vector3(7.0, 0.11, 17.6), 2.65, 3.6, 1.35, 6)
		make_steam(Vector3(4.25, 0.05, -12.0), 1.0, 3.2, 0.72, 4)
		make_steam(Vector3(14.55, 3.24, 8.0), 0.62, 0.57, 0.77, 5)
	await super._ready()
	if watching:
		finish_doors()


func dress_meshes(root: Node) -> void:
	for child in root.find_children("*", "MeshInstance3D", true, false):
		var surface := child as MeshInstance3D
		var id := str(surface.name)
		var shader: Shader
		if id == "SpringSurface":
			shader = SPRING
		elif id == "Alpine grass blades":
			shader = GRASS
		elif id in ["WALK_SpringShelf", "FLOOR_ValleyHillside"]:
			shader = SHELF
		elif id.begins_with("FOLIAGE_"):
			shader = FOLIAGE
		elif id.begins_with("PIGMENT_"):
			shader = SHELF
		elif id.begins_with("WATER_"):
			shader = RIVER
		elif id.begins_with("OBSTACLE_Schist") or id.begins_with("HIT_SlopeSchist") or id.begins_with("Mineral rim") or id == "HIT_SeatLedge" or id.begins_with("Portal") or id.begins_with("Quarried wall") or id.begins_with("Flagstone"):
			weather_stone(surface)
		if shader == null:
			continue
		var material := ShaderMaterial.new()
		material.shader = shader
		surface.material_override = material
		if shader in [SPRING, RIVER, GRASS]:
			surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func weather_stone(mesh_node: MeshInstance3D) -> void:
	for surface in mesh_node.mesh.get_surface_count():
		var original := mesh_node.mesh.surface_get_material(surface) as StandardMaterial3D
		if original == null:
			continue
		var id := original.get_instance_id()
		if not stone_materials.has(id):
			var material := ShaderMaterial.new()
			material.shader = WEATHERED_STONE
			material.set_shader_parameter("pigment", original.albedo_color)
			stone_materials[id] = material
		mesh_node.set_surface_override_material(surface, stone_materials[id])


func light_room(center: Vector3, reach: float, energy: float) -> void:
	var lamp := OmniLight3D.new()
	lamp.position = center
	lamp.light_color = Color(1.0, 0.72, 0.43)
	lamp.light_energy = energy
	lamp.omni_range = reach
	lamp.omni_attenuation = 1.45
	add_child(lamp)


func finish_doors() -> void:
	var straps := flat_mat(Color(0.13, 0.12, 0.115))
	straps.metallic = 0.56
	var latch := flat_mat(Color(0.37, 0.25, 0.13))
	latch.metallic = 0.68
	for door in doors.values():
		var body: StaticBody3D = door.body
		var size: Vector3 = door.solid.aabb.size
		for side in [-1.0, 1.0]:
			var x: float = side * (size.x * 0.5 + 0.01)
			for y in [-0.68, 0.68]:
				visual_box(body, straps, Vector3(x, y, 0.31), Vector3(0.028, 0.084, 1.03))
				visual_box(body, latch, Vector3(x + side * 0.018, y, 0.73), Vector3(0.034, 0.115, 0.10))
			visual_box(body, straps, Vector3(x, -0.06, -0.60), Vector3(0.028, 0.22, 0.13))
			visual_box(body, latch, Vector3(x + side * 0.045, -0.047, -0.60), Vector3(0.11, 0.073, 0.075))


func make_steam(origin: Vector3, width: float, length: float, rise: float, count: int) -> void:
	var material := ShaderMaterial.new()
	material.shader = STEAM
	for index in count:
		var quad := QuadMesh.new()
		quad.size = Vector2(width * (1.27 + float(index % 3) * 0.23), rise * (0.83 + float(index % 2) * 0.24))
		quad.material = material
		var plume := MeshInstance3D.new()
		plume.mesh = quad
		plume.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		sources.add_child(plume)
		steam.append({"node": plume, "origin": origin, "width": width, "length": length, "rise": rise, "index": index})


func _process(delta: float) -> void:
	super._process(delta)
	steam_age += delta
	for source in steam:
		var index: int = source.index
		var phase := fposmod(steam_age * 0.10 + index * 0.38197, 1.0)
		var angle := index * 2.39996
		var plume: MeshInstance3D = source.node
		plume.position = source.origin + Vector3(
			cos(angle) * float(source.width) + phase * 0.65,
			0.06 + phase * float(source.rise),
			sin(angle) * float(source.length) - phase * 0.52
		)
		plume.set_instance_shader_parameter("opacity", sin(phase * PI) * 0.27)


func watch_setup() -> void:
	watching = DisplayServer.get_name() != "headless"
	if not watching:
		return
	spec_cam = explorer.get_node("Camera")
	spec_auto = false
	for person in agents:
		var nameplate: Label3D = person.nameplate
		nameplate.visibility_range_end = 14.0
		nameplate.visibility_range_end_margin = 3.5
		nameplate.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		nameplate.visible = not OS.get_cmdline_user_args().has("--empty")


func watch_step(delta: float) -> void:
	spec_now += delta
	update_actor_visuals(delta)


func _unhandled_input(_event: InputEvent) -> void:
	pass
