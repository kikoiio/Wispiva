"""Private-telling acceptance for one absent third person.

Alice and Bob start together in a yard. Cora starts on a distant ridge with
no path between them. Alice is asked to say one unguessable token only to Bob.
The audit checks model inputs and the delivered message log. It records counts
and does not copy message text into the public summary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

MARKER = "cedar-token-7f3a"
ACTORS = ("alice", "bob", "cora")
SEEDS = {
    "alice": "The private yard token is cedar-token-7f3a. Only Bob may hear it from me.",
    "bob": "I am with Alice in the yard and have not been told a private token.",
    "cora": "I am alone on the ridge and have not met Alice or Bob.",
}
GOALS = {
    "alice": "On your first decision, say to Bob and include the exact token cedar-token-7f3a. Do not tell anyone else.",
    "bob": "Stay beside Alice. If she tells you a private token, keep it to yourself.",
    "cora": "Stay on the ridge. Do not approach the yard. You do not know a private token.",
}
# Source kinds that may legally contain the marker after it leaves Alice's seed.
HEARD = {"agent_message", "agent", "event"}
SAID = {"genesis_seed", "self", "action", "event"}
MESSAGE_LINE = re.compile(r"ev=message agent=(\d+) recipient=(\d+) sha256=([0-9a-fA-F]+)")
REQUEST_NAME = re.compile(r"request-(\d+)-agent-(\d+)\.json$")
RESPONSE_NAME = re.compile(r"response-(\d+)-agent-(\d+)\.json$")

SCENARIO = {
    "schemaVersion": 1,
    "title": "A private token at the yard",
    "description": "Alice and Bob share a yard. Cora waits on a distant ridge and cannot hear them.",
    "places": [
        {"id": "yard", "name": "The yard", "description": "Where Alice and Bob start together."},
        {"id": "ridge", "name": "The ridge", "description": "Where Cora starts, far from the yard."},
    ],
    "actors": [
        {"id": "alice", "name": "Alice", "role": "speaker", "goal": GOALS["alice"], "placeId": "yard"},
        {"id": "bob", "name": "Bob", "role": "listener", "goal": GOALS["bob"], "placeId": "yard"},
        {"id": "cora", "name": "Cora", "role": "absent", "goal": GOALS["cora"], "placeId": "ridge"},
    ],
    "memories": [{"actorId": actor, "text": text} for actor, text in SEEDS.items()],
    "rules": [],
    "layout": {
        "places": [
            {"placeId": "yard", "space": "outdoor", "grid": [-3, -3]},
            {"placeId": "ridge", "space": "outdoor", "grid": [3, 3]},
        ],
        "connections": [],
    },
}


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _records(envelope: dict):
    knowledge = envelope.get("knowledge") or {}
    if not isinstance(knowledge, dict):
        return
    for items in knowledge.values():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    yield item


def _goal(envelope: dict) -> str:
    goal = (envelope.get("actor") or {}).get("goal") or {}
    text = goal.get("text") if isinstance(goal, dict) else ""
    return text if isinstance(text, str) else ""


def _nearby(envelope: dict):
    observation = (envelope.get("current") or {}).get("observation") or {}
    nearby = observation.get("nearby_agents") or []
    return nearby if isinstance(nearby, list) else []


def _scrubbed_has_marker(envelope: dict, actor: str) -> bool:
    """True when the marker survives outside this actor's allowed goal and records."""
    clone = json.loads(json.dumps(envelope))
    if actor == "alice":
        goal = ((clone.get("actor") or {}).get("goal") or {})
        if isinstance(goal, dict) and isinstance(goal.get("text"), str):
            goal["text"] = goal["text"].replace(MARKER, "")
    allowed = SAID if actor == "alice" else HEARD if actor == "bob" else set()
    knowledge = clone.get("knowledge") or {}
    if isinstance(knowledge, dict):
        for items in knowledge.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict) or MARKER not in str(item.get("text") or ""):
                    continue
                kind = (item.get("source") or {}).get("kind")
                audience = ((item.get("access") or {}).get("audience"))
                if kind in allowed and audience == [actor]:
                    item["text"] = str(item["text"]).replace(MARKER, "")
    return MARKER in json.dumps(clone, ensure_ascii=False)


def audit(audit_dir: Path, log_text: str, run_exit: int = 0) -> dict:
    """Return a public summary. `failures` is empty only for a completed bounded run."""
    requests = []
    for path in sorted(audit_dir.rglob("request-*.json")):
        match = REQUEST_NAME.search(path.name)
        if match is None:
            continue
        payload = _load_json(path)
        envelope = ((payload.get("context") or {}).get("model_input") or {})
        actor = ((envelope.get("request") or {}).get("actor_id")
                  or (envelope.get("actor") or {}).get("id"))
        runtime = int(match.group(2))
        requests.append({"id": int(match.group(1)), "runtime": runtime,
                         "actor": actor, "envelope": envelope})
    responses = []
    for path in sorted(audit_dir.rglob("response-*.json")):
        match = RESPONSE_NAME.search(path.name)
        if match is None:
            continue
        payload = _load_json(path)
        responses.append({"id": int(match.group(1)), "runtime": int(match.group(2)),
                          "payload": payload})
    runtime_to_actor = {}
    for row in requests:
        if row["actor"] in ACTORS:
            runtime_to_actor[row["runtime"]] = row["actor"]
    failures = []
    if run_exit != 0:
        failures.append("run_failed")
    if "SOCIETY product-checkpoint commit " not in log_text or "SOCIETY done result=ok" not in log_text:
        failures.append("world_not_completed")
    if "origin=model" not in log_text:
        failures.append("no_model_action")
    seen = {row["actor"] for row in requests}
    if seen != set(ACTORS):
        failures.append("missing_actor")
    marker_requests = {actor: 0 for actor in ACTORS}
    cora_observed = []
    for row in requests:
        actor = row["actor"]
        envelope = row["envelope"]
        if actor not in SEEDS:
            failures.append("unknown_actor")
            continue
        unknowns = [item for item in _records(envelope)
                    if (item.get("source") or {}).get("kind") == "genesis_seed"]
        own = [item.get("text") for item in unknowns]
        if SEEDS[actor] not in own:
            failures.append(f"missing_own_seed:{actor}")
        for other, seed in SEEDS.items():
            if other != actor and seed in own:
                failures.append(f"seed_leak:{other}:{actor}")
        if _goal(envelope) != GOALS[actor]:
            failures.append(f"goal_mismatch:{actor}")
        if MARKER in json.dumps(envelope, ensure_ascii=False):
            marker_requests[actor] += 1
        if _scrubbed_has_marker(envelope, actor):
            failures.append(f"unsourced_marker:{actor}")
        if actor == "cora":
            for runtime in _nearby(envelope):
                other = runtime_to_actor.get(runtime)
                if other in ("alice", "bob"):
                    cora_observed.append(other)
                elif other is None:
                    failures.append("cora_observed_unknown")
    if cora_observed:
        failures.append("cora_observed_peer")
    deliveries = []
    for row in responses:
        action = (row["payload"].get("action") or {})
        text = action.get("text") if isinstance(action.get("text"), str) else ""
        if action.get("kind") != "say" or MARKER not in text:
            continue
        speaker = runtime_to_actor.get(row["runtime"])
        target = runtime_to_actor.get(action.get("target"))
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        delivered = any(
            int(agent) == row["runtime"] and int(recipient) == action.get("target")
            and seen_digest.lower() == digest
            for agent, recipient, seen_digest in MESSAGE_LINE.findall(log_text))
        deliveries.append({"speaker": speaker, "target": target, "request_id": row["id"],
                           "delivered": delivered})
        if target == "cora" or speaker == "cora":
            failures.append("cora_message")
    delivered_to_bob = [item for item in deliveries
                        if item["speaker"] == "alice" and item["target"] == "bob" and item["delivered"]]
    if not delivered_to_bob:
        failures.append("no_transmission")
    followup = False
    if delivered_to_bob:
        first = min(item["request_id"] for item in delivered_to_bob)
        for row in requests:
            if row["actor"] != "bob" or row["id"] <= first:
                continue
            for item in _records(row["envelope"]):
                source = (item.get("source") or {}).get("kind")
                audience = (item.get("access") or {}).get("audience")
                if (source == "agent_message" and audience == ["bob"]
                        and MARKER in str(item.get("text") or "")):
                    followup = True
        if not followup:
            failures.append("no_followup")
    for agent, recipient, _digest in MESSAGE_LINE.findall(log_text):
        if runtime_to_actor.get(int(recipient)) == "cora":
            failures.append("cora_received_message")
    attempt_errors = {}
    input_tokens = 0
    output_tokens = 0
    token_rows = 0
    attempts = 0
    for row in responses:
        for attempt in row["payload"].get("attempts") or []:
            attempts += 1
            error = attempt.get("error")
            if error:
                attempt_errors[error] = attempt_errors.get(error, 0) + 1
            usage = (attempt.get("audit") or {}).get("usage") or {}
            if "input_tokens" in usage or "output_tokens" in usage:
                token_rows += 1
                input_tokens += int(usage.get("input_tokens") or 0)
                output_tokens += int(usage.get("output_tokens") or 0)
    summary = {
        "scenario": "private_telling_absent_third",
        "marker": MARKER,
        "run_exit": run_exit,
        "requests": len(requests),
        "responses": len(responses),
        "requests_by_actor": {actor: sum(row["actor"] == actor for row in requests) for actor in ACTORS},
        "marker_requests": marker_requests,
        "say_with_marker": len(deliveries),
        "delivered_to_bob": len(delivered_to_bob),
        "bob_followup_has_sourced_rumor": followup,
        "cora_observed_peers": sorted(set(cora_observed)),
        "message_events": len(MESSAGE_LINE.findall(log_text)),
        "attempts": attempts,
        "attempt_errors": dict(sorted(attempt_errors.items())),
        "token_rows": token_rows,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "checkpoint_committed": "SOCIETY product-checkpoint commit " in log_text,
        "world_completed": "SOCIETY done result=ok" in log_text,
        "failures": sorted(set(failures)),
    }
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit the private-telling product run")
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-exit", type=int, default=0)
    args = parser.parse_args(argv)
    log_path = args.world / "private" / "product.log"
    log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    summary = audit(args.world / "private" / "model-audit", log_text, args.run_exit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: summary[key] for key in (
        "requests", "responses", "delivered_to_bob", "bob_followup_has_sourced_rumor",
        "cora_observed_peers", "attempt_errors", "failures")}, ensure_ascii=False))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
