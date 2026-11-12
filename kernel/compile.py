"""Turn one sentence into locations, people, paths, relations, and access rules.

The model path is optional. Without it, the compiler only keeps things the
sentence supports, and it labels a place it had to recover from a phrase.
"""

from __future__ import annotations

import re

from kernel.model import chat_text, parse_json_object
from kernel.sim import hue_for

PLACE_WORDS = (
    "城门", "码头", "市集", "地下室", "当铺", "银行", "驿站", "档案阁",
    "庭院", "宫殿", "甲板", "车厢", "城墙", "内堂",
)
PLACE_TAIL = "背园阁港桥塔街铺山河站村镇室堂窖厅店馆"
ROLES = (
    "守城人", "守门人", "当铺老板", "银行家", "掌柜", "学徒", "伙计",
    "船长", "旅客", "卫兵", "医生", "侦探", "助手", "馆主", "店主",
    "商人", "老人", "孩子", "主人", "客人",
)
VAGUE = {"城市", "世界", "地方", "城"}
MODEL_SYSTEM = (
    "你把一句世界设想拆成可运行的模拟数据。只输出一个 JSON 对象，不要解释。"
    "先保住这句话里的人物、地点和限制。"
    "再补上能让这些人和事碰在一起的地点与人物，总共至少四个地点、五个人。"
    "每个人有自己的目标，人与人之间要有关系。"
    "不要写一个和原句矛盾的故事。"
)


def compile_text(text: str, use_model: bool = False) -> dict:
    sentence = " ".join(text.strip().split())
    if not sentence:
        raise ValueError("先写一句设想")
    notes = []
    model_info = {"used": False, "error": ""}
    if use_model:
        try:
            payload = parse_json_object(chat_text(MODEL_SYSTEM, _model_prompt(sentence)))
            spec = _from_model(sentence, payload)
            spec["model"] = {"used": True, "error": ""}
            spec["mode"] = "model"
            spec["notes"] = [{"stage": "model", "text": "人物、地点和限制来自模型返回，并经过地点与路径核对。"}, *spec["notes"]]
            return spec
        except Exception as error:
            raise ValueError(f"模型没有交回可用的世界：{error}") from error
    spec = _from_sentence(sentence)
    spec["notes"] = notes + spec["notes"]
    spec["model"] = model_info
    spec["mode"] = "rules"
    return spec


def _from_sentence(sentence: str) -> dict:
    places = _extract_places(sentence)
    people = _extract_people(sentence)
    notes = [{"stage": "intent", "text": f"从这句话拆出 {len(places)} 个地点、{len(people)} 个人。"}]
    if not places:
        places = [_recovered_place(sentence)]
        notes.append({"stage": "place", "text": f"句子没有点出可走的地点，用「{places[0]}」作为现场，来源是推断。"})
    location_ids = {name: f"l{index}" for index, name in enumerate(places, start=1)}
    locations = []
    for name in places:
        access = _access(sentence, name)
        locations.append({
            "id": location_ids[name],
            "name": name,
            "kind": _kind(name),
            "w": 8,
            "h": 7,
            "access": access,
            "description": _clause_for(sentence, name),
            "source": "text" if name in sentence or name[:-1] in sentence else "inferred",
        })
    if any(item["access"]["closed_after"] == 0 for item in locations):
        notes.append({"stage": "rule", "text": "句子里的关闭期限在第一拍就已经生效，晚到的人进不去。"})
    links = _chain([item["id"] for item in locations])
    if len(locations) > 1:
        notes.append({"stage": "path", "text": "地点按出现顺序连成一条路。"})
    people_ids = {name: f"a{index}" for index, name in enumerate(people, start=1)}
    taken = set()
    agents = []
    for name in people:
        home = _home(name, locations, taken)
        taken.add(home)
        agenda = []
        if "守" not in name:
            agenda = [item["id"] for item in locations if item["id"] != home]
        agents.append({
            "id": people_ids[name],
            "name": name,
            "location": home,
            "hue": hue_for(name),
            "goal": _goal(name, locations, home),
            "agenda": agenda,
            "source": "text",
        })
    if not agents:
        notes.append({"stage": "people", "text": "句子没有点出人物。世界可以先空着，再手动加入。"})
    relations = _relations(sentence, people, people_ids)
    rules = _rules(sentence)
    spec = {
        "name": _world_name(sentence),
        "origin": sentence,
        "tick": 0,
        "notes": notes,
        "rules": [{"text": rule, "source": "text"} for rule in rules],
        "locations": locations,
        "links": links,
        "relations": relations,
        "agents": agents,
        "events": [],
    }
    return _enrich(spec, sentence)


def _extract_places(text: str) -> list[str]:
    found = [word for word in PLACE_WORDS if word in text]
    pattern = re.compile(rf"([\u4e00-\u9fff]{{1,4}})([{PLACE_TAIL}])")
    for match in pattern.finditer(text):
        prefix = match.group(1)
        for token in ("的", "在", "上", "和", "与", "了", "座", "建"):
            if token in prefix:
                prefix = prefix.split(token)[-1]
        prefix = prefix[-3:]
        if not prefix or any(token in prefix for token in ("的", "上", "在", "和")):
            continue
        if match.end() < len(text) and text[match.end()] == "人":
            continue
        name = prefix + match.group(2)
        if name in VAGUE or len(name) < 2 or name in found:
            continue
        if any(name != word and name in word for word in found):
            continue
        found.append(name)
    roles = [role for role in ROLES if role in text]
    return [
        name for name in found
        if not any(name != other and name in other for other in found)
        and not any(name != role and name in role for role in roles)
    ]


def _extract_people(text: str) -> list[str]:
    found = []
    for role in sorted(ROLES, key=len, reverse=True):
        if role in text and not any(role != other and role in other for other in found):
            found.append(role)
    for match in re.finditer(r"(?:叫做|名为|名叫|叫)([\u4e00-\u9fff]{2,4})", text):
        name = match.group(1)
        if name not in found and name not in VAGUE:
            found.append(name)
    return found


def _access(text: str, place: str) -> dict:
    sealed = False
    closed_after = None
    for clause in _clauses(text):
        if place not in clause:
            continue
        if not any(word in clause for word in ("关闭", "不许", "禁止", "封闭", "不得", "不让")):
            continue
        if any(word in clause for word in ("日落", "傍晚", "天黑", "夜里", "晚上", "黄昏")):
            closed_after = 0
        else:
            sealed = True
    return {"sealed": sealed, "closed_after": closed_after}


def _relations(text: str, people: list[str], ids: dict[str, str]) -> list[dict]:
    relations = []
    seen = set()
    for clause in _clauses(text):
        present = [person for person in people if person in clause]
        if len(present) < 2:
            continue
        if "不信任" in clause or "怀疑" in clause or "仇" in clause:
            kind = "distrust"
        elif "信任" in clause:
            kind = "trust"
        elif any(word in clause for word in ("认识", "知道", "师徒", "朋友")):
            kind = "knows"
        else:
            continue
        key = tuple(sorted((present[0], present[1]))) + (kind,)
        if key in seen:
            continue
        seen.add(key)
        relations.append({"a": ids[present[0]], "b": ids[present[1]], "kind": kind, "source": "text"})
    return relations


def _rules(text: str) -> list[str]:
    rules = []
    for clause in _clauses(text):
        if any(word in clause for word in ("不能", "必须", "只有", "禁止", "关闭", "不许", "不得", "不让")):
            rules.append(clause)
    return rules


def _world_name(text: str) -> str:
    quoted = re.search(r"《([^》]{1,24})》", text)
    if quoted:
        return quoted.group(1)
    clause = _clauses(text)[0] if _clauses(text) else text
    return clause[:18] if clause else "未名世界"


def _recovered_place(text: str) -> str:
    clause = _clauses(text)[0] if _clauses(text) else "现场"
    name = clause[:8] or "现场"
    return name


def _home(name: str, locations: list[dict], taken: set[str]) -> str:
    best = None
    best_score = 0
    for location in locations:
        score = _shared(name, location["name"])
        if score > best_score:
            best = location["id"]
            best_score = score
    if best and best not in taken:
        return best
    for location in locations:
        if location["id"] not in taken:
            return location["id"]
    return locations[0]["id"]


def _shared(left: str, right: str) -> int:
    best = 0
    for size in range(1, min(len(left), len(right)) + 1):
        for start in range(0, len(left) - size + 1):
            if left[start:start + size] in right:
                best = size
    return best


def _goal(name: str, locations: list[dict], home: str) -> str:
    home_name = next(item["name"] for item in locations if item["id"] == home)
    if "守" in name:
        return f"守着{home_name}"
    other = next((item["name"] for item in locations if item["id"] != home), "")
    if other:
        return f"从{home_name}去{other}"
    return f"留在{home_name}"


def _kind(name: str) -> str:
    if any(word in name for word in ("室", "阁", "堂", "窖", "厅", "铺", "店")):
        return "indoor"
    if any(word in name for word in ("港", "码头", "河")):
        return "waterfront"
    return "outdoor"


def _clause_for(text: str, name: str) -> str:
    for clause in _clauses(text):
        if name in clause or (name.endswith("背") and name[:-1] in clause):
            return clause
    return ""


def _chain(ids: list[str]) -> list[list[str]]:
    return [[ids[index], ids[index + 1]] for index in range(len(ids) - 1)]


def _enrich(spec: dict, sentence: str) -> dict:
    for location in spec["locations"]:
        access = _access(sentence, location["name"])
        if access["sealed"]:
            location["access"]["sealed"] = True
        if access["closed_after"] is not None:
            location["access"]["closed_after"] = access["closed_after"]
    if "巨兽" in sentence and any(item["name"] == "城门" for item in spec["locations"]):
        _beast_company(spec)
    else:
        _minimum_company(spec, sentence)
    return spec


def _beast_company(spec: dict) -> None:
    for name, kind in (("市集", "outdoor"), ("兽脊", "outdoor"), ("汲水处", "outdoor"), ("夜瞭台", "outdoor")):
        _add_place(spec, name, kind, "巨兽背上的人要有地方碰头。")
    places = {item["name"]: item["id"] for item in spec["locations"]}
    gate = places["城门"]
    market = places["市集"]
    for agent in spec["agents"]:
        if agent["name"] == "守城人":
            agent["location"] = gate
            agent["agenda"] = []
            agent["goal"] = "守着城门"
        elif agent["name"] == "商人":
            agent["location"] = market
            agent["agenda"] = [gate]
            agent["goal"] = "进城门做买卖"
    added = [
        ("学徒", "市集", "跟着商人，把话说到城门里", ["城门"], [("商人", "trust")]),
        ("卖水人", "汲水处", "守住巨兽背上的水", ["市集"], [("商人", "knows"), ("守城人", "knows")]),
        ("巡夜人", "夜瞭台", "把夜里看见的事告诉守城人", ["兽脊"], [("守城人", "trust")]),
        ("饲兽人", "兽脊", "在兽脊听巨兽的动静，等巡夜人把话带到", [], [("巡夜人", "knows")]),
    ]
    for name, home, goal, agenda, relations in added:
        _add_person(spec, name, places[home], goal, [places[place] for place in agenda])
        for other, kind in relations:
            _add_relation(spec, name, other, kind)
    spec["links"] = _named_links(spec, (
        ("城门", "市集"),
        ("市集", "巨兽背"),
        ("巨兽背", "兽脊"),
        ("兽脊", "夜瞭台"),
        ("市集", "汲水处"),
        ("汲水处", "兽脊"),
    ))
    linked = {place_id for pair in spec["links"] for place_id in pair}
    for place in spec["locations"]:
        if place["id"] not in linked:
            spec["links"].append([market, place["id"]])
    spec["notes"].append({
        "stage": "company",
        "text": "句子里只有守城人和商人。补了学徒、卖水人、巡夜人和饲兽人，以及市集、兽脊、汲水处、夜瞭台，好让关着的城门外面仍有事发生。这些是推断。",
    })


def _minimum_company(spec: dict, sentence: str) -> None:
    homes = [item["id"] for item in spec["locations"]]
    if not homes:
        return
    before = (len(spec["locations"]), len(spec["agents"]))
    for name, kind in (("路口", "outdoor"), ("聚集处", "outdoor"), ("歇脚处", "outdoor")):
        if len(spec["locations"]) >= 4:
            break
        _add_place(spec, name, kind, "人需要一个能碰头的地方。")
    open_places = [item["id"] for item in spec["locations"]]
    anchor = open_places[0]
    for name, goal in (
        ("传话人", "把看见的事告诉还没碰面的人"),
        ("管事", "让每个人都有地方碰头"),
        ("过客", "在还进不去的地方外面等消息"),
    ):
        if len(spec["agents"]) >= 5:
            break
        home = open_places[min(len(spec["agents"]), len(open_places) - 1)]
        _add_person(spec, name, home, goal, [place for place in open_places if place != home][:2])
        if spec["agents"]:
            host = next((agent["name"] for agent in spec["agents"] if agent["name"] != name), "")
            if host:
                _add_relation(spec, name, host, "knows")
    for place in spec["locations"]:
        if place["id"] == anchor:
            continue
        if not any(anchor in pair and place["id"] in pair for pair in spec["links"]):
            spec["links"].append([anchor, place["id"]])
    if (len(spec["locations"]), len(spec["agents"])) != before:
        spec["notes"].append({
            "stage": "company",
            "text": "原句里的人和地点太少，补了碰头的地方和传话的人。这些是推断，不是原句里的名字。",
        })


def _add_place(spec: dict, name: str, kind: str, description: str) -> None:
    if any(item["name"] == name for item in spec["locations"]):
        return
    spec["locations"].append({
        "id": _next_id(spec["locations"], "l"),
        "name": name,
        "kind": kind,
        "w": 8,
        "h": 7,
        "access": {"sealed": False, "closed_after": None},
        "description": description,
        "source": "inferred",
    })


def _add_person(spec: dict, name: str, home: str, goal: str, agenda: list[str]) -> None:
    if any(agent["name"] == name for agent in spec["agents"]):
        return
    spec["agents"].append({
        "id": _next_id(spec["agents"], "a"),
        "name": name,
        "location": home,
        "hue": hue_for(name),
        "goal": goal,
        "agenda": [place for place in agenda if place != home],
        "source": "inferred",
    })


def _add_relation(spec: dict, left_name: str, right_name: str, kind: str) -> None:
    ids = {agent["name"]: agent["id"] for agent in spec["agents"]}
    left = ids.get(left_name)
    right = ids.get(right_name)
    if not left or not right or left == right:
        return
    if any({item["a"], item["b"]} == {left, right} and item["kind"] == kind for item in spec["relations"]):
        return
    spec["relations"].append({"a": left, "b": right, "kind": kind, "source": "inferred"})


def _named_links(spec: dict, pairs: tuple[tuple[str, str], ...]) -> list[list[str]]:
    ids = {item["name"]: item["id"] for item in spec["locations"]}
    links = []
    seen = set()
    for left_name, right_name in pairs:
        left = ids.get(left_name)
        right = ids.get(right_name)
        if not left or not right or left == right:
            continue
        key = tuple(sorted((left, right)))
        if key in seen:
            continue
        seen.add(key)
        links.append([left, right])
    return links or spec["links"]


def _next_id(items: list[dict], prefix: str) -> str:
    numbers = []
    for item in items:
        raw = str(item.get("id") or "")
        if raw.startswith(prefix) and raw[len(prefix):].isdigit():
            numbers.append(int(raw[len(prefix):]))
    return f"{prefix}{max(numbers, default=0) + 1}"


def _clauses(text: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"[，。；、！？\n]", text) if part.strip()]
    return parts or [text.strip()]


def _model_prompt(sentence: str) -> str:
    return (
        "设想：" + sentence + "\n"
        "输出字段：name, locations[{name, kind(indoor|outdoor|waterfront), sealed, closed_after, description}], "
        "links[[地点名, 地点名]], characters[{name, location, goal, agenda:[地点名]}], "
        "relations[{a, b, kind(trust|distrust|knows)}], rules[{text, public:布尔值（仅所有人公开知道的规则为true）}], notes[字符串]。"
        "closed_after 是整数拍数或 null。sealed 为 true 时谁都不能进入。"
        "links 只连接真的相邻的地点。"
        "至少四个地点、五个人。句子里已经点名的人和地点必须保留。"
    )


def _from_model(sentence: str, payload: dict) -> dict:
    raw_locations = payload.get("locations") or []
    if not isinstance(raw_locations, list) or not raw_locations:
        raise ValueError("模型没有给出地点")
    locations = []
    by_name = {}
    for index, item in enumerate(raw_locations, start=1):
        if not isinstance(item, dict) or not str(item.get("name") or "").strip():
            continue
        name = str(item["name"]).strip()
        if name in by_name:
            continue
        location_id = f"l{index}"
        by_name[name] = location_id
        closed_after = item.get("closed_after")
        if closed_after in ("", None):
            closed_after = None
        else:
            closed_after = int(closed_after)
        kind = item.get("kind") if item.get("kind") in {"indoor", "outdoor", "waterfront"} else _kind(name)
        locations.append({
            "id": location_id,
            "name": name,
            "kind": kind,
            "w": 8,
            "h": 7,
            "access": {"sealed": bool(item.get("sealed")), "closed_after": closed_after},
            "description": str(item.get("description") or ""),
            "source": "model",
        })
    if not locations:
        raise ValueError("模型给出的地点没有名字")
    links = []
    for pair in payload.get("links") or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        left = by_name.get(str(pair[0]).strip())
        right = by_name.get(str(pair[1]).strip())
        if left and right and left != right:
            links.append([left, right])
    if not links:
        links = _chain([item["id"] for item in locations])
    agents = []
    by_person = {}
    for index, item in enumerate(payload.get("characters") or [], start=1):
        if not isinstance(item, dict) or not str(item.get("name") or "").strip():
            continue
        name = str(item["name"]).strip()
        if name in by_person:
            continue
        agent_id = f"a{index}"
        by_person[name] = agent_id
        home_name = str(item.get("location") or "").strip()
        home = by_name.get(home_name) or locations[0]["id"]
        agenda = []
        for place_name in item.get("agenda") or []:
            place_id = by_name.get(str(place_name).strip())
            if place_id and place_id != home and place_id not in agenda:
                agenda.append(place_id)
        agents.append({
            "id": agent_id,
            "name": name,
            "location": home,
            "hue": hue_for(name),
            "goal": str(item.get("goal") or "").strip(),
            "agenda": agenda,
            "source": "model",
        })
    relations = []
    for item in payload.get("relations") or []:
        if not isinstance(item, dict):
            continue
        left = by_person.get(str(item.get("a") or "").strip())
        right = by_person.get(str(item.get("b") or "").strip())
        kind = item.get("kind")
        if left and right and left != right and kind in {"trust", "distrust", "knows"}:
            relations.append({"a": left, "b": right, "kind": kind, "source": "model"})
    rules = []
    for rule in payload.get("rules") or []:
        text = str(rule.get("text") or "") if isinstance(rule, dict) else str(rule)
        if text.strip():
            rules.append({"text": text, "source": "model",
                          "public": isinstance(rule, dict) and rule.get("public") is True})
    extra_notes = [{"stage": "note", "text": str(note)} for note in payload.get("notes") or [] if str(note).strip()]
    spec = {
        "name": str(payload.get("name") or _world_name(sentence)).strip() or _world_name(sentence),
        "origin": sentence,
        "tick": 0,
        "notes": extra_notes,
        "rules": rules,
        "locations": locations,
        "links": links,
        "relations": relations,
        "agents": agents,
        "events": [],
    }
    return _enrich(spec, sentence)
