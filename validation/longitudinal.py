"""Acceptance for the next three longitudinal scenarios.

Consequence: one real gather at a known node, then a failed gather of that same
node. Both results are in the world event journal, the actor's experience, and
the conserved inventory.

Environment: a logical-time stock settles at the old rate through a boundary,
then the new rate holds. An old prediction stays an unknown and does not become
a current fact.

Resume: after a clean stop and a wall-clock wait, the next run starts at the
checkpoint clock. Offline seconds are recorded and are not added to that clock.
Event and memory ids from the first run remain.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

GATHER = {"x": -1, "y": 1, "z": -2}
PREDICTION = "stock-prediction-4"
CHANGE_AT = 2
SETTLED_AMOUNT = 8
REQUEST_NAME = re.compile(r"request-(\d+)-agent-(\d+)\.json$")
RESPONSE_NAME = re.compile(r"response-(\d+)-agent-(\d+)\.json$")
VERIFY = re.compile(
    r"resource-verify initial=(-?\d+) environment_delta=(-?\d+) expected=(-?\d+) "
    r"world=(-?\d+) inventory=(-?\d+) ok=(true|false)")
RESUME_LINE = re.compile(
    r"ev=resume logical=(\d+) offline_seconds=(\d+) rate=([0-9.]+)")
CHECKPOINT_TIME = re.compile(r"environment-checkpoint time=(\d+)")


def _draft(title, description, role, goal, seed, place_name):
    return {
        "schemaVersion": 1,
        "title": title,
        "description": description,
        "places": [{"id": "yard", "name": place_name, "description": description}],
        "actors": [{"id": "alice", "name": "Alice", "role": role, "goal": goal, "placeId": "yard"}],
        "memories": [{"actorId": "alice", "text": seed}],
        "rules": [],
        "layout": {"places": [{"placeId": "yard", "space": "outdoor", "grid": [0, 0]}],
                   "connections": []},
    }


CONSEQUENCE = _draft(
    "One resource beside Alice",
    "Alice starts beside one resource node and can gather it once.",
    "gatherer",
    "On decision 1, gather the society:resource at x=-1, y=1, z=-2. "
    "On decision 2, gather that same point again so it fails. Do not move first.",
    "A society:resource node is one block east of me, at x=-1, y=1, z=-2. "
    "I am not carrying a resource.",
    "The yard",
)
ENVIRONMENT = _draft(
    "A grove stock with an old prediction",
    "The grove stock changes on its own. Alice's old prediction is not a fact.",
    "observer",
    "On every decision, inspect. The phrase stock-prediction-4 in your seed is an "
    "old prediction, not the current stock.",
    "I once predicted the grove stock would stay stock-prediction-4. "
    "That prediction is not a present fact.",
    "The grove",
)
RESUME = _draft(
    "Alice inspects, then the world stops",
    "Alice inspects. The world then stops and later resumes from the checkpoint.",
    "observer",
    "On every decision, inspect the ground in front of you.",
    "I am standing in the yard and can inspect the ground.",
    "The yard",
)
SCENARIOS = {"consequence": CONSEQUENCE, "environment": ENVIRONMENT, "resume": RESUME}


def prepare(root: Path, scenario: str) -> None:
    from genesis.store import DraftStore
    from genesis.world_create import create_world
    draft = SCENARIOS[scenario]
    root = Path(root).resolve()
    root.mkdir(mode=0o700)
    store = DraftStore(root / "drafts.sqlite", create=True)
    try:
        record = store.create(draft)
        store.confirm(record["id"], record["revision"], root / "origin.sqlite")
        create_world(store, record["id"], record["revision"], root / "world")
    finally:
        store.close()


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_storage(path: Path) -> dict:
    fields = _load_json(path)
    return {"checkpoint": _load_json_text(fields["agent_state"]),
            "environment": _load_json_text(fields["environment_state"])}


def _load_json_text(value):
    return json.loads(value) if isinstance(value, str) else value


def _whole(value):
    """Luanti writes whole counts as JSON floats. Reject anything else."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != int(value):
        return None
    return int(value)


def _events(checkpoint: dict) -> list:
    journal = checkpoint.get("world_events") or {}
    events = journal.get("events") or []
    return events if isinstance(events, list) else []


def _records(checkpoint: dict) -> list:
    store = checkpoint.get("long_term") or {}
    records = store.get("records") or []
    return records if isinstance(records, list) else []


def _actor(checkpoint: dict, runtime: int = 0):
    for agent in (checkpoint.get("agents") or []):
        if isinstance(agent, dict) and agent.get("id") == runtime:
            return agent
    return None


def _same_point(event: dict, point: dict) -> bool:
    got = event.get("point")
    if not isinstance(got, dict):
        return False
    try:
        return all(int(got[axis]) == point[axis] for axis in ("x", "y", "z"))
    except (KeyError, TypeError, ValueError):
        return False


def _model_counts(audit_dir: Path) -> dict:
    attempts = 0
    errors = {}
    input_tokens = 0
    output_tokens = 0
    token_rows = 0
    requests = 0
    observed = []
    if audit_dir.is_dir():
        for path in audit_dir.rglob("request-*.json"):
            if REQUEST_NAME.search(path.name) is None:
                continue
            requests += 1
            payload = _load_json(path)
            envelope = ((payload.get("context") or {}).get("model_input") or {})
            request = envelope.get("request") or {}
            observed.append(request.get("observed_at"))
            if not _prediction_only_unknown(envelope):
                errors["prediction_became_fact"] = errors.get("prediction_became_fact", 0) + 1
        for path in audit_dir.rglob("response-*.json"):
            if RESPONSE_NAME.search(path.name) is None:
                continue
            payload = _load_json(path)
            for attempt in payload.get("attempts") or []:
                attempts += 1
                error = attempt.get("error")
                if error:
                    errors[error] = errors.get(error, 0) + 1
                usage = (attempt.get("audit") or {}).get("usage") or {}
                if "input_tokens" in usage or "output_tokens" in usage:
                    token_rows += 1
                    input_tokens += int(usage.get("input_tokens") or 0)
                    output_tokens += int(usage.get("output_tokens") or 0)
    return {"requests": requests, "attempts": attempts, "attempt_errors": errors,
            "token_rows": token_rows, "input_tokens": input_tokens,
            "output_tokens": output_tokens, "observed_at": observed}


def _facts(envelope: dict):
    knowledge = envelope.get("knowledge") or {}
    facts = knowledge.get("facts") if isinstance(knowledge, dict) else []
    return facts if isinstance(facts, list) else []


def _unknowns(envelope: dict):
    knowledge = envelope.get("knowledge") or {}
    unknowns = knowledge.get("unknowns") if isinstance(knowledge, dict) else []
    return unknowns if isinstance(unknowns, list) else []


def _prediction_only_unknown(envelope: dict) -> bool:
    """True when the prediction phrase is absent from current facts."""
    for fact in _facts(envelope):
        if isinstance(fact, dict) and PREDICTION in str(fact.get("text") or ""):
            return False
    return True


def _completed(log_text: str, run_exit: int, failures: list) -> None:
    if run_exit != 0:
        failures.append("run_failed")
    if "SOCIETY product-checkpoint commit " not in log_text or "SOCIETY done result=ok" not in log_text:
        failures.append("world_not_completed")
    if "origin=model" not in log_text:
        failures.append("no_model_action")


def _stock(events: list) -> int | None:
    stock = 0
    for event in events:
        kind, ok = event.get("kind"), event.get("ok")
        if kind == "gather" and ok is True:
            stock += 1
        elif kind == "build" and ok is True:
            stock -= 1
        elif kind == "give" and ok is True:
            return None
    return stock


def audit_consequence(world: Path, log_text: str, run_exit: int = 0) -> dict:
    failures = []
    _completed(log_text, run_exit, failures)
    checks = list(VERIFY.finditer(log_text))
    if not checks or checks[-1].group(6) != "true":
        failures.append("resource_not_conserved")
    try:
        stored = load_storage(world / "mod_storage" / "society")
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        stored = None
        failures.append("missing_checkpoint")
    success = failure = None
    inventory = None
    if stored is not None:
        events = _events(stored["checkpoint"])
        for event in events:
            if event.get("kind") != "gather" or not _same_point(event, GATHER):
                continue
            if event.get("ok") is True and event.get("reason") == "world-verified":
                success = event
            if event.get("ok") is False and event.get("reason") == "resource mismatch":
                failure = event
        if success is None:
            failures.append("no_gather_success")
        if failure is None:
            failures.append("no_gather_failure")
        texts = [str(record.get("text") or "") for record in _records(stored["checkpoint"])
                 if str(record.get("owner")) == "0"]
        if not any("gather succeeded: world-verified" in text for text in texts):
            failures.append("missing_success_memory")
        if not any("gather failed: resource mismatch" in text for text in texts):
            failures.append("missing_failure_memory")
        actor = _actor(stored["checkpoint"])
        inventory = (actor or {}).get("inventory") or {}
        expected = _stock(events)
        held = inventory.get("society:resource", 0) if isinstance(inventory, dict) else None
        if expected is None or held != expected:
            failures.append("inventory_mismatch")
    counts = _model_counts(world / "private" / "model-audit")
    summary = {"scenario": "action_consequence", "run_exit": run_exit,
               "gather_success": success is not None, "gather_failure": failure is not None,
               "inventory": inventory.get("society:resource", 0) if isinstance(inventory, dict) else None,
               "requests": counts["requests"], "attempts": counts["attempts"],
               "attempt_errors": {key: value for key, value in sorted(counts["attempt_errors"].items())
                                  if key != "prediction_became_fact"},
               "token_rows": counts["token_rows"], "input_tokens": counts["input_tokens"],
               "output_tokens": counts["output_tokens"],
               "checkpoint_committed": "SOCIETY product-checkpoint commit " in log_text,
               "world_completed": "SOCIETY done result=ok" in log_text,
               "failures": sorted(set(failures))}
    return summary


def audit_environment(world: Path, log_text: str, run_exit: int = 0) -> dict:
    failures = []
    _completed(log_text, run_exit, failures)
    amount = rate = logical = None
    try:
        stored = load_storage(world / "mod_storage" / "society")
        environment = stored["environment"]
        amount = _whole(environment["amount"])
        rate = _whole(environment["rate"])
        logical = _whole(environment["time"])
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        failures.append("missing_checkpoint")
    if amount != SETTLED_AMOUNT or rate != 0 or logical is None or logical < CHANGE_AT:
        failures.append("condition_not_applied")
    if f"ev=environment-condition at={CHANGE_AT} rate=0 amount={SETTLED_AMOUNT}" not in log_text:
        failures.append("condition_not_logged")
    counts = _model_counts(world / "private" / "model-audit")
    if counts["attempt_errors"].get("prediction_became_fact"):
        failures.append("prediction_became_fact")
    seed_seen = False
    after_change = False
    audit_dir = world / "private" / "model-audit"
    if audit_dir.is_dir():
        for path in audit_dir.rglob("request-*.json"):
            if REQUEST_NAME.search(path.name) is None:
                continue
            payload = _load_json(path)
            envelope = ((payload.get("context") or {}).get("model_input") or {})
            if any(PREDICTION in str(item.get("text") or "") for item in _unknowns(envelope)
                   if isinstance(item, dict)):
                seed_seen = True
            observed = (envelope.get("request") or {}).get("observed_at")
            if isinstance(observed, (int, float)) and observed >= CHANGE_AT:
                after_change = True
    if not seed_seen:
        failures.append("missing_prediction_seed")
    if not after_change:
        failures.append("no_observation_after_change")
    return {"scenario": "environment_condition", "run_exit": run_exit,
            "settled_amount": amount, "settled_rate": rate, "logical_time": logical,
            "prediction_remains_unknown": "prediction_became_fact" not in failures and seed_seen,
            "observed_after_change": after_change, "requests": counts["requests"],
            "attempts": counts["attempts"],
            "attempt_errors": {key: value for key, value in sorted(counts["attempt_errors"].items())
                               if key != "prediction_became_fact"},
            "token_rows": counts["token_rows"], "input_tokens": counts["input_tokens"],
            "output_tokens": counts["output_tokens"],
            "checkpoint_committed": "SOCIETY product-checkpoint commit " in log_text,
            "world_completed": "SOCIETY done result=ok" in log_text,
            "failures": sorted(set(failures))}


def _ids(events: list) -> list:
    return [event.get("operation_id") for event in events]


def _record_ids(checkpoint: dict) -> set:
    return {record.get("id") for record in _records(checkpoint) if record.get("id")}


def audit_resume(world: Path, before: Path, log_text: str, before_log: str, run_exit: int = 0) -> dict:
    failures = []
    _completed(log_text, run_exit, failures)
    if "origin=model" not in before_log or "SOCIETY done result=ok" not in before_log:
        failures.append("first_run_failed")
    if " joins game" in log_text or " joins game" in before_log:
        failures.append("client_joined")
    match = RESUME_LINE.search(log_text)
    offline = logical = rate = None
    if match is None:
        failures.append("missing_resume_log")
    else:
        logical, offline, rate = int(match.group(1)), int(match.group(2)), float(match.group(3))
        if offline < 2:
            failures.append("offline_not_recorded")
    try:
        before_store = load_storage(before / "society")
        after_store = load_storage(world / "mod_storage" / "society")
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        before_store = after_store = None
        failures.append("missing_checkpoint")
    decisions_before = decisions_after = None
    if before_store is not None and after_store is not None:
        checkpoint_time = before_store["environment"].get("time")
        if logical is not None and logical != checkpoint_time:
            failures.append("offline_applied_to_clock")
        if offline and rate and logical is not None and logical == checkpoint_time + int(offline * rate):
            failures.append("offline_applied_to_clock")
        before_ids = _ids(_events(before_store["checkpoint"]))
        after_ids = _ids(_events(after_store["checkpoint"]))
        if len(after_ids) != len(set(after_ids)):
            failures.append("duplicate_operation")
        if not set(before_ids) <= set(after_ids):
            failures.append("events_dropped")
        if not _record_ids(before_store["checkpoint"]) <= _record_ids(after_store["checkpoint"]):
            failures.append("memory_dropped")
        first = _actor(before_store["checkpoint"])
        second = _actor(after_store["checkpoint"])
        decisions_before = None if first is None else _whole(first.get("decisions"))
        decisions_after = None if second is None else _whole(second.get("decisions"))
        if decisions_before is None or decisions_after is None or decisions_after <= decisions_before:
            failures.append("decisions_reset")
    counts = _model_counts(world / "private" / "model-audit")
    return {"scenario": "restart_resume", "run_exit": run_exit,
            "resume_logical": logical, "offline_seconds": offline,
            "decisions_before": decisions_before, "decisions_after": decisions_after,
            "headless": "client_joined" not in failures,
            "requests": counts["requests"], "attempts": counts["attempts"],
            "attempt_errors": {key: value for key, value in sorted(counts["attempt_errors"].items())
                               if key != "prediction_became_fact"},
            "token_rows": counts["token_rows"], "input_tokens": counts["input_tokens"],
            "output_tokens": counts["output_tokens"],
            "checkpoint_committed": "SOCIETY product-checkpoint commit " in log_text,
            "world_completed": "SOCIETY done result=ok" in log_text,
            "failures": sorted(set(failures))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare or audit a longitudinal scenario")
    parser.add_argument("command", choices=("prepare", "audit"))
    parser.add_argument("--scenario", choices=tuple(SCENARIOS), required=True)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--world", type=Path)
    parser.add_argument("--before", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--run-exit", type=int, default=0)
    args = parser.parse_args(argv)
    if args.command == "prepare":
        if args.root is None:
            parser.error("prepare requires --root")
        prepare(args.root, args.scenario)
        return 0
    if args.world is None or args.output is None:
        parser.error("audit requires --world and --output")
    log_path = args.world / "private" / "product.log"
    log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    if args.scenario == "consequence":
        summary = audit_consequence(args.world, log_text, args.run_exit)
    elif args.scenario == "environment":
        summary = audit_environment(args.world, log_text, args.run_exit)
    else:
        if args.before is None:
            parser.error("resume audit requires --before")
        before_log_path = args.before / "product.log"
        before_log = (before_log_path.read_text(encoding="utf-8", errors="replace")
                      if before_log_path.exists() else "")
        summary = audit_resume(args.world, args.before, log_text, before_log, args.run_exit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    public = {key: summary[key] for key in summary if key != "inventory"}
    print(json.dumps(public, ensure_ascii=False))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
