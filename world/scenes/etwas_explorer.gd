extends CharacterBody3D

const SPEED := 2.0
const STEP_HEIGHT := 0.32
const WALK_EYE := Vector3(0, 1.63, 0)
const SPRING_APPROACH := Vector3(104.40, 35.05, -120.00)
const SPRING_SEATED_EYE := Vector3(104.72, 35.98, -121.16)
const SPRING_GAZE := Vector3(100.0, 36.05, -168.0)
const START := Vector3(-10.8, 1.65, 1.7)
const START_GAZE := Vector3(7.0, 3.2, -3.7)

@onready var camera: Camera3D = $Camera
@onready var prompt: Label = $Overlay/Margin/Prompt
@onready var world = get_parent()

var yaw := 0.0
var pitch := 0.0
var seated := false
var seat_blend := 0.0
var last_ground := START


func _ready() -> void:
	camera.position = WALK_EYE
	look_toward(START_GAZE)
	if OS.get_cmdline_user_args().has("--pool"):
		position = SPRING_APPROACH + Vector3.UP * 0.16
		last_ground = position
		look_toward(Vector3(105.15, 34.9, -124.2))
	if OS.get_cmdline_user_args().has("--empty"):
		$Overlay.hide()


func look_toward(target: Vector3) -> void:
	var facing := (target - (position + WALK_EYE)).normalized()
	yaw = atan2(-facing.x, -facing.z)
	pitch = asin(facing.y)


func aim(delta: Vector2) -> void:
	yaw -= delta.x * 0.0026
	pitch = clampf(pitch - delta.y * 0.0026, -1.22, 1.20)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and (
		Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
		or event.button_mask & MOUSE_BUTTON_MASK_LEFT
	):
		aim(event.relative)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		elif event.physical_keycode == KEY_E:
			interact()


func _physics_process(delta: float) -> void:
	var forward := int(Input.is_physical_key_pressed(KEY_W) or Input.is_action_pressed("ui_up"))
	var backward := int(Input.is_physical_key_pressed(KEY_S) or Input.is_action_pressed("ui_down"))
	var right := int(Input.is_physical_key_pressed(KEY_D) or Input.is_action_pressed("ui_right"))
	var left := int(Input.is_physical_key_pressed(KEY_A) or Input.is_action_pressed("ui_left"))
	walk(Vector2(right - left, backward - forward), delta)


func walk(input: Vector2, delta: float) -> void:
	var direction := Vector3(input.x, 0, input.y).limit_length().rotated(Vector3.UP, yaw)
	if seated or seat_blend > 0.02:
		direction = Vector3.ZERO
	velocity.x = direction.x * SPEED
	velocity.z = direction.z * SPEED
	velocity.y = -0.3 if is_on_floor() else maxf(velocity.y - 14.0 * delta, -16.0)
	if is_on_floor() and direction.length_squared() > 0.01:
		step_up(direction * maxf(SPEED * delta, 0.12))
	move_and_slide()
	if global_position.y < -5.0:
		global_position = last_ground + Vector3.UP * 0.12
		velocity = Vector3.ZERO
	elif is_on_floor():
		last_ground = global_position


func step_up(motion: Vector3) -> void:
	var obstacle := KinematicCollision3D.new()
	if not test_move(global_transform, motion, obstacle) or obstacle.get_normal().y >= cos(floor_max_angle):
		return
	var toe := global_position + motion.normalized() * 0.37
	var probe := PhysicsRayQueryParameters3D.create(
		toe + Vector3.UP * (STEP_HEIGHT + 0.02), toe, world.L_FLOOR
	)
	var floor_hit := get_world_3d().direct_space_state.intersect_ray(probe)
	if floor_hit.is_empty() or (floor_hit.normal as Vector3).y < cos(floor_max_angle):
		return
	var height: float = floor_hit.position.y - global_position.y
	if height < 0.015 or height > STEP_HEIGHT:
		return
	var rise := Vector3.UP * (height + 0.014)
	if test_move(global_transform, rise):
		return
	if test_move(global_transform.translated(rise), motion):
		return
	global_position += rise


func _process(delta: float) -> void:
	seat_blend = move_toward(seat_blend, float(seated), delta * 0.98)
	camera.position = WALK_EYE.lerp(to_local(SPRING_SEATED_EYE), smoothstep(0, 1, seat_blend))
	camera.rotation = Vector3(pitch, yaw, 0)
	if seated:
		prompt.text = "E  起身"
	elif at_spring_seat():
		prompt.text = "E  坐在岩盘上"
	else:
		var door := facing_door()
		prompt.text = "WASD  行走     拖动鼠标  环顾" if door.is_empty() else ("E  关门" if door.open else "E  开门")


func at_spring_seat() -> bool:
	return global_position.distance_to(SPRING_APPROACH) < 1.12


func facing_door() -> Dictionary:
	var eye := camera.global_position
	var facing := -camera.global_basis.z
	var nearest := 2.35
	var match_door := {}
	for door in world.doors.values():
		var center: Vector3 = door.solid.aabb.get_center() + Vector3.UP * 0.20
		var offset := center - eye
		var reach := offset.length()
		if reach >= nearest or offset.normalized().dot(facing) < 0.65:
			continue
		var query := PhysicsRayQueryParameters3D.create(eye, center, world.L_WORLD | world.L_DOOR | world.L_PROP)
		var hit := get_world_3d().direct_space_state.intersect_ray(query)
		if hit.is_empty() or hit.collider == door.body:
			match_door = door
			nearest = reach
	return match_door


func interact() -> void:
	if seated:
		seated = false
		return
	if at_spring_seat():
		seated = true
		look_toward(SPRING_GAZE + Vector3.UP * (WALK_EYE.y - 0.93))
		return
	var door := facing_door()
	if door.is_empty() or door.lock == "locked":
		return
	# Keep the panel from closing around the explorer.
	if door.open and (door.solid.aabb as AABB).grow(0.30).has_point(position + Vector3.UP):
		return
	door.open = not door.open
	world.apply_door_visual(door)
