extends "res://world.gd"

const ART_ROOTS := ["EtwasTown", "EtwasValley", "EtwasLandscape"]
const NAV_CELL_SIZE := 0.12
const NAV_CELL_HEIGHT := 0.10

var bake_meshes: Array[MeshInstance3D] = []
var registered_meshes: Dictionary = {}
var baked_navigation_mesh: NavigationMesh


func layout_resource_path() -> String:
	return "res://data/etwas_layout.json"


func cast_resource_path() -> String:
	return "res://data/etwas_cast.json"


func build_scene() -> void:
	configure_scene_services()
	load_roads()
	for point in layout.river.points:
		river_pts.append(v3(point))
	for root_name in ART_ROOTS:
		var art_root := find_child(root_name, true, false) as Node3D
		if art_root != null:
			register_model_geometry(art_root)
	for opening in layout.openings:
		var side := str(opening.side)
		var normal := Vector3.RIGHT if side.ends_with("x") else Vector3.BACK
		open_passages.append({
			"center": v3(opening.center),
			"normal": normal,
			"width": float(opening.width),
			"thick": float(opening.thick),
		})
	for door in layout.interior_doors:
		build_free_door(door)
	for building in layout.buildings:
		var floor := v3(building.floor)
		landmarks[str(building.id)] = {
			"name": str(building.name),
			"center": floor,
			"surfaces": [],
		}
	for spec in layout.fixtures:
		register_etwas_fixture(spec)
	for spec in cast.agents:
		spawn_actor(spec, false)
	for spec in cast.wildlife:
		spawn_actor(spec, true)
	for box in cast.containers:
		containers[str(box.id)] = box
	for place_id in layout.places:
		if not landmarks.has(str(place_id)):
			landmarks[str(place_id)] = {
				"name": str(place_id).replace("_", " ").capitalize(),
				"center": v3(layout.places[place_id]),
				"surfaces": [],
			}
	register_fine_rects()


func configure_scene_services() -> void:
	var environment_node := find_child("WorldEnvironment", true, false) as WorldEnvironment
	if environment_node == null:
		environment_node = WorldEnvironment.new()
		environment_node.name = "EtwasEnvironment"
		var fallback_environment := Environment.new()
		var fallback_sky := Sky.new()
		var procedural_sky := ProceduralSkyMaterial.new()
		procedural_sky.sky_top_color = Color(0.23, 0.31, 0.5)
		procedural_sky.sky_horizon_color = Color(0.83, 0.55, 0.42)
		fallback_sky.sky_material = procedural_sky
		fallback_environment.background_mode = Environment.BG_SKY
		fallback_environment.sky = fallback_sky
		fallback_environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		fallback_environment.ambient_light_energy = 0.7
		environment_node.environment = fallback_environment
		add_child(environment_node)
	world_environment = environment_node.environment
	if world_environment != null and world_environment.sky != null:
		if world_environment.sky.sky_material is ProceduralSkyMaterial:
			sky_material = world_environment.sky.sky_material as ProceduralSkyMaterial
	var found_sun := find_child("Sun", true, false) as DirectionalLight3D
	if found_sun == null:
		found_sun = DirectionalLight3D.new()
		found_sun.name = "Sun"
		found_sun.rotation_degrees = Vector3(-34, -28, 0)
		found_sun.light_color = Color(1.0, 0.69, 0.52)
		found_sun.light_energy = 1.0
		found_sun.shadow_enabled = true
		add_child(found_sun)
	sun_light = found_sun
	spec_cam = get_viewport().get_camera_3d()


func update_sky(weather_now: String) -> void:
	if sky_material == null or world_environment == null or sun_light == null:
		return
	super.update_sky(weather_now)


func load_roads() -> void:
	roads.clear()
	for road in layout.roads:
		var points: Array[Vector3] = []
		for point in road.points:
			points.append(v3(point))
		roads.append({
			"id": str(road.id),
			"width": float(road.width),
			"points": points,
		})


func register_model_geometry(root: Node3D) -> void:
	for candidate in root.find_children("*", "MeshInstance3D", true, false):
		var mesh_node := candidate as MeshInstance3D
		if mesh_node.mesh == null or registered_meshes.has(mesh_node.get_instance_id()):
			continue
		var prefix := mesh_prefix(str(mesh_node.name))
		if prefix == "":
			continue
		registered_meshes[mesh_node.get_instance_id()] = true
		var collision_layer := 0
		var blocks_navigation := false
		match prefix:
			"WALK_":
				collision_layer = L_FLOOR
				bake_meshes.append(mesh_node)
			"OBSTACLE_":
				collision_layer = L_WORLD
				blocks_navigation = true
				bake_meshes.append(mesh_node)
			"HIT_":
				collision_layer = L_WORLD
			"NAV_":
				mesh_node.hide()
				bake_meshes.append(mesh_node)
			"FLOOR_":
				collision_layer = L_FLOOR
			"SOLID_":
				collision_layer = L_PROP
				blocks_navigation = true
				bake_meshes.append(mesh_node)
		if collision_layer == 0:
			continue
		var shape := mesh_node.mesh.create_trimesh_shape()
		if shape == null:
			continue
		var body := StaticBody3D.new()
		body.name = str(mesh_node.name) + "_collision"
		body.collision_layer = collision_layer
		body.collision_mask = 0
		var collision := CollisionShape3D.new()
		collision.shape = shape
		body.add_child(collision)
		add_child(body)
		body.global_transform = mesh_node.global_transform
		var bounds: AABB = body.global_transform * mesh_node.get_aabb()
		solids.append({
			"aabb": bounds,
			"nav": blocks_navigation,
			"door": null,
			"until": -1,
			"body": body,
		})


func mesh_prefix(node_name: String) -> String:
	for prefix in ["WALK_", "OBSTACLE_", "HIT_", "NAV_", "FLOOR_", "SOLID_"]:
		if node_name.begins_with(prefix):
			return prefix
	return ""


func register_etwas_fixture(spec: Dictionary) -> void:
	var id := str(spec.id)
	var kind := str(spec.kind)
	var material := "wood" if kind in ["bed", "seat", "workstation", "table"] else "stone"
	var body := add_solid(
		id,
		v3(spec.center),
		v3(spec.size),
		material,
		bool(spec.get("blocks_navigation", true)),
		null,
		L_PROP,
		col(material)
	)
	hide_mesh(body)
	var fixture := {
		"spec": spec,
		"body": body,
		"solid": solids.back(),
		"batches": int(spec.get("batches", -1)),
	}
	fixtures[id] = fixture
	if kind == "fire":
		var flame := Node3D.new()
		flame.name = "Flame"
		body.add_child(flame)
		var glow := flat_mat(Color(1.0, 0.38, 0.12))
		glow.emission_enabled = true
		glow.emission = Color(1.0, 0.32, 0.08)
		for index in range(3):
			visual_box(flame, glow, Vector3((index - 1) * 0.15, 0.35, 0), Vector3(0.16, 0.52 - index * 0.06, 0.16))
		var light := OmniLight3D.new()
		light.position.y = 0.7
		light.light_color = Color(1.0, 0.54, 0.28)
		light.light_energy = 1.25
		light.omni_range = 8.0
		flame.add_child(light)
		flame.hide()
		fixture["flame"] = flame
		fixture["lit_until"] = -1
		add_smoke(fixture)


func register_fine_rects() -> void:
	add_fine(-22.0, 25.0, -30.0, 20.0)


func fill_navmesh() -> void:
	nav_verts = PackedVector3Array()
	nav_polys = []
	cart_polys = []
	vert_index = {}
	corner_height.clear()
	nav_covers = []
	road_links = []
	baked_navigation_mesh = NavigationMesh.new()
	baked_navigation_mesh.agent_radius = 0.36
	baked_navigation_mesh.cell_size = NAV_CELL_SIZE
	baked_navigation_mesh.cell_height = NAV_CELL_HEIGHT
	baked_navigation_mesh.agent_max_climb = 0.30
	var source_geometry := NavigationMeshSourceGeometryData3D.new()
	for mesh_node in bake_meshes:
		if is_instance_valid(mesh_node) and mesh_node.mesh != null:
			source_geometry.add_mesh(mesh_node.mesh, mesh_node.global_transform)
	for fixture in fixtures.values():
		var body: StaticBody3D = fixture.body
		for child in body.get_children():
			if child is not CollisionShape3D or child.shape is not BoxShape3D:
				continue
			var prop_mesh := BoxMesh.new()
			prop_mesh.size = (child.shape as BoxShape3D).size
			source_geometry.add_mesh(prop_mesh, body.global_transform * child.transform)
	NavigationServer3D.bake_from_source_geometry_data(baked_navigation_mesh, source_geometry)


func build_navigation() -> void:
	map_rid = create_nav_map()
	cart_map_rid = create_nav_map()
	for nav_map in [map_rid, cart_map_rid]:
		NavigationServer3D.map_set_cell_size(nav_map, NAV_CELL_SIZE)
		NavigationServer3D.map_set_cell_height(nav_map, NAV_CELL_HEIGHT)
	build_navigation_mesh_only()
	print("WISPIVA_ETWAS_NAV_BAKED")


func install_nav_region(nav_map: RID, _cart_path: bool) -> RID:
	var region := NavigationServer3D.region_create()
	NavigationServer3D.region_set_use_async_iterations(region, false)
	NavigationServer3D.region_set_navigation_mesh(region, baked_navigation_mesh)
	NavigationServer3D.region_set_map(region, nav_map)
	return region


func build_links() -> void:
	pass


func ground_y(x: float, z: float) -> float:
	if on_bridge(x, z):
		var bridge: Dictionary = layout.bridge
		var progress := clampf((x - float(bridge.x0)) / (float(bridge.x1) - float(bridge.x0)), 0.0, 1.0)
		return lerpf(float(bridge.west_y), float(bridge.east_y), progress)
	var nearest_distance := INF
	var nearest_height := 0.0
	var nearest_width := 0.0
	for road in roads:
		var points: Array = road.points
		for index in range(points.size() - 1):
			var hit: Dictionary = closest_xz(x, z, points[index], points[index + 1])
			if float(hit.dist) < nearest_distance:
				nearest_distance = float(hit.dist)
				nearest_height = float(hit.y)
				nearest_width = float(road.width)
	if nearest_distance <= nearest_width * 0.5 + 0.65:
		return nearest_height
	if absf(x) <= 4.2:
		return 0.0
	return float(layout.east_bank_y) if x > 0.0 else float(layout.west_bank_y)


func in_water(x: float, z: float) -> bool:
	var half_width := float(layout.river.half_width)
	return z >= float(layout.river.z_min) and z <= float(layout.river.z_max) and absf(x) < half_width - 0.4


func on_bridge(x: float, z: float) -> bool:
	var bridge: Dictionary = layout.bridge
	return x >= float(bridge.x0) and x <= float(bridge.x1) and z >= float(bridge.z0) and z <= float(bridge.z1)


func weather_region(_pos: Vector3) -> String:
	return "stonebridge"


func tool_rest(agent, args) -> Dictionary:
	var location_id := str(args.get("location_id", ""))
	var fixture: Dictionary = fixtures.get(location_id, {})
	if location_id != "":
		if fixture.is_empty() or str(fixture.spec.kind) not in ["bed", "seat"]:
			return fail("bad_args", "location_id must name an available bed or seat")
		var occupied_by := str(fixture.get("resting_agent", ""))
		if occupied_by != "" and occupied_by != str(agent.id):
			return fail("busy", "someone is already resting there")
		var inaccessible := fixture_access_error(agent, fixture)
		if not inaccessible.is_empty():
			return inaccessible
		fixture["resting_agent"] = str(agent.id)
	var result := super.tool_rest(agent, args)
	if not result.ok:
		if location_id != "":
			fixture.erase("resting_agent")
		return result
	if location_id != "":
		pending_actions[str(agent.id)]["location_id"] = location_id
	return result


func finish_actions(movement_tick: bool) -> bool:
	var resting_locations: Dictionary = {}
	for agent_id in pending_actions:
		var location_id := str(pending_actions[agent_id].get("location_id", ""))
		if location_id != "":
			resting_locations[str(agent_id)] = location_id
	var completed := super.finish_actions(movement_tick)
	for agent_id in resting_locations:
		if pending_actions.has(agent_id):
			continue
		var fixture: Dictionary = fixtures.get(resting_locations[agent_id], {})
		if str(fixture.get("resting_agent", "")) == agent_id:
			fixture.erase("resting_agent")
	return completed


func self_test_paths() -> void:
	for route in [
		["west_to_bath", Vector3(-10.8, 1.5, 1.7), v3(layout.places.bath)],
		["quay_stairs", v3(layout.places.east_street), v3(layout.places.lower_quay)],
		["gate_to_old_bath", v3(layout.places.east_gate), v3(layout.places.old_bath_entrance)],
		["old_bath_to_summit", v3(layout.places.old_bath_entrance), v3(layout.places.summit_access)],
	]:
		sample_path(str(route[0]), route[1], route[2])
