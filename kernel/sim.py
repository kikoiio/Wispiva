"""Tick loop: perceive, plan, and invoke for every agent, then reflect, then deliver mail.

Messages sent during a tick stay in the queue until reflect has finished, so the
receiver perceives them on the next tick. Movement is only along a direct link,
and a closed or sealed place rejects entry.
"""

from __future__ import annotations

from collections import deque
from copy import copy, deepcopy


def hue_for(name: str) -> int:
    return sum(ord(char) for char in name) % 360


class SimulationBlocked(ValueError):
    """A requested model turn could not produce a complete valid set of plans."""


class World:
    def __init__(self, spec: dict):
        self.name = spec.get("name") or "未名世界"
        self.origin = spec.get("origin") or ""
        self.mode = spec.get("mode") or ("model" if (spec.get("model") or {}).get("used") else "rules")
        self._revision = spec.get("_revision", 0)
        self.world_id = spec.get("world_id")
        self.simulation = deepcopy(spec.get("simulation") or {})
        self.archived_actors = deepcopy(spec.get("archived_actors") or spec.get("archivedActors") or [])
        self.tick_index = int(spec.get("tick") or 0)
        self.notes = list(spec.get("notes") or [])
        self.rules = list(spec.get("rules") or [])
        self.model_info = dict(spec.get("model") or {"used": False, "error": ""})
        self.locations = {item["id"]: _location(item) for item in spec.get("locations") or []}
        self.links = []
        seen = set()
        for pair in spec.get("links") or []:
            if len(pair) != 2:
                continue
            edge = tuple(sorted((pair[0], pair[1])))
            if edge[0] == edge[1] or edge in seen:
                continue
            if edge[0] not in self.locations or edge[1] not in self.locations:
                continue
            seen.add(edge)
            self.links.append([edge[0], edge[1]])
        self.relations = []
        for item in spec.get("relations") or []:
            if item.get("a") and item.get("b") and item.get("kind") in {"trust", "distrust", "knows"}:
                self.relations.append({"a": item["a"], "b": item["b"], "kind": item["kind"], "source": item.get("source") or "text"})
        self.agents = {}
        for item in spec.get("agents") or []:
            self.agents[item["id"]] = _agent(item)
        self.events = deepcopy(spec.get("events") or [])
        historical_ids = set(self.agents) | {a["id"] for a in self.archived_actors}
        historical_ids.update(e.get("agent", "") for e in self.events)
        highest = max((int(i[1:]) for i in historical_ids if isinstance(i, str) and i.startswith("a") and i[1:].isdigit()), default=0)
        self.next_agent_id = max(int(spec.get("next_agent_id") or 1), highest + 1)
        self._queue: list[dict] = list(spec.get("outbox") or [])

    def snapshot(self) -> dict:
        return {
            "name": self.name,
            "origin": self.origin,
            "mode": self.mode,
            "tick": self.tick_index,
            "notes": self.notes,
            "rules": self.rules,
            "model": {
                "used": bool(self.model_info.get("used")),
                "error": self.model_info.get("error") or "",
                "name": self.model_info.get("name") or "",
            },
            "tileSize": 16,
            "locations": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "kind": item["kind"],
                    "w": item["w"],
                    "h": item["h"],
                    "access": {"sealed": item["sealed"], "closed_after": item["closed_after"]},
                    "description": item["description"],
                    "source": item["source"],
                }
                for item in self.locations.values()
            ],
            "links": self.links,
            "relations": self.relations,
            "actors": [_actor(agent) for agent in self.agents.values()],
            "archivedActors": deepcopy(self.archived_actors),
            "events": self.events,
        }

    def to_disk(self) -> dict:
        data = self.snapshot()
        data.update(mode=self.mode, _revision=self._revision, world_id=self.world_id,
                    next_agent_id=self.next_agent_id, archived_actors=deepcopy(self.archived_actors),
                    simulation=deepcopy(self.simulation))
        data["agents"] = [
            {
                "id": agent["id"],
                "name": agent["name"],
                "location": agent["location"],
                "hue": agent["hue"],
                "goal": agent["goal"],
                "agenda": agent["agenda"],
                "source": agent["source"],
                "memory": agent["memory"],
                "incoming": agent["incoming"],
                "last_failure": agent["last_failure"],
                "greeted": sorted(agent["greeted"]),
                "replied": sorted(agent["replied"]),
            }
            for agent in self.agents.values()
        ]
        data["events"] = self.events
        data["outbox"] = self._queue
        return data

    @classmethod
    def from_spec(cls, spec: dict) -> "World":
        world = cls(spec)
        saved = spec.get("agents") or []
        if saved and isinstance(saved[0], dict) and "memory" in saved[0]:
            for item in saved:
                agent = world.agents.get(item["id"])
                if agent is None:
                    continue
                agent["memory"] = list(item.get("memory") or [])
                agent["last_failure"] = item.get("last_failure")
                agent["greeted"] = set(item.get("greeted") or [])
                agent["replied"] = set(item.get("replied") or [])
                agent["agenda"] = list(item.get("agenda") or [])
                if item.get("location") in world.locations:
                    agent["location"] = item["location"]
        return world

    def add_agent(self, name: str, location: str, goal: str = "") -> dict:
        clean = name.strip()
        if not clean:
            raise ValueError("人物需要一个名字")
        if location not in self.locations:
            raise ValueError("没有这个地点")
        if any(agent["name"] == clean for agent in self.agents.values()):
            raise ValueError("已经有同名的人")
        agent_id = f"a{self.next_agent_id}"
        self.next_agent_id += 1
        self.agents[agent_id] = _agent({
            "id": agent_id,
            "name": clean,
            "location": location,
            "goal": goal.strip() or "看看这个地方",
            "agenda": [],
            "source": "user",
            "hue": hue_for(clean),
        })
        self._record(self.tick_index, agent_id, "join", True, f"{clean}进入了{self.locations[location]['name']}。")
        return self.snapshot()

    def remove_agent(self, agent_id: str) -> dict:
        agent = self.agents.get(agent_id)
        if agent is None:
            raise ValueError("没有这个人")
        place = self.locations[agent["location"]]["name"]
        self.archived_actors.append(_actor(agent))
        del self.agents[agent_id]
        self.relations = [item for item in self.relations if item["a"] != agent_id and item["b"] != agent_id]
        self._record(self.tick_index, agent_id, "leave", True, f"{agent['name']}离开了{place}。")
        return self.snapshot()

    def tick(self) -> dict:
        self.run_agents()
        return self.deliver_and_advance()

    def run_agents(self, decider=None) -> None:
        # Stage only mutable turn state; historical events are append-only.
        staged = copy(self)
        staged.agents = deepcopy(self.agents)
        staged.events = list(self.events)
        staged._queue = deepcopy(self._queue)
        try:
            staged._run_agents(decider)
        except SimulationBlocked:
            raise
        except Exception as exc:
            if decider is None:
                raise
            raise SimulationBlocked(f"模拟暂停：{_public_error(exc)}") from exc
        # Preserve existing agent references held by offline callers.
        for ident, agent in staged.agents.items():
            original = self.agents[ident]
            original.clear()
            original.update(agent)
        self.events = staged.events
        self._queue = staged._queue
        self.model_info = staged.model_info

    def _run_agents(self, decider=None) -> None:
        perceived = {}
        for agent in self.agents.values():
            messages = agent["incoming"]
            agent["incoming"] = []
            perceived[agent["id"]] = messages
            for message in messages:
                sender = message.get("sender_name") or self._name(message["from"])
                agent["memory"].append({
                    "tick": self.tick_index,
                    "text": f"收到来自{sender}的消息：{message['text']}",
                })
        plans = []
        for agent in self.agents.values():
            if decider is None:
                plan = self._plan(agent, perceived[agent["id"]])
            else:
                view = self._observation(agent)
                try:
                    plan = decider(view, view.agents[agent["id"]], deepcopy(perceived[agent["id"]]))
                except Exception as exc:
                    raise SimulationBlocked(f"模拟暂停：{_public_error(exc)}") from exc
                if not _valid_plan(plan, self):
                    raise SimulationBlocked(f"模拟暂停：{agent['name']}没有返回有效行动")
                plan = deepcopy(plan)
            plans.append((agent, plan))
        if decider is not None:
            self.model_info = {"used": True, "error": "", "name": self.model_info.get("name") or ""}
        for agent, plan in plans:
            self._invoke(agent, plan)
        for agent, plan in plans:
            self._reflect(agent, plan)

    def _observation(self, agent: dict) -> "World":
        """An isolated copy of what this character can know, never the world."""
        here = agent["location"]
        links = [list(edge) for edge in self.links if here in edge]
        visible = {here} | {ident for edge in links for ident in edge}
        relations = [r for r in self.relations if agent["id"] in {r["a"], r["b"]}]
        known_people = {ident for r in relations for ident in (r["a"], r["b"])}
        people = [deepcopy(agent)]
        for other in self.agents.values():
            if other["id"] == agent["id"]:
                continue
            if other["location"] == here or other["id"] in known_people:
                people.append({"id": other["id"], "name": other["name"], "hue": other["hue"],
                               "location": here if other["location"] == here else None})
        return World({
            "tick": self.tick_index,
            "locations": [{"id": ident, "name": self.locations[ident]["name"]} for ident in self.locations if ident in visible],
            "links": links, "agents": people, "relations": deepcopy(relations),
            "rules": deepcopy([r for r in self.rules if isinstance(r, dict) and r.get("public") is True]),
        })

    def deliver_and_advance(self) -> dict:
        self._dispatch()
        self.tick_index += 1
        return self.snapshot()

    def _plan(self, agent: dict, messages: list[dict]) -> dict:
        reply = self._reply_target(agent, messages)
        if reply is not None and not self._same_failure(agent, "speak", reply):
            return {"action": "speak", "target": reply, "text": self._reply_line(agent, reply)}
        if messages:
            sender = messages[-1]["from"]
            if sender in self.agents and sender != agent["id"]:
                hop = self._next_hop(agent["location"], self.agents[sender]["location"])
                if hop and not self._same_failure(agent, "move", hop):
                    return {"action": "move", "target": hop}
        for place_id in list(agent["agenda"]):
            if place_id == agent["location"]:
                continue
            hop = self._next_hop(agent["location"], place_id)
            if hop is None:
                continue
            if self._same_failure(agent, "move", hop):
                break
            return {"action": "move", "target": hop}
        for other in self.agents.values():
            if other["id"] == agent["id"] or other["location"] != agent["location"]:
                continue
            if other["id"] in agent["greeted"]:
                continue
            if self._relation(agent["id"], other["id"]) is None:
                continue
            if self._same_failure(agent, "speak", other["id"]):
                continue
            return {"action": "speak", "target": other["id"], "text": self._relation_line(agent, other)}
        return {"action": "wait"}

    def _invoke(self, agent: dict, plan: dict) -> None:
        action = plan["action"]
        from_location = agent["location"]
        if action == "wait":
            result = {"ok": True, "text": plan.get("text") or f"{agent['name']}留在{self._place_name(agent['location'])}。"}
        elif action == "move":
            result = self._move(agent, plan["target"])
        elif action == "speak":
            result = self._speak(agent, plan["target"], plan.get("text") or "")
        else:
            result = {"ok": False, "text": f"{agent['name']}没有做成这件事。"}
        agent["last_result"] = {"action": action, "target": plan.get("target"), **result,
                                "from_location": from_location, "to_location": agent["location"]}

    def _reflect(self, agent: dict, plan: dict) -> None:
        result = agent.get("last_result") or {"ok": True, "action": "wait", "text": ""}
        agent["memory"].append({"tick": self.tick_index, "text": result["text"]})
        if result["ok"] and result.get("action", plan["action"]) == "move":
            agent["last_failure"] = None
            agent["greeted"].clear()
            target = plan.get("target")
            if agent["agenda"] and agent["agenda"][0] == agent["location"]:
                agent["agenda"].pop(0)
            elif target == agent["location"] and target in agent["agenda"]:
                agent["agenda"].remove(target)
        elif result["ok"] and plan["action"] == "speak":
            agent["last_failure"] = None
            target = plan.get("target")
            if target:
                agent["greeted"].add(target)
                agent["replied"].add(target)
        elif not result["ok"]:
            agent["last_failure"] = {"action": plan["action"], "target": plan.get("target")}
        movement = {}
        if plan["action"] == "move":
            movement = {"from_location": result["from_location"], "to_location": result["to_location"]}
        self._record(self.tick_index, agent["id"], plan["action"], bool(result["ok"]), result["text"], **movement)

    def _move(self, agent: dict, location_id: str) -> dict:
        if location_id not in self.locations:
            return {"ok": False, "text": f"{agent['name']}要去的地方不在这个世界里。"}
        if location_id == agent["location"]:
            return {"ok": False, "text": f"{agent['name']}已经在{self._place_name(location_id)}。"}
        if not self._adjacent(agent["location"], location_id):
            return {"ok": False, "text": f"{agent['name']}去不了{self._place_name(location_id)}，没有直接相连的路。"}
        allowed, reason = self._can_enter(location_id)
        if not allowed:
            return {"ok": False, "text": f"{agent['name']}进不了{self._place_name(location_id)}：{reason}"}
        origin = self._place_name(agent["location"])
        agent["location"] = location_id
        return {"ok": True, "text": f"{agent['name']}从{origin}到了{self._place_name(location_id)}。"}

    def _speak(self, agent: dict, other_id: str, text: str) -> dict:
        other = self.agents.get(other_id)
        if other is None:
            return {"ok": False, "text": f"{agent['name']}想说话，但找不到对方。"}
        if other["location"] != agent["location"]:
            return {"ok": False, "text": f"{agent['name']}想对{other['name']}说话，但对方不在{self._place_name(agent['location'])}。"}
        self._queue.append({"from": agent["id"], "to": other_id, "text": text, "sender_name": agent["name"]})
        return {"ok": True, "text": text}

    def _dispatch(self) -> None:
        pending = self._queue
        self._queue = []
        for message in pending:
            receiver = self.agents.get(message["to"])
            if receiver is None:
                continue
            receiver["incoming"].append(message)

    def _can_enter(self, location_id: str) -> tuple[bool, str]:
        place = self.locations[location_id]
        if place["sealed"]:
            return False, "这里关着。"
        closed_after = place["closed_after"]
        if closed_after is not None and self.tick_index >= closed_after:
            return False, "这个时候已经不让进。"
        return True, ""

    def _adjacent(self, origin: str, dest: str) -> bool:
        for left, right in self.links:
            if {left, right} == {origin, dest}:
                return True
        return False

    def _next_hop(self, origin: str, dest: str) -> str | None:
        if origin == dest or dest not in self.locations:
            return None
        if self._adjacent(origin, dest):
            return dest
        graph: dict[str, list[str]] = {item: [] for item in self.locations}
        for left, right in self.links:
            graph[left].append(right)
            graph[right].append(left)
        previous = {origin: None}
        queue = deque([origin])
        while queue:
            here = queue.popleft()
            for nxt in graph[here]:
                if nxt in previous:
                    continue
                previous[nxt] = here
                if nxt == dest:
                    hop = dest
                    while previous[hop] != origin:
                        hop = previous[hop]
                    return hop
                queue.append(nxt)
        return None

    def _reply_target(self, agent: dict, messages: list[dict]) -> str | None:
        for message in messages:
            sender = message["from"]
            if sender not in self.agents or sender == agent["id"]:
                continue
            if sender in agent["replied"]:
                continue
            if "我听到了" in message["text"]:
                continue
            if self.agents[sender]["location"] == agent["location"]:
                return sender
        return None

    def _reply_line(self, agent: dict, other_id: str) -> str:
        return f"{agent['name']}对{self._name(other_id)}说：我听到了。"

    def _relation(self, left: str, right: str) -> str | None:
        for item in self.relations:
            if {item["a"], item["b"]} == {left, right}:
                return item["kind"]
        return None

    def _relation_line(self, agent: dict, other: dict) -> str:
        kind = self._relation(agent["id"], other["id"])
        if kind == "distrust":
            return f"{agent['name']}对{other['name']}说：这件事我不会告诉你。"
        if kind == "trust":
            return f"{agent['name']}对{other['name']}说：我这边的情况你可以知道。"
        return f"{agent['name']}对{other['name']}说：我看见你了。"

    def _same_failure(self, agent: dict, action: str, target: str | None) -> bool:
        failure = agent["last_failure"]
        return bool(failure and failure.get("action") == action and failure.get("target") == target)

    def _place_name(self, location_id: str) -> str:
        place = self.locations.get(location_id)
        return place["name"] if place else location_id

    def _name(self, agent_id: str) -> str:
        agent = self.agents.get(agent_id)
        if agent:
            return agent["name"]
        archived = next((a for a in self.archived_actors if a["id"] == agent_id), None)
        return archived["name"] if archived else agent_id

    def _record(self, tick: int, agent_id: str, action: str, ok: bool, text: str, **extra) -> None:
        agent = self.agents.get(agent_id)
        actor = _actor(agent) if agent else next((a for a in self.archived_actors if a["id"] == agent_id), None)
        self.events.append({
            "actor": deepcopy(actor),
            "location": actor["place"] if actor else None,
            **extra,
            "tick": tick,
            "agent": agent_id,
            "action": action,
            "ok": ok,
            "text": text,
        })


def _actor(agent: dict) -> dict:
    return {"id": agent["id"], "name": agent["name"], "place": agent["location"],
            "hue": agent["hue"], "goal": agent["goal"], "source": agent["source"],
            "memory": deepcopy(agent["memory"][-3:])}


def _valid_plan(plan, world: World) -> bool:
    if not isinstance(plan, dict) or not isinstance(plan.get("action"), str):
        return False
    if plan["action"] not in {"move", "speak", "wait"}:
        return False
    if plan["action"] != "wait" and (not isinstance(plan.get("target"), str) or not plan["target"].strip()):
        return False
    if plan["action"] == "move" and plan["target"] not in world.locations:
        return False
    if plan["action"] == "speak" and plan["target"] not in world.agents:
        return False
    return plan.get("text") is None or isinstance(plan["text"], str)


def _public_error(exc: Exception) -> str:
    text = str(exc).replace("\n", " ")
    return text[:180] or exc.__class__.__name__


def _location(item: dict) -> dict:
    access = item.get("access") or {}
    closed_after = access.get("closed_after", item.get("closed_after"))
    if closed_after is not None:
        closed_after = int(closed_after)
    return {
        "id": item["id"],
        "name": item.get("name") or item["id"],
        "kind": item.get("kind") or "outdoor",
        "w": int(item.get("w") or 8),
        "h": int(item.get("h") or 7),
        "sealed": bool(access.get("sealed", item.get("sealed"))),
        "closed_after": closed_after,
        "description": item.get("description") or "",
        "source": item.get("source") or "text",
    }


def _agent(item: dict) -> dict:
    return {
        "id": item["id"],
        "name": item.get("name") or item["id"],
        "location": item.get("location") or item.get("place"),
        "hue": int(item.get("hue") if item.get("hue") is not None else hue_for(item.get("name") or item["id"])),
        "goal": item.get("goal") or "",
        "agenda": list(item.get("agenda") or []),
        "source": item.get("source") or "text",
        "memory": list(item.get("memory") or []),
        "incoming": deepcopy(item.get("incoming") or []),
        "last_failure": item.get("last_failure"),
        "last_result": None,
        "greeted": set(item.get("greeted") or []),
        "replied": set(item.get("replied") or []),
    }
