extends SceneTree

class RulesWorld extends "res://world.gd":
	func _ready() -> void:
		pass

	func _process(_delta: float) -> void:
		pass

func _initialize() -> void:
	var world := RulesWorld.new()
	var wagon := Transform3D(Basis.looking_at(Vector3.BACK), Vector3(0, 0.65, 0))
	var turn := world.cart_pose_after_step(Vector3(0.01, 0, 2.55), wagon)
	if turn.origin.distance_to(wagon.origin) > 0.02 or turn.basis.z.angle_to(wagon.basis.z) > 0.01:
		push_error("A tiny turn by the hauler must not swing the trailing cart across the road")
		quit(1)
		return
	var payer := {"sp": 1, "cp": 0}
	var receiver := {"sp": 0, "cp": 0}
	if not world.move_stack(payer, receiver, "cp", 2) or payer != {"sp": 0, "cp": 8} or receiver.cp != 2:
		push_error("Copper payment must make change and conserve value")
		quit(1)
		return
	if world.move_stack(payer, receiver, "sp", 1) or payer.cp != 8 or receiver.cp != 2:
		push_error("An unaffordable coin transfer must preserve both wallets")
		quit(1)
		return
	if not world.move_stack(receiver, payer, "cp", 2) or not world.take_stack(payer, "sp", 1) or payer.sp != 0 or payer.cp != 0:
		push_error("Ten copper must cover one silver")
		quit(1)
		return
	var observation: Dictionary = world.public_observation({"id": "demon_kael", "visible_listeners": ["demon_kael"], "events": [{"from": "demon_kael", "utterance": "demon_kael"}]})
	if observation.id != "traveler_kael" or observation.visible_listeners != ["traveler_kael"] or observation.events[0].from != "traveler_kael" or observation.events[0].utterance != "demon_kael":
		push_error("Public identifiers must preserve the disguise and literal speech")
		quit(1)
		return
	world.free()
	print("PASS cart articulation, denomination exchange, failed payment, and disguised observation identifiers")
	quit(0)
