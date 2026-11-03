import json
import tempfile
import unittest
from pathlib import Path

from genesis.compiler import compile_plan
from validation.longitudinal import (
    CHANGE_AT, CONSEQUENCE, ENVIRONMENT, GATHER, PREDICTION, SETTLED_AMOUNT,
    audit_consequence, audit_environment, audit_resume,
)


def storage(events, records, inventory, decisions, environment):
    checkpoint = {
        "format": "society-checkpoint", "version": 1,
        "agents": [{"id": 0, "decisions": decisions, "inventory": inventory}],
        "world_events": {"version": 1, "events": events},
        "long_term": {"version": 1, "records": records},
    }
    return {"agent_state": json.dumps(checkpoint), "environment_state": json.dumps(environment)}


def event(seq, kind, ok, reason, point=None, operation=None):
    item = {"id": f"world-event:{seq}", "seq": seq, "operation_id": operation or f"op-{seq}",
            "time": 1, "kind": kind, "actor": "0", "ok": ok, "reason": reason,
            "participants": []}
    if point is not None:
        item["point"] = point
    return item


def experience(text, record_id):
    return {"id": record_id, "owner": "0", "layer": "L1", "text": text}


class LongitudinalTests(unittest.TestCase):
    def test_spawn_puts_the_resource_one_block_east(self):
        plan = compile_plan(CONSEQUENCE)
        position = plan["public"]["actors"][0]["position"]
        self.assertEqual(position, {"x": -2, "y": 1, "z": -2})
        self.assertIn("x=-1, y=1, z=-2", plan["private_actors"]["alice"]["goal"])
        self.assertIn(PREDICTION, ENVIRONMENT["memories"][0]["text"])

    def write_consequence(self, root, *, second_ok=False, conserve=True):
        point = dict(GATHER)
        events = [event(1, "gather", True, "world-verified", point, "gather-1")]
        records = [experience("I gather succeeded: world-verified; position=-1,1,-2", "m1")]
        inventory = {"society:resource": 1}
        if second_ok:
            events.append(event(2, "gather", True, "world-verified", point, "gather-2"))
            inventory = {"society:resource": 2}
        else:
            events.append(event(2, "gather", False, "resource mismatch", point, "gather-2"))
            records.append(experience("I gather failed: resource mismatch; position=-1,1,-2", "m2"))
        world = root / "world"
        (world / "mod_storage").mkdir(parents=True)
        (world / "private" / "model-audit").mkdir(parents=True)
        (world / "mod_storage" / "society").write_text(
            json.dumps(storage(events, records, inventory, 2, {"amount": 2, "rate": 1, "time": 1})),
            encoding="utf-8")
        (world / "private" / "model-audit" / "response-1-agent-0.json").write_text(json.dumps({
            "attempts": [{"ok": True, "error": None, "audit": {"usage": {"input_tokens": 3, "output_tokens": 1}}}]
        }), encoding="utf-8")
        ok = "true" if conserve else "false"
        log = "\n".join([
            "SOCIETY ev=model-action agent=0 request=1 kind=gather origin=model",
            f"SOCIETY resource-verify initial=1 environment_delta=0 expected=1 world=0 inventory=1 ok={ok}",
            "SOCIETY product-checkpoint commit version=2",
            "SOCIETY done result=ok",
        ])
        return world, log

    def test_consequence_accepts_success_then_failed_gather(self):
        with tempfile.TemporaryDirectory() as tmp:
            world, log = self.write_consequence(Path(tmp))
            summary = audit_consequence(world, log, 0)
        self.assertEqual(summary["failures"], [])
        self.assertEqual(summary["inventory"], 1)
        self.assertEqual(summary["input_tokens"], 3)

    def test_consequence_rejects_two_successes_and_a_broken_tally(self):
        with tempfile.TemporaryDirectory() as tmp:
            world, log = self.write_consequence(Path(tmp), second_ok=True, conserve=False)
            summary = audit_consequence(world, log, 0)
        self.assertIn("no_gather_failure", summary["failures"])
        self.assertIn("missing_failure_memory", summary["failures"])
        self.assertIn("resource_not_conserved", summary["failures"])

    def test_environment_keeps_the_prediction_unknown_after_the_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = Path(tmp) / "world"
            audit = world / "private" / "model-audit"
            (world / "mod_storage").mkdir(parents=True)
            audit.mkdir(parents=True)
            (world / "mod_storage" / "society").write_text(json.dumps(storage(
                [], [], {}, 2, {"amount": SETTLED_AMOUNT, "rate": 0, "time": 6})), encoding="utf-8")
            envelope = {"request": {"observed_at": CHANGE_AT},
                        "knowledge": {"facts": [{"text": "I can currently observe society:resource nearby."}],
                                      "unknowns": [{"text": f"stay {PREDICTION}"}]}}
            (audit / "request-2-agent-0.json").write_text(
                json.dumps({"context": {"model_input": envelope}}), encoding="utf-8")
            log = "\n".join([
                "SOCIETY ev=model-action agent=0 request=2 kind=inspect origin=model",
                f"SOCIETY ev=environment-condition at={CHANGE_AT} rate=0 amount={SETTLED_AMOUNT}",
                "SOCIETY product-checkpoint commit version=2",
                "SOCIETY done result=ok",
            ])
            summary = audit_environment(world, log, 0)
        self.assertEqual(summary["failures"], [])
        self.assertTrue(summary["prediction_remains_unknown"])
        self.assertEqual(summary["settled_amount"], SETTLED_AMOUNT)

    def test_environment_rejects_a_prediction_promoted_to_a_fact(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = Path(tmp) / "world"
            audit = world / "private" / "model-audit"
            (world / "mod_storage").mkdir(parents=True)
            audit.mkdir(parents=True)
            (world / "mod_storage" / "society").write_text(json.dumps(storage(
                [], [], {}, 1, {"amount": 4, "rate": 2, "time": 1})), encoding="utf-8")
            envelope = {"request": {"observed_at": 0},
                        "knowledge": {"facts": [{"text": f"The stock is {PREDICTION}"}],
                                      "unknowns": [{"text": PREDICTION}]}}
            (audit / "request-1-agent-0.json").write_text(
                json.dumps({"context": {"model_input": envelope}}), encoding="utf-8")
            log = "SOCIETY ev=model-action origin=model\nSOCIETY product-checkpoint commit version=2\nSOCIETY done result=ok\n"
            summary = audit_environment(world, log, 0)
        self.assertIn("condition_not_applied", summary["failures"])
        self.assertIn("prediction_became_fact", summary["failures"])
        self.assertIn("no_observation_after_change", summary["failures"])

    def test_resume_keeps_clock_events_and_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            before = root / "before"
            world = root / "world"
            before.mkdir()
            (world / "mod_storage").mkdir(parents=True)
            (world / "private").mkdir()
            first_events = [event(1, "inspect", True, "observed", operation="decision-1")]
            first_records = [experience("I inspect succeeded: observed", "memory-1")]
            (before / "society").write_text(json.dumps(storage(
                first_events, first_records, {}, 2, {"amount": 3, "rate": 1, "time": 5})), encoding="utf-8")
            (world / "mod_storage" / "society").write_text(json.dumps(storage(
                first_events + [event(2, "inspect", True, "observed", operation="decision-2")],
                first_records + [experience("I inspect succeeded: observed", "memory-2")],
                {}, 4, {"amount": 3, "rate": 1, "time": 7})), encoding="utf-8")
            before_log = "SOCIETY ev=model-action origin=model\nSOCIETY done result=ok\nSOCIETY environment-checkpoint time=5\n"
            log = "\n".join([
                "SOCIETY ev=resume logical=5 offline_seconds=3 rate=24",
                "SOCIETY ev=model-action origin=model",
                "SOCIETY product-checkpoint commit version=3",
                "SOCIETY done result=ok",
            ])
            summary = audit_resume(world, before, log, before_log, 0)
        self.assertEqual(summary["failures"], [])
        self.assertEqual(summary["resume_logical"], 5)
        self.assertEqual(summary["offline_seconds"], 3)
        self.assertEqual((summary["decisions_before"], summary["decisions_after"]), (2, 4))
        self.assertTrue(summary["headless"])

    def test_resume_rejects_catchup_and_lost_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            before = root / "before"
            world = root / "world"
            before.mkdir()
            (world / "mod_storage").mkdir(parents=True)
            first_events = [event(1, "inspect", True, "observed", operation="decision-1")]
            (before / "society").write_text(json.dumps(storage(
                first_events, [experience("kept", "memory-1")], {}, 2,
                {"amount": 3, "rate": 1, "time": 5})), encoding="utf-8")
            (world / "mod_storage" / "society").write_text(json.dumps(storage(
                [event(1, "inspect", True, "observed", operation="other")],
                [], {}, 2, {"amount": 3, "rate": 1, "time": 77})), encoding="utf-8")
            log = "\n".join([
                "SOCIETY ev=resume logical=77 offline_seconds=3 rate=24",
                "SOCIETY ev=model-action origin=model",
                "SOCIETY product-checkpoint commit version=3",
                "SOCIETY done result=ok",
                "Client alice joins game",
            ])
            before_log = "SOCIETY ev=model-action origin=model\nSOCIETY done result=ok\n"
            summary = audit_resume(world, before, log, before_log, 0)
        self.assertIn("offline_applied_to_clock", summary["failures"])
        self.assertIn("events_dropped", summary["failures"])
        self.assertIn("memory_dropped", summary["failures"])
        self.assertIn("decisions_reset", summary["failures"])
        self.assertIn("client_joined", summary["failures"])


if __name__ == "__main__":
    unittest.main()
