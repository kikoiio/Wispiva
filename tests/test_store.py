from copy import deepcopy
import json

from redis_support import RedisCase
from kernel.store import load_world, save_world


def world_spec():
    return {"name": "test", "tick": 0, "locations": [{"id": "yard", "name": "院子"}],
            "agents": [{"id": "a1", "name": "安", "location": "yard", "memory": []}],
            "events": [{"tick": i, "agent": "a1", "action": "wait", "text": str(i)} for i in range(210)]}


class StoreTests(RedisCase):
    def test_history_is_not_truncated_after_saving(self):
        spec = world_spec()
        save_world(self.client, spec)
        self.assertEqual(len(load_world(self.client)["events"]), 210)

    def test_stale_writer_cannot_erase_a_new_character(self):
        from kernel.store import ConflictError
        save_world(self.client, world_spec())
        stale = load_world(self.client)
        edited = deepcopy(stale)
        edited["agents"].append({"id": "a2", "name": "柏", "location": "yard"})
        save_world(self.client, edited)
        stale["tick"] = 1
        with self.assertRaises(ConflictError):
            save_world(self.client, stale)
        self.assertEqual([a["id"] for a in load_world(self.client)["agents"]], ["a1", "a2"])

    def test_revisions_are_immutable_and_survive_world_replacement(self):
        from kernel.store import load_revision, list_history
        save_world(self.client, world_spec())
        first = load_world(self.client)
        original_id, revision = first["world_id"], first["_revision"]
        first["agents"][0]["memory"].append({"tick": 1, "text": "remember"})
        first["tick"] = 1
        save_world(self.client, first)
        save_world(self.client, {**world_spec(), "name": "second"}, replace=True)
        old = load_revision(self.client, original_id, revision)
        self.assertEqual(old["tick"], 0)
        self.assertEqual(old["agents"][0]["memory"], [])
        self.assertEqual(len(old["events"]), 210)
        self.assertEqual(len(list_history(self.client, original_id, 0, 10)), 2)
        self.assertNotEqual(load_world(self.client)["world_id"], original_id)

    def test_existing_hash_format_migrates_without_deleting_original_data(self):
        from kernel.controller import Controller
        self.client.hset("openstory:meta", mapping={"name": "原世界", "tick": "7"})
        self.client.sadd("openstory:locations", "yard")
        self.client.hset("openstory:location:yard", "json", json.dumps({"id": "yard", "name": "院子"}))
        self.client.sadd("openstory:agents", "a1")
        self.client.hset("openstory:agent:a1", "json", json.dumps({"id": "a1", "name": "安", "location": "yard", "incoming": [{"from": "a2", "text": "信"}]}))
        self.client.rpush("openstory:events", json.dumps({"tick": 6, "agent": "a1", "text": "曾经发生"}))
        Controller(self.client, runner=lambda spec: spec).migrate()
        migrated = load_world(self.client)
        self.assertEqual(migrated["tick"], 7)
        self.assertEqual(migrated["agents"][0]["incoming"][0]["text"], "信")
        self.assertEqual(migrated["events"][0]["text"], "曾经发生")
        self.assertEqual(migrated["_revision"], 1)
        self.assertTrue(self.client.exists("openstory:meta"))

    def test_saved_events_cannot_be_rewritten(self):
        save_world(self.client, world_spec())
        spec = load_world(self.client)
        spec["events"][0]["text"] = "rewritten"
        with self.assertRaisesRegex(ValueError, "历史不可"):
            save_world(self.client, spec)
        self.assertEqual(load_world(self.client)["events"][0]["text"], "0")
