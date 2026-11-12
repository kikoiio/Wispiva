import unittest

from kernel.compile import compile_text
from kernel.sim import World

SENTENCE = "一座建在巨兽背上的城市，守城人和商人互相不信任，城门在日落前关闭。"


def sample_world() -> World:
    return World.from_spec({
        "name": "试",
        "locations": [
            {"id": "yard", "name": "院子", "kind": "outdoor", "w": 8, "h": 7},
            {"id": "gate", "name": "城门", "kind": "outdoor", "w": 8, "h": 7, "access": {"closed_after": 0}},
            {"id": "hall", "name": "内堂", "kind": "indoor", "w": 8, "h": 7, "access": {"sealed": True}},
        ],
        "links": [["yard", "gate"], ["gate", "hall"]],
        "relations": [{"a": "ann", "b": "bo", "kind": "knows"}],
        "agents": [
            {"id": "ann", "name": "安", "location": "yard", "agenda": ["hall"], "goal": "进入内堂"},
            {"id": "bo", "name": "柏", "location": "hall", "agenda": [], "goal": "留在内堂"},
        ],
    })


class CompileTests(unittest.TestCase):
    def test_sentence_keeps_people_place_and_closure(self):
        spec = compile_text(SENTENCE)
        names = [item["name"] for item in spec["locations"]]
        people = [item["name"] for item in spec["agents"]]
        self.assertIn("城门", names)
        self.assertIn("巨兽背", names)
        self.assertIn("市集", names)
        self.assertGreaterEqual(len(names), 4)
        self.assertIn("守城人", people)
        self.assertIn("商人", people)
        self.assertIn("学徒", people)
        self.assertGreaterEqual(len(people), 5)
        gate = next(item for item in spec["locations"] if item["name"] == "城门")
        self.assertEqual(gate["access"]["closed_after"], 0)
        self.assertEqual(spec["relations"][0]["kind"], "distrust")
        guard = next(item for item in spec["agents"] if item["name"] == "守城人")
        merchant = next(item for item in spec["agents"] if item["name"] == "商人")
        self.assertEqual(guard["agenda"], [])
        self.assertEqual(merchant["agenda"], [gate["id"]])
        self.assertNotEqual(guard["location"], merchant["location"])

    def test_compiled_gate_refuses_the_merchant(self):
        world = World.from_spec(compile_text(SENTENCE))
        merchant = next(agent for agent in world.agents.values() if agent["name"] == "商人")
        started = merchant["location"]
        world.tick()
        self.assertEqual(merchant["location"], started)
        refused = [event for event in world.events if event["agent"] == merchant["id"] and not event["ok"]]
        self.assertTrue(refused)
        self.assertIn("进不了", refused[0]["text"])
        world.tick()
        self.assertEqual(merchant["location"], started)

    def test_people_outside_the_gate_can_meet(self):
        world = World.from_spec(compile_text(SENTENCE))

        def who(name):
            return next(agent for agent in world.agents.values() if agent["name"] == name)

        tender = who("饲兽人")
        watch = who("巡夜人")
        seller = who("卖水人")
        merchant = who("商人")
        spine = tender["location"]
        market = merchant["location"]
        self.assertEqual(tender["agenda"], [])
        world.tick()
        self.assertEqual(tender["location"], spine)
        self.assertEqual(watch["location"], spine)
        self.assertEqual(seller["location"], market)
        self.assertEqual(merchant["location"], market)
        world.tick()
        spoken = [event["text"] for event in world.events if event["ok"] and event["action"] == "speak"]
        self.assertTrue(any("饲兽人" in text and "巡夜人" in text for text in spoken))
        self.assertTrue(any("卖水人" in text and "商人" in text for text in spoken))


class TickTests(unittest.TestCase):
    def test_closed_gate_blocks_entry_and_is_not_retried(self):
        world = sample_world()
        world.tick()
        ann = world.agents["ann"]
        self.assertEqual(ann["location"], "yard")
        self.assertIn("进不了", ann["memory"][-1]["text"])
        world.tick()
        self.assertEqual(ann["location"], "yard")
        waits = [event for event in world.events if event["agent"] == "ann" and event["action"] == "wait"]
        self.assertTrue(waits)

    def test_open_path_stops_at_a_sealed_room(self):
        world = sample_world()
        world.locations["gate"]["closed_after"] = None
        world.tick()
        self.assertEqual(world.agents["ann"]["location"], "gate")
        world.tick()
        self.assertEqual(world.agents["ann"]["location"], "gate")
        self.assertIn("关着", world.agents["ann"]["memory"][-1]["text"])

    def test_mail_stays_queued_until_the_system_delivers(self):
        world = sample_world()
        world.agents["ann"]["agenda"] = []
        world.agents["bo"]["location"] = "yard"
        world.run_agents()
        saved = world.to_disk()
        self.assertTrue(saved["outbox"])
        self.assertFalse(any(item["text"].startswith("收到来自") for item in world.agents["bo"]["memory"]))
        restored = World.from_spec(saved)
        restored.deliver_and_advance()
        self.assertEqual(restored._queue, [])
        restored.run_agents()
        self.assertTrue(any(item["text"].startswith("收到来自") for item in restored.agents["bo"]["memory"]))

    def test_speech_is_perceived_on_the_next_tick(self):
        world = sample_world()
        world.agents["ann"]["agenda"] = []
        world.agents["bo"]["location"] = "yard"
        world.agents["bo"]["agenda"] = []
        world.tick()
        self.assertFalse(any("收到来自" in item["text"] for item in world.agents["bo"]["memory"]))
        self.assertTrue(any(event["action"] == "speak" and event["ok"] for event in world.events))
        world.tick()
        heard = [item["text"] for item in world.agents["bo"]["memory"] if item["text"].startswith("收到来自")]
        self.assertTrue(heard)

    def test_add_and_remove_agent(self):
        world = sample_world()
        world.add_agent("岑", "yard", "看看")
        self.assertIn("岑", [agent["name"] for agent in world.agents.values()])
        added = next(agent for agent in world.agents.values() if agent["name"] == "岑")
        world.tick()
        self.assertEqual(added["location"], "yard")
        world.remove_agent("bo")
        self.assertNotIn("bo", world.agents)
        self.assertTrue(any(event["action"] == "leave" for event in world.events))

    def test_model_speech_is_kept_and_a_closed_move_is_refused(self):
        world = sample_world()
        world.agents["ann"]["agenda"] = []
        world.agents["bo"]["location"] = "yard"
        world.agents["bo"]["agenda"] = []

        def decide(world, agent, messages):
            if agent["id"] == "ann":
                return {"action": "speak", "target": "bo", "text": "安对柏说：城门关了，我改日再来。"}
            return {"action": "move", "target": "gate"}

        world.run_agents(decider=decide)
        self.assertTrue(world.model_info["used"])
        said = [event for event in world.events if "改日再来" in event["text"]]
        self.assertTrue(said and said[0]["ok"])
        blocked = [event for event in world.events if event["agent"] == "bo" and not event["ok"]]
        self.assertTrue(blocked)
        self.assertIn("进不了", blocked[0]["text"])
        self.assertEqual(world.agents["bo"]["location"], "yard")

    def test_model_outage_stops_without_fallback(self):
        world = World.from_spec(compile_text(SENTENCE))
        before = world.to_disk()

        def decide(world, agent, messages):
            raise RuntimeError("模型请求失败（503）")

        with self.assertRaisesRegex(ValueError, "503"):
            world.run_agents(decider=decide)
        self.assertEqual(world.to_disk(), before)

    def test_plan_from_uses_names(self):
        from kernel.decide import plan_from

        world = sample_world()
        ann = world.agents["ann"]
        spoken = plan_from(world, ann, {"action": "speak", "target": "柏", "line": "我改日再来"})
        self.assertEqual(spoken["target"], "bo")
        self.assertIn("我改日再来", spoken["text"])
        moved = plan_from(world, ann, {"action": "move", "target": "城门", "line": ""})
        self.assertEqual(moved["target"], "gate")
        self.assertIsNone(plan_from(world, ann, {"action": "fly", "target": "", "line": ""}))
        waited = plan_from(world, ann, {"action": "wait", "target": "", "line": "安留在院子。我改日再来。"})
        self.assertEqual(waited["text"], "安留在院子。我改日再来。")

    def test_distant_move_does_not_teleport(self):
        world = sample_world()
        result = world._move(world.agents["ann"], "hall")
        self.assertFalse(result["ok"])
        self.assertEqual(world.agents["ann"]["location"], "yard")
        self.assertIn("没有直接相连的路", result["text"])


if __name__ == "__main__":
    unittest.main()
