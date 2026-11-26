extends RefCounted

const INJURIES := ["bruised", "lacerated", "fractured", "burned", "bleeding", "fever"]
const BLOOD_LOSS_FAINT := 25.0
const BLOOD_LOSS_FATAL := 60.0
const SPLINT_HEAL_MINUTES := 4320

static func initial() -> Dictionary:
	return {
		"stamina": 100.0,
		"hunger": 12.0,
		"thirst": 10.0,
		"wetness": 0.0,
		"warmth": 37.0,
		"blood_loss": 0.0,
		"injuries": [],
		"fracture_rest": 0,
		"open_wound_minutes": 0,
		"splinted": false,
		"unconscious": false,
		"dead": false,
	}

static func injure(body: Dictionary, injury: String) -> void:
	if body.dead or injury not in INJURIES or injury in body.injuries:
		return
	body.injuries.append(injury)
	if injury == "fractured":
		body.splinted = false
		body.fracture_rest = 0

static func dress_wound(body: Dictionary) -> void:
	body.injuries.erase("bleeding")
	body.injuries.erase("lacerated")

static func bleed(body: Dictionary, amount: float) -> void:
	injure(body, "lacerated")
	injure(body, "bleeding")
	body.blood_loss += amount
	body.unconscious = body.blood_loss >= BLOOD_LOSS_FAINT or body.warmth < 28.5
	body.dead = body.blood_loss >= BLOOD_LOSS_FATAL or body.warmth < 26.0

static func step(body: Dictionary, minutes: int, air_c: float, wet: bool, sheltered: bool, fire: bool, winter_clothes: bool, resting: bool) -> void:
	const HOURS := 1.0 / 60.0
	for _minute in range(minutes):
		if body.dead:
			return
		body.hunger = minf(100.0, float(body.hunger) + HOURS * (2.5 if resting else 4.0))
		body.thirst = minf(100.0, float(body.thirst) + HOURS * (3.0 if resting else 5.0))
		var dry_rate := 65.0 if fire else 28.0 if sheltered else 12.0
		var moisture := HOURS * (82.0 if wet else -dry_rate)
		body.wetness = clampf(float(body.wetness) + moisture, 0.0, 100.0)
		var insulation := 5.0 if winter_clothes else 0.0
		var chill := maxf(0.0, 12.0 - air_c - insulation + float(body.wetness) * 0.11)
		var target := 37.0 - chill * 0.34
		if sheltered:
			target = maxf(target, 36.4)
		if fire:
			target = 37.0
		body.warmth = move_toward(float(body.warmth), target, HOURS * (3.0 if fire else 1.8))
		if "bleeding" in body.injuries:
			body.blood_loss += 1.0
		else:
			body.blood_loss = maxf(0.0, float(body.blood_loss) - HOURS * (8.0 if resting else 3.0))
		if "lacerated" in body.injuries:
			body.open_wound_minutes += 1
			if body.open_wound_minutes >= 1440:
				injure(body, "fever")
		else:
			body.open_wound_minutes = 0
		if resting:
			var recovery := 40.0 if fire or sheltered else 20.0
			body.stamina = minf(100.0, float(body.stamina) + recovery * HOURS)
			if body.splinted and "fractured" in body.injuries:
				body.fracture_rest += 1
				if body.fracture_rest >= SPLINT_HEAL_MINUTES:
					body.injuries.erase("fractured")
					body.splinted = false
		body.unconscious = body.blood_loss >= BLOOD_LOSS_FAINT or body.warmth < 28.5
		body.dead = body.blood_loss >= BLOOD_LOSS_FATAL or body.warmth < 26.0

static func minutes_to_blood_change(body: Dictionary) -> int:
	if body.dead or "bleeding" not in body.injuries:
		return 60
	var threshold := BLOOD_LOSS_FATAL if body.unconscious else BLOOD_LOSS_FAINT
	return maxi(1, int(ceil(threshold - float(body.blood_loss))))

static func pace_factor(body: Dictionary) -> float:
	var factor := 1.0
	if body.thirst >= 70.0 or body.hunger >= 80.0:
		factor *= 0.75
	if body.stamina < 25.0:
		factor *= 0.65
	if body.warmth < 35.0:
		factor *= 0.72
	if "fractured" in body.injuries:
		factor *= 0.65 if body.splinted else 0.45
	if "fever" in body.injuries:
		factor *= 0.8
	return factor
