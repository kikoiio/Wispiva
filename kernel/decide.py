"""Ask the configured model what one character does on this tick.

The world still accepts or rejects the attempt. Model failures block the turn.
"""

from __future__ import annotations

from kernel.model import chat_text, load_provider, parse_json_object

SYSTEM = (
    "你是故事世界里的一个角色，正在决定这一拍只做一件事。"
    "你只根据写给你的处境判断，不要补充没有写明的秘密。"
    "关着或已经关闭的地方进不去，不在身边的人听不见。"
    "只返回一个 JSON 对象，键是 action、target、line。"
    "action 只能是 move、speak、wait。"
    "move 的 target 是一个相邻地点的名字，line 为空字符串。"
    "speak 的 target 是身边某个人的名字，line 是你说出口的那一句。"
    "wait 的 target 为空字符串，line 是你留在原地时心里或嘴里的那一句。"
)


def model_decider(world, agent: dict, messages: list[dict]) -> dict | None:
    if load_provider() is None:
        raise ValueError("没有已配置的模型")
    world = world._observation(agent)
    agent = world.agents[agent["id"]]
    reply = chat_text(SYSTEM, situation(world, agent, messages), max_tokens=1200, timeout=70)
    return plan_from(world, agent, parse_json_object(reply))


def situation(world, agent: dict, messages: list[dict]) -> str:
    world = world._observation(agent)
    agent = world.agents[agent["id"]]
    here = agent["location"]
    place = world._place_name(here)
    neighbors = []
    for left, right in world.links:
        other = right if left == here else left if right == here else None
        if other is None:
            continue
        neighbors.append(world._place_name(other))
    company = [
        other["name"]
        for other in world.agents.values()
        if other["id"] != agent["id"] and other["location"] == here
    ]
    relations = []
    for item in world.relations:
        if agent["id"] not in {item["a"], item["b"]}:
            continue
        other_id = item["b"] if item["a"] == agent["id"] else item["a"]
        kind = {"trust": "信任", "distrust": "不信任", "knows": "认识"}.get(item["kind"], item["kind"])
        relations.append(f"你{kind}{world._name(other_id)}")
    rules = []
    for rule in world.rules:
        text = (rule.get("text") or "") if isinstance(rule, dict) and rule.get("public") is True else ""
        if text:
            rules.append(text)
    memory = [item.get("text") or "" for item in agent.get("memory") or []][-6:]
    heard = [
        f"{message.get('sender_name') or world._name(message['from'])}说：{message.get('text') or ''}"
        for message in messages
    ]
    failure = agent.get("last_failure") or {}
    failed = ""
    if failure:
        target = failure.get("target")
        target_name = world._place_name(target) if target in world.locations else world._name(target)
        failed = f"{failure.get('action') or '行动'} {target_name}".strip()
    lines = [
        f"你是{agent['name']}。目标：{agent.get('goal') or '没有写明的目标'}。",
        f"你在{place}。",
        f"身边的人：{'、'.join(company) if company else '没有别人'}。",
        f"能直接走到：{'、'.join(neighbors) if neighbors else '哪里都去不了'}。",
        f"关系：{'、'.join(relations) if relations else '没有写明'}。",
        f"大家都知道的规则：{'；'.join(rules) if rules else '没有'}。",
        "你记得：",
        *([f"- {item}" for item in memory] or ["- 还没有发生过的事。"]),
    ]
    if heard:
        lines.append("这一拍你刚听见：")
        lines.extend(f"- {item}" for item in heard)
    if failed:
        lines.append(f"上一件没做成的事：{failed}。不要原样再做一次。")
    return "\n".join(lines)


def plan_from(world, agent: dict, data: dict) -> dict | None:
    if not isinstance(data, dict) or not isinstance(data.get("action"), str):
        return None
    if any(key in data and not isinstance(data[key], str) for key in ("target", "line")):
        return None
    action = str(data.get("action") or "").strip().lower()
    target_name = str(data.get("target") or "").strip()
    line = " ".join(str(data.get("line") or "").split())
    if action == "wait":
        stay = f"{agent['name']}留在{world._place_name(agent['location'])}。"
        if line:
            if not line.endswith(("。", "！", "？")):
                line += "。"
            stay = line if line.startswith(f"{agent['name']}留在") else f"{stay}{line}"
        return {"action": "wait", "text": stay}
    if action == "move":
        place_id = _match(target_name, ((item["name"], item["id"]) for item in world.locations.values()))
        if place_id is None:
            return None
        return {"action": "move", "target": place_id}
    if action == "speak":
        others = (
            (other["name"], other["id"])
            for other in world.agents.values()
            if other["id"] != agent["id"]
        )
        other_id = _match(target_name, others)
        if other_id is None:
            return None
        spoken = line or "……"
        if "说" not in spoken:
            if not spoken.endswith(("。", "！", "？")):
                spoken += "。"
            spoken = f"{agent['name']}对{world._name(other_id)}说：{spoken}"
        return {"action": "speak", "target": other_id, "text": spoken}
    return None


def _match(name: str, pairs) -> str | None:
    cleaned = name.strip()
    if not cleaned:
        return None
    found = None
    for label, ident in pairs:
        if cleaned == label:
            return ident
        if cleaned in label or label in cleaned:
            found = ident
    return found
