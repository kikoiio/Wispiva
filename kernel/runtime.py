"""Ray computes a candidate tick; only the controller commits it to Redis."""

from __future__ import annotations

import os
import time
from pathlib import Path

import ray
import redis

from kernel.sim import World

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
ROOT = Path(__file__).resolve().parents[1]
_HANDLES: dict = {}


def connect():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=3, socket_timeout=5)


def ensure_ray() -> None:
    if ray.is_initialized():
        return
    # Ray's Unix socket names need a short path, outside the quota-limited /tmp.
    directory = Path(os.environ.get("RAY_TMPDIR") or f"/var/tmp/wispiva-ray-{os.getuid()}")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise RuntimeError("Ray 临时目录不属于当前用户，请设置 RAY_TMPDIR")
    ray.init(
        namespace="openstory",
        num_cpus=1,
        include_dashboard=False,
        object_store_memory=128 * 1024 * 1024,
        ignore_reinit_error=True,
        logging_level="ERROR",
        _temp_dir=str(directory.resolve()),
        runtime_env={"env_vars": {"PYTHONPATH": str(ROOT)}},
    )


@ray.remote
class Pod:
    def run_agents(self, spec: dict) -> dict:
        from kernel.decide import model_decider
        world = World.from_spec(spec)
        decider = model_decider if spec.get("mode", "model") == "model" else None
        try:
            world.run_agents(decider=decider)
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300]}
        return {"ok": True, "spec": world.to_disk()}


@ray.remote
class System:
    def deliver_and_advance(self, spec: dict) -> dict:
        world = World.from_spec(spec)
        world.deliver_and_advance()
        return world.to_disk()


def actors():
    ensure_ray()
    if "pod" not in _HANDLES:
        # Job-scoped actors never kill or reuse a different server's actors.
        _HANDLES["pod"] = Pod.remote()
        _HANDLES["system"] = System.remote()
    return _HANDLES["pod"], _HANDLES["system"]


def advance(spec: dict) -> dict:
    pod, system = actors()
    budget = float(os.environ.get("WISPIVA_TICK_TIMEOUT") or 600)
    deadline = time.monotonic() + budget
    try:
        result = ray.get(pod.run_agents.remote(spec), timeout=budget)
        if not result["ok"]:
            raise RuntimeError(result["error"])
        return ray.get(system.deliver_and_advance.remote(result["spec"]), timeout=max(0, deadline - time.monotonic()))
    except ray.exceptions.GetTimeoutError as exc:
        _discard_actors()
        raise RuntimeError("这一拍超过运行时限，世界停在上一拍") from exc
    except ray.exceptions.RayError:
        _discard_actors()
        raise RuntimeError("角色运行进程不可用，世界已暂停；可重试以重建运行进程") from None


def _discard_actors():
    handles = list(_HANDLES.values())
    _HANDLES.clear()
    for handle in handles:
        try:
            ray.kill(handle)
        except ray.exceptions.RayError:
            pass


def shutdown() -> None:
    _HANDLES.clear()
    if ray.is_initialized():
        ray.shutdown()
