"""Atomic current state, append-only events, and immutable revision checkpoints."""

from __future__ import annotations

import hashlib
import json
import uuid

from redis.exceptions import WatchError

PREFIX = "openstory"
CURRENT = f"{PREFIX}:current"
HEAD = f"{PREFIX}:head"


class ConflictError(ValueError):
    pass


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(events) -> str:
    digest = hashlib.sha256()
    for event in events:
        digest.update(_dump(event).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _base(world_id: str) -> str:
    return f"{PREFIX}:world:{world_id}"


def save_world(client, spec: dict, *, replace: bool = False, clear_waiting: bool = False) -> None:
    for _ in range(8):
        try:
            _save_world(client, spec, replace=replace, clear_waiting=clear_waiting)
            return
        except WatchError:
            continue
    raise ConflictError("世界正在被其他操作修改，请稍后重试")


def _save_world(client, spec: dict, *, replace: bool, clear_waiting: bool) -> None:
    events = spec.get("events") or []
    with client.pipeline() as pipe:
        try:
            pipe.watch(CURRENT)
            previous_raw = pipe.get(CURRENT)
            previous = json.loads(previous_raw) if previous_raw else None
            if previous and not replace:
                if (spec.get("world_id"), spec.get("_revision")) != (previous["world_id"], previous["_revision"]):
                    raise ConflictError("世界已被其他操作修改，请刷新后重试")
            world_id = uuid.uuid4().hex if replace else spec.get("world_id") or uuid.uuid4().hex
            same_world = previous is not None and previous["world_id"] == world_id
            revision = previous["_revision"] + 1 if same_world else 1
            prior_count = previous["_event_count"] if same_world else 0
            if len(events) < prior_count or (same_world and _digest(events[:prior_count]) != previous["_event_digest"]):
                raise ValueError("已保存的历史不可删除或改写")
            data = {key: value for key, value in spec.items() if key not in {"events", "simulation"}}
            data.update(world_id=world_id, _revision=revision,
                        _event_count=len(events), _event_digest=_digest(events))
            raw = _dump(data)
            base = _base(world_id)
            control = None
            if same_world and clear_waiting:
                pipe.watch(f"{base}:control")
                control = _control(pipe.get(f"{base}:control"))
                control.update(waiting=False, error="")
            entry = {"revision": revision, "tick": data.get("tick", 0), "event_count": len(events)}
            pipe.multi()
            if len(events) > prior_count:
                pipe.rpush(f"{base}:events", *(_dump(event) for event in events[prior_count:]))
            pipe.set(f"{base}:revision:{revision}", raw, nx=True)
            pipe.rpush(f"{base}:history", _dump(entry))
            pipe.set(f"{base}:latest", raw)
            pipe.set(CURRENT, raw)
            pipe.set(HEAD, _dump({"world_id": world_id, "_revision": revision, "tick": data.get("tick", 0)}))
            pipe.hset(f"{PREFIX}:worlds", world_id, _dump({"world_id": world_id, "name": data.get("name", ""), "tick": data.get("tick", 0), "revision": revision}))
            if not same_world:
                pipe.set(f"{base}:control", _dump({"running": False, "interval": 1.0, "waiting": False, "error": ""}))
            elif control is not None:
                pipe.set(f"{base}:control", _dump(control))
            pipe.execute()
        except WatchError:
            raise
    spec.update(world_id=world_id, _revision=revision)


def _hydrate(client, raw) -> dict | None:
    if raw is None:
        return None
    data = json.loads(raw)
    count = data.pop("_event_count")
    data.pop("_event_digest", None)
    data["events"] = [json.loads(item) for item in client.lrange(f"{_base(data['world_id'])}:events", 0, count - 1)] if count else []
    return data


def load_world(client) -> dict | None:
    data = _hydrate(client, client.get(CURRENT))
    if data is None:
        return _load_legacy(client)
    data["simulation"] = load_control(client, data["world_id"])
    return data


def load_control(client, world_id: str) -> dict:
    raw = client.get(f"{_base(world_id)}:control")
    return _control(raw)


def _control(raw) -> dict:
    return json.loads(raw) if raw else {"running": False, "interval": 1.0, "waiting": False, "error": ""}


def save_control(client, world_id: str, control: dict) -> None:
    update_control(client, world_id, control)


def update_control(client, world_id: str, changes: dict) -> dict:
    key = f"{_base(world_id)}:control"
    for _ in range(8):
        with client.pipeline() as pipe:
            try:
                pipe.watch(key)
                control = _control(pipe.get(key))
                control.update(changes)
                pipe.multi()
                pipe.set(key, _dump(control))
                pipe.execute()
                return control
            except WatchError:
                continue
    raise ConflictError("运行状态正在变化，请稍后重试")


def load_head(client) -> dict | None:
    raw = client.get(HEAD)
    if raw is None:
        return None
    data = json.loads(raw)
    data["simulation"] = load_control(client, data["world_id"])
    return data


def list_history(client, world_id: str, offset: int = 0, limit: int = 50) -> list[dict]:
    if offset < 0 or not 1 <= limit <= 100:
        raise ValueError("offset 必须非负，limit 必须在 1–100 之间")
    return [json.loads(item) for item in client.lrange(f"{_base(world_id)}:history", offset, offset + limit - 1)]


def load_revision(client, world_id: str, revision: int) -> dict | None:
    return _hydrate(client, client.get(f"{_base(world_id)}:revision:{revision}"))


def list_worlds(client) -> list[dict]:
    return [json.loads(item) for item in client.hvals(f"{PREFIX}:worlds")]


def _load_legacy(client) -> dict | None:
    """Read existing installations without deleting their original hashes."""
    meta = client.hgetall(f"{PREFIX}:meta")
    if not meta:
        return None
    meta = {_text(key): _text(value) for key, value in meta.items()}
    data = {key: json.loads(meta.get(key) or default) for key, default in {
        "notes": "[]", "rules": "[]", "model": "{}", "links": "[]", "relations": "[]", "outbox": "[]",
    }.items()}
    data.update(name=meta.get("name", ""), origin=meta.get("origin", ""), tick=int(meta.get("tick") or 0), mode="model")
    for plural, singular in (("locations", "location"), ("agents", "agent")):
        data[plural] = []
        for item_id in sorted(client.smembers(f"{PREFIX}:{plural}")):
            raw = client.hget(f"{PREFIX}:{singular}:{_text(item_id)}", "json")
            if raw:
                data[plural].append(json.loads(raw))
    data["events"] = [json.loads(item) for item in client.lrange(f"{PREFIX}:events", 0, -1)]
    return data


def _text(value) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)
