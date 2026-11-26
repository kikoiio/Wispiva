extends SceneTree

class RulesWorld extends "res://world.gd":
	func _ready() -> void:
		pass

	func _process(_delta: float) -> void:
		pass

func _initialize() -> void:
	var world := RulesWorld.new()
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
	print("PASS denomination exchange, failed payment, and disguised observation identifiers")
	quit(0)
