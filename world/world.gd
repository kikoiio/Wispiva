extends Node3D

const BodyState = preload("res://body_state.gd")

# Greybox basin. 1 unit = 1 m. +X east, +Y up, +Z south. Origin is the town bridge landing.

const PORT := 7777
const L_WORLD := 1
const L_DOOR := 2
const L_AGENT := 4
const L_WATER := 8
const L_PROP := 16
const L_FLOOR := 32
const L_FOLIAGE := 64
# A door shorter than this is furniture, not a way through.
const DOORWAY := 2.0
const MOVE_MASK := L_WORLD | L_DOOR | L_WATER | L_PROP | L_AGENT
const SIGHT_MASK := L_WORLD | L_DOOR | L_AGENT | L_PROP | L_FLOOR | L_FOLIAGE
# Walls, closed doors, props and floors pull the spectator camera in; people do not.
const CAM_MASK := L_WORLD | L_DOOR | L_PROP | L_FLOOR
const body_margin := 0.35
const FIXTURE_REACH := 3.5
const FERRY_WEST := Vector3(-62, 0, 480)
const FERRY_EAST := Vector3(-22, 0, 480)
const FERRY_CROSSING_MINUTES := 3
const FERRY_PASSENGERS := 6
const FERRY_CAPACITY_KG := 600.0
const CART_TARE_KG := 360.0
const CART_CAPACITY_KG := 180.0
const CART_SIZE := Vector3(1.54, 1.3, 3.1)
const CART_TRAIL_M := 2.55
const MINUTES_PER_DAY := 1440
const SEASONS := ["spring", "summer", "autumn", "winter"]
const WEATHER_STATES := ["clear", "overcast", "rain", "storm", "snow", "blizzard"]
const GRAIN_GROWTH_MINUTES := 15 * MINUTES_PER_DAY
const RECIPES := {
	"light_campfire": {"need": {"timber": 1}, "out": {}, "minutes": 4},
	"lift_spire_crystal": {"need": {}, "out": {"spire_crystal": 1}, "minutes": 6},
	"herd_sheep": {"need": {}, "out": {}, "minutes": 5, "tool": "sheep_crook"},
	"pick_apples": {"need": {}, "out": {"apple": 4}, "minutes": 8},
	"sow_grain": {"need": {"seed_sack": 1, "spring_water": 1}, "out": {}, "minutes": 20},
	"harvest_grain": {"need": {}, "out": {"grain_sack": 2, "seed_sack": 1}, "minutes": 30},
	"draw_water": {"need": {}, "out": {"spring_water": 1}, "minutes": 2},
	"gather_herbs": {"need": {}, "out": {"forest_herbs": 2}, "minutes": 5},
	"cut_timber": {"need": {}, "out": {"timber": 2}, "minutes": 15, "tool": "hand_axe"},
	"burn_charcoal": {"need": {"timber": 2}, "out": {"charcoal": 1}, "minutes": 50},
	"herbal_tonic": {"need": {"spring_water": 1, "forest_herbs": 2}, "out": {"herbal_tonic": 1}, "minutes": 12},
	"bread": {"need": {"grain_sack": 1}, "out": {"bread": 4}, "minutes": 20},
	"iron_bar": {"need": {"iron_ore": 1, "charcoal": 1}, "out": {"iron_bar": 1}, "minutes": 25},
	"forge_pickaxe": {"need": {"iron_bar": 1, "timber": 1}, "out": {"iron_pickaxe": 1}, "minutes": 30, "tool": "smith_hammer"},
	"cut_light_stone": {"need": {"raw_mana_crystal": 1}, "out": {"lamp_stone": 1}, "minutes": 15, "tool": "appraisal_loupe"},
	"bandage": {"need": {"linen": 1}, "out": {"bandage": 2}, "minutes": 10},
	"mine_iron": {"need": {}, "out": {"iron_ore": 1}, "minutes": 12, "tool": "iron_pickaxe"},
	"mine_crystal": {"need": {}, "out": {"raw_mana_crystal": 1}, "minutes": 18, "tool": "iron_pickaxe"},
	"clear_rubble": {"need": {"timber_brace": 1}, "out": {}, "minutes": 15, "tool": "iron_pickaxe"},
}
const OUTPUT_ITEMS := {
	"winter_coat": ["winter coat", 1.4],
	"iron_pickaxe": ["iron pickaxe", 3.8],
	"lamp_stone": ["lamp-grade light stone", 0.5],
	"timber_brace": ["timber brace", 5.0],
	"oil_flask": ["lamp oil flask", 0.5],
	"spire_crystal": ["high-purity spire crystal", 0.7],
	"apple": ["apple", 0.18],
	"grain_sack": ["grain sack", 20.0],
	"seed_sack": ["seed sack", 8.0],
	"spring_water": ["spring water", 1.0],
	"forest_herbs": ["forest herbs", 0.2],
	"timber": ["cut timber", 5.0],
	"charcoal": ["charcoal sack", 4.0],
	"herbal_tonic": ["herbal tonic", 0.3],
	"bread": ["bread", 0.4],
	"iron_ore": ["iron ore", 12.0],
	"iron_bar": ["iron bar", 8.0],
	"bandage": ["bandage", 0.15],
	"raw_mana_crystal": ["raw mana crystal", 0.55],
}
const STATION_ALIASES := {"inn_pantry": "inn_oven", "smelter_stock": "smelter_furnace"}
const STOCK_RECIPES := {
	"forge_stock": "iron_bar",
	"chapel_cabinet": "bandage",
}

const COL := {
	"stone": Color(0.46, 0.45, 0.42),
	"wood": Color(0.45, 0.32, 0.18),
	"iron": Color(0.28, 0.3, 0.33),
	"water": Color(0.16, 0.38, 0.58, 0.78),
	"road": Color(0.4, 0.36, 0.3),
	"grass": Color(0.34, 0.48, 0.26),
	"cliff": Color(0.34, 0.33, 0.32),
	"roof": Color(0.4, 0.2, 0.16),
	"skin": Color(0.72, 0.55, 0.4),
}

var layout: Dictionary = {}
var cast: Dictionary = {}
var solids: Array = []
var passages: Array = []
var ladder_lowered := true
var open_passages: Array[Dictionary] = []
var doors: Dictionary = {}
var agents: Array = []
var agents_by_id: Dictionary = {}
var wildlife: Array = []
var containers: Dictionary = {}
var fixtures: Dictionary = {}
var carts: Dictionary = {}
var ferry_dock := FERRY_EAST
var ferry_trip: Dictionary = {}
var ferry_raft: StaticBody3D
var sheep_return_until := -1
var crop_plots: Dictionary = {}
var navigation_dirty := false
var pending_actions: Dictionary = {}
var travel_actions: Dictionary = {}
var piles: Array = []
var traces: Dictionary = {}
var next_trace := 1
var roads: Array = []
var river_pts: Array = []
var fine_rects: Array = []
var contracts: Array = []
var offers: Dictionary = {}
var barriers: Array = []
var regional_weather := {
	"stonebridge": "clear",
	"whisperwood": "clear",
	"anvil_valley": "clear",
	"sunken_spire": "clear",
	"south_farms": "clear",
}
var weather_rng := RandomNumberGenerator.new()
var sky_material: ProceduralSkyMaterial
var world_environment: Environment
var sun_light: DirectionalLight3D
var sky_minute := -1
var sky_weather := ""
var minute := 0
var next_contract := 1
var map_rid: RID
var region_rid: RID
var link_rids: Array[RID] = []
var nav_verts := PackedVector3Array()
var nav_polys: Array = []
var vert_index := {}
var corner_height := {}
var nav_covers: Array = []
var road_links: Array = []
var server := TCPServer.new()
var peers: Array = []
var ready_net := false
var dressed := 0
var modeled := 0

func _ready() -> void:
	weather_rng.seed = 41026
	layout = load_json("res://data/layout.json")
	cast = load_json("res://data/cast.json")
	build_scene()
	update_sky(regional_weather.stonebridge)
	watch_setup()
	print("WISPIVA_MODELS buildings=%d actors=%d" % [dressed, modeled])
	build_navigation()
	await get_tree().physics_frame
	await get_tree().physics_frame
	NavigationServer3D.map_force_update(map_rid)
	self_test_paths()
	listen()

func load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("missing " + path)
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed

func v3(value) -> Vector3:
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

func col(name: String) -> Color:
	return COL.get(name, COL.stone)

var shaded := {}

func shaded_material(kind: String, color: Color) -> Material:
	var key := kind if kind in ["water", "ground", "road", "roof", "iron"] else "%s:%.3f:%.3f:%.3f" % [kind, color.r, color.g, color.b]
	if shaded.has(key):
		return shaded[key]
	var mat: Material
	if kind == "stone":
		var stone := ShaderMaterial.new()
		stone.shader = load("res://materials/masonry.gdshader")
		stone.set_shader_parameter("tint", color)
		mat = stone
	elif kind == "cliff":
		var rock := ShaderMaterial.new()
		rock.shader = load("res://materials/rock.gdshader")
		rock.set_shader_parameter("tint", color)
		mat = rock
	elif kind == "wood":
		var wood := ShaderMaterial.new()
		wood.shader = load("res://materials/timber.gdshader")
		wood.set_shader_parameter("tint", color)
		mat = wood
	elif kind == "water":
		var water := ShaderMaterial.new()
		water.shader = load("res://materials/water.gdshader")
		mat = water
	elif kind == "ground" or kind == "road":
		var terrain := ShaderMaterial.new()
		terrain.shader = load("res://materials/terrain.gdshader")
		terrain.set_shader_parameter("road", kind == "road")
		mat = terrain
	else:
		var std := StandardMaterial3D.new()
		std.albedo_color = COL.roof if kind == "roof" else color
		std.roughness = 0.9 if kind == "roof" else 0.4
		std.metallic = 0.72 if kind == "iron" else 0.0
		if color.a < 0.99 and kind != "roof" and kind != "iron":
			std.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat = std
	shaded[key] = mat
	return mat

func add_solid(node_name: String, center: Vector3, size: Vector3, material: String, blocks: bool, door, layer: int, color: Color) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = node_name
	body.position = center
	body.collision_layer = layer
	body.collision_mask = 0
	body.set_meta("material", material)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	var mesh_node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh_node.mesh = mesh
	mesh_node.material_override = shaded_material(material, color)
	body.add_child(mesh_node)
	add_child(body)
	var record = {
		"aabb": AABB(center - size * 0.5, size),
		"nav": blocks,
		"door": door,
		"until": -1,
		"body": body,
	}
	solids.append(record)
	if door != null:
		door.solid = record
	return body

func blocks_now(solid) -> bool:
	if not solid.nav:
		return false
	if solid.door != null and solid.door.open:
		return false
	if int(solid.until) >= 0 and int(solid.until) <= minute:
		return false
	return true

func build_scene() -> void:
	var env := WorldEnvironment.new()
	var world_env := Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.23, 0.4, 0.68)
	sky_mat.sky_horizon_color = Color(0.74, 0.78, 0.8)
	sky_mat.sky_curve = 0.12
	sky_mat.ground_bottom_color = Color(0.16, 0.18, 0.16)
	sky_mat.ground_horizon_color = Color(0.5, 0.48, 0.42)
	sky_mat.sun_angle_max = 28.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	world_env.background_mode = Environment.BG_SKY
	world_env.sky = sky
	world_env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	world_env.ambient_light_energy = 0.42
	world_env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	world_env.tonemap_exposure = 1.05
	world_env.fog_enabled = true
	world_env.fog_light_color = Color(0.7, 0.76, 0.8)
	world_env.fog_density = 0.00065
	world_env.fog_aerial_perspective = 0.25
	world_env.fog_sky_affect = 0.55
	env.environment = world_env
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-46, 18, 0)
	sun.light_color = Color(1.0, 0.95, 0.86)
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 280.0
	add_child(sun)
	sky_material = sky_mat
	world_environment = world_env
	sun_light = sun
	var cam := Camera3D.new()
	cam.fov = 55.0
	cam.position = Vector3(40, 70, 150)
	cam.far = 4000
	cam.current = true
	add_child(cam)
	cam.look_at(Vector3(50, 0, 0))
	spec_cam = cam
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(2100, 2100)
	ground.mesh = plane
	ground.position = Vector3(0, -0.08, 0)
	ground.material_override = shaded_material("ground", COL.grass)
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ground)
	build_cliffs()
	build_river()
	build_bridge()
	build_roads()
	build_town_wall()
	for building in layout.buildings:
		build_building(building)
	build_span_x("guild_partition", 76.0, 94.0, -41.0, 0.0, 3.2, 1.0, "stone", [{"x0": 84.3, "x1": 85.7}])
	for door in layout.interior_doors:
		build_free_door(door)
	for platform in layout.platforms:
		var center := v3(platform.center)
		var size := v3(platform.size)
		add_solid(str(platform.id), center, size, "wood", false, null, L_FLOOR, COL.wood.darkened(0.15))
	build_mine()
	build_ruins()
	build_props()
	build_trees()
	build_plateaus()
	for agent in cast.agents:
		spawn_actor(agent, false)
	for beast in cast.wildlife:
		spawn_actor(beast, true)
	for index in range(14):
		var home := sheep_home(index)
		spawn_actor({"id": "miller_sheep_%02d" % (index + 1), "name": "Sheep", "kind": "sheep", "pos": [home.x, home.y, home.z]}, true)
		wildlife.back()["herd_index"] = index
	for box in cast.containers:
		containers[str(box.id)] = box
	register_fine_rects()

func build_cliffs() -> void:
	add_solid("cliff_west", Vector3(-950, 40, 0), Vector3(100, 80, 2100), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("cliff_east", Vector3(990, 40, 0), Vector3(80, 80, 2100), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("cliff_north", Vector3(0, 50, -960), Vector3(1900, 100, 120), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("cliff_south", Vector3(0, 40, 990), Vector3(1900, 80, 80), "cliff", true, null, L_WORLD, COL.cliff)
	dress_basin_cliffs()

# Picture only. Ribs overlap the basin face of each wall and do not add collision.
func dress_basin_cliffs() -> void:
	var rock := shaded_material("cliff", COL.cliff)
	var dark := shaded_material("cliff", COL.cliff.darkened(0.16))
	# North face z=-900. Each entry is x, height, breadth, depth, base.
	var north: Array = [
		[-150.0, 70.0, 28.0, 18.0, 6.0],
		[-70.0, 92.0, 16.0, 22.0, 0.0],
		[8.0, 64.0, 24.0, 14.0, 12.0],
		[78.0, 104.0, 20.0, 20.0, 4.0],
		[150.0, 76.0, 30.0, 16.0, 8.0],
		[230.0, 88.0, 18.0, 24.0, 0.0],
	]
	for i in north.size():
		var rib: Array = north[i]
		var depth := float(rib[3])
		var height := float(rib[1])
		var mat: Material = dark if i % 2 == 0 else rock
		visual_box(self, mat, Vector3(float(rib[0]), float(rib[4]) + height * 0.5, -900.0 + depth * 0.5 - 3.0), Vector3(float(rib[2]), height, depth))
	var teeth: Array = [
		[-210.0, 20.0, 26.0],
		[-110.0, 16.0, 24.0],
		[-20.0, 24.0, 18.0],
		[55.0, 18.0, 28.0],
		[120.0, 28.0, 16.0],
		[190.0, 14.0, 22.0],
		[270.0, 22.0, 20.0],
	]
	for i in teeth.size():
		var tooth: Array = teeth[i]
		var height := float(tooth[1])
		var mat: Material = rock if i % 2 == 0 else dark
		rock_lump(mat, Vector3(float(tooth[0]), 100.0 + height * 0.35, -896.0), Vector3(float(tooth[2]), height, 14.0), Vector3(0.25, 0.35 + float(i) * 0.4, -0.15))
	# Cap on the one north rib that rises past the rim.
	rock_lump(rock, Vector3(78.0, 104.0, -892.0), Vector3(18.0, 16.0, 14.0), Vector3(0.2, 0.5, 0.1))
	# Plates in the gaps, each a different depth, so the face is not one plane.
	for plate in [
		[-108.0, 46.0, 34.0, 58.0, 7.0],
		[-34.0, 40.0, 30.0, 72.0, 4.0],
		[44.0, 52.0, 24.0, 46.0, 10.0],
	]:
		var proud := float(plate[4])
		visual_box(self, dark, Vector3(float(plate[0]), float(plate[1]), -900.0 + proud * 0.5 - 1.5), Vector3(float(plate[2]), float(plate[3]), proud))
	# West face x=-900, east face x=950, south face z=950. Entries are along, height, breadth, depth.
	for spec in [
		[-180.0, 74.0, 26.0, 18.0],
		[40.0, 58.0, 20.0, 14.0],
		[260.0, 86.0, 22.0, 20.0],
	]:
		var depth := float(spec[3])
		var height := float(spec[1])
		visual_box(self, rock, Vector3(-900.0 + depth * 0.5 - 3.0, height * 0.45, float(spec[0])), Vector3(depth, height, float(spec[2])))
	for spec in [
		[-80.0, 68.0, 24.0, 16.0],
		[140.0, 90.0, 18.0, 20.0],
		[360.0, 60.0, 22.0, 14.0],
	]:
		var depth := float(spec[3])
		var height := float(spec[1])
		visual_box(self, dark, Vector3(950.0 - depth * 0.5 + 3.0, height * 0.45, float(spec[0])), Vector3(depth, height, float(spec[2])))
	for spec in [
		[-200.0, 62.0, 24.0, 16.0],
		[40.0, 80.0, 20.0, 18.0],
		[240.0, 56.0, 28.0, 14.0],
	]:
		var depth := float(spec[3])
		var height := float(spec[1])
		visual_box(self, rock, Vector3(float(spec[0]), height * 0.45, 950.0 - depth * 0.5 + 3.0), Vector3(float(spec[2]), height, depth))

func build_river() -> void:
	for point in layout.river.points:
		river_pts.append(v3(point))
	var bridge = layout.bridge
	for i in range(river_pts.size() - 1):
		var a: Vector3 = river_pts[i]
		var b: Vector3 = river_pts[i + 1]
		var delta := b - a
		var length := Vector2(delta.x, delta.z).length()
		if length < 0.1:
			continue
		var steps := maxi(1, int(length / 12.0))
		for s in range(steps):
			var t := (float(s) + 0.5) / float(steps)
			var p := a.lerp(b, t)
			var half := 12.0 if p.z >= -200.0 and p.z <= 600.0 else 7.0
			if p.x >= float(bridge.x0) - 2.0 and p.x <= float(bridge.x1) + 2.0 and absf(p.z) <= float(bridge.z1) + 2.0:
				continue
			var yaw := atan2(delta.x, delta.z)
			var body := add_solid("river_%d_%d" % [i, s], Vector3(p.x, -1.2, p.z), Vector3(half * 2.0, 2.6, length / float(steps) + 1.0), "water", false, null, L_WATER, COL.water)
			body.rotation.y = yaw

func build_bridge() -> void:
	var bridge = layout.bridge
	var size := Vector3(float(bridge.x1) - float(bridge.x0), 0.35, float(bridge.z1) - float(bridge.z0))
	var center := Vector3((float(bridge.x0) + float(bridge.x1)) * 0.5, float(bridge.y), 0)
	add_solid("stone_bridge", center, size, "stone", false, null, L_FLOOR, COL.stone.lightened(0.1))

func build_roads() -> void:
	for road in layout.roads:
		var pts: Array = []
		for point in road.points:
			pts.append(v3(point))
		roads.append({"id": str(road.id), "width": float(road.width), "points": pts})
		if pts.size() < 2:
			continue
		var mesh := ribbon_mesh(pts, float(road.width), 0.06)
		var node := MeshInstance3D.new()
		node.mesh = mesh
		node.name = "road_" + str(road.id)
		node.material_override = shaded_material("road", COL.road)
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(node)

func ribbon_mesh(points: Array, width: float, lift: float) -> ArrayMesh:
	var tool := SurfaceTool.new()
	tool.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(points.size() - 1):
		var a: Vector3 = points[i] + Vector3(0, lift, 0)
		var b: Vector3 = points[i + 1] + Vector3(0, lift, 0)
		var flat := Vector3(b.x - a.x, 0, b.z - a.z)
		if flat.length() < 0.05:
			continue
		var side := Vector3(-flat.z, 0, flat.x).normalized() * width * 0.5
		var a1 := a + side
		var a2 := a - side
		var b1 := b + side
		var b2 := b - side
		tool.add_vertex(a1)
		tool.add_vertex(b1)
		tool.add_vertex(b2)
		tool.add_vertex(a1)
		tool.add_vertex(b2)
		tool.add_vertex(a2)
	tool.generate_normals()
	return tool.commit()

func build_town_wall() -> void:
	var wall = layout.town_wall
	var x0 := float(wall.x0)
	var x1 := float(wall.x1)
	var z0 := float(wall.z0)
	var z1 := float(wall.z1)
	var height := float(wall.height)
	var thick := float(wall.thick)
	var y0 := float(wall.floor_y)
	var gate_gaps := {"+z": [], "-z": [], "+x": [], "-x": []}
	for gate in layout.gates:
		var side := "-x" if absf(float(gate.x) - x0) < 2.0 else "+x" if absf(float(gate.x) - x1) < 2.0 else "-z" if absf(float(gate.z) - z0) < 2.0 else "+z"
		var width := float(gate.width)
		if side == "+z" or side == "-z":
			gate_gaps[side].append({"x0": float(gate.x) - width * 0.5, "x1": float(gate.x) + width * 0.5})
		else:
			gate_gaps[side].append({"z0": float(gate.z) - width * 0.5, "z1": float(gate.z) + width * 0.5})
		var door := make_door(gate)
		var center := Vector3(float(gate.x), y0 + float(gate.height) * 0.5, float(gate.z))
		var size := Vector3(thick, float(gate.height), width) if side.ends_with("x") else Vector3(width, float(gate.height), thick)
		add_solid(door.id, center, size, door.material, true, door, L_DOOR, col(door.material))
		door.body = solids.back().body
		apply_door_visual(door)
		remember_passage(side, center, width, thick, door)
	build_span_x("town_south", x0, x1, z1, y0, y0 + height, thick, "stone", gate_gaps["+z"])
	build_span_x("town_north", x0, x1, z0, y0, y0 + height, thick, "stone", gate_gaps["-z"])
	build_span_z("town_west", z0, z1, x0, y0, y0 + height, thick, "stone", gate_gaps["-x"])
	build_span_z("town_east", z0, z1, x1, y0, y0 + height, thick, "stone", gate_gaps["+x"])
	add_solid("west_tower_n", Vector3(x0, 5, -6.5), Vector3(5, 10, 4), "stone", true, null, L_WORLD, COL.stone.darkened(0.05))
	add_solid("west_tower_s", Vector3(x0, 5, 6.5), Vector3(5, 10, 4), "stone", true, null, L_WORLD, COL.stone.darkened(0.05))

func build_building(building) -> void:
	var floor := v3(building.floor)
	var size := v3(building.size)
	var thick := maxf(float(building.thick), 0.4)
	var minx := floor.x - size.x * 0.5
	var maxx := floor.x + size.x * 0.5
	var minz := floor.z - size.z * 0.5
	var maxz := floor.z + size.z * 0.5
	var y0 := floor.y
	var y1 := floor.y + size.y
	var mat_name := str(building.material)
	var gaps := {"+z": [], "-z": [], "+x": [], "-x": []}
	for opening in building.openings:
		append_gap(gaps, opening, minx, maxx, minz, maxz)
		var side := str(opening.side)
		var normal := Vector3.RIGHT if side.ends_with("x") else Vector3.BACK
		var threshold := wall_point(side, minx, maxx, minz, maxz, y0)
		open_passages.append({"center": threshold, "normal": normal, "width": float(opening.width), "thick": thick})
	for spec in building.doors:
		append_gap(gaps, spec, minx, maxx, minz, maxz)
		var door := make_door(spec)
		var center := wall_point(str(spec.side), minx, maxx, minz, maxz, y0 + float(spec.height) * 0.5)
		var door_size := Vector3(float(spec.width), float(spec.height), thick)
		if str(spec.side).ends_with("x"):
			door_size = Vector3(thick, float(spec.height), float(spec.width))
		add_solid(door.id, center, door_size, door.material, true, door, L_DOOR, col(door.material))
		door.body = solids.back().body
		apply_door_visual(door)
		remember_passage(str(spec.side), center, float(spec.width), thick, door)
	build_span_x(str(building.id) + "_s", minx, maxx, maxz, y0, y1, thick, mat_name, gaps["+z"])
	build_span_x(str(building.id) + "_n", minx, maxx, minz, y0, y1, thick, mat_name, gaps["-z"])
	build_span_z(str(building.id) + "_w", minz, maxz, minx, y0, y1, thick, mat_name, gaps["-x"])
	build_span_z(str(building.id) + "_e", minz, maxz, maxx, y0, y1, thick, mat_name, gaps["+x"])
	add_solid(str(building.id) + "_roof", Vector3(floor.x, y1 - 0.12, floor.z), Vector3(size.x, 0.24, size.z), "roof", true, null, L_WORLD, COL.roof)
	dress_building(str(building.id))

# A modelled building replaces only the greybox meshes. The scripted bodies stay:
# they carry the collision, sight blocking and navigation the rules rely on.
func dress_building(id: String) -> void:
	var model := load_model("res://assets/buildings/%s.glb" % id)
	if model == null:
		return
	var sides := ["_s_", "_n_", "_w_", "_e_"]
	for child in get_children():
		if child is StaticBody3D and (child.name == id + "_roof" or sides.any(func(side): return child.name.begins_with(id + side))):
			for part in child.get_children():
				if part is MeshInstance3D:
					part.visible = false
	add_child(model)
	dressed += 1

func load_model(path: String) -> Node3D:
	if not ResourceLoader.exists(path):
		return null
	var scene: PackedScene = load(path)
	if scene == null:
		return null
	return scene.instantiate() as Node3D

func append_gap(gaps, spec, minx: float, maxx: float, minz: float, maxz: float) -> void:
	var side := str(spec.side)
	var width := float(spec.width)
	if side == "+z" or side == "-z":
		var x := (minx + maxx) * 0.5
		gaps[side].append({"x0": x - width * 0.5, "x1": x + width * 0.5})
	else:
		var z := (minz + maxz) * 0.5
		gaps[side].append({"z0": z - width * 0.5, "z1": z + width * 0.5})

func wall_point(side: String, minx: float, maxx: float, minz: float, maxz: float, y: float) -> Vector3:
	var cx := (minx + maxx) * 0.5
	var cz := (minz + maxz) * 0.5
	if side == "+z":
		return Vector3(cx, y, maxz)
	if side == "-z":
		return Vector3(cx, y, minz)
	if side == "+x":
		return Vector3(maxx, y, cz)
	return Vector3(minx, y, cz)

func remember_passage(side: String, center: Vector3, width: float, _thick: float, door) -> void:
	var gap = {"door": door, "inset": 0.25}
	if side == "+z" or side == "-z":
		gap.axis = "x"
		gap.x0 = center.x - width * 0.5
		gap.x1 = center.x + width * 0.5
		gap.z0 = center.z - 2.0
		gap.z1 = center.z + 2.0
	else:
		gap.axis = "z"
		gap.z0 = center.z - width * 0.5
		gap.z1 = center.z + width * 0.5
		gap.x0 = center.x - 2.0
		gap.x1 = center.x + 2.0
	passages.append(gap)

func build_free_door(spec) -> void:
	var door := make_door(spec)
	var center := v3(spec.center)
	var size := v3(spec.size)
	add_solid(door.id, center, size, door.material, true, door, L_DOOR, col(door.material))
	door.body = solids.back().body
	apply_door_visual(door)
	var gap = {"door": door, "inset": 0.2, "axis": "x" if size.x >= size.z else "z"}
	gap.x0 = center.x - maxf(size.x, 1.2) * 0.5
	gap.x1 = center.x + maxf(size.x, 1.2) * 0.5
	gap.z0 = center.z - maxf(size.z, 1.2) * 0.5
	gap.z1 = center.z + maxf(size.z, 1.2) * 0.5
	if gap.axis == "x":
		gap.z0 = center.z - 2.0
		gap.z1 = center.z + 2.0
	else:
		gap.x0 = center.x - 2.0
		gap.x1 = center.x + 2.0
	passages.append(gap)

func make_door(spec) -> Dictionary:
	var door = {
		"id": str(spec.id),
		"open": bool(spec.open),
		"lock": str(spec.lock),
		"key": str(spec.get("key", "")),
		"material": str(spec.get("material", "wood")),
		"mana_sealed": bool(spec.get("mana_sealed", false)),
		"body": null,
		"solid": null,
	}
	doors[door.id] = door
	return door

func apply_door_visual(door) -> void:
	if door.body == null:
		return
	door.body.collision_layer = 0 if door.open else L_DOOR
	door.body.rotation.y = 1.15 if door.open else 0.0

func build_span_x(id: String, x0: float, x1: float, z: float, y0: float, y1: float, thick: float, material: String, gaps: Array) -> void:
	for span in subtract_intervals(x0, x1, gaps, "x"):
		var center := Vector3((span[0] + span[1]) * 0.5, (y0 + y1) * 0.5, z)
		var size := Vector3(span[1] - span[0], y1 - y0, thick)
		if size.x < 0.05:
			continue
		add_solid("%s_%.0f" % [id, span[0]], center, size, material, true, null, L_WORLD, col(material))

func build_span_z(id: String, z0: float, z1: float, x: float, y0: float, y1: float, thick: float, material: String, gaps: Array) -> void:
	for span in subtract_intervals(z0, z1, gaps, "z"):
		var center := Vector3(x, (y0 + y1) * 0.5, (span[0] + span[1]) * 0.5)
		var size := Vector3(thick, y1 - y0, span[1] - span[0])
		if size.z < 0.05:
			continue
		add_solid("%s_%.0f" % [id, span[0]], center, size, material, true, null, L_WORLD, col(material))

func subtract_intervals(a: float, b: float, gaps: Array, axis: String) -> Array:
	var cuts: Array = []
	for gap in gaps:
		if axis == "x":
			cuts.append([float(gap.x0), float(gap.x1)])
		else:
			cuts.append([float(gap.z0), float(gap.z1)])
	cuts.sort_custom(func(u, v): return u[0] < v[0])
	var out: Array = []
	var cursor := a
	for cut in cuts:
		if cut[0] > cursor + 0.02:
			out.append([cursor, minf(cut[0], b)])
		cursor = maxf(cursor, cut[1])
	if cursor < b - 0.02:
		out.append([cursor, b])
	return out

func build_mine() -> void:
	var mine = layout.mine
	var portal := v3(mine.portal)
	var z1 := float(mine.level1_to_z)
	var length := absf(z1 - portal.z)
	var center_z := (portal.z + z1) * 0.5
	build_span_z("mine_wall_w", z1, portal.z, portal.x - 1.7, portal.y - 0.1, portal.y + 2.7, 0.4, "cliff", [{"z0": -762.4, "z1": -757.6}])
	add_solid("mine_wall_e", Vector3(portal.x + 1.7, portal.y + 1.3, center_z), Vector3(0.4, 2.8, length), "wood", true, null, L_WORLD, COL.wood.darkened(0.2))
	add_solid("mine_roof", Vector3(portal.x, portal.y + 2.7, center_z), Vector3(3.4, 0.3, length), "cliff", true, null, L_WORLD, COL.cliff)
	for z in [-762.4, -757.6]:
		add_solid("stope_wall_%d" % int(z), Vector3(38.8, portal.y + 1.3, z), Vector3(9.3, 2.8, 0.45), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("stope_end", Vector3(34.15, portal.y + 1.3, -760), Vector3(0.4, 2.8, 4.8), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("stope_floor", Vector3(38.8, portal.y - 0.15, -760), Vector3(9.3, 0.3, 4.8), "cliff", false, null, L_FLOOR, COL.cliff.darkened(0.4))
	add_solid("stope_roof", Vector3(38.8, portal.y + 2.7, -760), Vector3(9.3, 0.3, 4.8), "cliff", false, null, L_WORLD, COL.cliff)
	var deep_z := float(mine.level2_to_z)
	var shaft: Array = mine.shaft
	var deep_center := (float(shaft[2]) + deep_z) * 0.5
	var deep_length := absf(deep_z - float(shaft[2]))
	var deep_y := float(mine.level2_y)
	add_solid("mine_l2_floor", Vector3(portal.x, deep_y - 0.18, deep_center), Vector3(3, 0.36, deep_length + 2), "cliff", false, null, L_FLOOR, COL.cliff.darkened(0.35))
	add_solid("mine_l2_roof", Vector3(portal.x, deep_y + 2.55, deep_center - 2.0), Vector3(3.4, 0.3, deep_length - 3), "cliff", false, null, L_WORLD, COL.cliff)
	var water := Color(0.15, 0.3, 0.4, 0.55)
	visual_box(self, shaded_material("water", water), Vector3(portal.x, deep_y + 0.14, -842), Vector3(2.7, 0.28, 28))
	for y in range(15, 29):
		visual_box(self, shaded_material("wood", COL.wood), Vector3(portal.x + 0.85, y, -800.0), Vector3(0.18, 0.12, 0.8))
	for z in [-800.37, -799.63]:
		visual_box(self, shaded_material("wood", COL.wood), Vector3(portal.x + 0.85, 21.5, z), Vector3(0.18, 14, 0.13))
	add_solid("mine_l2_w", Vector3(portal.x - 1.5, float(mine.level2_y) + 1.2, (float(shaft[2]) + deep_z) * 0.5), Vector3(0.35, 2.4, absf(deep_z - float(shaft[2]))), "cliff", true, null, L_WORLD, COL.cliff)
	add_solid("mine_l2_e", Vector3(portal.x + 1.5, float(mine.level2_y) + 1.2, (float(shaft[2]) + deep_z) * 0.5), Vector3(0.35, 2.4, absf(deep_z - float(shaft[2]))), "cliff", true, null, L_WORLD, COL.cliff)

func build_ruins() -> void:
	var center := Vector3(-640, 38, -560)
	var radius := 8.0
	for i in range(8):
		if i == 4:
			continue
		var ang := float(i) / 8.0 * TAU
		var pos := center + Vector3(cos(ang) * radius, 7.0, sin(ang) * radius)
		add_solid("ruin_%d" % i, pos, Vector3(3.4, 14, 1.4), "stone", true, null, L_WORLD, COL.stone.darkened(0.12))
	add_solid("ruin_courtyard_n", Vector3(-640, 39.2, -582), Vector3(40, 1.6, 1.0), "stone", true, null, L_WORLD, COL.stone)
	add_solid("ruin_courtyard_s", Vector3(-640, 39.0, -538), Vector3(36, 1.2, 1.0), "stone", true, null, L_WORLD, COL.stone)
	build_spire_levels()
	build_ravine_cave("ravine_goblins", Vector3(-760, 42, -423))
	build_ravine_cave("ravine_wolves", Vector3(-720, 40, -354))

func build_ravine_cave(id: String, center: Vector3) -> void:
	var cliff := COL.cliff.darkened(0.2)
	var base := center - Vector3.UP * 2.0
	visual_box(self, shaded_material("cliff", cliff), base, Vector3(25, 4, 40))
	for x in [-4.9, 4.9]:
		add_solid(id + ("_west" if x < 0 else "_east"), center + Vector3(x, 2.0, 0), Vector3(2.8, 4.0, 25), "cliff", true, null, L_WORLD, cliff)
	add_solid(id + "_rear", center + Vector3(0, 2, -12.4), Vector3(8.0, 4.0, 1.1), "cliff", true, null, L_WORLD, cliff)
	add_solid(id + "_roof", center + Vector3(0, 4.15, -0.4), Vector3(12.6, 1.15, 24), "cliff", false, null, L_WORLD, cliff)
	for i in range(5):
		rock_lump(shaded_material("cliff", cliff.lightened(0.08)), center + Vector3(i * 2.35 - 4.7, 4.65 + (i % 2) * 0.5, 10.1), Vector3(3.4, 2.8, 3.0), Vector3(i * 0.11, 0.2, i * 0.14))

func build_spire_levels() -> void:
	var stone := COL.stone.darkened(0.25)
	var slab: Dictionary = doors.rune_vault
	var rune := flat_mat(Color(0.2, 0.45, 0.55))
	rune.emission = Color(0.25, 0.75, 1.0)
	rune.emission_energy_multiplier = 1.3
	slab["rune_material"] = rune
	for i in range(3):
		var x := float(i - 1) * 0.28
		visual_box(slab.body, rune, Vector3(x, 0.15, -0.207), Vector3(0.07, 0.52, 0.03), Vector3(0, 0, 0.3 * (i - 1)))
	add_solid("vault_floor", Vector3(-637, 29.85, -547), Vector3(12, 0.3, 12), "stone", false, null, L_FLOOR, stone)
	add_solid("vault_roof", Vector3(-637, 36.15, -547), Vector3(12, 3.7, 12), "stone", false, null, L_FLOOR, stone)
	for x in [-643.0, -631.0]:
		add_solid("vault_wall_%d" % int(x), Vector3(x, 32.25, -547), Vector3(0.35, 4.5, 12.3), "stone", true, null, L_WORLD, stone)
	add_solid("vault_end", Vector3(-637, 32.25, -541), Vector3(12, 4.5, 0.4), "stone", true, null, L_WORLD, stone)
	build_span_x("vault_partition", -643, -631, -553, 30, 34.5, 0.38, "stone", [{"x0": -637.8, "x1": -636.2}])
	var material := shaded_material("stone", stone)
	paint_spire_stairs(material, Vector3(-637, 38, -566.4), Vector3(-637, 30, -554.4), 2.3, 24)
	paint_spire_stairs(material, Vector3(-643.2, 38, -554.2), Vector3(-643.2, 47, -564.8), 1.8, 24)
	add_solid("spire_ledge_floor", Vector3(-643.2, 46.87, -565.25), Vector3(2.3, 0.26, 1.6), "stone", false, null, L_FLOOR, stone)
	add_solid("vault_landing", Vector3(-637, 29.87, -553.95), Vector3(2.7, 0.26, 1.95), "stone", false, null, L_FLOOR, stone)

func paint_spire_stairs(material: Material, from: Vector3, to: Vector3, width: float, steps: int) -> void:
	var depth := absf(to.z - from.z) / steps
	for index in range(steps):
		var position := from.lerp(to, (index + 0.5) / steps)
		visual_box(self, material, position - Vector3.UP * 0.19, Vector3(width, 0.38, depth + 0.045))

func build_props() -> void:
	add_solid("town_well", Vector3(56, 0.5, 6), Vector3(1.8, 1.0, 1.8), "stone", true, null, L_PROP, COL.stone)
	for i in range(4):
		add_solid("stall_%d" % i, Vector3(44 + float(i) * 3.2, 1.1, -8), Vector3(2.4, 2.2, 2.0), "wood", true, null, L_PROP, COL.wood)
	add_solid("anvil", Vector3(112, 0.8, 33), Vector3(0.6, 0.8, 1.2), "iron", true, null, L_PROP, COL.iron)
	add_solid("furnace", Vector3(118, 1.2, 31), Vector3(2.2, 2.4, 1.6), "stone", true, null, L_PROP, COL.roof)
	add_solid("waterwheel", Vector3(36, 28, -640), Vector3(0.4, 4.0, 4.0), "wood", true, null, L_PROP, COL.wood)
	for i in range(3):
		var ang := float(i) / 3.0 * TAU
		add_solid("menhir_%d" % i, Vector3(780 + cos(ang) * 10.0, 25.2, -180 + sin(ang) * 10.0), Vector3(1.1, 2.4, 0.8), "stone", true, null, L_PROP, COL.stone.darkened(0.2))
	add_solid("ferry_pier_w", Vector3(-62, 0.3, 480), Vector3(5, 0.4, 3), "wood", false, null, L_FLOOR, COL.wood)
	add_solid("ferry_pier_e", Vector3(-22, 0.3, 480), Vector3(5, 0.4, 3), "wood", false, null, L_FLOOR, COL.wood)
	ferry_raft = add_solid("ferry_raft", ferry_raft_center(ferry_dock), Vector3(6, 0.3, 3), "wood", false, null, L_FLOOR, COL.wood.lightened(0.05))
	add_solid("notice_post", Vector3(50, 1.3, -2), Vector3(0.3, 2.6, 0.3), "wood", true, null, L_PROP, COL.wood)
	for spec in layout.fixtures:
		var id := str(spec.id)
		var material := "wood" if spec.kind in ["storage", "ladder", "timber", "table", "board"] else "grass" if spec.kind == "herbs" else "stone"
		var body := add_solid(id, v3(spec.center), v3(spec.size), material, spec.kind != "field", null, 0 if spec.kind == "field" else L_PROP, col(material))
		fixtures[id] = {"spec": spec, "body": body, "solid": solids.back(), "batches": int(spec.get("batches", -1))}
		if spec.kind == "fire":
			hide_mesh(body)
			var rock := flat_mat(COL.stone)
			for i in range(8):
				var angle := i * TAU / 8.0
				visual_box(body, rock, Vector3(cos(angle) * 0.57, -0.08, sin(angle) * 0.57), Vector3(0.34, 0.31, 0.34))
			var flame := Node3D.new()
			body.add_child(flame)
			var glow := flat_mat(Color(0.98, 0.37, 0.08))
			glow.emission_enabled = true
			glow.emission = Color(1, 0.41, 0.12)
			for i in range(3):
				visual_box(flame, glow, Vector3((i - 1) * 0.16, 0.28 + i * 0.06, 0), Vector3(0.2, 0.56 - i * 0.05, 0.24), Vector3(0, 0, (i - 1) * 0.23))
			var lamp := OmniLight3D.new()
			lamp.position.y = 0.6
			lamp.light_color = Color(1.0, 0.65, 0.37)
			lamp.omni_range = 9.0
			flame.add_child(lamp)
			flame.hide()
			fixtures[id]["flame"] = flame
			fixtures[id]["lit_until"] = -1
		elif spec.kind == "field":
			hide_mesh(body)
			var crop := Node3D.new()
			body.add_child(crop)
			var stalk := flat_mat(Color(0.55, 0.64, 0.18))
			var plot_size := Vector2(float(spec.plot[0]), float(spec.plot[1]))
			for row in range(5):
				for column in range(12):
					visual_box(crop, stalk, Vector3((column - 5.5) * plot_size.x / 13.0, 0.12, (row - 2.0) * plot_size.y / 6.0), Vector3(0.09, 0.6, 0.09))
			crop.hide()
			crop_plots[id] = {"planted": false, "growth": 0.0, "crop": crop, "material": stalk}
		elif spec.kind == "orchard":
			hide_mesh(body)
			var fruit := Node3D.new()
			body.add_child(fruit)
			var skin := flat_mat(Color(0.67, 0.15, 0.07))
			for i in range(8):
				var angle := PI * float(i) * 0.25
				visual_box(fruit, skin, Vector3(cos(angle) * 0.57, 0.8 + 0.12 * (i % 3), sin(angle) * 0.57), Vector3(0.14, 0.14, 0.14))
			fruit.hide()
			fixtures[id]["fruit"] = fruit
			fixtures[id]["fruit_year"] = 0
		elif spec.kind == "ladder":
			hide_mesh(body)
			for z in [-0.38, 0.38]:
				visual_box(body, flat_mat(COL.wood), Vector3(0, 0, z), Vector3(0.07, 5.9, 0.07))
			for rung in range(16):
				visual_box(body, flat_mat(COL.wood.lightened(0.16)), Vector3(0, -2.75 + rung * 0.36, 0), Vector3(0.13, 0.09, 0.83))
		elif spec.kind == "spring":
			visual_box(body, flat_mat(Color(0.18, 0.47, 0.58)), Vector3(0, 0.46, 0), Vector3(1.3, 0.035, 1.3))
		elif spec.kind == "inscription":
			var glyph := shaded_material("stone", COL.stone.lightened(0.42))
			for i in range(3):
				visual_box(body, glyph, Vector3(0, -0.12 + i * 0.22, 0.16), Vector3(0.58 - i * 0.11, 0.03, 0.02))
		elif spec.kind == "herbs":
			for i in range(5):
				visual_box(body, flat_mat(Color(0.44, 0.63, 0.21)), Vector3(0.16 * i - 0.32, 0.24, 0.1 * (i % 2)), Vector3(0.11, 0.48, 0.17), Vector3(0.14 * i, 0, 0))
		elif spec.kind == "deposit":
			var vein_color := Color(0.2, 0.64, 0.81) if id in ["crystal_vein", "spire_crystals"] else Color(0.52, 0.26, 0.18)
			for i in range(3):
				visual_box(body, flat_mat(vein_color), Vector3(float(spec.size[0]) * 0.5, -0.35 + 0.3 * i, -0.32 + 0.32 * i), Vector3(0.1, 0.27, 0.25), Vector3(0.23 * i, 0, 0))
		elif spec.kind == "obstruction":
			hide_mesh(body)
			for i in range(5):
				var fragment := rock_lump(shaded_material("cliff", COL.cliff), v3(spec.center) + Vector3(-1.0 + 0.5 * i, -0.05, sin(i * 2.0) * 0.3), Vector3(0.55, 0.84, 0.85), Vector3(0.13 * i, 0, 0))
				fragment.reparent(body, true)
		elif spec.kind == "storage":
			for x in [-0.85, 0.0, 0.85]:
				visual_box(body, flat_mat(Color(0.63, 0.49, 0.30)), Vector3(x, 0.64, 0), Vector3(0.6, 0.35, 0.62))
		elif spec.kind == "workstation":
			visual_box(body, flat_mat(Color(0.13, 0.09, 0.07)), Vector3(0, 0.15, 0.704), Vector3(1.05, 0.58, 0.012))
			visual_box(body, flat_mat(Color(0.76, 0.30, 0.12)), Vector3(0, -0.09, 0.716), Vector3(0.78, 0.09, 0.013))
	for spec in layout.carts:
		build_cart(spec)
	dress_town()

func build_cart(spec: Dictionary) -> void:
	var pos := v3(spec.at) + Vector3.UP * CART_SIZE.y * 0.5
	var id := str(spec.id)
	var body := add_solid(id, pos, CART_SIZE, "wood", false, null, L_PROP, COL.wood)
	body.set_meta("cart_id", id)
	hide_mesh(body)
	var rig := Node3D.new()
	body.add_child(rig)
	var boards := shaded_material("wood", COL.wood.lightened(0.12))
	var leather := flat_mat(Color(0.25, 0.18, 0.14))
	var mule := flat_mat(Color(0.43, 0.32, 0.24))
	visual_box(rig, boards, Vector3(0, -0.13, 0.66), Vector3(1.48, 0.3, 1.63))
	for x in [-0.66, 0.66]:
		visual_box(rig, boards, Vector3(x, 0.1, 0.68), Vector3(0.13, 0.36, 1.6))
		var tire := CylinderMesh.new()
		tire.top_radius = 0.39
		tire.bottom_radius = 0.39
		tire.height = 0.15
		tire.radial_segments = 10
		var wheel := MeshInstance3D.new()
		wheel.mesh = tire
		wheel.material_override = leather
		wheel.position = Vector3(x, -0.19, 0.63)
		wheel.rotation.z = PI * 0.5
		rig.add_child(wheel)
		visual_box(rig, boards, Vector3(x * 0.61, -0.07, -0.57), Vector3(0.09, 0.09, 1.85))
	visual_box(rig, mule, Vector3(0, 0.12, -0.84), Vector3(0.56, 0.52, 1.28))
	visual_box(rig, mule, Vector3(0, 0.48, -1.38), Vector3(0.38, 0.44, 0.47), Vector3(-0.25, 0, 0))
	for x in [-0.15, 0.15]:
		for z in [-1.23, -0.49]:
			visual_box(rig, mule, Vector3(x, -0.3, z), Vector3(0.12, 0.53, 0.13))
		visual_box(rig, mule, Vector3(x * 0.6, 0.79, -1.41), Vector3(0.08, 0.35, 0.08), Vector3(0.16, 0, 0))
	var freight := Node3D.new()
	rig.add_child(freight)
	visual_box(freight, flat_mat(Color(0.65, 0.5, 0.3)), Vector3(0, 0.26, 0.7), Vector3(0.86, 0.46, 0.7))
	freight.hide()
	var wagon := {"id": id, "name": spec.name, "body": body, "rig": rig, "freight": freight, "items": [], "handler": "", "motion": {}, "solid": solids.back()}
	carts[id] = wagon
	set_cart_parked(wagon, true)

# Picture only. The grey boxes under these meshes still own collision and sight.
func dress_town() -> void:
	var stone := shaded_material("stone", COL.stone)
	var wood := shaded_material("wood", COL.wood)
	var iron := shaded_material("iron", COL.iron)
	crown_merlons(stone)
	gatehouse(stone, wood)
	bridge_parapets(stone)
	dress_well(get_node_or_null("town_well") as StaticBody3D, stone, wood)
	var cloth := [Color(0.55, 0.2, 0.14), Color(0.62, 0.48, 0.22), Color(0.28, 0.36, 0.46), Color(0.72, 0.66, 0.52)]
	for i in range(4):
		dress_stall(get_node_or_null("stall_%d" % i) as StaticBody3D, wood, cloth[i])
	pin_board(get_node_or_null("notice_post") as StaticBody3D, Vector3(1.15, 0.75, 0.06), Vector3(0, 0.55, 0.18), Color(0.78, 0.72, 0.58))
	dress_furnace(get_node_or_null("furnace") as StaticBody3D, stone)
	dress_anvil(get_node_or_null("anvil") as StaticBody3D, iron)

func hide_mesh(body: Node) -> void:
	if body == null:
		return
	for part in body.get_children():
		if part is MeshInstance3D:
			part.visible = false

func visual_box(parent: Node3D, mat: Material, center: Vector3, size: Vector3, rot := Vector3.ZERO) -> void:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.position = center
	node.rotation = rot
	node.material_override = mat
	parent.add_child(node)

func crown_merlons(stone: Material) -> void:
	var wall = layout.town_wall
	var x0 := float(wall.x0)
	var x1 := float(wall.x1)
	var z0 := float(wall.z0)
	var z1 := float(wall.z1)
	var y := float(wall.floor_y) + float(wall.height) + 0.36
	var thick := float(wall.thick)
	var ns := PackedVector3Array()
	var ew := PackedVector3Array()
	for x in merlon_centers(x0, x1, [[57.8, 62.2]]):
		ns.append(Vector3(x, y, z0))
	for x in merlon_centers(x0, x1, []):
		ns.append(Vector3(x, y, z1))
	for z in merlon_centers(z0, z1, [[-9.2, -4.0], [-2.3, 2.3], [4.0, 9.2]]):
		ew.append(Vector3(x0, y, z))
	for z in merlon_centers(z0, z1, [[9.0, 11.2]]):
		ew.append(Vector3(x1, y, z))
	place_merlons("town_crown_ns", ns, Vector3(1.1, 0.72, thick), stone)
	place_merlons("town_crown_ew", ew, Vector3(thick, 0.72, 1.1), stone)

func merlon_centers(start: float, end_v: float, blocked: Array) -> Array:
	var out: Array = []
	var cursor := start + 0.4
	var width := 1.1
	while cursor + width < end_v - 0.15:
		var a := cursor
		var b := cursor + width
		var hit := false
		for span in blocked:
			if a < float(span[1]) and b > float(span[0]):
				hit = true
				break
		if not hit:
			out.append((a + b) * 0.5)
		cursor += 2.25
	return out

func place_merlons(node_name: String, spots: PackedVector3Array, size: Vector3, stone: Material) -> void:
	if spots.is_empty():
		return
	var box := BoxMesh.new()
	box.size = size
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = box
	multi.instance_count = spots.size()
	for i in spots.size():
		multi.set_instance_transform(i, Transform3D(Basis.IDENTITY, spots[i]))
	var node := MultiMeshInstance3D.new()
	node.name = node_name
	node.multimesh = multi
	node.material_override = stone
	add_child(node)

func gatehouse(stone: Material, wood: Material) -> void:
	visual_box(self, stone, Vector3(-30, 6.15, 0), Vector3(1.7, 4.3, 4.4))
	for zoff in [-1.35, 0.0, 1.35]:
		visual_box(self, stone, Vector3(-30, 8.55, zoff), Vector3(1.7, 0.55, 1.0))
	add_pyramid("west_tower_n_roof", Vector3(-30, 10.0, -6.5), 2.85, 2.35, 2.45, wood)
	add_pyramid("west_tower_s_roof", Vector3(-30, 10.0, 6.5), 2.85, 2.35, 2.45, wood)

func add_pyramid(node_name: String, base: Vector3, hx: float, hz: float, height: float, mat: Material) -> void:
	var apex := base + Vector3(0, height, 0)
	var c := [
		base + Vector3(-hx, 0, -hz),
		base + Vector3(hx, 0, -hz),
		base + Vector3(hx, 0, hz),
		base + Vector3(-hx, 0, hz),
	]
	var tool := SurfaceTool.new()
	tool.begin(Mesh.PRIMITIVE_TRIANGLES)
	add_tri_out(tool, apex, c[0], c[1], Vector3(0, 0.3, -1))
	add_tri_out(tool, apex, c[1], c[2], Vector3(1, 0.3, 0))
	add_tri_out(tool, apex, c[2], c[3], Vector3(0, 0.3, 1))
	add_tri_out(tool, apex, c[3], c[0], Vector3(-1, 0.3, 0))
	add_tri_out(tool, c[0], c[3], c[2], Vector3.DOWN)
	add_tri_out(tool, c[0], c[2], c[1], Vector3.DOWN)
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = tool.commit()
	node.material_override = mat
	add_child(node)

func add_tri_out(tool: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, outward: Vector3) -> void:
	if (b - a).cross(c - a).dot(outward) < 0.0:
		var swap := b
		b = c
		c = swap
	tool.add_vertex(a)
	tool.add_vertex(b)
	tool.add_vertex(c)

func bridge_parapets(stone: Material) -> void:
	visual_box(self, stone, Vector3(-47.5, 0.74, -4.72), Vector3(34.0, 0.82, 0.32))
	visual_box(self, stone, Vector3(-47.5, 0.74, 4.72), Vector3(34.0, 0.82, 0.32))

func dress_well(body: StaticBody3D, stone: Material, wood: Material) -> void:
	if body == null:
		return
	hide_mesh(body)
	var drum := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.82
	cyl.bottom_radius = 0.9
	cyl.height = 1.05
	cyl.radial_segments = 12
	drum.mesh = cyl
	drum.material_override = stone
	body.add_child(drum)
	var hole := MeshInstance3D.new()
	var inner := CylinderMesh.new()
	inner.top_radius = 0.52
	inner.bottom_radius = 0.52
	inner.height = 0.08
	hole.mesh = inner
	hole.position.y = 0.5
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.05, 0.06, 0.07)
	dark.roughness = 1.0
	hole.material_override = dark
	body.add_child(hole)
	for corner in [Vector3(0.68, 1.2, 0.68), Vector3(-0.68, 1.2, 0.68), Vector3(0.68, 1.2, -0.68), Vector3(-0.68, 1.2, -0.68)]:
		visual_box(body, wood, corner, Vector3(0.12, 1.55, 0.12))
	visual_box(body, wood, Vector3(0, 2.02, 0.34), Vector3(1.7, 0.08, 1.05), Vector3(0.42, 0, 0))
	visual_box(body, wood, Vector3(0, 2.02, -0.34), Vector3(1.7, 0.08, 1.05), Vector3(-0.42, 0, 0))

func dress_stall(body: StaticBody3D, wood: Material, cloth: Color) -> void:
	if body == null:
		return
	hide_mesh(body)
	for corner in [Vector3(1.02, 0, 0.82), Vector3(-1.02, 0, 0.82), Vector3(1.02, 0, -0.82), Vector3(-1.02, 0, -0.82)]:
		visual_box(body, wood, corner, Vector3(0.1, 2.15, 0.1))
	visual_box(body, wood, Vector3(0, -0.42, 0.2), Vector3(2.05, 0.1, 0.85))
	var awning := StandardMaterial3D.new()
	awning.albedo_color = cloth
	awning.roughness = 0.84
	visual_box(body, awning, Vector3(0, 0.95, 0), Vector3(2.45, 0.06, 2.25), Vector3(0.28, 0, 0))

func pin_board(body: StaticBody3D, size: Vector3, offset: Vector3, color: Color) -> void:
	if body == null:
		return
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.9
	visual_box(body, mat, offset, size)

func dress_furnace(body: StaticBody3D, stone: Material) -> void:
	if body == null:
		return
	hide_mesh(body)
	visual_box(body, stone, Vector3(0, -0.05, 0), Vector3(2.05, 2.1, 1.45))
	var mouth := StandardMaterial3D.new()
	mouth.albedo_color = Color(0.12, 0.05, 0.03)
	mouth.emission_enabled = true
	mouth.emission = Color(0.85, 0.32, 0.08)
	mouth.emission_energy_multiplier = 0.45
	visual_box(body, mouth, Vector3(0, -0.15, 0.7), Vector3(1.05, 0.75, 0.12))
	visual_box(body, stone, Vector3(0.35, 1.55, -0.1), Vector3(0.7, 1.3, 0.7))

func dress_anvil(body: StaticBody3D, iron: Material) -> void:
	if body == null:
		return
	hide_mesh(body)
	visual_box(body, iron, Vector3(0, -0.22, 0), Vector3(0.42, 0.32, 0.62))
	visual_box(body, iron, Vector3(0, 0.05, 0), Vector3(0.2, 0.28, 0.26))
	visual_box(body, iron, Vector3(0, 0.28, 0.05), Vector3(0.62, 0.16, 1.05))

func flat_mat(color: Color, rough := 0.92) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = rough
	return mat

# Picture pass outside the walls. Existing collision stays.
# The two pens are new obstacles, off the roads. Tree crowns do not block sight.
func dress_outskirts() -> void:
	var stone := shaded_material("stone", COL.stone.darkened(0.12))
	var wood := shaded_material("wood", COL.wood.darkened(0.25))
	dress_trees(wood)
	dress_ruin_crowns(stone, wood)
	dress_waterwheel(get_node_or_null("waterwheel") as StaticBody3D, wood)
	dress_ferry(wood)
	dress_mine_mouth(wood)
	dress_mine(wood)
	dress_treewatch(wood)
	dress_menhir_caps(stone)
	dress_fields(wood)
	dress_yard(wood)

func dress_trees(wood: Material) -> void:
	var leaves := [
		flat_mat(Color(0.18, 0.32, 0.13)),
		flat_mat(Color(0.26, 0.40, 0.16)),
		flat_mat(Color(0.15, 0.27, 0.12)),
	]
	for child in get_children():
		var node_name := str(child.name)
		if not (child is StaticBody3D) or not node_name.begins_with("tree_"):
			continue
		hide_mesh(child)
		var box := ((child as Node).get_child(0) as CollisionShape3D).shape as BoxShape3D
		var trunk := CylinderMesh.new()
		trunk.top_radius = box.size.x * 0.38
		trunk.bottom_radius = box.size.x * 0.52
		trunk.height = box.size.y
		trunk.radial_segments = 6
		var trunk_node := MeshInstance3D.new()
		trunk_node.mesh = trunk
		trunk_node.material_override = wood
		child.add_child(trunk_node)
		var n := int(node_name.trim_prefix("tree_"))
		var canopy := SphereMesh.new()
		var radius := 2.05 + float(n % 4) * 0.28
		canopy.radius = radius
		canopy.height = radius * 1.55
		canopy.radial_segments = 7
		canopy.rings = 4
		var ball := MeshInstance3D.new()
		ball.mesh = canopy
		ball.position = Vector3(0, box.size.y * 0.38, 0)
		ball.material_override = leaves[n % 3]
		child.add_child(ball)
		var foliage := StaticBody3D.new()
		foliage.collision_layer = L_FOLIAGE
		foliage.collision_mask = 0
		foliage.position = ball.position
		var shape := CollisionShape3D.new()
		shape.shape = canopy.create_convex_shape()
		foliage.add_child(shape)
		child.add_child(foliage)

func dress_ruin_crowns(stone: Material, wood: Material) -> void:
	for i in range(8):
		if i == 4:
			continue
		var body := get_node_or_null("ruin_%d" % i) as StaticBody3D
		if body == null:
			continue
		visual_box(body, stone, Vector3(0.15, 7.28, 0.08), Vector3(2.5, 0.48, 1.45), Vector3(0.1, 0.15, -0.08))
		if i % 2 == 0:
			visual_box(body, stone, Vector3(0.7, 7.65, -0.15), Vector3(1.05, 0.36, 0.7), Vector3(0.35, 0.4, 0.1))
	# The debris leaves the western breach and the south-east trail clear.
	var dead := [Vector3(-668, 41.6, -588), Vector3(-674, 41.2, -542), Vector3(-608, 41.4, -594)]
	var lean := [Vector3(0.42, 0.3, 0.18), Vector3(-0.55, 0.8, 0.1), Vector3(0.22, -0.4, -0.48)]
	for i in dead.size():
		var trunk := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.16
		cyl.bottom_radius = 0.38
		cyl.height = 7.2
		cyl.radial_segments = 5
		trunk.mesh = cyl
		trunk.position = dead[i]
		trunk.rotation = lean[i]
		trunk.material_override = wood
		add_child(trunk)

func dress_waterwheel(body: StaticBody3D, wood: Material) -> void:
	if body == null:
		return
	hide_mesh(body)
	# The collision disk is centered in the east wall. The picture sits on the outer face.
	var rig := Node3D.new()
	rig.position.x = 0.62
	body.add_child(rig)
	var disk := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.7
	cyl.bottom_radius = 1.7
	cyl.height = 0.28
	cyl.radial_segments = 14
	disk.mesh = cyl
	disk.basis = Basis(Vector3.BACK, PI * 0.5)
	disk.material_override = wood
	rig.add_child(disk)
	for i in 4:
		var angle := float(i) * PI / 4.0
		var radial := Vector3(0, cos(angle), sin(angle))
		var tangent := Vector3(0, -sin(angle), cos(angle))
		var spoke := MeshInstance3D.new()
		var spoke_box := BoxMesh.new()
		spoke_box.size = Vector3(0.1, 3.15, 0.08)
		spoke.mesh = spoke_box
		spoke.basis = Basis(Vector3(1, 0, 0), radial, tangent).orthonormalized()
		spoke.material_override = wood
		rig.add_child(spoke)
	for i in 8:
		var angle := float(i) / 8.0 * TAU
		var radial := Vector3(0, cos(angle), sin(angle))
		var tangent := Vector3(0, -sin(angle), cos(angle))
		var paddle := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(0.34, 0.7, 0.14)
		paddle.mesh = box
		paddle.position = radial * 1.58
		paddle.basis = Basis(Vector3(1, 0, 0), radial, tangent).orthonormalized()
		paddle.material_override = wood
		rig.add_child(paddle)

func dress_ferry(wood: Material) -> void:
	for id in ["ferry_pier_w", "ferry_pier_e"]:
		var pier := get_node_or_null(id) as StaticBody3D
		if pier == null:
			continue
		for corner in [Vector3(2.28, 0.88, 1.28), Vector3(2.28, 0.88, -1.28), Vector3(-2.28, 0.88, 1.28), Vector3(-2.28, 0.88, -1.28)]:
			visual_box(pier, wood, corner, Vector3(0.16, 1.4, 0.16))
		for z in [1.28, -1.28]:
			visual_box(pier, wood, Vector3(0, 0.72, z), Vector3(4.4, 0.08, 0.08))
			visual_box(pier, wood, Vector3(0, 1.18, z), Vector3(4.4, 0.08, 0.08))
	var raft := get_node_or_null("ferry_raft") as StaticBody3D
	if raft != null:
		visual_box(raft, wood, Vector3(0, 0.32, 1.32), Vector3(5.5, 0.1, 0.08))
		visual_box(raft, wood, Vector3(0, 0.32, -1.32), Vector3(5.5, 0.1, 0.08))
	var x0 := -59.7
	var x1 := -24.3
	var parts := 6
	for i in parts:
		var t0 := float(i) / float(parts)
		var t1 := float(i + 1) / float(parts)
		var y0 := 1.48 - sin(t0 * PI) * 0.7
		var y1 := 1.48 - sin(t1 * PI) * 0.7
		var xa := lerpf(x0, x1, t0)
		var xb := lerpf(x0, x1, t1)
		var length := Vector2(xb - xa, y1 - y0).length()
		visual_box(self, wood, Vector3((xa + xb) * 0.5, (y0 + y1) * 0.5, 481.2), Vector3(length, 0.05, 0.05), Vector3(0, 0, atan2(y1 - y0, xb - xa)))

func dress_mine_mouth(wood: Material) -> void:
	# Posts sit outside the 3 m opening. The tunnel collision is unchanged.
	var mouth_z := -684.55
	visual_box(self, wood, Vector3(43.15, 29.45, mouth_z), Vector3(0.3, 3.0, 0.3))
	visual_box(self, wood, Vector3(46.85, 29.45, mouth_z), Vector3(0.3, 3.0, 0.3))
	visual_box(self, wood, Vector3(45.0, 30.95, mouth_z), Vector3(4.0, 0.26, 0.3))

# Rock picture on the timber colliders, plus props and rails. mine_end is the one new collider.
func dress_mine(wood: Material) -> void:
	var rock := shaded_material("cliff", COL.cliff)
	var iron := shaded_material("iron", COL.iron)
	var east_wall := get_node("mine_wall_e") as StaticBody3D
	hide_mesh(east_wall)
	var east_shape := (east_wall.get_child(0) as CollisionShape3D).shape as BoxShape3D
	visual_box(east_wall, rock, Vector3.ZERO, east_shape.size)
	for i in 50:
		var z := -689.0 - float(i) * 4.0
		visual_box(self, wood, Vector3(43.58, 29.18, z), Vector3(0.16, 2.36, 0.16))
		visual_box(self, wood, Vector3(46.42, 29.18, z), Vector3(0.16, 2.36, 0.16))
		visual_box(self, wood, Vector3(45.0, 30.38, z), Vector3(2.92, 0.12, 0.16))
		visual_box(self, wood, Vector3(45.0, 28.04, z), Vector3(0.92, 0.045, 0.12))
	visual_box(self, iron, Vector3(44.68, 28.09, -787.0), Vector3(0.05, 0.045, 196.0))
	visual_box(self, iron, Vector3(45.32, 28.09, -787.0), Vector3(0.05, 0.045, 196.0))
	var floor_rock := shaded_material("cliff", COL.cliff.darkened(0.55))
	# The yard pad tops out at 26 m. The adit floor, and the walk past z=-770, sit at 28 m.
	visual_box(self, floor_rock, Vector3(45.0, 27.97, -785.5), Vector3(2.85, 0.12, 203.0))
	park_ore_cart(wood, iron, floor_rock, Vector3(44.2, 28.03, -699.0))
	var glow := StandardMaterial3D.new()
	glow.albedo_color = Color(0.35, 0.18, 0.06)
	glow.emission_enabled = true
	glow.emission = Color(1.0, 0.62, 0.22)
	glow.emission_energy_multiplier = 0.45
	glow.roughness = 0.45
	visual_box(self, glow, Vector3(46.15, 29.55, -693.0), Vector3(0.16, 0.22, 0.16))
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(46.05, 29.5, -693.0)
	lamp.light_color = Color(1.0, 0.74, 0.42)
	lamp.light_energy = 0.7
	lamp.omni_range = 8.0
	lamp.shadow_enabled = false
	add_child(lamp)
	# Hillside outside the timber, from the mouth back to the end wall. The opening stays clear.
	visual_box(self, rock, Vector3(38.7, 31.0, -722.8), Vector3(9.3, 14.0, 69.6))
	visual_box(self, rock, Vector3(38.7, 31.0, -821.2), Vector3(9.3, 14.0, 117.6))
	visual_box(self, rock, Vector3(38.7, 34.35, -760.0), Vector3(9.3, 7.3, 4.8))
	visual_box(self, rock, Vector3(51.3, 31.0, -778.0), Vector3(9.3, 14.0, 204.0))
	visual_box(self, rock, Vector3(45.0, 34.6, -679.8), Vector3(4.0, 6.8, 7.4))
	dress_mine_face(rock)
	add_solid("mine_end", Vector3(45.0, 29.28, -887.2), Vector3(3.4, 2.65, 0.6), "cliff", true, null, L_WORLD, COL.cliff.darkened(0.25))

# Picture only, on the yard side of the adit. The slot below the lintel stays open.
func dress_mine_face(rock: Material) -> void:
	var dark := shaded_material("cliff", COL.cliff.darkened(0.18))
	visual_box(self, rock, Vector3(39.0, 30.4, -673.0), Vector3(5.0, 8.8, 5.4))
	visual_box(self, dark, Vector3(37.2, 35.2, -674.2), Vector3(2.6, 2.2, 3.2))
	visual_box(self, rock, Vector3(53.2, 31.2, -673.4), Vector3(4.4, 10.4, 5.0))
	visual_box(self, dark, Vector3(54.2, 37.0, -673.6), Vector3(2.6, 1.6, 3.0))
	visual_box(self, dark, Vector3(44.0, 35.8, -674.6), Vector3(2.4, 2.2, 3.0))
	visual_box(self, rock, Vector3(46.8, 34.6, -674.0), Vector3(2.0, 3.2, 3.4))
	# Lumps break the pier corners. They stay outside the slot, x 43.4..46.7 below the lintel.
	rock_lump(dark, Vector3(37.6, 33.4, -669.5), Vector3(2.2, 1.7, 1.8), Vector3(0.4, 0.6, 0.3))
	rock_lump(rock, Vector3(40.5, 29.2, -669.2), Vector3(1.7, 2.3, 1.6), Vector3(0.2, -0.7, 0.5))
	rock_lump(dark, Vector3(52.2, 34.2, -669.6), Vector3(2.0, 1.8, 1.6), Vector3(0.3, 0.9, -0.2))
	rock_lump(rock, Vector3(54.2, 28.6, -669.3), Vector3(1.6, 2.2, 1.5), Vector3(-0.4, 0.5, 0.6))
	rock_lump(dark, Vector3(44.0, 36.4, -672.2), Vector3(2.8, 2.6, 2.2), Vector3(0.4, 0.5, 0.3))
	rock_lump(rock, Vector3(46.8, 35.2, -671.8), Vector3(2.6, 3.0, 2.2), Vector3(-0.25, 0.7, 0.2))
	rock_lump(dark, Vector3(37.2, 35.8, -672.2), Vector3(2.8, 2.2, 2.2), Vector3(0.3, -0.4, 0.45))
	rock_lump(rock, Vector3(54.2, 37.3, -671.8), Vector3(2.8, 2.0, 2.2), Vector3(0.2, 0.6, -0.3))
	rock_lump(dark, Vector3(41.2, 26.55, -669.2), Vector3(1.9, 1.1, 1.5), Vector3(0.4, 0.7, 0.3))
	rock_lump(rock, Vector3(51.5, 26.6, -668.6), Vector3(2.1, 1.2, 1.6), Vector3(0.3, -0.5, 0.6))
	rock_lump(dark, Vector3(39.2, 26.4, -668.0), Vector3(1.3, 0.8, 1.1), Vector3(-0.5, 0.4, 0.2))
	# Large lumps over the south faces. West of x=42 and east of x=50, so the slot stays open.
	rock_lump(rock, Vector3(37.8, 30.6, -668.7), Vector3(3.4, 4.8, 2.6), Vector3(0.15, 0.4, 0.2))
	rock_lump(dark, Vector3(40.2, 28.2, -668.5), Vector3(2.6, 3.6, 2.3), Vector3(-0.2, -0.5, 0.3))
	rock_lump(rock, Vector3(38.5, 34.2, -669.0), Vector3(2.8, 2.4, 2.2), Vector3(0.35, 0.25, -0.2))
	rock_lump(dark, Vector3(52.4, 31.4, -668.7), Vector3(3.0, 4.6, 2.5), Vector3(0.2, 0.55, -0.15))
	rock_lump(rock, Vector3(54.4, 28.0, -668.5), Vector3(2.4, 3.4, 2.2), Vector3(-0.25, -0.4, 0.3))
	rock_lump(dark, Vector3(53.1, 35.0, -668.9), Vector3(2.5, 2.2, 2.1), Vector3(0.3, 0.45, 0.2))
	rock_lump(rock, Vector3(35.4, 30.2, -673.8), Vector3(2.6, 4.2, 2.8), Vector3(0.2, 0.7, -0.25))
	rock_lump(dark, Vector3(56.8, 31.2, -674.2), Vector3(2.8, 4.6, 3.0), Vector3(-0.2, 0.5, 0.25))
	visual_box(self, dark, Vector3(56.7, 28.6, -694.0), Vector3(1.5, 2.0, 16.0))
	visual_box(self, rock, Vector3(56.5, 33.5, -712.0), Vector3(1.2, 1.1, 14.0))
	visual_box(self, dark, Vector3(56.4, 30.6, -682.0), Vector3(1.6, 2.2, 6.0))
	rock_lump(rock, Vector3(40.4, 39.0, -683.2), Vector3(3.6, 2.2, 3.4), Vector3(0.3, 0.5, 0.2))
	rock_lump(dark, Vector3(52.6, 39.2, -681.4), Vector3(3.8, 2.4, 3.6), Vector3(-0.2, 0.7, 0.3))

# Picture only, west of the centre line, so a body walking the middle of the adit misses it.
func park_ore_cart(wood: Material, iron: Material, rock: Material, at: Vector3) -> void:
	visual_box(self, wood, at + Vector3(0, 0.32, 0), Vector3(0.7, 0.1, 1.3))
	visual_box(self, wood, at + Vector3(0, 0.5, 0.62), Vector3(0.7, 0.26, 0.06))
	visual_box(self, wood, at + Vector3(0, 0.5, -0.62), Vector3(0.7, 0.26, 0.06))
	visual_box(self, wood, at + Vector3(-0.33, 0.5, 0), Vector3(0.06, 0.26, 1.22))
	visual_box(self, wood, at + Vector3(0.33, 0.5, 0), Vector3(0.06, 0.26, 1.22))
	visual_box(self, rock, at + Vector3(-0.08, 0.48, 0.12), Vector3(0.28, 0.16, 0.34))
	visual_box(self, rock, at + Vector3(0.12, 0.5, -0.16), Vector3(0.24, 0.14, 0.28))
	for corner in [Vector3(-0.26, 0.14, -0.42), Vector3(0.26, 0.14, -0.42), Vector3(-0.26, 0.14, 0.42), Vector3(0.26, 0.14, 0.42)]:
		var wheel := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.14
		cyl.bottom_radius = 0.14
		cyl.height = 0.08
		cyl.radial_segments = 8
		wheel.mesh = cyl
		wheel.position = at + corner
		wheel.basis = Basis(Vector3.BACK, PI * 0.5)
		wheel.material_override = iron
		add_child(wheel)

# Picture only, east of the road end and north of the bunkhouse. The yard path stays clear.
func dress_yard(wood: Material) -> void:
	var slag := shaded_material("cliff", Color(0.26, 0.24, 0.22))
	var ore := shaded_material("cliff", Color(0.36, 0.22, 0.14))
	ore_heap(ore, slag, Vector3(49.5, 26.0, -652.0))
	ore_heap(slag, ore, Vector3(46.5, 26.0, -645.5))
	var crib := Vector3(56.0, 26.0, -666.0)
	visual_box(self, wood, crib + Vector3(0, 0.55, 1.15), Vector3(2.4, 1.1, 0.1))
	visual_box(self, wood, crib + Vector3(0, 0.55, -1.15), Vector3(2.4, 1.1, 0.1))
	visual_box(self, wood, crib + Vector3(-1.15, 0.55, 0), Vector3(0.1, 1.1, 2.2))
	rock_lump(ore, crib + Vector3(0.05, 0.45, 0.0), Vector3(1.5, 0.8, 1.3), Vector3(0.3, 0.6, 0.2))
	rock_lump(slag, crib + Vector3(-0.2, 0.7, -0.1), Vector3(0.8, 0.5, 0.6), Vector3(-0.4, 0.8, 0.5))
	rock_lump(slag, Vector3(53.2, 26.22, -647.5), Vector3(0.6, 0.4, 0.5), Vector3(0.4, 0.2, 0.5))
	rock_lump(ore, Vector3(57.4, 26.18, -657.0), Vector3(0.5, 0.32, 0.4), Vector3(0.5, -0.4, 0.3))
	rock_lump(slag, Vector3(44.8, 26.24, -658.5), Vector3(0.75, 0.42, 0.55), Vector3(-0.3, 0.7, 0.4))

func rock_lump(mat: Material, at: Vector3, size: Vector3, rot: Vector3) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.5
	mesh.height = 1.0
	mesh.radial_segments = 6
	mesh.rings = 3
	node.mesh = mesh
	node.position = at
	node.scale = size
	node.rotation = rot
	node.material_override = mat
	add_child(node)
	return node

func ore_heap(a: Material, b: Material, at: Vector3) -> void:
	rock_lump(a, at + Vector3(0, 0.48, 0), Vector3(1.8, 0.95, 1.4), Vector3(0.3, 0.5, 0.2))
	rock_lump(b, at + Vector3(0.4, 0.72, 0.12), Vector3(1.0, 0.7, 0.85), Vector3(-0.4, 0.8, 0.5))
	rock_lump(a, at + Vector3(-0.45, 0.3, 0.28), Vector3(0.75, 0.5, 0.6), Vector3(0.6, -0.3, 0.4))
	rock_lump(b, at + Vector3(0.1, 0.28, -0.35), Vector3(0.65, 0.42, 0.55), Vector3(0.2, 1.0, -0.5))

func dress_treewatch(wood: Material) -> void:
	# Three trunks carry the decks. The ladder column is x=518, z=40, so the south-west corner stays empty.
	var feet := [Vector3(523.2, 25.6, 42.2), Vector3(523.2, 25.6, 37.8), Vector3(516.8, 25.6, 42.2), Vector3(533.6, 25.6, 41.1)]
	for foot in feet:
		var trunk := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.48
		cyl.bottom_radius = 0.62
		cyl.height = 16.0
		cyl.radial_segments = 6
		trunk.mesh = cyl
		trunk.position = foot
		trunk.material_override = wood
		add_child(trunk)
	for z in [39.1, 40.9]:
		visual_box(self, wood, Vector3(527, 30.96, z), Vector3(7, 0.075, 0.075))
		for x in [523.6, 526.0, 528.2, 530.4]:
			visual_box(self, wood, Vector3(x, 30.56, z), Vector3(0.06, 0.85, 0.06))
	for i in range(14):
		visual_box(self, wood, Vector3(523.75 + 0.5 * i, 30.13, 40), Vector3(0.45, 0.035, 2.0))
	for z in [39.62, 40.38]:
		visual_box(self, wood, Vector3(518.55, 27.12, z), Vector3(0.07, 5.85, 0.07))
	for rung in range(16):
		visual_box(self, wood, Vector3(518.55, 24.35 + rung * 0.36, 40), Vector3(0.13, 0.09, 0.83))

func dress_menhir_caps(stone: Material) -> void:
	for i in 3:
		var body := get_node_or_null("menhir_%d" % i) as StaticBody3D
		if body == null:
			continue
		visual_box(body, stone, Vector3(0, 1.32, 0), Vector3(1.25, 0.28, 0.95))

func dress_fields(wood: Material) -> void:
	add_field(Vector3(-296, 3.06, 174), Vector3(14.6, 0.08, 14.6), Color(0.36, 0.28, 0.16))
	add_pen("sheep_pen", -282, -262, 185, 203, 3.0, "-z", wood)
	add_pen("miller_fence", -304.0, -288.0, 166.0, 182.0, 3.0, "+x", wood)
	add_field(Vector3(160, 2.06, 399), Vector3(14.2, 0.08, 16.2), Color(0.40, 0.32, 0.18))
	add_pen("oakford_fence", 152.0, 168.0, 390.0, 408.0, 2.0, "-x", wood)
	var leaf := flat_mat(Color(0.30, 0.44, 0.16))
	var trunk_mat := shaded_material("wood", COL.wood)
	for spot in [Vector2(158, 356), Vector2(168, 354), Vector2(173, 362), Vector2(163, 364)]:
		var origin := Vector3(spot.x, 2.0, spot.y)
		var trunk := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.1
		cyl.bottom_radius = 0.16
		cyl.height = 1.8
		cyl.radial_segments = 5
		trunk.mesh = cyl
		trunk.position = origin + Vector3(0, 0.9, 0)
		trunk.material_override = trunk_mat
		add_child(trunk)
		var ball := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = 0.85
		sphere.height = 1.35
		sphere.radial_segments = 6
		sphere.rings = 3
		ball.mesh = sphere
		ball.position = origin + Vector3(0, 1.95, 0)
		ball.material_override = leaf
		add_child(ball)

func add_field(center: Vector3, size: Vector3, color: Color) -> void:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.position = center
	node.material_override = flat_mat(color)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(node)
	var furrow := flat_mat(color.darkened(0.28))
	for i in 5:
		var strip := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(size.x * 0.84, 0.02, 0.14)
		strip.mesh = box
		strip.position = Vector3(0, 0.045, (float(i) - 2.0) * size.z * 0.16)
		strip.material_override = furrow
		strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(strip)

func add_pen(prefix: String, x0: float, x1: float, z0: float, z1: float, y: float, gap_side: String, wood: Material) -> void:
	var runs: Array = [
		{"side": "-z", "a": x0, "b": x1, "fixed": z0, "along_x": true},
		{"side": "+z", "a": x0, "b": x1, "fixed": z1, "along_x": true},
		{"side": "-x", "a": z0, "b": z1, "fixed": x0, "along_x": false},
		{"side": "+x", "a": z0, "b": z1, "fixed": x1, "along_x": false},
	]
	var n := 0
	for run in runs:
		var spans: Array = [[run.a, run.b]]
		if str(run.side) == gap_side:
			var mid := (float(run.a) + float(run.b)) * 0.5
			spans = [[run.a, mid - 0.8], [mid + 0.8, run.b]]
		for span in spans:
			var a := float(span[0])
			var b := float(span[1])
			if b - a < 0.4:
				continue
			var fixed := float(run.fixed)
			var along_x: bool = run.along_x
			var center := Vector3((a + b) * 0.5, y + 0.52, fixed) if along_x else Vector3(fixed, y + 0.52, (a + b) * 0.5)
			var size := Vector3(b - a, 1.05, 0.12) if along_x else Vector3(0.12, 1.05, b - a)
			var body := add_solid("%s_%d" % [prefix, n], center, size, "wood", true, null, L_PROP, COL.wood.darkened(0.2))
			hide_mesh(body)
			n += 1
			for rail_y in [0.38, 0.82]:
				var rail_c := Vector3((a + b) * 0.5, y + float(rail_y), fixed) if along_x else Vector3(fixed, y + float(rail_y), (a + b) * 0.5)
				var rail_s := Vector3(b - a, 0.08, 0.08) if along_x else Vector3(0.08, 0.08, b - a)
				visual_box(self, wood, rail_c, rail_s)
			var cursor := a
			while cursor <= b + 0.04:
				var post := Vector3(cursor, y + 0.55, fixed) if along_x else Vector3(fixed, y + 0.55, cursor)
				visual_box(self, wood, post, Vector3(0.12, 1.12, 0.12))
				cursor += 1.7

func build_trees() -> void:
	for i in range(48):
		var x := 280.0 + float((i * 37) % 460)
		var z := -140.0 + float((i * 53) % 320)
		if near_road(x, z).dist < 5.0:
			continue
		if Vector2(x - 520, z - 40).length() < 16.0:
			continue
		if Vector2(x - 780, z + 180).length() < 18.0:
			continue
		var trunk := 0.7 + float(i % 5) * 0.2
		add_solid("tree_%d" % i, Vector3(x, ground_y(x, z) + 3.0, z), Vector3(trunk, 6.0, trunk), "wood", true, null, L_WORLD, COL.wood.darkened(0.35))

func build_plateaus() -> void:
	var pads = [
		[Vector3(40, 13, -660), Vector3(160, 26, 220), Color(0.32, 0.30, 0.28)],
		[Vector3(-640, 24, -560), Vector3(90, 28, 90), Color(0.48, 0.46, 0.42)],
		[Vector3(520, 9, 30), Vector3(80, 18, 70), Color(0.24, 0.34, 0.18)],
		[Vector3(780, 12, -180), Vector3(50, 24, 50), Color(0.28, 0.38, 0.20)],
		[Vector3(-280, 1.5, 160), Vector3(50, 3, 50), Color(0.36, 0.42, 0.20)],
		[Vector3(140, 1, 380), Vector3(60, 2, 60), Color(0.40, 0.38, 0.22)],
	]
	for i in range(pads.size()):
		if i == 1:
			var rock := shaded_material("cliff", pads[i][2])
			visual_box(self, rock, Vector3(-640, 19, -560), Vector3(90, 22, 90))
			for slab in [
				[Vector3(-664.6, 34, -560), Vector3(40.8, 8, 90)],
				[Vector3(-614.2, 34, -560), Vector3(38.4, 8, 90)],
				[Vector3(-637.0, 34, -586), Vector3(10.6, 8, 38)],
				[Vector3(-637.0, 34, -528), Vector3(10.6, 8, 26)],
				[Vector3(-640.3, 34, -560), Vector3(4.0, 8, 14)],
				[Vector3(-633.7, 34, -560), Vector3(4.0, 8, 14)],
			]:
				visual_box(self, rock, slab[0], slab[1])
			continue
		var node := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = pads[i][1]
		node.mesh = mesh
		node.position = pads[i][0]
		node.name = "pad_%d" % i
		if i <= 1:
			node.material_override = shaded_material("cliff", pads[i][2])
		else:
			var mat := StandardMaterial3D.new()
			mat.albedo_color = pads[i][2]
			mat.roughness = 0.95
			node.material_override = mat
		add_child(node)
	dress_outskirts()

func spawn_actor(spec, wild: bool) -> void:
	var pos := v3(spec.pos)
	var race := str(spec.get("race", spec.get("kind", "beast")))
	var height := 0.96 if race == "sheep" else 1.35 if race == "dwarf" else 1.0 if race == "wolf" else 1.2 if race == "goblin" else 1.8 if race == "elf" else 1.75
	var radius := 0.3 if race == "dwarf" or wild else 0.35
	var body := StaticBody3D.new()
	body.name = str(spec.id)
	body.collision_layer = L_AGENT
	body.collision_mask = 0
	body.position = pos + Vector3(0, height * 0.5, 0)
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = radius
	capsule.height = height
	shape.shape = capsule
	body.add_child(shape)
	# The picture hangs on its own node so it can walk to where the body already is.
	var visual := Node3D.new()
	body.add_child(visual)
	var mesh_node := MeshInstance3D.new()
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	mesh_node.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.35, 0.32, 0.3) if wild else Color(0.25, 0.45, 0.75) if race == "elf" else Color(0.55, 0.4, 0.28) if race == "dwarf" else COL.skin
	mesh_node.material_override = mat
	visual.add_child(mesh_node)
	var figure := load_model("res://assets/actors/%s.glb" % race)
	if race == "sheep":
		mesh_node.hide()
		var wool := flat_mat(Color(0.8, 0.77, 0.65))
		var dark := flat_mat(Color(0.2, 0.16, 0.13))
		visual_box(visual, wool, Vector3(0, 0.13, 0), Vector3(0.54, 0.54, 0.93))
		visual_box(visual, dark, Vector3(0, 0.26, -0.51), Vector3(0.28, 0.33, 0.36))
		for x in [-0.17, 0.17]:
			for z in [-0.31, 0.31]:
				visual_box(visual, dark, Vector3(x, -0.24, z), Vector3(0.11, 0.45, 0.11))
	elif figure != null:
		figure.position = Vector3(0, -height * 0.5, 0)
		visual.add_child(figure)
		mesh_node.visible = false
		paint_figure(figure, spec, race)
		modeled += 1
	var label := Label3D.new()
	label.text = str(spec.get("name", spec.id))
	label.font_size = 36
	label.pixel_size = 0.0075
	label.position = Vector3(0, height * 0.55 + 0.22, 0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.outline_size = 7
	visual.add_child(label)
	label.visible = race != "sheep"
	add_child(body)
	var actor = {
		"id": str(spec.id),
		"name": str(spec.get("name", spec.id)),
		"race": race,
		"role": str(spec.get("role", spec.get("kind", ""))),
		"wild": wild,
		"cart_id": "",
		"pos": pos,
		"yaw": float(spec.get("yaw", 0.0)),
		"height": height,
		"radius": radius,
		"mana": float(spec.get("mana", 0)),
		"manaMax": float(spec.get("manaMax", spec.get("mana", 0))),
		"suppressed": bool(spec.get("suppressed", false)),
		"apparent": float(spec.get("apparent", spec.get("manaMax", spec.get("mana", 0)))),
		"sp": int(spec.get("sp", 0)),
		"cp": int(spec.get("cp", 0)),
		"items": spec.get("items", []).duplicate(true),
		"events": [],
		"light_until": -1,
		"body": body,
		"visual": visual,
		"nameplate": label,
		"tween": {},
		"bubble": null,
		"bubble_until": 0,
		"note": "",
		"note_until": 0,
		"home": pos,
		"kind": str(spec.get("kind", "")),
	}
	actor.merge(BodyState.initial())
	body.set_meta("agent_id", actor.id)
	if wild:
		wildlife.append(actor)
	else:
		agents.append(actor)
		agents_by_id[actor.id] = actor

const ROLE_CLOTH := {
	"Town Reeve": Color(0.50, 0.15, 0.13),
	"Guard Captain": Color(0.25, 0.32, 0.40),
	"Guild Clerk": Color(0.20, 0.34, 0.30),
	"Town Blacksmith": Color(0.27, 0.16, 0.11),
	"Tavern Keeper": Color(0.58, 0.32, 0.18),
	"Provisioner": Color(0.52, 0.40, 0.18),
	"Town Healer": Color(0.74, 0.72, 0.64),
	"West Farmer": Color(0.40, 0.30, 0.16),
	"South Farmer": Color(0.34, 0.36, 0.18),
	"Ferryman": Color(0.20, 0.32, 0.42),
	"Mercenary Leader": Color(0.40, 0.18, 0.12),
	"Junior Shieldbearer": Color(0.32, 0.24, 0.16),
	"Apprentice Mage": Color(0.16, 0.20, 0.42),
	"Forest Warden": Color(0.16, 0.30, 0.16),
	"Forest Scout": Color(0.28, 0.38, 0.20),
	"Ancient Wandering Mage": Color(0.55, 0.56, 0.58),
	"Forge Master": Color(0.22, 0.18, 0.16),
	"Lead Miner": Color(0.30, 0.28, 0.26),
	"Smelter": Color(0.24, 0.20, 0.18),
	"Ore Hauler": Color(0.38, 0.30, 0.20),
	"Travelling Scholar": Color(0.10, 0.10, 0.12),
}

const HOOD_ROLES := [
	"Apprentice Mage", "Forest Warden", "Forest Scout", "Ancient Wandering Mage",
	"Travelling Scholar", "Ferryman", "Town Healer",
]

# The capsule stays. Cloth and hair are picture only, one color per role.
func paint_figure(figure: Node, spec, race: String) -> void:
	if race == "wolf":
		return
	var role := str(spec.get("role", ""))
	var cloth := outfit_color(spec, race)
	var hair := Color(0.16, 0.09, 0.05)
	if role == "Ancient Wandering Mage":
		hair = Color(0.82, 0.80, 0.74)
	elif role == "Town Healer":
		hair = Color(0.55, 0.36, 0.22)
	elif race == "dwarf":
		hair = Color(0.46, 0.20, 0.10)
	elif race == "elf":
		hair = Color(0.14, 0.11, 0.08)
	elif race == "goblin":
		hair = Color(0.12, 0.14, 0.08)
	paint_nodes(figure, cloth, hair, role in HOOD_ROLES)

func outfit_color(spec, race: String) -> Color:
	var role := str(spec.get("role", ""))
	if ROLE_CLOTH.has(role):
		return ROLE_CLOTH[role]
	var base := Color(0.40, 0.26, 0.16)
	if race == "elf":
		base = Color(0.24, 0.36, 0.22)
	elif race == "dwarf":
		base = Color(0.34, 0.28, 0.24)
	elif race == "goblin":
		base = Color(0.36, 0.32, 0.16)
	return base.darkened(0.05 * float(absi(str(spec.id).hash()) % 4))

func paint_nodes(node: Node, cloth: Color, hair: Color, hooded: bool) -> void:
	if node is MeshInstance3D:
		var label := str(node.name)
		if "_hood_" in label:
			node.visible = hooded
		elif "_hair_" in label:
			node.visible = not hooded
		var mesh := (node as MeshInstance3D).mesh
		if mesh != null and mesh.get_surface_count() > 0 and ("_cloth_" in label or "_hood_" in label or "_hair_" in label):
			var mat := StandardMaterial3D.new()
			mat.albedo_color = hair if "_hair_" in label else cloth
			mat.roughness = 0.82 if "_hair_" in label else 0.9
			(node as MeshInstance3D).set_surface_override_material(0, mat)
	for child in node.get_children():
		paint_nodes(child, cloth, hair, hooded)

func register_fine_rects() -> void:
	add_fine(-70, 210, -130, 140)
	add_fine(-20, 130, -760, -540)
	add_fine(-320, -240, 120, 210)
	add_fine(100, 190, 330, 430)
	add_fine(-710, -560, -640, -480)
	add_fine(480, 570, 0, 80)
	add_fine(740, 830, -230, -120)
	add_fine(-90, -40, 450, 520)
	add_fine(20, 70, -910, -660)

func add_fine(x0: float, x1: float, z0: float, z1: float) -> void:
	fine_rects.append({"x0": x0, "x1": x1, "z0": z0, "z1": z1})

func in_fine(x: float, z: float) -> bool:
	for rect in fine_rects:
		if x >= rect.x0 and x <= rect.x1 and z >= rect.z0 and z <= rect.z1:
			return true
	return false

func in_cliff(x: float, z: float) -> bool:
	return x <= -900.0 or x >= 950.0 or z <= -900.0 or z >= 950.0

func on_bridge(x: float, z: float) -> bool:
	var bridge = layout.bridge
	return x >= float(bridge.x0) and x <= float(bridge.x1) and z >= float(bridge.z0) and z <= float(bridge.z1)

func in_water(x: float, z: float) -> bool:
	var best := 100000.0
	var half := 7.0
	for i in range(river_pts.size() - 1):
		var a: Vector3 = river_pts[i]
		var b: Vector3 = river_pts[i + 1]
		var hit = closest_xz(x, z, a, b)
		if hit.dist < best:
			best = hit.dist
			var zz := lerpf(a.z, b.z, hit.t)
			half = 12.0 if zz >= -200.0 and zz <= 600.0 else 7.0
	return best < half - 0.4

func closest_xz(x: float, z: float, a: Vector3, b: Vector3):
	var ab := Vector2(b.x - a.x, b.z - a.z)
	var len2 := ab.length_squared()
	var t := 0.0 if len2 < 0.0001 else clampf(Vector2(x - a.x, z - a.z).dot(ab) / len2, 0.0, 1.0)
	var px := lerpf(a.x, b.x, t)
	var pz := lerpf(a.z, b.z, t)
	return {"dist": Vector2(x - px, z - pz).length(), "t": t, "y": lerpf(a.y, b.y, t)}

func near_road(x: float, z: float) -> Dictionary:
	var best := 100000.0
	var y := 0.0
	for road in roads:
		var pts: Array = road.points
		for i in range(pts.size() - 1):
			var hit = closest_xz(x, z, pts[i], pts[i + 1])
			if hit.dist < best:
				best = hit.dist
				y = hit.y
	return {"dist": best, "y": y}

func ground_y(x: float, z: float) -> float:
	if on_bridge(x, z):
		return 0.15
	var y := 0.0
	if z < -180.0:
		y = maxf(y, lerpf(0.0, 26.0, clampf((-180.0 - z) / 460.0, 0.0, 1.0)))
	if x > 260.0:
		y = maxf(y, lerpf(0.0, 18.0, clampf((x - 260.0) / 260.0, 0.0, 1.0)))
	var road = near_road(x, z)
	if float(road.dist) < 9.0:
		var influence := clampf((9.0 - float(road.dist)) / 3.0, 0.0, 1.0)
		y = lerpf(y, float(road.y), influence)
	y = raise_disk(y, x, z, -640.0, -560.0, 48.0, 38.0)
	if absf(x + 640.0) <= 45.0 and absf(z + 560.0) <= 45.0:
		y = maxf(y, 38.0)
	y = raise_disk(y, x, z, -760.0, -410.0, 36.0, 42.0)
	if absf(x + 760.0) <= 12.5 and absf(z + 423.0) <= 20.0:
		y = 42.0
	if absf(x + 720.0) <= 12.5 and absf(z + 354.0) <= 20.0:
		y = 40.0
	y = raise_disk(y, x, z, -720.0, -340.0, 28.0, 40.0)
	y = raise_disk(y, x, z, 780.0, -180.0, 24.0, 24.0)
	y = raise_disk(y, x, z, 520.0, 40.0, 28.0, 18.0)
	y = raise_disk(y, x, z, -280.0, 160.0, 26.0, 3.0)
	y = raise_box(y, x, z, -313.0, -234.0, 165.0, 229.0, 3.0)
	y = raise_disk(y, x, z, 140.0, 380.0, 34.0, 2.0)
	y = raise_box(y, x, z, -10.0, 110.0, -820.0, -560.0, 26.0)
	y = raise_box(y, x, z, 30.0, 60.0, -910.0, -670.0, 28.0)
	return y

func raise_disk(base: float, x: float, z: float, cx: float, cz: float, radius: float, height: float) -> float:
	return raise_inset(base, radius - Vector2(x - cx, z - cz).length(), height)

func raise_box(base: float, x: float, z: float, x0: float, x1: float, z0: float, z1: float, height: float) -> float:
	if x <= x0 or x >= x1 or z <= z0 or z >= z1:
		return base
	return raise_inset(base, minf(minf(x - x0, x1 - x), minf(z - z0, z1 - z)), height)

func raise_inset(base: float, inset: float, height: float) -> float:
	if inset <= 0.0 or height <= base:
		return base
	return minf(height, base + inset * 0.2)

func gap_allows(cx: float, cz: float, gap) -> bool:
	# Narrow thresholds use centered links instead of letting a two-meter cell clip a jamb.
	var width: float = gap.x1 - gap.x0 if gap.axis == "x" else gap.z1 - gap.z0
	if width < 2.0 + body_margin * 2.0:
		return false
	var inset := float(gap.inset)
	if str(gap.axis) == "x":
		return cx >= float(gap.x0) + inset and cx <= float(gap.x1) - inset and cz >= float(gap.z0) and cz <= float(gap.z1)
	return cz >= float(gap.z0) + inset and cz <= float(gap.z1) - inset and cx >= float(gap.x0) and cx <= float(gap.x1)

func whitelisted(cx: float, cz: float) -> bool:
	for gap in passages:
		if gap.door != null and not gap.door.open:
			continue
		if gap_allows(cx, cz, gap):
			return true
	return false

func blocker_name(cx: float, cz: float) -> String:
	if in_water(cx, cz) and not on_bridge(cx, cz):
		return "water"
	var foot := ground_y(cx, cz)
	var probe := Vector3(cx, foot + 1.0, cz)
	for solid in solids:
		if blocks_now(solid) and solid.aabb.has_point(probe):
			return str(solid.body.name)
	return "free"

# A cell is walkable only when its whole square, with room for a body around it, is clear.
# A centre-only test lets the mesh leak through walls thinner than a cell.
func blocked_point(cx: float, cz: float) -> bool:
	if in_cliff(cx, cz):
		return true
	if cx >= -639.5 and cx <= -634.5 and cz >= -566.7 and cz <= -553.0:
		return true
	# This chamber uses a floor mesh with a shared junction to the main gallery.
	if cx > 34.0 and cx < 44.0 and absf(cz + 760.0) < 2.5:
		return true
	for opening in open_passages:
		var relative := Vector3(cx, 0, cz) - (opening.center as Vector3)
		var normal: Vector3 = opening.normal
		if absf(relative.dot(normal)) <= float(opening.thick) * 0.5 + 1.0 and absf(relative.dot(normal.cross(Vector3.UP))) <= float(opening.width) * 0.5 + 1.0:
			return true
	if whitelisted(cx, cz):
		return false
	if in_water(cx, cz) and not on_bridge(cx, cz):
		return true
	var foot := ground_y(cx, cz)
	var half := 1.0 + body_margin
	var box := AABB(Vector3(cx - half, foot + 0.35, cz - half), Vector3(half * 2.0, 1.3, half * 2.0))
	for solid in solids:
		if blocks_now(solid) and solid.aabb.intersects(box):
			return true
	return false

func blocked_coarse(cx: float, cz: float, step: float) -> bool:
	if in_cliff(cx, cz):
		return true
	if in_water(cx, cz) and not on_bridge(cx, cz):
		return true
	var foot := ground_y(cx, cz)
	var box := AABB(Vector3(cx - step * 0.5, foot + 0.35, cz - step * 0.5), Vector3(step, 1.3, step))
	for solid in solids:
		if blocks_now(solid) and solid.aabb.intersects(box):
			return true
	return false

func sync_nav() -> void:
	NavigationServer3D.map_set_use_async_iterations(map_rid, false)
	NavigationServer3D.map_force_update(map_rid)

func build_navigation() -> void:
	var started := Time.get_ticks_msec()
	map_rid = NavigationServer3D.map_create()
	NavigationServer3D.map_set_active(map_rid, true)
	NavigationServer3D.map_set_use_async_iterations(map_rid, false)
	NavigationServer3D.map_set_up(map_rid, Vector3.UP)
	NavigationServer3D.map_set_edge_connection_margin(map_rid, 0.45)
	NavigationServer3D.map_set_link_connection_radius(map_rid, 2.0)
	fill_navmesh()
	var mesh := NavigationMesh.new()
	mesh.vertices = nav_verts
	for poly in nav_polys:
		mesh.add_polygon(poly)
	region_rid = NavigationServer3D.region_create()
	NavigationServer3D.region_set_use_async_iterations(region_rid, false)
	NavigationServer3D.region_set_navigation_mesh(region_rid, mesh)
	NavigationServer3D.region_set_map(region_rid, map_rid)
	build_links()
	sync_nav()
	print("NAV polys=%d verts=%d mesh=%d/%d first=%s iteration=%d ms=%d" % [nav_polys.size(), nav_verts.size(), mesh.vertices.size(), mesh.get_polygon_count(), nav_verts[0], NavigationServer3D.map_get_iteration_id(map_rid), Time.get_ticks_msec() - started])

func fill_navmesh() -> void:
	nav_verts = PackedVector3Array()
	nav_polys = []
	vert_index = {}
	nav_covers = []
	road_links = []
	corner_height = {}
	cover_raster(-56, 184, -104, 108, 2)
	cover_raster(-136, -104, -8, 30, 2)
	cover_raster(0, 100, -760, -546, 2)
	cover_raster(-320, -240, 120, 210, 2)
	cover_raster(100, 190, 330, 430, 2)
	cover_raster(-690, -590, -610, -510, 2)
	cover_raster(-772, -748, -442, -404, 2)
	cover_raster(-732, -708, -373, -335, 2)
	cover_raster(284, 326, 8, 32, 2)
	cover_raster(480, 570, 0, 80, 2)
	cover_raster(754, 804, -204, -156, 2)
	cover_raster(20, 70, -910, -762, 2)
	var portal := v3(layout.mine.portal)
	var mine_start := portal + Vector3(0, 0, 0.5)
	var mine_end := Vector3(portal.x, portal.y, float(layout.mine.level1_to_z) + 4.0)
	var junction_north := Vector3(portal.x, portal.y, -760.8)
	var junction_south := Vector3(portal.x, portal.y, -759.2)
	push_ribbon(mine_start, junction_south, 1.35)
	push_ribbon(junction_south, junction_north, 1.35)
	push_ribbon(junction_north, mine_end, 1.35)
	push_ribbon(Vector3(36, portal.y, -760), Vector3(portal.x - 0.675, portal.y, -760), 1.6)
	var shaft := v3(layout.mine.shaft)
	var deep_y := float(layout.mine.level2_y)
	var deep_from := Vector3(shaft.x, deep_y, shaft.z + 1.0)
	var deep_to := Vector3(shaft.x, deep_y, float(layout.mine.level2_to_z))
	push_ribbon(deep_from, deep_to, 1.5)
	push_ribbon(Vector3(-637, 38, -566.4), Vector3(-637, 30, -554.4), 1.7)
	push_ribbon(Vector3(-637, 30, -554.4), Vector3(-637, 30, -553.65), 1.7)
	push_quad(Vector3(-642.65, 30, -552.4), Vector3(-631.35, 30, -552.4), Vector3(-631.35, 30, -541.55), Vector3(-642.65, 30, -541.55))
	push_ribbon(Vector3(-643.2, 38, -554.2), Vector3(-643.2, 47, -564.8), 1.45)
	push_ribbon(Vector3(-643.2, 47, -564.8), Vector3(-643.2, 47, -565.7), 1.45)
	for platform in layout.platforms:
		if not str(platform.id).begins_with("treewatch_"):
			continue
		var size := v3(platform.size)
		var c := v3(platform.center) + Vector3.UP * size.y * 0.5
		var a := Vector3(size.x * 0.5 - 0.25, 0, 0)
		var b := Vector3(0, 0, size.z * 0.5 - 0.25)
		push_quad(c - a - b, c + a - b, c + a + b, c - a + b)
	for road in roads:
		push_road_chain(road.points, float(road.width))

func cover_raster(x0: int, x1: int, z0: int, z1: int, step: int) -> void:
	var half := float(step) * 0.5
	nav_covers.append({
		"x0": float(x0) - half, "x1": float(x1) + half,
		"z0": float(z0) - half, "z1": float(z1) + half,
	})
	raster(x0, x1, z0, z1, step, true)

func in_nav_cover(x: float, z: float, pad: float) -> bool:
	for rect in nav_covers:
		if x >= float(rect.x0) - pad and x <= float(rect.x1) + pad and z >= float(rect.z0) - pad and z <= float(rect.z1) + pad:
			return true
	return false

func push_road_chain(raw: Array, width: float) -> void:
	if raw.size() < 2:
		return
	var samples: Array[Vector3] = []
	for i in range(raw.size() - 1):
		var a: Vector3 = raw[i]
		var b: Vector3 = raw[i + 1]
		var length := Vector2(b.x - a.x, b.z - a.z).length()
		var steps := maxi(1, int(ceil(length / 4.0)))
		for s in range(steps):
			samples.append(a.lerp(b, float(s) / float(steps)))
	samples.append(raw[raw.size() - 1])
	var pad := width * 0.5 + 0.25
	var run: Array[Vector3] = []
	var previous := samples[0]
	var previous_inside := in_nav_cover(previous.x, previous.z, pad)
	if not previous_inside:
		run.append(previous)
	for i in range(1, samples.size()):
		var point: Vector3 = samples[i]
		var inside := in_nav_cover(point.x, point.z, pad)
		if inside:
			if run.size() >= 2:
				emit_miter_strip(run, width)
				road_links.append({"a": run[run.size() - 1], "b": inland_toward(run[run.size() - 1], point)})
			elif not run.is_empty() and previous_inside == false:
				road_links.append({"a": run[0], "b": inland_toward(run[0], point)})
			run = []
		else:
			if run.is_empty() and previous_inside:
				road_links.append({"a": point, "b": inland_toward(point, previous)})
			run.append(point)
		previous = point
		previous_inside = inside
	if run.size() >= 2:
		emit_miter_strip(run, width)

func inland_toward(outside: Vector3, toward: Vector3) -> Vector3:
	var delta := toward - outside
	var flat := Vector2(delta.x, delta.z).length()
	if flat < 0.05:
		delta = Vector3(1, 0, 0)
		flat = 1.0
	var step := delta / flat
	var point := outside
	for _i in range(48):
		point += step
		if in_nav_cover(point.x, point.z, 0.0):
			point += step * 1.1
			point.y = ground_y(point.x, point.z)
			return point
	point.y = ground_y(point.x, point.z)
	return point

func emit_miter_strip(pts: Array[Vector3], width: float) -> void:
	var left: Array[Vector3] = []
	var right: Array[Vector3] = []
	for i in range(pts.size()):
		var prev: Vector3 = pts[i] if i == 0 else pts[i - 1]
		var next: Vector3 = pts[i] if i == pts.size() - 1 else pts[i + 1]
		var flat := Vector3(next.x - prev.x, 0, next.z - prev.z)
		if flat.length() < 0.001:
			flat = Vector3(1, 0, 0)
		var side := Vector3(-flat.z, 0, flat.x).normalized() * width * 0.5
		var point: Vector3 = pts[i]
		left.append(point + side)
		right.append(point - side)
	for i in range(pts.size() - 1):
		push_quad(left[i], left[i + 1], right[i + 1], right[i])

func raster(x0: int, x1: int, z0: int, z1: int, step: int, fine: bool) -> void:
	var z := z0
	while z <= z1:
		var x := x0
		var run_x = null
		var run_y := 0.0
		while x <= x1:
			var fx := float(x)
			var fz := float(z)
			var free := false
			if fine or not in_fine(fx, fz):
				free = not (blocked_point(fx, fz) if fine else blocked_coarse(fx, fz, float(step)))
			var y := ground_y(fx, fz)
			if free and run_x != null and absf(y - run_y) < 0.001 and int((x - int(run_x)) / step) < 30:
				x += step
				continue
			if run_x != null:
				emit_run(int(run_x), x - step, z, step, run_y)
				run_x = null
			if free:
				run_x = x
				run_y = y
			x += step
		if run_x != null:
			emit_run(int(run_x), x - step, z, step, run_y)
		z += step

func emit_run(x_start: int, x_end: int, z: int, step: int, _y: float) -> void:
	var half := float(step) * 0.5
	var z0 := float(z) - half
	var z1 := float(z) + half
	var x := x_start
	while x <= x_end:
		var x0 := float(x) - half
		var x1 := float(x) + half
		nav_polys.append(PackedInt32Array([
			nav_vertex(x0, corner_y(x0, z0), z0),
			nav_vertex(x1, corner_y(x1, z0), z0),
			nav_vertex(x1, corner_y(x1, z1), z1),
			nav_vertex(x0, corner_y(x0, z1), z1),
		]))
		x += step

func corner_y(x: float, z: float) -> float:
	var key := "%d,%d" % [int(round(x * 1000.0)), int(round(z * 1000.0))]
	if corner_height.has(key):
		return float(corner_height[key])
	var y := ground_y(x, z)
	corner_height[key] = y
	return y

func nav_vertex(x: float, y: float, z: float) -> int:
	var key := "%d,%d,%d" % [int(round(x * 1000.0)), int(round(y * 1000.0)), int(round(z * 1000.0))]
	if vert_index.has(key):
		return int(vert_index[key])
	var idx := nav_verts.size()
	nav_verts.append(Vector3(x, y, z))
	vert_index[key] = idx
	return idx

func push_ribbon(a: Vector3, b: Vector3, width: float) -> void:
	var flat := Vector3(b.x - a.x, 0, b.z - a.z)
	if flat.length() < 0.05:
		return
	var side := Vector3(-flat.z, 0, flat.x).normalized() * width * 0.5
	push_quad(a + side, b + side, b - side, a - side)

func push_quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3) -> void:
	var pts: Array[Vector3] = [a, b, c, d]
	if (b - a).cross(c - a).y < 0.0:
		pts = [a, d, c, b]
	var base := nav_verts.size()
	for point in pts:
		nav_verts.append(point)
	nav_polys.append(PackedInt32Array([base, base + 1, base + 2, base + 3]))

func build_links() -> void:
	for link_rid in link_rids:
		NavigationServer3D.free_rid(link_rid)
	link_rids.clear()
	for spec in layout.links:
		add_link(v3(spec["from"]), v3(spec.to), spec.get("control", "") != "treewatch_ladder" or ladder_lowered)
	var portal := v3(layout.mine.portal)
	add_link(portal + Vector3(0, 0, 3.0), portal + Vector3(0, 0, -2.0), true)
	var vault = doors.get("rune_vault")
	if vault != null:
		add_link(Vector3(-637, 30, -554.1), Vector3(-637, 30, -552.1), vault.open)
	add_link(Vector3(-637, 38, -568.0), Vector3(-637, 38, -566.4), true)
	add_link(Vector3(-643.2, 38, -553.4), Vector3(-643.2, 38, -554.2), true)
	for id in doors:
		link_door(doors[id])
	for opening in open_passages:
		var reach := float(opening.thick) * 0.5 + 1.5
		var a: Vector3 = opening.center - opening.normal * reach
		var b: Vector3 = opening.center + opening.normal * reach
		a.y = ground_y(a.x, a.z)
		b.y = ground_y(b.x, b.z)
		add_link(a, b, true)
	for spec in road_links:
		add_link(spec.a, spec.b, true)
	print("ROAD_LINKS ", road_links.size())

# A doorway is narrower than a navigation cell, so an open door is crossed by a link.
func link_door(door) -> void:
	if door.solid == null or str(door.id) == "rune_vault":
		return
	var box: AABB = door.solid.aabb
	var center := box.get_center()
	if box.size.y < DOORWAY or box.position.y - ground_y(center.x, center.z) > 1.0:
		return
	var along := Vector3.RIGHT if box.size.x < box.size.z else Vector3.BACK
	var reach := minf(box.size.x, box.size.z) * 0.5 + 1.5
	var a := center - along * reach
	var b := center + along * reach
	a.y = ground_y(a.x, a.z)
	b.y = ground_y(b.x, b.z)
	add_link(a, b, door.open)

func add_link(a: Vector3, b: Vector3, enabled: bool) -> void:
	var link := NavigationServer3D.link_create()
	NavigationServer3D.link_set_map(link, map_rid)
	NavigationServer3D.link_set_start_position(link, a)
	NavigationServer3D.link_set_end_position(link, b)
	NavigationServer3D.link_set_bidirectional(link, true)
	NavigationServer3D.link_set_enabled(link, enabled)
	link_rids.append(link)

func refresh_nav() -> void:
	if navigation_dirty:
		rebuild_nav()

func rebuild_nav() -> void:
	navigation_dirty = false
	if region_rid.is_valid():
		NavigationServer3D.free_rid(region_rid)
	for link_rid in link_rids:
		NavigationServer3D.free_rid(link_rid)
	link_rids.clear()
	region_rid = RID()
	build_navigation_mesh_only()

func build_navigation_mesh_only() -> void:
	fill_navmesh()
	var mesh := NavigationMesh.new()
	mesh.vertices = nav_verts
	for poly in nav_polys:
		mesh.add_polygon(poly)
	region_rid = NavigationServer3D.region_create()
	NavigationServer3D.region_set_use_async_iterations(region_rid, false)
	NavigationServer3D.region_set_navigation_mesh(region_rid, mesh)
	NavigationServer3D.region_set_map(region_rid, map_rid)
	build_links()
	sync_nav()

func self_test_paths() -> void:
	sample_path("along_x", Vector3(0, 0, 0), Vector3(40, 0, 0))
	sample_path("down_z", Vector3(50, 0, 0), Vector3(50, 0, -8))
	sample_path("road_seg", Vector3(-180, 2, 15), Vector3(-120, 1, 8))
	sample_path("kael_gate", Vector3(-180, 2, 15), Vector3(-36, 0, 0))
	sample_path("gate_guild", Vector3(-28, 0, 0), Vector3(85, 0, -27))
	sample_path("anvil_square", Vector3(40, 26, -640), Vector3(50, 0, 0))
	sample_path("square_tree", Vector3(50, 0, 0), Vector3(520, 18, 40))

func nav_path(a: Vector3, b: Vector3, optimize: bool) -> PackedVector3Array:
	var params := NavigationPathQueryParameters3D.new()
	params.map = map_rid
	params.start_position = a
	params.target_position = b
	params.path_search_max_polygons = 100000
	params.path_postprocessing = NavigationPathQueryParameters3D.PATH_POSTPROCESSING_CORRIDORFUNNEL if optimize else NavigationPathQueryParameters3D.PATH_POSTPROCESSING_EDGECENTERED
	var result := NavigationPathQueryResult3D.new()
	NavigationServer3D.query_path(params, result)
	return result.path

func sample_path(label: String, a: Vector3, b: Vector3) -> void:
	var ca := NavigationServer3D.map_get_closest_point(map_rid, a)
	var cb := NavigationServer3D.map_get_closest_point(map_rid, b)
	var path := nav_path(ca, cb, true)
	var raw := nav_path(ca, cb, false)
	var length := 0.0
	for i in range(1, path.size()):
		length += path[i - 1].distance_to(path[i])
	var raw_length := 0.0
	for i in range(1, raw.size()):
		raw_length += raw[i - 1].distance_to(raw[i])
	var tail: Vector3 = path[path.size() - 1] if path.size() else Vector3.INF
	print("SELFTEST %s points=%d length=%.1f raw=%d/%.1f snap=%.1f/%.1f end=%s goal=%s" % [label, path.size(), length, raw.size(), raw_length, ca.distance_to(a), cb.distance_to(b), tail, cb])

func listen() -> void:
	var err := server.listen(PORT, "127.0.0.1")
	if err != OK:
		print("WISPIVA_BIND_FAIL ", err)
		return
	ready_net = true
	print("WISPIVA_READY port=%d" % PORT)

func _process(delta: float) -> void:
	if watching:
		watch_step(delta)
	if not ready_net:
		return
	if server.is_connection_available():
		var peer := server.take_connection()
		peer.set_no_delay(true)
		peers.append({"peer": peer, "buf": ""})
	var drop: Array[int] = []
	for i in range(peers.size()):
		var slot = peers[i]
		var peer: StreamPeerTCP = slot.peer
		if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			drop.append(i)
			continue
		var available := peer.get_available_bytes()
		if available > 0:
			slot.buf += peer.get_utf8_string(available)
		while true:
			var buf := str(slot.buf)
			var nl := buf.find("\n")
			if nl < 0:
				break
			var line := buf.substr(0, nl).strip_edges()
			slot.buf = buf.substr(nl + 1)
			if line == "":
				continue
			var response = handle_line(line)
			peer.put_data((JSON.stringify(response) + "\n").to_utf8_buffer())
	for j in range(drop.size() - 1, -1, -1):
		peers.remove_at(drop[j])

func handle_line(line: String):
	var parsed = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {"id": "", "ok": false, "error": {"code": "bad_json", "message": "expected an object"}}
	var response = dispatch(str(parsed.get("role", "agent")), str(parsed.get("agentId", "")), str(parsed.get("tool", "")), parsed.get("args", {}))
	response["id"] = str(parsed.get("id", ""))
	return response

func dispatch(role: String, agent_id: String, tool: String, args) -> Dictionary:
	if typeof(args) != TYPE_DICTIONARY:
		args = {}
	if role == "host":
		match tool:
			"world_step": return tool_step(args)
			"world_snapshot": return tool_snapshot()
			"world_inject_event": return tool_inject(args)
			"host_pending": return tool_pending(args)
			"host_nav": return tool_nav(args)
			_: return fail("unknown_tool", "unknown host tool " + tool)
	if role != "agent":
		return fail("forbidden", "unknown role")
	if not agents_by_id.has(agent_id):
		return fail("unknown_agent", "unknown agent")
	var agent = agents_by_id[agent_id]
	if tool == "status":
		return ok(status_of(agent))
	if agent.dead or agent.unconscious:
		return fail("rejected", "you cannot act while unconscious or dead")
	if pending_actions.has(agent_id) and tool not in ["status", "look", "inspect"]:
		return fail("busy", "finish your current action first")
	match tool:
		"look": return tool_look(agent, args)
		"inspect": return tool_inspect(agent, args)
		"sense_mana": return tool_sense(agent, args)
		"move_to": return tool_move(agent, args)
		"toggle_lock": return tool_lock(agent, args)
		"transfer_item": return tool_transfer(agent, args)
		"cart": return tool_cart(agent, args)
		"work_craft": return tool_craft(agent, args)
		"rest": return tool_rest(agent, args)
		"speak": return tool_speak(agent, args)
		"trade": return tool_trade(agent, args)
		"guild_contract": return tool_contract(agent, args)
		"suppress_mana": return tool_suppress(agent, args)
		"cast_spell": return tool_cast(agent, args)
		_: return fail("unknown_tool", "unknown tool " + tool)

func ok(result) -> Dictionary:
	return {"ok": true, "result": result}

func fail(code: String, message: String) -> Dictionary:
	return {"ok": false, "error": {"code": code, "message": message}}

func clock_hour() -> int:
	return int(clock_minute_of_day() / 60)

func clock_minute_of_day() -> int:
	return (360 + minute) % MINUTES_PER_DAY

func clock_day() -> int:
	return 1 + int((360 + minute) / MINUTES_PER_DAY)

func clock_label() -> String:
	return "Day %d %02d:%02d" % [clock_day(), clock_hour(), clock_minute_of_day() % 60]

func season() -> String:
	return SEASONS[int((clock_day() - 1) / 30) % SEASONS.size()]

func weather_region(pos: Vector3) -> String:
	if pos.x >= 260.0:
		return "whisperwood"
	if pos.x <= -350.0 and pos.z <= -200.0:
		return "sunken_spire"
	if pos.z <= -300.0:
		return "anvil_valley"
	if pos.z > 90.0:
		return "south_farms"
	return "stonebridge"

func local_weather(pos: Vector3) -> String:
	return regional_weather[weather_region(pos)]

func update_weather() -> void:
	var pool: Array
	match season():
		"summer":
			pool = ["clear", "clear", "clear", "overcast", "rain", "storm"]
		"winter":
			pool = ["clear", "overcast", "snow", "snow", "snow", "blizzard"]
		_:
			pool = ["clear", "clear", "overcast", "rain", "rain", "storm"]
	for region in regional_weather:
		if regional_weather[region] not in pool or weather_rng.randf() < 0.35:
			regional_weather[region] = pool[weather_rng.randi_range(0, pool.size() - 1)]

func update_sky(weather_now: String) -> void:
	if sky_minute == minute and sky_weather == weather_now:
		return
	sky_minute = minute
	sky_weather = weather_now
	var hour := clock_minute_of_day() / 60.0
	var daylight := smoothstep(5.0, 7.5, hour) * (1.0 - smoothstep(18.0, 20.0, hour))
	var cloud := 0.0 if weather_now == "clear" else 0.48 if weather_now == "overcast" else 0.72
	var brightness := daylight * (1.0 - cloud * 0.65)
	sun_light.rotation_degrees = Vector3(-lerpf(5.0, 60.0, daylight), 18.0 + (hour - 12.0) * 12.0, 0.0)
	sun_light.light_energy = 1.25 * brightness
	sky_material.sky_top_color = Color(0.027, 0.045, 0.09).lerp(Color(0.23, 0.4, 0.68), brightness)
	sky_material.sky_horizon_color = Color(0.085, 0.12, 0.19).lerp(Color(0.74, 0.78, 0.8), daylight)
	world_environment.ambient_light_energy = lerpf(0.18, 0.42, brightness)
	world_environment.fog_density = 0.00065 + cloud * 0.002
	world_environment.fog_light_color = Color(0.10, 0.15, 0.24).lerp(Color(0.7, 0.76, 0.8), daylight)

func eye(actor) -> float:
	return float(actor.height) - 0.15

func place_pos(name: String):
	if carts.has(name):
		return (carts[name].body.global_position as Vector3) - Vector3.UP * CART_SIZE.y * 0.5
	if fixtures.has(name):
		return v3(fixtures[name].spec.approaches[0])
	if layout.places.has(name):
		return v3(layout.places[name])
	if agents_by_id.has(name):
		return agents_by_id[name].pos
	for beast in wildlife:
		if beast.id == name:
			return beast.pos
	if doors.has(name):
		return doors[name].body.global_position
	# "West Gate", "west gate" and "west-gate" all name west_gate.
	var key := name.to_lower().replace(" ", "_").replace("-", "_")
	if key != name and (layout.places.has(key) or doors.has(key)):
		return place_pos(key)
	return null

func tool_look(agent, args) -> Dictionary:
	var focus := str(args.get("focus", ""))
	if focus != "":
		face_focus(agent, focus)
	sync_body(agent)
	var seen_agents: Array = []
	var seen_doors: Array = []
	var seen_fixtures: Array = []
	var reach := view_range(agent)
	for other in actors():
		if other.id == agent.id:
			continue
		# Someone close enough to touch is noticed without turning to look.
		if can_see(agent, other.pos + Vector3(0, eye(other) * 0.85, 0), other.body, reach, flat_dist(agent.pos, other.pos) > 2.0):
			seen_agents.append({"id": other.id, "name": other.name, "distance_m": round2(flat_dist(agent.pos, other.pos))})
	for door_id in doors.keys():
		var door = doors[door_id]
		var pos: Vector3 = door.body.global_position
		if can_see(agent, pos, door.body, reach):
			seen_doors.append({"id": door_id, "open": door.open, "lock": door.lock, "distance_m": round2(flat_dist(agent.pos, pos))})
	for wagon in carts.values():
		var center: Vector3 = wagon.body.global_position
		if can_see(agent, center, wagon.body, reach):
			seen_fixtures.append({"id": wagon.id, "name": wagon.name, "kind": "cart", "distance_m": round2(flat_dist(agent.pos, center))})
	for fixture in fixtures.values():
		if not fixture.body.visible:
			continue
		var pos: Vector3 = fixture.body.global_position
		if can_see(agent, pos, fixture.body, reach):
			var details := fixture_label(fixture)
			details["distance_m"] = round2(flat_dist(agent.pos, pos))
			seen_fixtures.append(details)
	for barrier in barriers:
		if barrier.body.visible and can_see(agent, barrier.body.global_position, barrier.body, reach):
			seen_fixtures.append({"id": str(barrier.body.name), "kind": "barrier", "integrity": barrier.body.get_meta("mana_integrity"), "distance_m": round2(agent.pos.distance_to(barrier.body.global_position))})
	return ok({
		"clock": clock_label(),
		"weather": local_weather(agent.pos),
		"season": season(),
		"facing": facing_name(agent.yaw),
		"view_range_m": reach,
		"visible_agents": seen_agents,
		"visible_doors": seen_doors,
		"visible_fixtures": seen_fixtures,
		"visible_traces": visible_traces(agent),
	})

func face_focus(agent, focus: String) -> void:
	var dirs := {"east": 0.0, "south": PI * 0.5, "west": PI, "north": -PI * 0.5}
	if dirs.has(focus):
		agent.yaw = dirs[focus]
		return
	if traces.has(focus):
		var target: Vector3 = traces[focus].pos
		agent.yaw = atan2(target.z - agent.pos.z, target.x - agent.pos.x)
		return
	if fixtures.has(focus):
		var target: Vector3 = fixtures[focus].body.global_position
		agent.yaw = atan2(target.z - agent.pos.z, target.x - agent.pos.x)
		return
	var pos = place_pos(focus)
	if pos != null:
		agent.yaw = atan2(pos.z - agent.pos.z, pos.x - agent.pos.x)

func facing_name(yaw: float) -> String:
	var names := ["east", "south", "west", "north"]
	var idx := int(round(wrapf(yaw, -PI, PI) / (PI * 0.5)))
	return names[posmod(idx, 4)]

func can_see(agent, target: Vector3, body: Node, reach: float, cone := true) -> bool:
	var from := (agent.pos as Vector3) + Vector3(0, eye(agent), 0)
	if from.distance_to(target) > reach:
		return false
	if cone:
		var ang := atan2(target.z - from.z, target.x - from.x)
		if absf(wrapf(ang - agent.yaw, -PI, PI)) > deg_to_rad(55.0):
			return false
	var query := PhysicsRayQueryParameters3D.create(from, target, SIGHT_MASK)
	query.exclude = [agent.body.get_rid()]
	var hit := space().intersect_ray(query)
	if hit.is_empty():
		return true
	return hit.collider == body

func view_range(agent) -> float:
	if underground_dark(agent.pos) and not has_light(agent):
		return 0.0
	if underground_dark(agent.pos):
		return 12.0
	var hour := clock_hour()
	var base := 35.0
	if hour >= 6 and hour < 19:
		base = 200.0
	elif (hour >= 19 and hour < 20) or (hour >= 5 and hour < 6):
		base = 70.0
	var weather := local_weather(agent.pos)
	if weather == "rain" or weather == "snow":
		base *= 0.85
	if weather == "storm" or weather == "blizzard":
		base *= 0.6
	return base

func has_light(agent) -> bool:
	if int(agent.light_until) > minute:
		return true
	for item_id in ["torch", "lantern", "lamp_stone"]:
		if qty_of(agent.items, item_id) > 0:
			return true
	return false

func underground_dark(pos: Vector3) -> bool:
	if (absf(pos.x + 760.0) <= 3.5 and absf(pos.z + 423.0) <= 10.5 and pos.y >= 41.5) or (absf(pos.x + 720.0) <= 3.5 and absf(pos.z + 354.0) <= 10.5 and pos.y >= 39.5):
		return true
	if pos.y < 35.0 and pos.x >= -643.1 and pos.x <= -630.9 and pos.z >= -563.0 and pos.z <= -540.9:
		return true
	if pos.y < 20.0 and absf(pos.x - 45.0) < 6.0 and pos.z < -760.0:
		return true
	if pos.x >= 34.2 and pos.x < 43.6 and absf(pos.z + 760.0) < 2.4 and absf(pos.y - 28.0) < 2.5:
		return true
	if absf(pos.x - 45.0) < 4.0 and pos.z < -700.0 and pos.y > 20.0:
		return true
	return false

func in_mine_water(pos: Vector3) -> bool:
	return absf(pos.x - 45.0) <= 1.35 and absf(pos.y - 14.0) < 0.8 and pos.z <= -828.0 and pos.z >= -856.0

func tool_inspect(agent, args) -> Dictionary:
	var target_id := str(args.get("target_id", ""))
	for barrier in barriers:
		if str(barrier.body.name) != target_id or not barrier.body.visible:
			continue
		if not can_see(agent, barrier.body.global_position, barrier.body, 3.5, false):
			return fail("blocked", "the barrier is beyond reach or behind an obstruction")
		return ok({"id": target_id, "kind": "barrier", "integrity": barrier.body.get_meta("mana_integrity"), "until_minute": barrier.until})
	if traces.has(target_id):
		var trace: Dictionary = traces[target_id]
		if agent.pos.distance_to(trace.pos) > 3.5:
			return fail("too_far", "the trace is beyond reach")
		if not can_see(agent, trace.pos + Vector3.UP * 0.08, null, view_range(agent), false):
			return fail("blocked", "you cannot see the trace from here")
		return ok(trace_details(trace))
	if carts.has(target_id):
		var wagon: Dictionary = carts[target_id]
		var center: Vector3 = wagon.body.global_position
		if agent.pos.distance_to(center) > 3.4:
			return fail("too_far", "you are not beside that cart")
		if not can_see(agent, center, wagon.body, view_range(agent), false):
			return fail("blocked", "you cannot see the cart from here")
		return ok(cart_status(wagon))
	if fixtures.has(target_id):
		var fixture: Dictionary = fixtures[target_id]
		var obstructed := fixture_access_error(agent, fixture)
		if not obstructed.is_empty():
			return obstructed
		var details := fixture_label(fixture)
		if fixture.spec.kind == "fire":
			details["lit"] = int(fixture.lit_until) > minute
		if fixture.spec.kind == "field":
			var plot: Dictionary = crop_plots[target_id]
			details["crop_state"] = crop_state(plot)
			details["growth_minutes"] = int(plot.growth)
			details["growth_required"] = GRAIN_GROWTH_MINUTES
			details["recipes"] = {"sow_grain": RECIPES.sow_grain, "harvest_grain": RECIPES.harvest_grain}
		if fixture.spec.kind == "orchard":
			details["in_season"] = season() in ["summer", "autumn"]
		if fixture.spec.has("text"):
			details["text"] = fixture.spec.text
		if fixture.spec.kind == "ladder":
			details["lowered"] = ladder_lowered
		if fixture.spec.has("recipe"):
			var recipe_id: String = fixture.spec.recipe
			details["recipe_id"] = recipe_id
			details["recipe"] = RECIPES[recipe_id]
			if fixture.batches >= 0:
				details["remaining_batches"] = fixture.batches
			if fixture.spec.has("stock"):
				details["stock"] = inventory_out(containers[fixture.spec.stock].items)
		elif containers.has(target_id):
			var box: Dictionary = containers[target_id]
			var door_id: String = box.get("door", "")
			details["accessible"] = door_id == "" or doors[door_id].open
			if details.accessible:
				details["stock"] = inventory_out(box.items)
		return ok(details)
	if target_id in ["ferry_east", "ferry_west"]:
		if flat_dist(agent.pos, place_pos(target_id)) > 7.0 or absf(agent.pos.y) > 2.0:
			return fail("too_far", "you are not beside the ferry pier")
		return ok(ferry_status())
	if doors.has(target_id):
		var door: Dictionary = doors[target_id]
		var center: Vector3 = door.body.global_position
		if flat_dist(agent.pos, center) > 2.5 or absf(agent.pos.y - center.y) > 2.5:
			return fail("too_far", "too far to inspect")
		if not can_see(agent, center, door.body, view_range(agent), false):
			return fail("blocked", "you cannot see the door from here")
		return ok({"id": target_id, "open": door.open, "lock": door.lock, "material": door.material, "mana_sealed": door.mana_sealed, "needs_key": door.key != ""})
	var pos = place_pos(target_id)
	if pos == null:
		return fail("bad_args", "unknown target")
	if flat_dist(agent.pos, pos) > 2.5 or absf(agent.pos.y - pos.y) > 2.5:
		return fail("too_far", "too far to inspect")
	if agents_by_id.has(target_id) or find_wild(target_id) != null:
		var other = agents_by_id[target_id] if agents_by_id.has(target_id) else find_wild(target_id)
		if not can_see(agent, other.pos + Vector3.UP * eye(other), other.body, view_range(agent), false):
			return fail("blocked", "you cannot see that person from here")
		return ok({"id": other.id, "name": other.name, "race": other.race, "injuries": other.injuries, "condition": body_condition(other), "distance_m": round2(flat_dist(agent.pos, other.pos))})
	return ok({"id": target_id, "note": "a physical landmark", "distance_m": round2(flat_dist(agent.pos, pos))})

func fixture_label(fixture: Dictionary) -> Dictionary:
	var label := {"id": fixture.spec.id, "name": fixture.spec.name, "kind": fixture.spec.kind}
	if fixture.batches == 0:
		label["depleted"] = true
	return label

func fixture_access_error(agent, fixture: Dictionary) -> Dictionary:
	if not fixture.body.visible:
		return fail("depleted", "nothing remains at that spot")
	var target: Vector3 = fixture.body.global_position
	if fixture.spec.kind == "field":
		target = v3(fixture.spec.approaches[0]) + Vector3.UP * 0.65
	if agent.pos.distance_to(target) > FIXTURE_REACH:
		return fail("too_far", "you are not within reach of that fixture")
	if not can_see(agent, target, fixture.body, view_range(agent), false):
		return fail("blocked", "you cannot see that fixture from here")
	return {}

func fixture_approach(agent, fixture: Dictionary) -> Vector3:
	for point in fixture.spec.approaches:
		var target := v3(point)
		var snapped := NavigationServer3D.map_get_closest_point(map_rid, target)
		if snapped.distance_to(target) > 1.2:
			continue
		if space().intersect_shape(capsule_params(agent, snapped), 1).is_empty():
			return snapped
	return v3(fixture.spec.approaches[0])

func tool_sense(agent, args) -> Dictionary:
	var mode := str(args.get("mode", "pulse"))
	if mode not in ["pulse", "passive"]:
		return fail("bad_args", "mode must be pulse or passive")
	var reach := 5.0 if agent.suppressed and mode != "pulse" else 40.0
	var found: Array = []
	for other in actors():
		if other.id == agent.id or other.wild:
			continue
		var dist := (agent.pos as Vector3).distance_to(other.pos as Vector3)
		var limit := mana_reach(agent.pos, other.pos, reach)
		if dist > limit:
			continue
		var apparent := float(other.apparent) if other.suppressed else float(other.manaMax)
		found.append({"id": other.id, "direction": bearing(agent.pos, other.pos), "band": band(dist), "apparent_mana": int(apparent)})
	for fixture in fixtures.values():
		var id := str(fixture.spec.id)
		if id not in ["crystal_vein", "spire_crystals"] or fixture.batches == 0:
			continue
		var pos: Vector3 = fixture.body.global_position
		var dist: float = agent.pos.distance_to(pos)
		if dist <= mana_reach(agent.pos, pos, reach):
			found.append({"id": id, "direction": bearing(agent.pos, pos), "band": band(dist), "apparent_mana": 120 if id == "spire_crystals" else 60})
	var spring: Vector3 = v3(layout.places.sacred_spring)
	if agent.pos.distance_to(spring) <= mana_reach(agent.pos, spring, reach):
		found.append({"id": "sacred_spring", "direction": bearing(agent.pos, spring), "band": band(agent.pos.distance_to(spring)), "apparent_mana": 300})
	if mode == "pulse":
		for other in agents:
			if other.id == agent.id or float(other.manaMax) < 30.0:
				continue
			if other.pos.distance_to(agent.pos) <= mana_reach(agent.pos, other.pos, reach):
				push_event(other, {"type": "mana_pulse", "text": "A mana pulse swept over you."})
	return ok({"mode": mode, "signatures": found})

func mana_reach(a: Vector3, b: Vector3, reach: float) -> float:
	return minf(reach, 20.0) if stone_between(a, b) else reach

func stone_between(a: Vector3, b: Vector3) -> bool:
	# Test each real collider, including stone hidden behind a nearer wooden wall.
	for solid in solids:
		var body: StaticBody3D = solid.body
		if not body.visible or (body.collision_layer & (L_WORLD | L_DOOR | L_FLOOR)) == 0:
			continue
		if str(body.get_meta("material", "")) not in ["stone", "cliff"]:
			continue
		for child in body.get_children():
			if child is CollisionShape3D and not child.disabled and child.shape is BoxShape3D:
				var shape: BoxShape3D = child.shape
				var from: Vector3 = child.global_transform.affine_inverse() * (a + Vector3.UP * 1.2)
				var to: Vector3 = child.global_transform.affine_inverse() * (b + Vector3.UP * 1.2)
				if mana_stone_depth(from, to, shape.size) > 1.0:
					return true
	return false

func mana_stone_depth(from: Vector3, to: Vector3, size: Vector3) -> float:
	var delta := to - from
	var entry := 0.0
	var exit := 1.0
	for axis in range(3):
		var half := size[axis] * 0.5
		if absf(delta[axis]) < 0.00001:
			if absf(from[axis]) > half:
				return 0.0
			continue
		var first := (-half - from[axis]) / delta[axis]
		var last := (half - from[axis]) / delta[axis]
		entry = maxf(entry, minf(first, last))
		exit = minf(exit, maxf(first, last))
		if exit <= entry:
			return 0.0
	return delta.length() * (exit - entry)

func bearing(a: Vector3, b: Vector3) -> String:
	return facing_name(atan2(b.z - a.z, b.x - a.x))

func band(dist: float) -> String:
	if dist < 5.0:
		return "adjacent"
	if dist < 15.0:
		return "near"
	if dist < 30.0:
		return "mid"
	return "far"

func body_condition(agent) -> String:
	if agent.dead:
		return "dead"
	if agent.unconscious:
		return "unconscious"
	if agent.warmth < 35.0:
		return "hypothermic"
	return "conscious"

func status_of(agent) -> Dictionary:
	var mass := mass_of(agent)
	return {
		"agentId": agent.id,
		"name": agent.name,
		"x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z),
		"yaw": round2(agent.yaw),
		"inventory": inventory_out(agent.items),
		"mass_kg": round2(mass),
		"encumbrance": "overloaded" if mass >= 45.0 else "burdened" if mass > carry_threshold(agent) else "normal",
		"stamina": round2(agent.stamina),
		"hunger": round2(agent.hunger),
		"thirst": round2(agent.thirst),
		"wetness": round2(agent.wetness),
		"blood_loss": round2(agent.blood_loss),
		"condition": body_condition(agent),
		"sheltered": under_cover(agent.pos),
		"near_fire": warmth_from_fire(agent, minute),
		"ambient_c": round2(ambient_temperature(local_weather(agent.pos), clock_hour())),
		"splinted": agent.splinted,
		"warmth": round2(agent.warmth),
		"injuries": agent.injuries,
		"mana": round2(agent.mana),
		"manaMax": round2(agent.manaMax),
		"suppressed": agent.suppressed,
		"apparent_mana": int(agent.apparent if agent.suppressed else agent.manaMax),
		"sp": agent.sp,
		"cp": agent.cp,
		"clock": clock_label(),
		"action": pending_actions.get(str(agent.id), null),
		"cart_id": agent.cart_id if agent.cart_id != "" else null,
		"footing": "shallow_water" if in_mine_water(agent.pos) else "ground",
	}

func tool_move(agent, args) -> Dictionary:
	refresh_nav()
	var destination := str(args.get("destination", ""))
	var pace := str(args.get("pace", "walk"))
	if destination == "":
		return fail("bad_args", "destination is required")
	if pace != "walk" and pace != "run" and pace != "sneak":
		return fail("bad_args", "pace must be walk, run, or sneak")
	var dest = resolve_dest(destination)
	if dest == null:
		return fail("bad_args", "unknown destination; name a known place, a person, or x,y,z. Known places: " + ", ".join(layout.places.keys()))
	if fixtures.has(destination):
		dest = fixture_approach(agent, fixtures[destination])
	var landing = ferry_landing(agent.pos, dest)
	if landing != null:
		return board_ferry(agent, landing)
	if flat_dist(agent.pos, dest) < 1.2 and absf(agent.pos.y - dest.y) < 1.5:
		return ok({"arrived": true, "x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z), "distance_m": 0, "minutes": 0, "blocked": null})
	var approach := dest as Vector3
	if carts.has(destination):
		var delta: Vector3 = agent.pos - approach
		delta.y = 0
		if delta.length() >= 0.1:
			approach += delta.normalized() * 2.3
	var other = agent_named(destination)
	if other != null:
		var delta := (agent.pos as Vector3) - approach
		delta.y = 0
		if delta.length() < 0.2:
			delta = Vector3(1, 0, 0)
		approach = approach + delta.normalized() * 1.4
	var start := NavigationServer3D.map_get_closest_point(map_rid, agent.pos)
	var goal := NavigationServer3D.map_get_closest_point(map_rid, approach)
	if goal.distance_to(approach) > 5.0:
		return ok({"arrived": false, "reason": "not_walkable", "x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z), "distance_m": 0, "minutes": 0, "blocked": {"kind": "terrain", "id": "", "reason": "no walkable ground there"}})
	var path := nav_path(start, goal, true)
	# A shut door drops its crossing from the navigation mesh, so no path gets past it.
	var shut := {}
	if path.size() >= 2 and path[path.size() - 1].distance_to(approach) > 2.2:
		shut = shut_door_between(agent, approach)
	if not shut.is_empty():
		approach = door_front(shut, agent.pos)
		goal = NavigationServer3D.map_get_closest_point(map_rid, approach)
		path = nav_path(start, goal, true)
	if path.size() < 2:
		return ok({"arrived": false, "reason": "unreachable", "x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z), "distance_m": 0, "minutes": 0, "blocked": {"kind": "path", "id": "", "reason": "no navigation path"}})
	var preview := walk_path(agent, path)
	if preview.blocked != null and preview.blocked.kind in ["obstacle", "cart"]:
		# Shared-edge centres clear corners the shortened path can shave.
		var plain := nav_path(start, goal, false)
		if plain.size() >= 2 and walk_path(agent, plain).blocked == null:
			path = plain
	var used_pace := pace
	if pace == "run" and (mass_of(agent) >= 45.0 or agent.stamina < 15.0 or agent.cart_id != "" or "fractured" in agent.injuries):
		used_pace = "walk"
	var distance: float = agent.pos.distance_to(path[1])
	for index in range(2, path.size()):
		distance += path[index - 1].distance_to(path[index])
	var speed := speed_mpm(agent, used_pace)
	if agent.cart_id != "":
		var freight := cart_cargo_mass(carts[agent.cart_id])
		speed = minf(speed, lerpf(62.0, 39.0, freight / CART_CAPACITY_KG))
	var travel := {
		"path": path, "index": 1, "walked": 0.0, "pace": used_pace, "speed": speed,
		"approach": approach, "door": shut.get("id", ""), "blocked": null,
	}
	return start_action(agent, maxi(1, int(ceil(distance / speed))), {"kind": "walk", "destination": destination}, travel)

func walk_path(agent, path: PackedVector3Array, index := 1, budget := INF) -> Dictionary:
	var walked := 0.0
	var pos: Vector3 = agent.pos
	var blocked = null
	var wagon: Dictionary = carts.get(str(agent.cart_id), {})
	var wagon_pose := Transform3D.IDENTITY
	if not wagon.is_empty():
		wagon_pose = wagon.body.global_transform
	var pts: PackedVector3Array = [pos]
	while index < path.size() and walked < budget:
		var waypoint: Vector3 = path[index]
		var nxt := pos.move_toward(waypoint, budget - walked)
		var fraction := travel_fraction(agent, pos, nxt)
		if fraction < 0.96:
			var stop := pos.lerp(nxt, maxf(fraction - 0.05, 0.0))
			blocked = identify_block(agent, stop, nxt)
			nxt = stop
		if not wagon.is_empty():
			var proposed := cart_pose_after_step(pos, nxt, wagon_pose)
			if not cart_step_is_clear(agent, wagon, wagon_pose, proposed, pos, nxt):
				blocked = {"kind": "cart", "id": wagon.id, "reason": "the cart cannot clear this route"}
				break
			wagon_pose = proposed
		walked += pos.distance_to(nxt)
		pos = nxt
		pts.append(pos)
		if blocked != null:
			break
		if nxt.is_equal_approx(waypoint):
			index += 1
		else:
			break
	pts.append(pos)
	return {"pos": pos, "walked": walked, "blocked": blocked, "pts": pts, "index": index, "cart_pose": wagon_pose}

func tick_walk(agent, travel: Dictionary) -> bool:
	var pace := str(travel.pace)
	if pace == "run" and (agent.stamina < 15.0 or "fractured" in agent.injuries):
		pace = "walk"
		travel.pace = pace
	var speed := speed_mpm(agent, pace)
	if agent.cart_id != "":
		var freight := cart_cargo_mass(carts[agent.cart_id])
		speed = minf(speed, lerpf(62.0, 39.0, freight / CART_CAPACITY_KG))
	var step := walk_path(agent, travel.path, travel.index, speed)
	var previous: Vector3 = agent.pos
	var next: Vector3 = step.pos
	set_pos(agent, next)
	if agent.cart_id != "":
		move_cart(carts[agent.cart_id], step.cart_pose)
	if step.walked > 0.2:
		agent.yaw = atan2(next.z - previous.z, next.x - previous.x)
		var effort := 1.5 if in_mine_water(previous) or in_mine_water(next) else 1.0
		spend_travel(agent, travel.pace, effort)
		stroll(agent, step.pts, travel.pace)
		if wet_weather(local_weather(next)) and not under_cover(next):
			leave_trace("footprints", next)
		if "bleeding" in agent.injuries:
			leave_trace("blood", next)
	travel.walked += step.walked
	travel.index = step.index
	travel.blocked = step.blocked
	if travel.pace == "run" and step.blocked != null and step.walked > 2.0:
		BodyState.injure(agent, "bruised")
	return step.blocked != null or step.index >= travel.path.size()

func walk_result(agent, action: Dictionary, travel: Dictionary) -> Dictionary:
	var approach: Vector3 = travel.approach
	var reached := flat_dist(agent.pos, approach) <= 2.2 and absf(agent.pos.y - approach.y) <= 2.0
	var blocked = null if reached else travel.blocked
	if blocked == null and travel.door != "":
		var door = doors[travel.door]
		var why := "locked" if door.lock == "locked" else "closed"
		blocked = {"kind": "door", "id": door.id, "reason": "the door is " + why}
	elif blocked == null and not reached:
		blocked = {"kind": "path", "id": "", "reason": "no open route reaches that destination"}
	if blocked != null:
		watch_note(agent, str(blocked.reason), Color(1.0, 0.72, 0.35))
	return {
		"arrived": blocked == null and reached,
		"x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z),
		"distance_m": round2(travel.walked), "minutes": minute - int(action.started_at),
		"pace": travel.pace, "path_points": travel.path.size(), "blocked": blocked,
	}

func resolve_dest(destination: String):
	var named = place_pos(destination)
	if named != null:
		return named
	var other = agent_named(destination)
	if other != null:
		return other.pos
	var parts := destination.replace(" ", "").split(",")
	if parts.size() == 2 or parts.size() == 3:
		var x := float(parts[0])
		if parts.size() == 2:
			return Vector3(x, ground_y(x, float(parts[1])), float(parts[1]))
		return Vector3(x, float(parts[1]), float(parts[2]))
	return null

# People are named by id, by full name, or by one word of their name.
func agent_named(text: String):
	var wanted := text.strip_edges().to_lower()
	if wanted == "":
		return null
	for other in agents:
		if wanted == str(other.id).to_lower() or wanted == str(other.name).to_lower():
			return other
	for other in agents:
		for word in str(other.name).to_lower().split(" "):
			if word.length() >= 3 and word == wanted:
				return other
	return null

# The shut door that keeps `agent` from a goal no path reaches: the nearest one the agent can walk up to,
# with the goal on its far side. Empty when no door is to blame.
func shut_door_between(agent, goal: Vector3) -> Dictionary:
	var start := NavigationServer3D.map_get_closest_point(map_rid, agent.pos)
	var best := {}
	var best_dist := INF
	for door_id in doors:
		var door = doors[door_id]
		if door.solid == null or door.open or door.solid.aabb.size.y < DOORWAY:
			continue
		var box: AABB = door.solid.aabb
		var along := Vector3.RIGHT if box.size.x < box.size.z else Vector3.BACK
		if (agent.pos - box.get_center()).dot(along) * (goal - box.get_center()).dot(along) > 0.0:
			continue
		var near := door_front(door, agent.pos)
		if near.distance_to(agent.pos) >= best_dist:
			continue
		var walk := nav_path(start, NavigationServer3D.map_get_closest_point(map_rid, near), true)
		if walk.size() >= 2 and walk[walk.size() - 1].distance_to(near) < 2.5:
			best = door
			best_dist = near.distance_to(agent.pos)
	return best

# A standing spot beside a door, on whichever side `from` is, where the door's crossing would begin.
func door_front(door, from: Vector3) -> Vector3:
	var box: AABB = door.solid.aabb
	var along := Vector3.RIGHT if box.size.x < box.size.z else Vector3.BACK
	var side := 1.0 if (from - box.get_center()).dot(along) > 0.0 else -1.0
	var spot: Vector3 = box.get_center() + along * side * (minf(box.size.x, box.size.z) * 0.5 + 1.5)
	spot.y = ground_y(spot.x, spot.z)
	return spot

func ferry_landing(pos: Vector3, dest: Vector3):
	if absf(pos.y) >= 3.0:
		return null
	if flat_dist(pos, FERRY_WEST) < 7.0 and flat_dist(dest, FERRY_EAST) < 8.0:
		return FERRY_EAST
	if flat_dist(pos, FERRY_EAST) < 7.0 and flat_dist(dest, FERRY_WEST) < 8.0:
		return FERRY_WEST
	return null

func ferry_raft_center(dock: Vector3) -> Vector3:
	return dock + Vector3(4.5 if dock == FERRY_WEST else -4.5, 0.25, 0)

func board_ferry(agent, landing: Vector3) -> Dictionary:
	var source := FERRY_WEST if landing == FERRY_EAST else FERRY_EAST
	if not ferry_trip.is_empty() and (ferry_trip.source != source or minute >= int(ferry_trip.depart)):
		return fail("busy", "the ferry is already crossing")
	var cart_id := str(agent.cart_id)
	var kg := (64.0 if agent.race == "dwarf" else 75.0) + mass_of(agent)
	if cart_id != "":
		kg += CART_TARE_KG + cart_cargo_mass(carts[cart_id])
	if not ferry_trip.is_empty() and (cart_id != "" or ferry_trip.cart_id != ""):
		return fail("encumbered", "a cart needs the whole deck")
	if kg > FERRY_CAPACITY_KG:
		return fail("encumbered", "the ferry cannot carry that load")
	if not ferry_trip.is_empty() and (int(ferry_trip.seats) >= FERRY_PASSENGERS or float(ferry_trip.mass_kg) + kg > FERRY_CAPACITY_KG):
		return fail("encumbered", "the ferry has reached its passenger or weight limit")
	if ferry_trip.is_empty():
		var wait := 1 if ferry_dock == source else FERRY_CROSSING_MINUTES + 1
		ferry_trip = {
			"source": source, "landing": landing, "initial_dock": ferry_dock,
			"start": minute, "depart": minute + wait, "arrive": minute + wait + FERRY_CROSSING_MINUTES,
			"seats": 0, "mass_kg": 0.0, "cart_id": cart_id,
		}
	var seat := int(ferry_trip.seats)
	ferry_trip.seats += 1
	ferry_trip.mass_kg += kg
	watch_note(agent, "Waiting for the ferry", Color(0.75, 0.87, 0.98))
	return start_action(agent, int(ferry_trip.arrive) - minute, {
		"kind": "ferry", "depart_at": ferry_trip.depart, "wait_minutes": int(ferry_trip.depart) - minute, "cart_id": cart_id,
	}, {"landing": landing, "seat": seat, "distance": flat_dist(source, landing)})

func position_ferry() -> void:
	if ferry_trip.is_empty():
		return
	var source: Vector3 = ferry_trip.source
	var landing: Vector3 = ferry_trip.landing
	var initial: Vector3 = ferry_trip.initial_dock
	var center := ferry_raft_center(source)
	if minute < int(ferry_trip.depart):
		var approach := clampf(float(minute - int(ferry_trip.start)) / FERRY_CROSSING_MINUTES, 0.0, 1.0)
		center = ferry_raft_center(initial).lerp(center, approach)
	else:
		var crossing := clampf(float(minute - int(ferry_trip.depart)) / FERRY_CROSSING_MINUTES, 0.0, 1.0)
		center = center.lerp(ferry_raft_center(landing), crossing)
	ferry_raft.position = center
	ferry_raft.force_update_transform()
	if minute < int(ferry_trip.depart) or minute >= int(ferry_trip.arrive):
		return
	var cart_id: String = ferry_trip.cart_id
	if cart_id != "":
		var wagon: Dictionary = carts[cart_id]
		var heading := (landing - source).normalized()
		wagon.body.collision_layer = 0
		move_cart(wagon, Transform3D(Basis.looking_at(heading), center + Vector3.UP * (0.15 + CART_SIZE.y * 0.5)))
	for agent_id in pending_actions:
		if pending_actions[agent_id].kind != "ferry":
			continue
		var actor = agents_by_id[agent_id]
		var seat := int(travel_actions[agent_id].seat)
		var deck := center + Vector3(-1.5 + float(seat % 3) * 1.5, 0.16, -0.58 if seat < 3 else 0.58)
		if cart_id != "":
			deck = center + Vector3(0, 0.16, -1.17)
		set_pos(actor, deck)

func ferry_status() -> Dictionary:
	var dock := "west" if ferry_dock == FERRY_WEST else "east"
	var active := not ferry_trip.is_empty()
	return {
		"dock": dock if not active else null, "crossing": active,
		"capacity_kg": FERRY_CAPACITY_KG, "capacity_seats": FERRY_PASSENGERS,
		"reserved_kg": ferry_trip.get("mass_kg", 0.0), "reserved_seats": ferry_trip.get("seats", 0),
		"depart_at": ferry_trip.get("depart"), "arrive_at": ferry_trip.get("arrive"), "cart_id": ferry_trip.get("cart_id"),
	}

func ferry_arrival_spot(agent, landing: Vector3, seat: int) -> Vector3:
	for i in range(12):
		var index := (seat + i) % 12
		var candidate := landing + Vector3(-0.75 + float(index % 3) * 0.75, 0, -1.15 + float(index / 3) * 0.76)
		if space().intersect_shape(capsule_params(agent, candidate), 1).is_empty():
			return candidate
	return landing + Vector3(-2.0 if landing == FERRY_WEST else 2.0, 0, float(seat) - 2.5)

func capsule_params(agent, at: Vector3) -> PhysicsShapeQueryParameters3D:
	var shape := CapsuleShape3D.new()
	shape.radius = minf(float(agent.radius), 0.3)
	shape.height = float(agent.height)
	var params := PhysicsShapeQueryParameters3D.new()
	params.shape = shape
	params.transform = Transform3D(Basis(), at + Vector3(0, float(agent.height) * 0.5, 0))
	params.collision_mask = MOVE_MASK
	params.exclude = [agent.body.get_rid()]
	if agent.cart_id != "":
		params.exclude += [carts[agent.cart_id].body.get_rid()]
	return params

func travel_fraction(agent, frm: Vector3, to: Vector3) -> float:
	var params := capsule_params(agent, frm)
	params.motion = to - frm
	var hit := space().cast_motion(params)
	if hit.size() < 1:
		return 1.0
	return float(hit[0])

func identify_block(agent, frm: Vector3, to: Vector3):
	# The cast stops up to 5% of a segment early, so look that far ahead for a person.
	var seg := Vector2(to.x - frm.x, to.z - frm.z)
	if seg.length() > 0.01:
		var ahead := 0.75 + seg.length() * 0.06
		for other in actors():
			if other.id == agent.id or absf(other.pos.y - frm.y) > 2.0:
				continue
			var offset := Vector2(other.pos.x - frm.x, other.pos.z - frm.z)
			if offset.dot(seg.normalized()) >= 0.0 and offset.dot(seg.normalized()) < ahead and absf(offset.cross(seg.normalized())) < 0.75:
				return {"kind": "agent", "id": other.id, "reason": "someone is in the way"}
	# A ray slips past corners and low things the body caught, so ask what the body itself touches.
	var params := capsule_params(agent, frm)
	params.motion = to - frm
	var touch := space().cast_motion(params)
	if touch.size() < 1:
		return {"kind": "obstacle", "id": "", "reason": "the way is blocked"}
	params.transform.origin += (to - frm) * minf(float(touch[1]) + 0.02, 1.0)
	params.motion = Vector3.ZERO
	var named = null
	for hit in space().intersect_shape(params, 16):
		var found = describe_blocker(hit.collider)
		if str(found.kind) != "obstacle":
			return found
		if str(found.id) != "":
			named = found
	if named != null:
		return named
	return {"kind": "obstacle", "id": "", "reason": "the way is blocked"}

func describe_blocker(body) -> Dictionary:
	if doors.has(str(body.name)):
		var door = doors[str(body.name)]
		var why := "locked" if door.lock == "locked" else "closed"
		return {"kind": "door", "id": door.id, "reason": "the door is " + why}
	if str(body.name).begins_with("river"):
		return {"kind": "water", "id": "silverbrook", "reason": "the river is too deep to ford"}
	var agent_id := str(body.get_meta("agent_id", ""))
	if agent_id != "":
		return {"kind": "agent", "id": agent_id, "reason": "someone is in the way"}
	return {"kind": "obstacle", "id": str(body.name), "reason": "the way is blocked"}

func speed_mpm(agent, pace: String) -> float:
	var base := 84.0 if pace == "walk" else 168.0 if pace == "run" else 42.0
	var mass := mass_of(agent)
	var threshold := carry_threshold(agent)
	if mass > threshold:
		var load := clampf((mass - threshold) / maxf(45.0 - threshold, 1.0), 0.0, 1.0)
		base *= lerpf(1.0, 0.45, load)
	return base * BodyState.pace_factor(agent)

func carry_threshold(agent) -> float:
	if agent.race == "dwarf":
		return 28.0
	if agent.race == "elf":
		return 18.0
	return 20.0

func spend_travel(agent, pace: String, minutes: float) -> void:
	var cost := 2.0 if pace == "walk" else 10.0 if pace == "run" else 4.0
	var burden := 2.8 if mass_of(agent) > 45.0 else 1.0
	agent.stamina = maxf(0.0, agent.stamina - cost * minutes * burden / 10.0)
	agent.thirst = minf(100.0, float(agent.thirst) + cost * minutes * 0.16)

func set_pos(agent, pos: Vector3) -> void:
	agent.pos = pos
	sync_body(agent)

func sync_body(agent) -> void:
	agent.body.global_position = agent.pos + Vector3(0, float(agent.height) * 0.5, 0)
	agent.body.force_update_transform()

func closest_on_aabb(box: AABB, point: Vector3) -> Vector3:
	var end := box.position + box.size
	return Vector3(
		clampf(point.x, box.position.x, end.x),
		clampf(point.y, box.position.y, end.y),
		clampf(point.z, box.position.z, end.z),
	)

func tool_lock(agent, args) -> Dictionary:
	var door_id := str(args.get("door_id", ""))
	var action := str(args.get("action", ""))
	if door_id == "treewatch_ladder":
		if action not in ["open", "close"]:
			return fail("bad_args", "use open to lower the ladder or close to retract it")
		var pos: Vector3 = agent.pos
		if absf(pos.y - 24.125) > 1.5 or flat_dist(pos, Vector3(518, 24.125, 40)) > 2.5:
			return fail("too_far", "the ladder pulley is on the middle platform")
		ladder_lowered = action == "open"
		var body: StaticBody3D = fixtures[door_id].body
		body.position.y = v3(fixtures[door_id].spec.center).y if ladder_lowered else 26.9
		body.force_update_transform()
		for i in range(layout.links.size()):
			if layout.links[i].get("control", "") == door_id:
				NavigationServer3D.link_set_enabled(link_rids[i], ladder_lowered)
		sync_nav()
		return ok({"door_id": door_id, "open": ladder_lowered})
	if not doors.has(door_id):
		return fail("bad_args", "unknown door")
	if action != "open" and action != "close" and action != "lock" and action != "unlock":
		return fail("bad_args", "action must be open, close, lock, or unlock")
	var door = doors[door_id]
	var pos: Vector3 = door.body.global_position
	if door.solid != null:
		pos = closest_on_aabb(door.solid.aabb, agent.pos + Vector3(0, 1.0, 0))
	if agent.pos.distance_to(pos) > 2.5 and flat_dist(agent.pos, door.body.global_position) > 2.5:
		return fail("too_far", "too far from the door")
	if door.mana_sealed and action == "unlock":
		return fail("locked", "the slab is mana-sealed")
	if (action == "lock" or action == "unlock") and door.key != "" and qty_of(agent.items, door.key) < 1:
		return fail("locked", "the lock does not take your key")
	if action == "open" and door.lock == "locked":
		return fail("locked", "the door is locked")
	if action == "open":
		door.open = true
	elif action == "close":
		door.open = false
	elif action == "lock":
		door.lock = "locked"
		door.open = false
	elif action == "unlock":
		door.lock = "unlocked"
	apply_door_visual(door)
	rebuild_nav()
	return ok({"door_id": door_id, "open": door.open, "lock": door.lock})

func cart_cargo_mass(wagon: Dictionary) -> float:
	var kg := 0.0
	for item in wagon.items:
		kg += float(item.kg) * int(item.qty)
	return kg

func cart_status(wagon: Dictionary) -> Dictionary:
	var pos: Vector3 = wagon.body.global_position
	return {"id": wagon.id, "name": wagon.name, "handler": wagon.handler, "cargo": inventory_out(wagon.items),
		"cargo_kg": round2(cart_cargo_mass(wagon)), "capacity_kg": CART_CAPACITY_KG,
		"x": round2(pos.x), "y": round2(pos.y - CART_SIZE.y * 0.5), "z": round2(pos.z)}

func move_cart(wagon: Dictionary, pose: Transform3D) -> void:
	if (wagon.body.global_transform as Transform3D).is_equal_approx(pose):
		return
	var prior: Transform3D = wagon.rig.global_transform
	wagon.body.global_transform = pose
	wagon.body.force_update_transform()
	if watching:
		wagon.rig.global_transform = prior
		wagon.motion = {"from": wagon.rig.transform, "elapsed": 0.0,
			"seconds": clampf(prior.origin.distance_to(pose.origin) / 8.0, 0.25, 4.5)}

func set_cart_parked(wagon: Dictionary, parked: bool) -> void:
	var pose: Transform3D = wagon.body.global_transform
	wagon.solid.nav = parked
	if parked:
		wagon.solid.aabb = pose * AABB(-CART_SIZE * 0.5, CART_SIZE)
	if map_rid.is_valid():
		navigation_dirty = true

func cart_pose_after_step(from: Vector3, to: Vector3, previous: Transform3D) -> Transform3D:
	var direction := Vector3(to.x - from.x, 0, to.z - from.z)
	if direction.length_squared() < 0.002:
		return previous
	direction = direction.normalized()
	return Transform3D(Basis.looking_at(direction), to - direction * CART_TRAIL_M + Vector3.UP * CART_SIZE.y * 0.5)

func cart_step_is_clear(agent, wagon: Dictionary, from: Transform3D, to: Transform3D, feet: Vector3, next: Vector3) -> bool:
	var step := flat_dist(feet, next)
	if absf(feet.y - next.y) > maxf(0.6, step * 0.5):
		return false
	if from.is_equal_approx(to):
		return true
	var shape := BoxShape3D.new()
	shape.size = CART_SIZE
	var probe := PhysicsShapeQueryParameters3D.new()
	probe.shape = shape
	probe.collision_mask = MOVE_MASK
	probe.exclude = [agent.body.get_rid(), wagon.body.get_rid()]
	probe.transform = Transform3D(to.basis, from.origin)
	probe.motion = to.origin - from.origin
	var sweep := space().cast_motion(probe)
	if sweep.size() > 0 and sweep[0] < 0.98:
		return false
	probe.motion = Vector3.ZERO
	probe.transform = to
	return space().intersect_shape(probe, 1).is_empty()

func tool_cart(agent, args) -> Dictionary:
	var cart_id := str(args.get("cart_id", ""))
	if not carts.has(cart_id):
		return fail("bad_args", "unknown cart")
	var wagon: Dictionary = carts[cart_id]
	if agent.pos.distance_to(wagon.body.global_position) > 3.4:
		return fail("too_far", "you are not beside that cart")
	if wagon.handler != "" and wagon.handler != agent.id:
		return fail("busy", "someone else is handling the cart")
	match str(args.get("action", "")):
		"hitch":
			if agent.cart_id != "" and agent.cart_id != cart_id:
				return fail("busy", "you already have a cart")
			agent.cart_id = cart_id
			wagon.handler = agent.id
			set_cart_parked(wagon, false)
		"unhitch":
			if agent.cart_id != cart_id:
				return fail("rejected", "you are not handling this cart")
			agent.cart_id = ""
			wagon.handler = ""
			set_cart_parked(wagon, true)
		"load", "unload":
			var item_id := str(args.get("item_id", ""))
			var quantity := int(args.get("quantity", 0))
			var loading: bool = args.action == "load"
			var source: Array = agent.items if loading else wagon.items
			var item := item_stack(source, item_id)
			if quantity < 1:
				return fail("bad_args", "quantity must be at least one")
			if int(item.get("qty", 0)) < quantity:
				return fail("no_item", "there is not that much cargo")
			var kg := float(item.kg) * quantity
			if (loading and cart_cargo_mass(wagon) + kg > CART_CAPACITY_KG) or (not loading and mass_of(agent) + kg > 70.0):
				return fail("encumbered", "the destination cannot carry that load")
			var target: Array = wagon.items if loading else agent.items
			take_from_inv(source, item_id, quantity)
			give_stack(target, item_id, str(item.name), float(item.kg), quantity)
			wagon.freight.visible = cart_cargo_mass(wagon) > 0.0
		_:
			return fail("bad_args", "use hitch, unhitch, load, or unload")
	return ok(cart_status(wagon))

func tool_transfer(agent, args) -> Dictionary:
	var item_id := str(args.get("item_id", ""))
	var action := str(args.get("action", ""))
	var quantity := int(args.get("quantity", 1))
	var target_id := str(args.get("target_agent", ""))
	if quantity < 1:
		return fail("bad_args", "quantity must be at least 1")
	if action == "consume":
		return consume_provision(agent, item_id, quantity)
	if action == "treat":
		return treat_injury(agent, target_id, item_id, quantity)
	if action == "spill":
		if item_id != "oil_flask" or quantity != 1:
			return fail("bad_args", "spill takes one oil flask")
		if not take_stack(agent, item_id, 1):
			return fail("no_item", "you do not have an oil flask")
		var trace := leave_trace("oil", agent.pos)
		return ok({"action": "spill", "item_id": item_id, "trace_id": trace.id})
	if action == "give":
		if not agents_by_id.has(target_id):
			return fail("bad_args", "unknown recipient")
		var other = agents_by_id[target_id]
		if flat_dist(agent.pos, other.pos) > 2.0 or absf(agent.pos.y - other.pos.y) > 2.0:
			return fail("too_far", "the recipient is more than 2 m away")
		if not patient_in_reach(agent, other, 2.5):
			return fail("blocked", "you cannot reach the recipient through the obstruction")
		if not move_stack(agent, other, item_id, quantity):
			return fail("no_item", "you do not have that many")
		if mass_of(other) > 70.0:
			move_stack(other, agent, item_id, quantity)
			return fail("encumbered", "they cannot carry that")
		return ok({"action": "give", "item_id": item_id, "quantity": quantity, "target_agent": target_id})
	if action == "drop":
		var item := item_stack(agent.items, item_id)
		if not take_stack(agent, item_id, quantity):
			return fail("no_item", "you do not have that many")
		drop_stack(agent.pos, item_id, quantity, item.get("name", item_id), float(item.get("kg", 0.012)))
		return ok({"action": "drop", "item_id": item_id, "quantity": quantity})
	if action == "store":
		var container_id := str(args.get("container_id", ""))
		if not containers.has(container_id):
			return fail("bad_args", "unknown container")
		var box: Dictionary = containers[container_id]
		if agent.pos.distance_to(v3(box.at)) > 2.0:
			return fail("too_far", "you are not beside the container")
		if not can_access_container(container_id, box):
			return fail("locked", "the container is closed")
		var item := item_stack(agent.items, item_id)
		if item.is_empty() or not take_stack(agent, item_id, quantity):
			return fail("no_item", "you do not have that many")
		give_stack(box.items, item_id, str(item.name), float(item.kg), quantity)
		return ok({"action": "store", "item_id": item_id, "container_id": container_id, "quantity": quantity})
	if action == "pick":
		return pick_stack(agent, item_id, quantity)
	return fail("bad_args", "action must be pick, drop, give, store, consume, treat, or spill")

func consume_provision(agent, item_id: String, quantity: int) -> Dictionary:
	if quantity != 1 or item_id not in ["ration", "bread", "apple", "spring_water", "herbal_tonic"]:
		return fail("bad_args", "pick one food, spring water, or a tonic")
	if not take_stack(agent, item_id, 1):
		return fail("no_item", "you do not have that provision")
	match item_id:
		"spring_water":
			agent.thirst = maxf(0.0, float(agent.thirst) - 50.0)
		"herbal_tonic":
			agent.stamina = minf(100.0, float(agent.stamina) + 35.0)
		"apple":
			agent.hunger = maxf(0.0, float(agent.hunger) - 10.0)
			agent.thirst = maxf(0.0, float(agent.thirst) - 8.0)
		_:
			agent.hunger = maxf(0.0, float(agent.hunger) - 25.0)
	watch_note(agent, "Consumed " + item_id.replace("_", " "), Color(0.66, 0.92, 0.62))
	return ok({"action": "consume", "item_id": item_id, "stamina": round2(agent.stamina),
		"hunger": round2(agent.hunger), "thirst": round2(agent.thirst)})

func treat_injury(healer, target_id: String, item_id: String, quantity: int) -> Dictionary:
	var patient = healer if target_id == "" or target_id == healer.id else agents_by_id.get(target_id)
	if quantity != 1 or item_id not in ["bandage", "timber_brace"] or patient == null:
		return fail("bad_args", "use one bandage or timber brace on a known patient")
	if patient.dead:
		return fail("rejected", "the patient is dead")
	if not patient_in_reach(healer, patient, 2.5):
		return fail("blocked", "you cannot reach the patient from here")
	var dressing := item_id == "bandage"
	if dressing and "bleeding" not in patient.injuries and "lacerated" not in patient.injuries:
		return fail("rejected", "there is no wound to dress")
	if not dressing and ("fractured" not in patient.injuries or patient.splinted):
		return fail("rejected", "there is no unsplinted fracture")
	if not take_stack(healer, item_id, 1):
		return fail("no_item", "you do not have the treatment item")
	if dressing:
		BodyState.dress_wound(patient)
	else:
		patient.splinted = true
	push_event(patient, {"type": "treatment", "item_id": item_id, "from": healer.id})
	watch_note(healer, "Treated " + str(patient.name), Color(0.66, 0.92, 0.62))
	return ok({"action": "treat", "patient": patient.id, "injuries": patient.injuries, "splinted": patient.splinted})

func patient_in_reach(healer, patient, reach: float) -> bool:
	if patient.id == healer.id:
		return true
	var point: Vector3 = patient.pos + Vector3.UP * eye(patient)
	return healer.pos.distance_to(patient.pos) <= reach and can_see(healer, point, patient.body, view_range(healer), false)

func move_stack(src, dst, item_id: String, quantity: int) -> bool:
	if item_id == "sp":
		if int(src.sp) < quantity:
			return false
		src.sp -= quantity
		dst.sp += quantity
		return true
	if item_id == "cp":
		if int(src.cp) < quantity:
			return false
		src.cp -= quantity
		dst.cp += quantity
		return true
	var name := ""
	var kg := 0.1
	for item in src.items:
		if str(item.id) == item_id:
			name = str(item.name)
			kg = float(item.kg)
	if not take_stack(src, item_id, quantity):
		return false
	give_stack(dst.items, item_id, name, kg, quantity)
	return true

func take_stack(holder, item_id: String, quantity: int) -> bool:
	if item_id == "sp":
		if int(holder.sp) < quantity:
			return false
		holder.sp -= quantity
		return true
	if item_id == "cp":
		if int(holder.cp) < quantity:
			return false
		holder.cp -= quantity
		return true
	for item in holder.items:
		if str(item.id) == item_id and int(item.qty) >= quantity:
			item.qty = int(item.qty) - quantity
			return true
	return false

func give_stack(inv: Array, item_id: String, item_name: String, kg: float, quantity: int) -> void:
	for item in inv:
		if str(item.id) == item_id:
			item.qty = int(item.qty) + quantity
			return
	inv.append({"id": item_id, "name": item_name if item_name != "" else item_id, "kg": kg, "qty": quantity})

func can_access_container(container_id: String, box: Dictionary) -> bool:
	if bool(box.get("sealed", false)) or container_id == "guild_lockbox":
		return false
	var door_id := str(box.get("door", ""))
	return door_id == "" or not doors.has(door_id) or doors[door_id].open

func pick_stack(agent, item_id: String, quantity: int) -> Dictionary:
	for pile in piles:
		if agent.pos.distance_to(pile.pos) <= 2.0 and qty_of(pile.items, item_id) >= quantity:
			return claim_stack(agent, pile.items, item_id, quantity)
	for container_id in containers.keys():
		var box = containers[container_id]
		if not can_access_container(container_id, box):
			continue
		if agent.pos.distance_to(v3(box.at)) > 2.0:
			continue
		if item_id == "sp" and int(box.get("sp", 0)) >= quantity:
			if mass_of(agent) + 0.012 * quantity > 70.0:
				return fail("encumbered", "that is too heavy to lift")
			box.sp = int(box.sp) - quantity
			agent.sp += quantity
			return ok({"action": "pick", "item_id": item_id, "quantity": quantity})
		if qty_of(box.items, item_id) >= quantity:
			return claim_stack(agent, box.items, item_id, quantity)
	return fail("no_item", "nothing like that is within reach")

func claim_stack(agent, inventory: Array, item_id: String, quantity: int) -> Dictionary:
	var item := item_stack(inventory, item_id)
	if mass_of(agent) + float(item.kg) * quantity > 70.0:
		return fail("encumbered", "that is too heavy to lift")
	take_from_inv(inventory, item_id, quantity)
	if item_id == "sp" or item_id == "cp":
		agent[item_id] += quantity
	else:
		give_stack(agent.items, item_id, str(item.name), float(item.kg), quantity)
	return ok({"action": "pick", "item_id": item_id, "quantity": quantity})

func take_from_inv(inv: Array, item_id: String, quantity: int) -> bool:
	for item in inv:
		if str(item.id) == item_id and int(item.qty) >= quantity:
			item.qty = int(item.qty) - quantity
			return true
	return false

func drop_stack(pos: Vector3, item_id: String, quantity: int, item_name: String, kg: float) -> void:
	for pile in piles:
		if pos.distance_to(pile.pos) < 1.0:
			give_stack(pile.items, item_id, item_name, kg, quantity)
			return
	piles.append({"pos": pos, "items": [{"id": item_id, "name": item_name, "kg": kg, "qty": quantity}]})

func item_stack(inv: Array, item_id: String) -> Dictionary:
	for item in inv:
		if str(item.id) == item_id:
			return item
	return {}

func qty_of(inv: Array, item_id: String) -> int:
	return int(item_stack(inv, item_id).get("qty", 0))

func mass_of(agent) -> float:
	var total := float(agent.sp + agent.cp) * 0.012
	for item in agent.items:
		total += float(item.kg) * float(item.qty)
	return total

func inventory_out(inv: Array) -> Array:
	var out: Array = []
	for item in inv:
		if int(item.qty) <= 0:
			continue
		out.append({"id": str(item.id), "name": str(item.name), "qty": int(item.qty), "kg": float(item.kg)})
	return out

func tool_speak(agent, args) -> Dictionary:
	var utterance := str(args.get("utterance", ""))
	var volume := str(args.get("volume", "normal"))
	var reach := 6.0 if volume == "whisper" else 65.0 if volume == "shout" else 20.0 if volume == "normal" else -1.0
	if utterance == "" or reach < 0.0:
		return fail("bad_args", "utterance and volume whisper|normal|shout are required")
	var heard: Array = []
	var reached: Array = []
	for other in agents:
		if other.id == agent.id:
			continue
		var dist := flat_dist(agent.pos, other.pos)
		var allowed := reach
		if local_weather(other.pos) in ["rain", "storm", "snow", "blizzard"]:
			allowed *= 0.9
		var cursor := (agent.pos as Vector3) + Vector3(0, eye(agent), 0)
		var target := (other.pos as Vector3) + Vector3(0, eye(other), 0)
		for _step in range(4):
			var query := PhysicsRayQueryParameters3D.create(cursor, target, L_WORLD | L_DOOR)
			var hit := space().intersect_ray(query)
			if hit.is_empty() or hit.position.distance_to(target) < 0.4:
				break
			var material := str(hit.collider.get_meta("material", "stone"))
			allowed -= 12.0 if material == "wood" else 40.0
			cursor = hit.position + (target - cursor).normalized() * 0.35
		if dist <= maxf(allowed, 0.0):
			push_event(other, {"type": "heard", "from": agent.id, "name": agent.name, "volume": volume, "utterance": utterance, "minute": minute})
			reached.append(other)
			if can_see(agent, other.pos + Vector3(0, eye(other), 0), other.body, view_range(agent), dist > 2.0):
				heard.append(other.id)
	watch_speech(agent, utterance, volume, reached)
	return ok({"volume": volume, "range_m": reach, "visible_listeners": heard})

func tool_trade(agent, args) -> Dictionary:
	var partner_id := str(args.get("partner_id", ""))
	if not agents_by_id.has(partner_id):
		return fail("bad_args", "unknown partner")
	var partner = agents_by_id[partner_id]
	if flat_dist(agent.pos, partner.pos) > 2.0:
		return fail("too_far", "trade requires standing within 2 m")
	if partner.dead or partner.unconscious or agent.id == partner_id or not patient_in_reach(agent, partner, 2.5):
		return fail("blocked", "you need a conscious partner in reach and a clear view")
	var offer = {
		"partner_id": partner_id,
		"offer_item": str(args.get("offer_item", "")),
		"offer_qty": int(args.get("offer_qty", 0)),
		"request_item": str(args.get("request_item", "")),
		"request_qty": int(args.get("request_qty", 0)),
	}
	if offer.offer_qty < 1 or offer.request_qty < 1:
		return fail("bad_args", "quantities must be at least 1")
	var theirs = offers.get(partner_id)
	if theirs != null and str(theirs.partner_id) == agent.id and str(theirs.offer_item) == offer.request_item and int(theirs.offer_qty) == offer.request_qty and str(theirs.request_item) == offer.offer_item and int(theirs.request_qty) == offer.offer_qty:
		if not move_stack(agent, partner, offer.offer_item, offer.offer_qty):
			return fail("no_item", "you cannot cover your side of the trade")
		if not move_stack(partner, agent, offer.request_item, offer.request_qty):
			move_stack(partner, agent, offer.offer_item, offer.offer_qty)
			return fail("no_item", "they cannot cover their side of the trade")
		if mass_of(agent) > 70.0 or mass_of(partner) > 70.0:
			move_stack(agent, partner, offer.request_item, offer.request_qty)
			move_stack(partner, agent, offer.offer_item, offer.offer_qty)
			return fail("encumbered", "the trade would exceed someone's carrying capacity")
		offers.erase(partner_id)
		offers.erase(agent.id)
		push_event(partner, {"type": "trade", "text": agent.name + " completed the trade."})
		watch_note(agent, "Traded with " + str(partner.name), Color(0.8, 1.0, 0.75))
		return ok({"settled": true, "partner_id": partner_id})
	offers[agent.id] = offer
	push_event(partner, {"type": "trade_offer", "from": agent.id, "offer_item": offer.offer_item, "offer_qty": offer.offer_qty, "request_item": offer.request_item, "request_qty": offer.request_qty})
	return ok({"settled": false, "waiting_on": partner_id})

func tool_contract(agent, args) -> Dictionary:
	var access := fixture_access_error(agent, fixtures.guild_board)
	if not access.is_empty():
		return access
	var action := str(args.get("action", "list"))
	if action == "list":
		return ok({"contracts": contracts, "escrow_sp": int(containers.guild_lockbox.get("sp", 0))})
	if action == "post":
		var reward := int(args.get("reward_sp", 0))
		if reward < 1 or agent.sp < reward:
			return fail("no_item", "you cannot escrow that reward")
		var delivery_item := str(args.get("delivery_item", ""))
		var delivery_qty := int(args.get("delivery_qty", 0))
		var summary := str(args.get("summary", "")).strip_edges()
		if summary == "" or (delivery_item == "" and delivery_qty != 0) or (delivery_item != "" and (delivery_qty < 1 or delivery_item in ["sp", "cp"])):
			return fail("bad_args", "give a summary and an optional item delivery with a positive quantity")
		agent.sp -= reward
		containers.guild_lockbox.sp = int(containers.guild_lockbox.sp) + reward
		var contract = {"id": "contract_%d" % next_contract, "summary": summary, "reward_sp": reward, "poster": agent.id, "holder": "", "state": "open", "delivery_item": delivery_item, "delivery_qty": delivery_qty, "collected": false}
		next_contract += 1
		contracts.append(contract)
		return ok(contract)
	var contract_id := str(args.get("contract_id", ""))
	var contract = null
	for entry in contracts:
		if str(entry.id) == contract_id:
			contract = entry
	if contract == null:
		return fail("bad_args", "unknown contract")
	if action == "accept":
		if str(contract.state) != "open":
			return fail("rejected", "that contract is not open")
		contract.holder = agent.id
		contract.state = "accepted"
		return ok(contract)
	if action == "confirm":
		if str(contract.poster) != agent.id or contract.state != "awaiting_confirmation":
			return fail("rejected", "only the poster can confirm a submitted service")
		contract.state = "verified"
		push_event(agents_by_id[contract.holder], {"type": "contract", "contract_id": contract.id, "text": "Your work was confirmed. Collect the reward at the guild board."})
		return ok(contract)
	if action == "collect":
		if contract.poster != agent.id or contract.state != "complete" or contract.get("delivery_item", "") == "" or contract.get("collected", false):
			return fail("rejected", "there is no delivery for you to collect")
		var item := item_stack(containers.guild_lockbox.items, contract.delivery_item)
		if int(item.get("qty", 0)) < int(contract.delivery_qty):
			return fail("no_item", "the delivered stock is missing")
		if mass_of(agent) + float(item.kg) * int(contract.delivery_qty) > 70.0:
			return fail("encumbered", "you cannot carry the delivery")
		take_from_inv(containers.guild_lockbox.items, contract.delivery_item, int(contract.delivery_qty))
		give_stack(agent.items, contract.delivery_item, item.name, float(item.kg), int(contract.delivery_qty))
		contract.collected = true
		return ok(contract)
	if action == "complete":
		if str(contract.holder) != agent.id or str(contract.state) not in ["accepted", "verified"]:
			return fail("rejected", "you are not the accepted holder")
		var delivery_item := str(contract.get("delivery_item", ""))
		if delivery_item == "" and contract.state == "accepted":
			contract.state = "awaiting_confirmation"
			push_event(agents_by_id[contract.poster], {"type": "contract", "contract_id": contract.id, "text": "The holder reports the service finished. Confirm it at the guild board after checking the work."})
			return ok(contract)
		var reward := int(contract.reward_sp)
		if int(containers.guild_lockbox.sp) < reward:
			return fail("rejected", "the escrow is short")
		if delivery_item != "":
			var item := item_stack(agent.items, delivery_item)
			var quantity := int(contract.delivery_qty)
			if int(item.get("qty", 0)) < quantity:
				return fail("no_item", "bring the required goods before claiming the reward")
			take_stack(agent, delivery_item, quantity)
			give_stack(containers.guild_lockbox.items, delivery_item, item.name, float(item.kg), quantity)
		containers.guild_lockbox.sp = int(containers.guild_lockbox.sp) - reward
		agent.sp += reward
		contract.state = "complete"
		return ok(contract)
	return fail("bad_args", "action must be list, post, accept, complete, confirm, or collect")

func tool_suppress(agent, args) -> Dictionary:
	var enabled = args.get("enabled", false)
	if typeof(enabled) != TYPE_BOOL:
		return fail("bad_args", "enabled must be a boolean")
	var apparent = args.get("apparent_level", 10)
	if enabled and (typeof(apparent) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(apparent))):
		return fail("bad_args", "apparent_level must be finite")
	if enabled and (float(apparent) < 0.0 or float(apparent) > minf(15.0, float(agent.manaMax))):
		return fail("bad_args", "suppressed emission must be between zero and civilian strength (at most 15)")
	agent.suppressed = enabled
	if enabled:
		agent.apparent = float(apparent)
	return ok({"suppressed": agent.suppressed, "apparent_mana": int(agent.apparent if agent.suppressed else agent.manaMax)})

func tool_cast(agent, args) -> Dictionary:
	var spell := str(args.get("spell_name", ""))
	var target := str(args.get("target", ""))
	var spend := int(args.get("mana_spend", 0))
	if spend < 1:
		return fail("bad_args", "mana_spend is required")
	var cap := float(agent.mana)
	if agent.suppressed:
		cap = minf(cap, float(agent.manaMax) * 0.5)
	if float(spend) > cap:
		return fail("mana", "not enough usable mana")
	if spell == "unseal":
		var slab: Dictionary = doors.get(target, {})
		if target != "rune_vault" or slab.is_empty() or not slab.mana_sealed:
			return fail("rejected", "there is no active seal there")
		var required := 20 if qty_of(agent.items, "seal_fragment") > 0 else 45
		if spend < required:
			return fail("mana", "the runes need %d mana" % required)
		var center: Vector3 = slab.body.global_position
		if agent.pos.distance_to(center) > 3.5 or not can_see(agent, center, slab.body, view_range(agent), false):
			return fail("rejected", "you need a clear view of the slab from the vestibule")
		for action in pending_actions.values():
			if action.kind == "unseal":
				return fail("busy", "the seal is already reacting")
		agent.mana -= spend
		slab.rune_material.emission_enabled = true
		watch_note(agent, "The runes glow", Color(0.48, 0.85, 1.0))
		return start_action(agent, 1, {"kind": "unseal", "door_id": target})
	if spell == "light":
		if target != "" and target != agent.id:
			return fail("bad_args", "light is cast on yourself")
	if spell not in ["light", "bandage", "flame", "barrier", "mend"]:
		return fail("bad_args", "unknown spell")
	var action := {"kind": "spell", "spell": spell, "target": target, "mana_spend": spend}
	var invalid := magic_target_error(agent, action)
	if not invalid.is_empty():
		return invalid
	agent.mana -= spend
	watch_note(agent, "Concentrating on " + spell, Color(0.48, 0.85, 1.0))
	return start_action(agent, 1, action)

func magic_target_error(agent, action: Dictionary) -> Dictionary:
	var spell := str(action.spell)
	var target := str(action.target)
	if spell in ["bandage", "mend"]:
		var patient = agent if target == "" or target == agent.id else agents_by_id.get(target)
		if patient == null or patient.dead or not patient_in_reach(agent, patient, 8.0):
			return fail("rejected", "no reachable living patient")
		if int(action.mana_spend) < 6:
			return fail("mana", "wound closure needs six mana")
		if spell == "mend" and "lacerated" not in patient.injuries and "bleeding" not in patient.injuries:
			return fail("rejected", "mend closes minor cuts; it cannot regrow tissue or mend fractures")
	if spell == "flame":
		var other = agents_by_id.get(target)
		if other != null:
			if not can_see(agent, other.pos + Vector3(0, eye(other), 0), other.body, 30.0, false):
				return fail("rejected", "no line of effect")
		else:
			var fixture: Dictionary = fixtures.get(target, {})
			if fixture.is_empty() or fixture.spec.kind not in ["fire", "timber"]:
				return fail("bad_args", "flame needs a creature, fire ring, or dry timber target")
			var pos: Vector3 = fixture.body.global_position
			if not fixture.body.visible or not can_see(agent, pos, fixture.body, 30.0, false):
				return fail("rejected", "no line of effect")
			if wet_weather(local_weather(pos)) and not under_cover(pos):
				return fail("rejected", "exposed wet fuel will not catch fire")
			if fixture.spec.kind == "fire" and (int(fixture.lit_until) > minute or qty_of(agent.items, "timber") < 1):
				return fail("rejected", "an unlit fire ring and one timber fuel are required")
			if fixture.spec.kind == "timber" and fixture.batches <= 0:
				return fail("depleted", "no dry timber remains")
	return {}

func finish_spell(agent, action: Dictionary) -> Dictionary:
	var invalid := magic_target_error(agent, action)
	if not invalid.is_empty():
		return {"spell": action.spell, "applied": false, "error": invalid.error}
	var spell := str(action.spell)
	var target := str(action.target)
	var spend := int(action.mana_spend)
	var result := {"spell": spell, "applied": true}
	match spell:
		"light":
			agent.light_until = minute + 10
			result["until_minute"] = agent.light_until
		"bandage", "mend":
			var patient = agent if target == "" or target == agent.id else agents_by_id[target]
			BodyState.dress_wound(patient)
			if spell == "mend":
				patient.injuries.erase("lacerated")
			push_event(patient, {"type": "treatment", "spell": spell, "from": agent.id})
			result["patient"] = patient.id
			result["injuries"] = patient.injuries.duplicate()
		"flame":
			var other = agents_by_id.get(target)
			if other != null:
				if spend >= 12:
					BodyState.injure(other, "burned")
				push_event(other, {"type": "spell", "text": "Flame washes over you."})
			else:
				var fixture: Dictionary = fixtures[target]
				if fixture.spec.kind == "fire":
					take_stack(agent, "timber", 1)
					set_fire(fixture, minute + 180)
					result["until_minute"] = fixture.lit_until
				else:
					fixture.batches -= 1
					leave_trace("ash", v3(fixture.spec.approaches[0]))
					drop_stack(fixture.body.global_position, "ash", 1, "wood ash", 0.2)
					result["remaining_batches"] = fixture.batches
					if fixture.batches == 0:
						leave_trace("stump", v3(fixture.spec.approaches[0]))
						fixture.body.hide()
						fixture.body.collision_layer = 0
						fixture.solid.nav = false
						rebuild_nav()
			result["target"] = target
		"barrier":
			var ahead := (agent.pos as Vector3) + Vector3(cos(agent.yaw), 0, sin(agent.yaw)) * 1.6
			var until := minute + maxi(1, int(spend / 5.0))
			var body := add_solid("barrier_%s_%d" % [agent.id, minute], ahead + Vector3(0, 1.0, 0), Vector3(1.2, 2.0, 0.3), "stone", true, null, L_WORLD, Color(0.5, 0.7, 1.0, 0.45))
			solids.back().until = until
			body.set_meta("mana_integrity", spend)
			barriers.append(solids.back())
			rebuild_nav()
			result["until_minute"] = until
			result["integrity"] = spend
			result["body"] = str(body.name)
	watch_note(agent, "Cast " + spell, Color(0.48, 0.85, 1.0))
	return result

func tool_craft(agent, args) -> Dictionary:
	var station_id := str(args.get("station_id", ""))
	station_id = STATION_ALIASES.get(station_id, station_id)
	var recipe_name := str(args.get("recipe_or_task", ""))
	var minutes := int(args.get("minutes", 0))
	if not RECIPES.has(recipe_name):
		return fail("bad_args", "unknown recipe")
	var fixture: Dictionary = fixtures.get(station_id, {})
	var box_items: Array = []
	if not fixture.is_empty():
		var available: Array = fixture.spec.get("recipes", [fixture.spec.get("recipe", "")])
		if recipe_name not in available:
			return fail("rejected", "that fixture does not support this task")
		var obstructed := fixture_access_error(agent, fixture)
		if not obstructed.is_empty():
			return obstructed
		if fixture.spec.kind == "fire" and (int(fixture.lit_until) > minute or (wet_weather(local_weather(agent.pos)) and not under_cover(fixture.body.position))):
			return fail("rejected", "the fire is already lit or the rain will put it out")
		if crop_plots.has(station_id):
			var state := crop_state(crop_plots[station_id])
			if recipe_name == "sow_grain" and state != "fallow":
				return fail("rejected", "this field already has a crop")
			if recipe_name == "harvest_grain" and state != "ripe":
				return fail("rejected", "there is no ripe grain to harvest")
		if fixture.spec.kind == "orchard" and season() not in ["summer", "autumn"]:
			return fail("rejected", "the fruit ripens in summer and autumn")
		if fixture.batches == 0:
			return fail("depleted", "nothing remains to extract here")
		if fixture.spec.has("stock"):
			box_items = containers[fixture.spec.stock].items
	else:
		if STOCK_RECIPES.get(station_id, "") != recipe_name:
			return fail("bad_args", "unknown station")
		var box: Dictionary = containers[station_id]
		if flat_dist(agent.pos, v3(box.at)) > 3.5:
			return fail("too_far", "you are not at that station")
		var stock_door := str(box.get("door", ""))
		if stock_door == "" or doors[stock_door].open:
			box_items = box.items
	var recipe: Dictionary = RECIPES[recipe_name]
	var duration := int(recipe.minutes)
	if minutes < duration:
		return fail("rejected", "that task needs %d minutes" % duration)
	if recipe.has("tool") and qty_of(agent.items, recipe.tool) == 0:
		return fail("no_item", "you need a " + str(recipe.tool).replace("_", " "))
	for action in pending_actions.values():
		if action.get("station_id") == station_id:
			return fail("busy", "someone is already working at that station")
	var output_mass := mass_of(agent)
	for item_id in recipe.need.keys():
		var need := int(recipe.need[item_id])
		var have := qty_of(agent.items, item_id) + qty_of(box_items, item_id)
		if have < need:
			return fail("no_item", "missing " + item_id)
		var owned := item_stack(agent.items, item_id)
		output_mass -= float(owned.get("kg", 0.0)) * mini(int(owned.get("qty", 0)), need)
	for item_id in recipe.out:
		output_mass += float(OUTPUT_ITEMS[item_id][1]) * int(recipe.out[item_id])
	if output_mass > 70.0:
		return fail("encumbered", "you cannot carry the result of this work")
	for item_id in recipe.need.keys():
		var left := int(recipe.need[item_id])
		var from_agent := mini(left, qty_of(agent.items, item_id))
		if from_agent > 0:
			take_stack(agent, item_id, from_agent)
		left -= from_agent
		if left > 0:
			take_from_inv(box_items, item_id, left)
	if not fixture.is_empty() and fixture.batches > 0:
		fixture.batches -= 1
	watch_note(agent, "Working on " + recipe_name.replace("_", " "), Color(1.0, 0.85, 0.60))
	return start_action(agent, minutes, {"kind": "craft", "recipe": recipe_name, "station_id": station_id})

func tool_rest(agent, args) -> Dictionary:
	var minutes := int(args.get("minutes", 0))
	if minutes < 1 or minutes > 600:
		return fail("bad_args", "minutes must be between 1 and 600")
	watch_note(agent, "Resting", Color(0.75, 0.86, 1.0))
	return start_action(agent, minutes, {"kind": "rest"})

func start_action(agent, minutes: int, action: Dictionary, travel := {}) -> Dictionary:
	action["started_at"] = minute
	action["finish_at"] = minute + minutes
	pending_actions[str(agent.id)] = action
	if not travel.is_empty():
		travel_actions[str(agent.id)] = travel
	return ok({"pending": true, "action": action})

func finish_actions() -> bool:
	var completed := false
	for agent_id in pending_actions.keys():
		var action: Dictionary = pending_actions[agent_id]
		var agent = agents_by_id[agent_id]
		if (agent.dead and action.kind != "ferry") or (agent.unconscious and action.kind not in ["rest", "ferry"]):
			pending_actions.erase(agent_id)
			travel_actions.erase(agent_id)
			if action.kind == "unseal":
				doors[action.door_id].rune_material.emission_enabled = false
			push_event(agent, {"type": "action_interrupted", "action": action, "minute": minute, "condition": body_condition(agent)})
			completed = true
			continue
		var travel: Dictionary = travel_actions.get(agent_id, {})
		if action.kind == "walk":
			if not tick_walk(agent, travel):
				continue
		elif int(action.finish_at) > minute:
			continue
		pending_actions.erase(agent_id)
		travel_actions.erase(agent_id)
		var duration := minute - int(action.started_at)
		var event := {"type": "action_completed", "action": action, "minute": minute}
		match action.kind:
			"spell":
				event["result"] = finish_spell(agent, action)
			"craft":
				var output: Dictionary = RECIPES[action.recipe].out
				for item_id in output:
					var item: Array = OUTPUT_ITEMS[item_id]
					give_stack(agent.items, item_id, item[0], float(item[1]), int(output[item_id]))
				agent.stamina = maxf(0.0, agent.stamina - float(duration) / 4.0)
				event["produced"] = output
				if crop_plots.has(action.station_id):
					var plot: Dictionary = crop_plots[action.station_id]
					plot.planted = action.recipe == "sow_grain"
					plot.growth = 0.0
					update_crop_visual(plot)
				if action.recipe == "herd_sheep":
					sheep_return_until = minute + 30
				var station: Dictionary = fixtures.get(action.station_id, {})
				if not station.is_empty() and station.spec.kind == "fire":
					if not wet_weather(local_weather(station.body.position)) or under_cover(station.body.position):
						set_fire(station, minute + 180)
						event["lit"] = true
				if not station.is_empty() and station.spec.kind == "orchard" and station.batches == 0:
					station.fruit.hide()
				if not station.is_empty() and station.spec.kind == "obstruction":
					station.body.visible = false
					station.body.collision_layer = 0
					station.solid.nav = false
					event["cleared"] = action.station_id
				if action.recipe == "burn_charcoal":
					leave_trace("ash", v3(station.spec.approaches[0]))
				if not station.is_empty() and station.batches == 0:
					if station.spec.kind == "timber":
						leave_trace("stump", v3(station.spec.approaches[0]))
						hide_mesh(station.body)
						station.body.collision_layer = 0
						station.solid.nav = false
						navigation_dirty = true
					elif station.spec.kind == "deposit":
						for child in station.body.get_children():
							if child is MeshInstance3D:
								child.material_override = flat_mat(COL.stone)
				watch_note(agent, "Finished " + str(action.recipe).replace("_", " "), Color(1.0, 0.85, 0.60))
			"unseal":
				var door: Dictionary = doors[action.door_id]
				door.rune_material.emission_enabled = false
				door.mana_sealed = false
				door.lock = "unlocked"
				door.open = true
				apply_door_visual(door)
				navigation_dirty = true
				event["opened"] = door.id
				for listener in agents:
					if listener.id != agent_id and listener.pos.distance_to(door.body.position) <= 40.0:
						push_event(listener, {"type": "mana_pulse", "text": "A pulse rolls outward from the ruins."})
				watch_note(agent, "Opened the rune vault", Color(0.48, 0.85, 1.0))
			"rest":
				finish_rest(agent, duration)
			"walk":
				event["result"] = walk_result(agent, action, travel)
			"ferry":
				var initial: Vector3 = agent.pos
				var seat := int(travel.seat)
				var arrival := ferry_arrival_spot(agent, travel.landing, seat)
				if action.cart_id != "":
					var heading := Vector3.LEFT if travel.landing == FERRY_WEST else Vector3.RIGHT
					var parking: Vector3 = travel.landing + heading * 3.65
					var wagon: Dictionary = carts[action.cart_id]
					wagon.body.collision_layer = L_PROP
					move_cart(wagon, Transform3D(Basis.looking_at(heading), parking + Vector3.UP * CART_SIZE.y * 0.5))
					arrival = parking + heading * CART_TRAIL_M
				set_pos(agent, arrival)
				stroll(agent, PackedVector3Array([initial, agent.pos]), "walk")
				event["result"] = {
					"arrived": true, "via": "ferry", "blocked": null,
					"x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z),
					"distance_m": round2(travel.distance), "minutes": duration, "cart_id": action.cart_id,
				}
		push_event(agent, event)
		completed = true
	if not ferry_trip.is_empty() and minute >= int(ferry_trip.arrive):
		ferry_dock = ferry_trip.landing
		ferry_trip = {}
	return completed

func finish_rest(agent, minutes: int) -> void:
	var hours := float(minutes) / 60.0
	if hours >= 1.0:
		agent.mana = minf(float(agent.manaMax), agent.mana + float(agent.manaMax) * 0.1 * hours)
	if agent.hunger > 30.0:
		if take_stack(agent, "ration", 1) or take_stack(agent, "bread", 1):
			agent.hunger = maxf(0.0, agent.hunger - 25.0)

func tool_step(args) -> Dictionary:
	var minutes := int(args.get("minutes", 0))
	if minutes < 1 or minutes > 10080:
		return fail("bad_args", "minutes out of range")
	advance(float(minutes), bool(args.get("stop_on_action", false)))
	var woke: Array = []
	for agent in agents:
		if can_wake(agent):
			woke.append(agent.id)
	return ok({"minute": minute, "clock": clock_label(), "weather": regional_weather.stonebridge, "season": season(), "woke": woke})

func tool_snapshot() -> Dictionary:
	var rows: Array = []
	for agent in agents:
		rows.append({
			"id": agent.id, "name": agent.name, "x": round2(agent.pos.x), "y": round2(agent.pos.y), "z": round2(agent.pos.z),
			"mana": round2(agent.mana), "manaMax": round2(agent.manaMax), "suppressed": agent.suppressed,
			"sp": agent.sp, "mass_kg": round2(mass_of(agent)), "items": inventory_out(agent.items),
			"action": pending_actions.get(str(agent.id), null),
		})
	var beasts: Array = []
	for beast in wildlife:
		beasts.append({"id": beast.id, "kind": beast.kind, "x": round2(beast.pos.x), "y": round2(beast.pos.y), "z": round2(beast.pos.z)})
	var door_rows: Array = []
	for door_id in doors.keys():
		var door = doors[door_id]
		door_rows.append({"id": door_id, "open": door.open, "lock": door.lock})
	var wagons: Array = []
	for wagon in carts.values():
		wagons.append(cart_status(wagon))
	return ok({"minute": minute, "clock": clock_label(), "weather": regional_weather.stonebridge, "regional_weather": regional_weather, "season": season(), "agents": rows, "wildlife": beasts, "doors": door_rows, "contracts": contracts, "ferry": ferry_status(), "carts": wagons})

func tool_inject(args) -> Dictionary:
	var kind := str(args.get("kind", ""))
	if kind == "weather":
		var weather_now := str(args.get("weather", "clear"))
		var region := str(args.get("region", ""))
		if weather_now not in WEATHER_STATES or (region != "" and not regional_weather.has(region)):
			return fail("bad_args", "unknown weather or region")
		if region == "":
			for key in regional_weather:
				regional_weather[key] = weather_now
		else:
			regional_weather[region] = weather_now
		refresh_fire_states()
		return ok({"weather": weather_now})
	if kind == "wake":
		var agent_id := str(args.get("agentId", ""))
		if not agents_by_id.has(agent_id):
			return fail("unknown_agent", "unknown agent")
		if pending_actions.has(agent_id) or agents_by_id[agent_id].dead or agents_by_id[agent_id].unconscious:
			return ok({"woke": null})
		push_event(agents_by_id[agent_id], {"type": "notice", "text": str(args.get("text", ""))})
		return ok({"woke": agent_id})
	if kind == "injury":
		var patient = agents_by_id.get(str(args.get("agentId", "")))
		var injury := str(args.get("injury", ""))
		if patient == null or patient.dead or injury not in BodyState.INJURIES:
			return fail("bad_args", "expected a living actor and an injury")
		BodyState.injure(patient, injury)
		return ok({"injuries": patient.injuries})
	if kind == "item":
		var where = place_pos(str(args.get("place", "town_square")))
		if where == null:
			return fail("bad_args", "unknown place")
		var item_id := str(args.get("item_id", "item"))
		var item: Array = OUTPUT_ITEMS.get(item_id, [item_id, 0.2])
		drop_stack(where, item_id, int(args.get("quantity", 1)), item[0], float(item[1]))
		return ok({"placed": true})
	return fail("bad_args", "kind must be weather, wake, item, or injury")

func tool_pending(args) -> Dictionary:
	var agent_id := str(args.get("agentId", ""))
	if agent_id == "":
		var all := {}
		for agent in agents:
			if can_wake(agent):
				all[agent.id] = agent.events.duplicate(true)
				agent.events = []
		return ok(all)
	if not agents_by_id.has(agent_id):
		return fail("unknown_agent", "unknown agent")
	var agent = agents_by_id[agent_id]
	if not can_wake(agent):
		return ok({"agentId": agent_id, "events": []})
	var events = agent.events.duplicate(true)
	agent.events = []
	return ok({"agentId": agent_id, "events": events})

func tool_nav(args) -> Dictionary:
	refresh_nav()
	var frm = resolve_dest(str(args.get("from", "town_square")))
	var to = resolve_dest(str(args.get("to", "anvil_yard")))
	if frm == null or to == null:
		return fail("bad_args", "unknown endpoint")
	var a := NavigationServer3D.map_get_closest_point(map_rid, frm)
	var b := NavigationServer3D.map_get_closest_point(map_rid, to)
	var path := nav_path(a, b, true)
	var length := 0.0
	for i in range(1, path.size()):
		length += path[i - 1].distance_to(path[i])
	return ok({"points": path.size(), "length_m": round2(length), "snap_from": round2(a.distance_to(frm)), "snap_to": round2(b.distance_to(to))})

func push_event(agent, event) -> void:
	agent.events.append(event)

func can_wake(agent) -> bool:
	return not agent.dead and not agent.unconscious and not pending_actions.has(str(agent.id)) and not agent.events.is_empty()

func advance(minutes: float, stop_on_action := false) -> void:
	var target := minute + int(ceil(minutes))
	while minute < target:
		var next := mini(target, minute + 60 - posmod(minute, 60))
		for fixture in fixtures.values():
			if fixture.spec.kind == "fire" and int(fixture.lit_until) > minute:
				next = mini(next, int(fixture.lit_until))
		for solid in solids:
			if int(solid.until) > minute:
				next = mini(next, int(solid.until))
		for agent in agents:
			next = mini(next, minute + BodyState.minutes_to_blood_change(agent))
			if not agent.dead and (agent.unconscious or agent.warmth < 30.0):
				next = mini(next, minute + 1)
		for action in pending_actions.values():
			next = mini(next, minute + 1 if action.kind == "walk" else int(action.finish_at))
		if not ferry_trip.is_empty():
			next = mini(next, minute + 1)
		var condition_changed := advance_interval(next - minute)
		position_ferry()
		var completed := finish_actions()
		if stop_on_action and (completed or condition_changed):
			break

func wet_weather(weather: String) -> bool:
	return weather in ["rain", "storm", "snow", "blizzard"]

func ambient_temperature(weather: String, hour: int) -> float:
	var base := {"spring": 12.0, "summer": 24.0, "autumn": 10.0, "winter": -4.0}
	var day_warmth := cos((float(hour) - 14.0) * TAU / 24.0) * 4.5
	var change := {"clear": 0.0, "overcast": -1.0, "rain": -2.5, "storm": -4.0, "snow": -5.0, "blizzard": -11.0}
	return float(base[season()]) + day_warmth + float(change[weather])

func under_cover(pos: Vector3) -> bool:
	if underground_dark(pos):
		return true
	var roof := PhysicsRayQueryParameters3D.create(pos + Vector3.UP * 1.3, pos + Vector3.UP * 18.0, L_WORLD | L_FLOOR | L_FOLIAGE)
	return not space().intersect_ray(roof).is_empty()

func set_fire(fixture: Dictionary, until: int) -> void:
	if int(fixture.lit_until) > -1 and until == -1:
		leave_trace("ash", v3(fixture.spec.approaches[0]))
	fixture.lit_until = until
	fixture.flame.visible = until > minute

func refresh_fire_states() -> void:
	for fixture in fixtures.values():
		if fixture.spec.kind != "fire" or int(fixture.lit_until) == -1:
			continue
		if int(fixture.lit_until) <= minute or (wet_weather(local_weather(fixture.body.position)) and not under_cover(fixture.body.position)):
			set_fire(fixture, -1)

func warmth_from_fire(agent, at_minute: int) -> bool:
	for fixture in fixtures.values():
		if fixture.spec.kind != "fire" or int(fixture.lit_until) <= at_minute:
			continue
		var origin: Vector3 = fixture.body.position + Vector3.UP * 0.55
		if can_see(agent, origin, fixture.body, 7.0, false):
			return true
	return false

const TRACE_LIFETIMES := {"footprints": 1440.0, "blood": 2880.0, "ash": 4320.0, "stump": 10080.0, "oil": 4320.0, "broken_lock": 10080.0}
const TRACE_COLORS := {"footprints": Color(0.24, 0.18, 0.12, 0.88), "blood": Color(0.42, 0.045, 0.035, 0.9), "ash": Color(0.11, 0.11, 0.1, 0.9), "stump": Color(0.45, 0.3, 0.15, 0.95), "oil": Color(0.13, 0.12, 0.08, 0.88), "broken_lock": Color(0.28, 0.3, 0.33, 0.95)}

func leave_trace(kind: String, pos: Vector3) -> Dictionary:
	for trace in traces.values():
		if trace.kind == kind and trace.pos.distance_to(pos) < 2.0:
			trace.remaining = float(TRACE_LIFETIMES[kind])
			return trace
	if traces.size() >= 2048:
		var oldest: String = traces.keys()[0]
		traces[oldest].visual.queue_free()
		traces.erase(oldest)
	var id := "trace_%d" % next_trace
	next_trace += 1
	var visual := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.3, 0.025, 0.65) if kind == "footprints" else Vector3(0.7, 0.025, 0.6)
	if kind == "stump":
		mesh.size = Vector3(0.65, 0.3, 0.65)
	visual.mesh = mesh
	visual.position = pos + Vector3.UP * (mesh.size.y * 0.5 + 0.035)
	visual.material_override = flat_mat(TRACE_COLORS[kind])
	visual.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(visual)
	var trace := {"id": id, "kind": kind, "pos": pos, "created_at": minute, "remaining": float(TRACE_LIFETIMES[kind]), "sheltered": under_cover(pos), "visual": visual}
	traces[id] = trace
	return trace

func trace_details(trace: Dictionary) -> Dictionary:
	return {"id": trace.id, "kind": trace.kind, "age_minutes": minute - int(trace.created_at), "clarity": round2(float(trace.remaining) / float(TRACE_LIFETIMES[trace.kind]))}

func visible_traces(agent) -> Array:
	var seen: Array = []
	for trace in traces.values():
		if can_see(agent, trace.pos + Vector3.UP * 0.08, null, minf(20.0, view_range(agent))):
			var details := trace_details(trace)
			details["distance_m"] = round2(agent.pos.distance_to(trace.pos))
			seen.append(details)
	return seen

func decay_traces(minutes: int) -> void:
	for id in traces.keys():
		var trace: Dictionary = traces[id]
		var weather := local_weather(trace.pos)
		var erosion := 1.0
		if not trace.sheltered and wet_weather(weather):
			erosion = 8.0 if weather in ["storm", "blizzard"] else 4.0
		trace.remaining -= minutes * erosion
		if trace.remaining <= 0.0:
			trace.visual.queue_free()
			traces.erase(id)
		else:
			var color: Color = TRACE_COLORS[trace.kind]
			color.a *= float(trace.remaining) / float(TRACE_LIFETIMES[trace.kind])
			trace.visual.material_override.albedo_color = color

func crop_state(plot: Dictionary) -> String:
	if not plot.planted:
		return "fallow"
	return "ripe" if plot.growth >= GRAIN_GROWTH_MINUTES else "growing"

func update_crop_visual(plot: Dictionary) -> void:
	plot.crop.visible = plot.planted
	var progress := clampf(float(plot.growth) / GRAIN_GROWTH_MINUTES, 0.0, 1.0)
	plot.crop.scale.y = lerpf(0.2, 1.6, progress)
	plot.material.albedo_color = Color(0.31, 0.53, 0.17).lerp(Color(0.76, 0.61, 0.25), progress)

func advance_interval(minutes: int) -> bool:
	var before := clock_hour()
	var condition_changed := false
	decay_traces(minutes)
	var growing_minutes := minutes * (0.5 if season() == "winter" else 1.0)
	for plot in crop_plots.values():
		if crop_state(plot) == "growing":
			plot.growth = minf(GRAIN_GROWTH_MINUTES, float(plot.growth) + growing_minutes)
			update_crop_visual(plot)
	minute += minutes
	var hours := float(minutes) / 60.0
	for agent in agents:
		var weather := local_weather(agent.pos)
		var sheltered := under_cover(agent.pos)
		var fire := warmth_from_fire(agent, minute - minutes)
		var resting: bool = pending_actions.get(str(agent.id), {}).get("kind") == "rest"
		var winter_clothes := qty_of(agent.items, "winter_coat") > 0
		var before_condition := body_condition(agent)
		if not agent.dead and "bleeding" in agent.injuries:
			leave_trace("blood", agent.pos)
		BodyState.step(agent, minutes, ambient_temperature(weather, before), (wet_weather(weather) and not sheltered) or in_mine_water(agent.pos), sheltered, fire, winter_clothes, resting)
		if body_condition(agent) != before_condition:
			condition_changed = true
			watch_note(agent, body_condition(agent).capitalize(), Color(0.82, 0.61, 0.50))
			if not agent.unconscious and not agent.dead:
				push_event(agent, {"type": "condition", "text": "Your condition has changed.", "condition": body_condition(agent)})
		if agent.dead:
			continue
		if not agent.suppressed:
			var field_strength := 3.0 if agent.pos.distance_to(v3(layout.places.sacred_spring)) <= 14.0 else 1.0
			agent.mana = minf(float(agent.manaMax), float(agent.mana) + float(agent.manaMax) * 0.05 * hours * field_strength)
	var after := clock_hour()
	refresh_fire_states()
	if after != before:
		update_weather()
		refresh_fire_states()
		var orchard: Dictionary = fixtures.oakford_orchard
		var fruit_year := int((clock_day() - 1) / 120)
		var fruit_season := season() in ["summer", "autumn"]
		if fruit_season and int(orchard.fruit_year) != fruit_year:
			orchard.fruit_year = fruit_year
			orchard.batches = int(orchard.spec.batches)
		orchard.fruit.visible = fruit_season and int(orchard.batches) > 0
	if before < 20 and (after >= 20 or after < before):
		for gate_id in ["west_gate", "north_gate", "east_postern"]:
			var gate = doors[gate_id]
			gate.open = false
			gate.lock = "locked"
			apply_door_visual(gate)
		navigation_dirty = true
	if before >= 20 or before < 6:
		if after >= 6 and after < 20:
			for gate_id in ["west_gate", "north_gate", "east_postern"]:
				var gate = doors[gate_id]
				gate.open = true
				gate.lock = "unlocked"
				apply_door_visual(gate)
			navigation_dirty = true
	step_wildlife(minutes)
	var expired := false
	for solid in solids:
		if int(solid.until) >= 0 and int(solid.until) <= minute and solid.body.visible:
			solid.body.visible = false
			solid.body.collision_layer = 0
			solid.nav = false
			expired = true
	if expired:
		navigation_dirty = true
	return condition_changed

func sheep_home(index: int) -> Vector3:
	return Vector3(-279.0 + 2.2 * (index % 7), 3.0, 190.0 + float(index / 7) * 4.0)

func step_sheep(sheep, minutes: float) -> void:
	if not doors.sheep_pen_gate.open:
		return
	var index := int(sheep.herd_index)
	var home := sheep_home(index)
	var hour := clock_hour()
	var return_home := hour < 6 or hour >= 19 or minute <= sheep_return_until
	var target := home if return_home else Vector3(-285.0 + 2.0 * (index % 7), 3.0, 178.5 + float(index / 7) * 1.3)
	var pos: Vector3 = sheep.pos
	if return_home and pos.z < 185.6:
		target = Vector3(-272.0, 3.0, 186.2 if pos.z > 184.2 else 184.8)
	elif not return_home and pos.z > 184.4:
		target = Vector3(-272.0, 3.0, 183.8 if pos.z < 185.8 else 185.2)
	var next := pos.move_toward(target, minutes * 4.0)
	next.y = ground_y(next.x, next.z)
	if pos.distance_to(next) > 0.02:
		sheep.visual.rotation.y = atan2(pos.x - next.x, pos.z - next.z)
		set_pos(sheep, next)

func step_wildlife(minutes: float) -> void:
	var hour := clock_hour()
	var night := hour >= 20 or hour < 5
	for beast in wildlife:
		if beast.kind == "sheep":
			step_sheep(beast, minutes)
			continue
		if beast.kind == "goblin":
			var offset: Vector3 = beast.home - Vector3(-760, 42, -410)
			var target := Vector3(-752, 42, -405) + offset * 0.28 if night else beast.home as Vector3
			var prior: Vector3 = beast.pos
			if night and prior.z < -409.9:
				target = Vector3(-760 + clampf(offset.x, -2.2, 2.2), 42, -408.8)
			elif not night and prior.z > -409.5:
				target = Vector3(-760 + clampf(offset.x, -2.2, 2.2), 42, -410.3)
			var next := prior.move_toward(target, 0.3 * minutes)
			next.y = ground_y(next.x, next.z)
			if prior.distance_to(next) > 0.02 and travel_fraction(beast, prior, next) >= 0.96:
				beast.visual.rotation.y = atan2(prior.x - next.x, prior.z - next.z)
				set_pos(beast, next)
			continue
		if beast.kind != "wolf":
			continue
		var target: Vector3 = beast.home
		if night:
			target = Vector3(-280, 3, 160)
		var delta := Vector3(target.x - beast.pos.x, 0, target.z - beast.pos.z)
		var dist := Vector2(delta.x, delta.z).length()
		if dist < 30.0:
			continue
		var step := minf(dist - 30.0, 30.0 * minutes / 60.0)
		beast.pos += delta / dist * step
		if beast.pos.x > -80.0:
			beast.pos.x = -80.0
		beast.pos.y = ground_y(beast.pos.x, beast.pos.z)
		sync_body(beast)
		if night:
			for target_agent in agents:
				if not target_agent.dead and target_agent.pos.distance_to(beast.pos) <= 1.4 and not stone_between(beast.pos, target_agent.pos):
					BodyState.injure(target_agent, "lacerated")
					BodyState.injure(target_agent, "bleeding")

func actors() -> Array:
	var all: Array = []
	all.append_array(agents)
	all.append_array(wildlife)
	return all

func find_wild(id: String):
	for beast in wildlife:
		if beast.id == id:
			return beast
	return null

func flat_dist(a: Vector3, b: Vector3) -> float:
	return Vector2(a.x - b.x, a.z - b.z).length()

func round2(value: float) -> float:
	return snappedf(value, 0.01)

func space() -> PhysicsDirectSpaceState3D:
	return get_world_3d().direct_space_state

# -- Spectator: a windowed run shows who walks where and who says what --

var watching := false
var spec_cam: Camera3D
var spec_title: Label
var spec_log: Label
var spec_log_panel: PanelContainer
var spec_lines: Array = []
var spec_follow := 0
var spec_free := false
var spec_overview := false
var spec_fixed := ""
var spec_zoom := 1.0
var spec_yaw := 0.0
var spec_pitch := -0.45
var spec_auto := true
var spec_cut := false
var spec_orbit := 0.0
var spec_now := 0.0
var spec_shot_dir := ""
var spec_shot_at := 0.0
var spec_shot_count := 0

const WATCH_OFFSET := Vector3(3.4, 2.6, 4.4)
const WATCH_ORBITS := [0.0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, PI]

func watch_setup() -> void:
	watching = DisplayServer.get_name() != "headless"
	if not watching:
		return
	var layer := CanvasLayer.new()
	add_child(layer)
	var top := watch_panel()
	top.position = Vector2(12, 10)
	layer.add_child(top)
	spec_title = Label.new()
	top.add_child(spec_title)
	spec_log_panel = watch_panel()
	layer.add_child(spec_log_panel)
	spec_log = Label.new()
	spec_log.custom_minimum_size = Vector2(780, 0)
	spec_log.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	spec_log.add_theme_color_override("font_color", Color(0.9, 0.92, 0.86))
	spec_log_panel.add_child(spec_log)
	# Far names would pile up over walls, so a name fades once its owner is far from the camera.
	for agent in agents:
		var nameplate: Label3D = agent.nameplate
		nameplate.visibility_range_end = 70.0
		nameplate.visibility_range_end_margin = 15.0
		nameplate.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		var lamp := OmniLight3D.new()
		lamp.position = Vector3(0.25, 0.3, 0)
		lamp.light_color = Color(1.0, 0.78, 0.48)
		lamp.light_energy = 1.4
		lamp.omni_range = 12.0
		lamp.hide()
		agent.visual.add_child(lamp)
		agent.lamp = lamp
	# `godot --path world -- --follow=human_mira` pins a character, `-- --overview` starts wide,
	# `-- --shots=/abs/dir` keeps a frame every five seconds where the window itself cannot be captured.
	for arg in OS.get_cmdline_user_args():
		if arg == "--overview":
			spec_overview = true
			spec_auto = false
		elif arg.begins_with("--follow="):
			spec_auto = false
			for i in range(agents.size()):
				if str(agents[i].id) == arg.trim_prefix("--follow="):
					spec_follow = i
		elif arg.begins_with("--view="):
			spec_fixed = arg.trim_prefix("--view=")
			spec_auto = false
			spec_overview = false
			spec_cut = true
		elif arg.begins_with("--shots="):
			spec_shot_dir = arg.trim_prefix("--shots=")
			DirAccess.make_dir_recursive_absolute(spec_shot_dir)
	if spec_shot_dir != "":
		# Reading frames back stalls the vsync swap on this driver, so capture runs skip vblank waits.
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	Engine.max_fps = 60

func watch_panel() -> PanelContainer:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.03, 0.04, 0.06, 0.74)
	style.set_content_margin_all(10.0)
	style.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", style)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return panel

# The body is already where the character is; the picture walks there so a spectator can follow it.
func stroll(agent, pts: PackedVector3Array, pace: String) -> void:
	var visual: Node3D = agent.visual
	if not watching or pts.size() < 2:
		visual.position = Vector3.ZERO
		agent.tween = {}
		return
	var rel: PackedVector3Array = [visual.position]
	for point in pts:
		rel.append(point - (agent.pos as Vector3))
	var length := 0.0
	for i in range(1, rel.size()):
		length += rel[i - 1].distance_to(rel[i])
	if length < 0.05:
		visual.position = Vector3.ZERO
		agent.tween = {}
		return
	var rate := 9.0 if pace == "walk" else 15.0 if pace == "run" else 5.0
	agent.tween = {"pts": rel, "length": length, "elapsed": 0.0, "seconds": clampf(length / rate, 0.35, 4.5)}
	watch_pick(agent)

func point_along(pts: PackedVector3Array, gone: float) -> Vector3:
	var left := gone
	for i in range(1, pts.size()):
		var seg := pts[i - 1].distance_to(pts[i])
		if seg > 0.0001 and left <= seg:
			return pts[i - 1].lerp(pts[i], left / seg)
		left -= seg
	return pts[pts.size() - 1]

func watch_step(delta: float) -> void:
	spec_now += delta
	for wagon in carts.values():
		var motion: Dictionary = wagon.motion
		if motion.is_empty():
			continue
		motion.elapsed = minf(float(motion.elapsed) + delta, float(motion.seconds))
		var start: Transform3D = motion.from
		wagon.rig.transform = start.interpolate_with(Transform3D.IDENTITY, float(motion.elapsed) / float(motion.seconds))
		if motion.elapsed >= motion.seconds:
			wagon.motion = {}
	for agent in agents:
		agent.lamp.visible = underground_dark(agent.pos) and has_light(agent)
		# A name right in front of the lens would fill the screen, so near ones shrink.
		var near := clampf(spec_cam.global_position.distance_to(agent.visual.global_position) / 5.0, 0.3, 1.0)
		agent.nameplate.scale = Vector3.ONE * near
		if agent.bubble != null and agent.bubble.visible:
			agent.bubble.scale = Vector3.ONE * near
			agent.bubble.position.y = float(agent.height) * 0.55 + 0.28 + near * (0.14 + float(agent.bubble_rows) * 0.145)
			if spec_now >= float(agent.bubble_until):
				agent.bubble.visible = false
		if agent.note != "" and spec_now >= float(agent.note_until):
			agent.note = ""
		var tween: Dictionary = agent.tween
		var visual: Node3D = agent.visual
		if tween.is_empty():
			# Standing still, the picture turns wherever the character logically faces.
			visual.rotation.y = lerp_angle(visual.rotation.y, atan2(-cos(agent.yaw), sin(agent.yaw)), minf(delta * 10.0, 1.0))
			continue
		tween.elapsed = minf(float(tween.elapsed) + delta, float(tween.seconds))
		if tween.elapsed >= tween.seconds:
			visual.position = Vector3.ZERO
			agent.tween = {}
			continue
		var pts: PackedVector3Array = tween.pts
		var gone: float = tween.length * tween.elapsed / tween.seconds
		var at := point_along(pts, gone)
		var ahead := point_along(pts, gone + 0.5)
		visual.position = at + Vector3(0, 0.045 * absf(sin(float(tween.elapsed) * 16.0)), 0)
		var heading := ahead - at
		heading.y = 0.0
		if heading.length() > 0.01:
			visual.rotation.y = lerp_angle(visual.rotation.y, atan2(-heading.x, -heading.z), minf(delta * 10.0, 1.0))
	if spec_free:
		watch_free_move(delta)
	else:
		watch_follow(delta)
	watch_title()
	if spec_shot_dir != "" and spec_now >= spec_shot_at:
		spec_shot_at = spec_now + 5.0
		get_viewport().get_texture().get_image().save_png("%s/shot_%05d.png" % [spec_shot_dir, spec_shot_count])
		print("SHOT %05d fps=%d" % [spec_shot_count, Engine.get_frames_per_second()])
		spec_shot_count += 1

# Whoever just moved or spoke takes the camera; a pinned character is left alone.
func watch_pick(agent) -> void:
	if not spec_auto or agents[spec_follow] == agent:
		return
	for i in range(agents.size()):
		if agents[i] == agent:
			spec_follow = i
			watch_leave_free()
			spec_cut = true
			spec_orbit = 0.0
			return

func watch_leave_free() -> void:
	spec_free = false
	spec_overview = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func watch_show_overview() -> void:
	spec_free = false
	spec_overview = true
	spec_auto = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func watch_wall(focus: Vector3, spot: Vector3, subject) -> Dictionary:
	var query := PhysicsRayQueryParameters3D.create(focus, spot, CAM_MASK)
	query.exclude = [subject.body.get_rid()]
	return space().intersect_ray(query)

func watch_follow(delta: float) -> void:
	var focus := Vector3(50, 1.0, 0)
	var wanted := Vector3(40, 70, 150)
	if spec_fixed == "facade":
		focus = Vector3(36, 3.4, -30)
		wanted = Vector3(36, 6.2, 8)
	elif spec_fixed == "square":
		focus = Vector3(50, 1.5, -4)
		wanted = Vector3(52, 7.2, 18)
	elif spec_fixed == "gate":
		focus = Vector3(-34, 4.2, 0)
		wanted = Vector3(4, 6.2, 24)
	elif spec_fixed == "farm":
		focus = Vector3(-272, 6, 172)
		wanted = Vector3(-250, 12, 145)
	elif spec_fixed == "oakford":
		focus = Vector3(148, 4, 386)
		wanted = Vector3(176, 11, 358)
	elif spec_fixed == "mine":
		# In front of the adit, east of the walk, so the mouth and the rock courses are both in frame.
		focus = Vector3(45.0, 29.4, -678.0)
		wanted = Vector3(58.0, 30.6, -650.0)
	elif spec_fixed == "cliff":
		# Square on the north wall, west of the adit, so the face between the ribs fills the frame.
		focus = Vector3(-40.0, 58.0, -900.0)
		wanted = Vector3(-40.0, 46.0, -760.0)
	elif spec_fixed == "ruins":
		focus = Vector3(-640, 46, -560)
		wanted = Vector3(-600, 58, -520)
	elif spec_fixed == "wood":
		focus = Vector3(520, 24, 40)
		wanted = Vector3(470, 34, 82)
	elif spec_fixed == "ferry":
		focus = Vector3(-42, 1.4, 480)
		wanted = Vector3(-42, 7.5, 508)
	elif spec_fixed == "people":
		# Just east of the west-gate leaf, in front of Garrick.
		focus = Vector3(-28.0, 1.35, 0.05)
		wanted = Vector3(-29.15, 1.45, 0.85)
	elif spec_fixed == "elf":
		focus = Vector3(340, 13.05, 20)
		wanted = Vector3(343.2, 13.35, 20.45)
	elif spec_fixed == "dwarf":
		focus = Vector3(45, 28.75, -685)
		wanted = Vector3(46.4, 29.35, -682.2)
	elif spec_fixed == "wolf":
		focus = Vector3(-720, 40.45, -340)
		wanted = Vector3(-716.7, 40.95, -338.2)
	elif spec_fixed == "goblin":
		focus = Vector3(-760, 42.6, -410)
		wanted = Vector3(-756.7, 43.05, -408.3)
	elif not spec_overview:
		var subject = agents[spec_follow]
		var feet: Vector3 = subject.visual.global_position - Vector3(0, float(subject.height) * 0.5, 0)
		focus = feet + Vector3(0, float(subject.height) * 0.62, 0)
		# A wall behind the usual spot swings the camera around the subject and then pulls it in,
		# instead of crushing it against them.
		var tries: Array = [spec_orbit]
		for angle in WATCH_ORBITS:
			tries.append(float(angle))
		var found := false
		for boom in [1.0, 0.45]:
			for angle in tries:
				var candidate: Vector3 = focus + WATCH_OFFSET.rotated(Vector3.UP, float(angle)) * spec_zoom * float(boom)
				var hit := watch_wall(focus, candidate, subject)
				if hit.is_empty() or focus.distance_to(hit.position) > focus.distance_to(candidate) - 0.6:
					spec_orbit = float(angle)
					wanted = candidate if hit.is_empty() else hit.position + (focus - candidate).normalized() * 0.3
					found = true
					break
			if found:
				break
		if not found:
			wanted = focus + WATCH_OFFSET.rotated(Vector3.UP, spec_orbit) * spec_zoom * 0.45
			var nearest := watch_wall(focus, wanted, subject)
			if not nearest.is_empty():
				wanted = nearest.position + (focus - wanted).normalized() * 0.3
	if spec_cut:
		spec_cam.global_position = wanted
		spec_cut = false
	else:
		spec_cam.global_position = spec_cam.global_position.lerp(wanted, 1.0 - exp(-delta * 6.0))
	spec_cam.look_at(focus)

func watch_free_move(delta: float) -> void:
	var basis := Basis.from_euler(Vector3(spec_pitch, spec_yaw, 0))
	var motion := Vector3.ZERO
	if Input.is_key_pressed(KEY_W):
		motion -= basis.z
	if Input.is_key_pressed(KEY_S):
		motion += basis.z
	if Input.is_key_pressed(KEY_A):
		motion -= basis.x
	if Input.is_key_pressed(KEY_D):
		motion += basis.x
	if Input.is_key_pressed(KEY_E):
		motion += Vector3.UP
	if Input.is_key_pressed(KEY_Q):
		motion -= Vector3.UP
	if motion.length() > 0.0:
		var speed := 40.0 if Input.is_key_pressed(KEY_SHIFT) else 10.0
		spec_cam.global_position += motion.normalized() * speed * delta
	spec_cam.global_basis = basis

func watch_set_free(on: bool) -> void:
	spec_free = on
	spec_overview = false
	spec_auto = false
	if on:
		var angles := spec_cam.global_rotation
		spec_yaw = angles.y
		spec_pitch = clampf(angles.x, -1.5, 1.5)
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func watch_title() -> void:
	var weather := local_weather(spec_cam.global_position if spec_free else agents[spec_follow].pos)
	update_sky(weather)
	var lines: Array = ["%s  ·  %s  ·  %s" % [clock_label(), season().capitalize(), weather.capitalize()]]
	if spec_free:
		lines.append("Free camera · WASD move · Q/E down/up · Shift fast · click to look · Esc release · F follow · O overview")
	elif spec_overview:
		lines.append("Overview · Tab follow a character · A auto-follow · F free camera")
	else:
		var subject = agents[spec_follow]
		if spec_auto:
			lines.append("Auto-following %s (%s)%s" % [subject.name, subject.id, subject.note])
			lines.append("Tab pin this one · wheel zoom · F free camera · O overview")
		else:
			lines.append("Following %s (%s), pinned%s" % [subject.name, subject.id, subject.note])
			lines.append("Tab next · Shift+Tab previous · wheel zoom · A auto-follow · F free camera · O overview")
	spec_title.text = "\n".join(lines)
	spec_log_panel.visible = spec_lines.size() > 0
	var height := get_viewport().get_visible_rect().size.y
	spec_log_panel.position = Vector2(12, height - spec_log_panel.size.y - 12)

func watch_bubble(agent, text: String, tint: Color, seconds: float) -> void:
	if agent.bubble == null:
		var made := Label3D.new()
		made.font_size = 34
		made.pixel_size = 0.006
		made.width = 760.0
		made.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		made.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		made.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		made.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		made.no_depth_test = true
		made.outline_size = 10
		made.render_priority = 5
		agent.visual.add_child(made)
		agent.bubble = made
	var bubble: Label3D = agent.bubble
	# The box grows upward from above the name; text sits at its bottom.
	var rows := int(ceil(text.length() / 44.0))
	agent.bubble_rows = rows
	bubble.text = text
	bubble.modulate = tint
	bubble.position = Vector3(0, float(agent.height) * 0.55 + 0.42 + rows * 0.145, 0)
	bubble.visible = true
	agent.bubble_until = spec_now + seconds

func watch_note(agent, text: String, tint: Color) -> void:
	if not watching:
		return
	watch_bubble(agent, text, tint, 2.5)
	agent.note = "  ·  " + text
	agent.note_until = spec_now + 6.0

func watch_speech(agent, utterance: String, volume: String, reached: Array) -> void:
	if not watching:
		return
	var tint := Color(1.0, 0.95, 0.6) if volume == "shout" else Color(0.78, 0.8, 0.84) if volume == "whisper" else Color(1, 1, 1)
	watch_bubble(agent, utterance, tint, clampf(2.5 + utterance.length() / 40.0, 3.0, 12.0))
	agent.note = ""
	watch_pick(agent)
	var names: Array = []
	for other in reached:
		names.append(String(other.name))
	var audience := "→ " + ", ".join(names) if names.size() > 0 else "→ unheard"
	spec_lines.append("[%s] %s %s: “%s”" % [clock_label(), agent.name, audience, utterance])
	while spec_lines.size() > 9:
		spec_lines.remove_at(0)
	spec_log.text = "\n".join(spec_lines)

func _unhandled_input(event: InputEvent) -> void:
	if not watching:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		match int(event.keycode):
			KEY_TAB:
				if agents.size() > 0:
					spec_auto = false
					watch_leave_free()
					spec_follow = posmod(spec_follow + (-1 if event.shift_pressed else 1), agents.size())
			KEY_A:
				spec_auto = true
				watch_leave_free()
			KEY_F:
				watch_set_free(not spec_free)
			KEY_O:
				watch_show_overview()
			KEY_ESCAPE:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			spec_zoom = clampf(spec_zoom / 1.15, 0.35, 3.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			spec_zoom = clampf(spec_zoom * 1.15, 0.35, 3.0)
		elif event.button_index == MOUSE_BUTTON_LEFT and event.pressed and spec_free:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		return
	if event is InputEventMouseMotion and spec_free and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		spec_yaw -= event.relative.x * 0.0032
		spec_pitch = clampf(spec_pitch - event.relative.y * 0.0032, -1.5, 1.5)
