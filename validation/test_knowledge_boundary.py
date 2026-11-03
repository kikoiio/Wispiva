import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from genesis.compiler import compile_plan
from genesis.genesis import validate
from validation.knowledge_boundary import GOALS, MARKER, SCENARIO, SEEDS, audit


def envelope(actor, runtime, rumors=None, nearby=None, seed=None):
    return {
        "schema": "wispiva.model-input", "version": 1,
        "request": {"actor_id": actor},
        "actor": {"id": actor, "runtime_id": runtime, "goal": {"text": GOALS[actor]}},
        "knowledge": {
            "facts": [], "experiences": [], "rumors": rumors or [],
            "unknowns": [{
                "id": f"seed:{actor}", "text": SEEDS[actor] if seed is None else seed,
                "source": {"kind": "genesis_seed", "id": "origin"},
                "access": {"scope": "private", "audience": [actor]},
            }],
        },
        "current": {"observation": {"nearby_agents": [] if nearby is None else nearby}},
    }


def rumor(text):
    return {
        "id": "message:1", "text": text,
        "source": {"kind": "agent_message", "id": "message:1"},
        "access": {"scope": "private", "audience": ["bob"]},
    }


class KnowledgeBoundaryTests(unittest.TestCase):
    def test_scenario_keeps_cora_beyond_sense_and_travel(self):
        self.assertEqual(validate(SCENARIO), [])
        plan = compile_plan(SCENARIO)
        positions = {item["actor_id"]: item["position"] for item in plan["public"]["actors"]}
        self.assertEqual(plan["public"]["semantic_connections"], [])
        bob, cora = positions["bob"], positions["cora"]
        distance = max(abs(bob["x"] - cora["x"]), abs(bob["z"] - cora["z"]))
        # Six decisions at the default step of 2 cannot close this gap from both sides.
        self.assertGreater(distance, 12 + 6 * 2 * 2)

    def write_run(self, root, bob_followup=True, cora_nearby=None, cora_seed=None):
        audit_dir = root / "audit"
        audit_dir.mkdir()
        spoken = f"Bob, the token is {MARKER}."
        rows = [
            (1, 1, "alice", envelope("alice", 1)),
            (2, 2, "bob", envelope("bob", 2, nearby=[1])),
            (4, 3, "cora", envelope("cora", 3, nearby=cora_nearby, seed=cora_seed)),
        ]
        bob_after = envelope("bob", 2, rumors=[rumor(spoken)] if bob_followup else [])
        rows.append((3, 2, "bob", bob_after))
        for request_id, runtime, actor, body in rows:
            payload = {"id": request_id, "context": {"model_input": body}}
            (audit_dir / f"request-{request_id}-agent-{runtime}.json").write_text(
                json.dumps(payload), encoding="utf-8")
        response = {"id": 1, "ok": True, "action": {"kind": "say", "target": 2, "text": spoken},
                    "attempts": [{"ok": False, "error": "invalid_action"},
                                 {"ok": True, "error": None,
                                  "audit": {"usage": {"input_tokens": 20, "output_tokens": 8}}}]}
        (audit_dir / "response-1-agent-1.json").write_text(json.dumps(response), encoding="utf-8")
        digest = hashlib.sha256(spoken.encode("utf-8")).hexdigest()
        log = "\n".join([
            "SOCIETY ev=model-action agent=1 request=1 kind=say origin=model",
            f"SOCIETY ev=message agent=1 recipient=2 sha256={digest}",
            "SOCIETY product-checkpoint commit version=2",
            "SOCIETY done result=ok",
        ])
        return audit_dir, log

    def test_sourced_delivery_and_absent_third_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            audit_dir, log = self.write_run(Path(tmp))
            summary = audit(audit_dir, log)
        self.assertEqual(summary["failures"], [])
        self.assertEqual(summary["delivered_to_bob"], 1)
        self.assertTrue(summary["bob_followup_has_sourced_rumor"])
        self.assertEqual(summary["attempt_errors"], {"invalid_action": 1})
        self.assertEqual(summary["input_tokens"], 20)
        self.assertNotIn("message_text", summary)
        self.assertNotIn("Bob, the token is", json.dumps(summary))

    def test_cora_seeing_the_marker_or_a_peer_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audit_dir, log = self.write_run(root, cora_nearby=[2])
            leaked = json.loads((audit_dir / "request-4-agent-3.json").read_text())
            leaked["context"]["model_input"]["knowledge"]["facts"].append(
                {"id": "fact", "text": f"I know {MARKER}", "source": {"kind": "engine.sensor", "id": "x"},
                 "access": {"scope": "public", "audience": ["cora"]}})
            (audit_dir / "request-4-agent-3.json").write_text(json.dumps(leaked), encoding="utf-8")
            summary = audit(audit_dir, log)
        self.assertIn("unsourced_marker:cora", summary["failures"])
        self.assertIn("cora_observed_peer", summary["failures"])

    def test_seed_copy_and_missing_followup_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            audit_dir, log = self.write_run(Path(tmp), bob_followup=False, cora_seed=SEEDS["alice"])
            summary = audit(audit_dir, log)
        self.assertIn("seed_leak:alice:cora", summary["failures"])
        self.assertIn("no_followup", summary["failures"])


if __name__ == "__main__":
    unittest.main()
