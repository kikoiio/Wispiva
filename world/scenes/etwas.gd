extends "res://scenes/etwas_world.gd"

const SPRING := preload("res://assets/etwas/spring.gdshader")
const STEAM := preload("res://assets/etwas/steam.gdshader")
const GRASS := preload("res://assets/etwas/grass.gdshader")
const SHELF := preload("res://assets/etwas/shelf.gdshader")
const RIVER := preload("res://assets/etwas/river.gdshader")

@onready var explorer: CharacterBody3D = $Explorer
@onready var sources: Node3D = $Steam

var steam: Array[Dictionary] = []
var steam_age := 0.0


func _ready() -> void:
	get_window().title = "埃托维斯河谷 · Etwas"
	$Sun.look_at_from_position(Vector3(-0.58, 0.39, -0.70), Vector3.ZERO)
	dress_meshes($EtwasLandscape)
	dress_meshes($EtwasValley)
	dress_meshes($EtwasTown)
	if DisplayServer.get_name() != "headless":
		make_steam(Vector3(105.24, 34.9, -123.15), 1.24, 0.76, 0.46, 11)
		make_steam(Vector3(7.0, 0.11, 17.6), 2.65, 3.6, 1.35, 6)
		make_steam(Vector3(4.25, 0.05, -12.0), 1.0, 3.2, 0.72, 4)
	await super._ready()


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
		elif id.begins_with("WATER_"):
			shader = RIVER
		if shader == null:
			continue
		var material := ShaderMaterial.new()
		material.shader = shader
		surface.material_override = material
		if shader != SHELF:
			surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


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
