"""One commit per tick; server-owned scheduling is independent of viewers."""

from __future__ import annotations

import math
import threading
import time
from contextlib import contextmanager

from kernel.art import attach
from kernel.compile import compile_text
from kernel.sim import World
from kernel.store import ConflictError, load_control, load_head, load_world, save_world, update_control


class BusyError(ValueError):
    pass


class StepError(RuntimeError):
    pass


class StepCancelled(StepError):
    pass


class Controller:
    def __init__(self, client, runner=None, clock=time.monotonic):
        self.client = client
        self.runner = runner or self._advance
        self.clock = clock
        self._mutation = threading.Lock()
        self._commit = threading.Lock()
        self._control = threading.RLock()
        self._wake = threading.Event()
        self._shutdown = threading.Event()
        self._thread = None
        self._deadline = None
        self._schedule = None
        self.last_error = ""

    @staticmethod
    def _advance(spec):
        from kernel.runtime import advance
        return advance(spec)

    @contextmanager
    def _writing(self):
        if self._shutdown.is_set():
            raise StepCancelled("服务正在退出")
        if not self._mutation.acquire(blocking=False):
            raise BusyError("世界正在推进或编辑，请稍后重试")
        try:
            yield
        finally:
            self._mutation.release()

    def _world(self):
        spec = load_world(self.client)
        if spec is None:
            raise ValueError("还没有世界")
        return spec

    def _save(self, spec, **options):
        with self._commit:
            if self._shutdown.is_set():
                raise StepCancelled("服务正在退出，这一拍未提交")
            save_world(self.client, spec, **options)

    def migrate(self):
        spec = load_world(self.client)
        if spec is not None and not spec.get("world_id"):
            save_world(self.client, spec)

    def present(self):
        spec = load_world(self.client)
        if spec is None:
            return None
        result = attach(World.from_spec(spec).snapshot())
        result["simulation"] = spec.get("simulation") or load_control(self.client, spec.get("world_id", ""))
        result["world_id"] = spec.get("world_id", "")
        result["revision"] = spec.get("_revision", 0)
        return result

    def create(self, text: str, use_model: bool = False):
        with self._writing():
            world = World.from_spec(compile_text(text, use_model=use_model))
            self._save(world.to_disk(), replace=True)
            with self._control:
                self._deadline = None
                self._schedule = None
        self._wake.set()
        return self.present()

    def add_agent(self, name: str, location: str, goal: str = ""):
        return self._edit(lambda world: world.add_agent(name, location, goal))

    def remove_agent(self, agent_id: str):
        return self._edit(lambda world: world.remove_agent(agent_id))

    def _edit(self, action):
        with self._writing():
            world = World.from_spec(self._world())
            action(world)
            self._save(world.to_disk())
        return self.present()

    def step(self):
        with self._writing():
            original = self._world()
            world_id = original.get("world_id", "")
            try:
                candidate = self.runner(original)
                self._save(candidate, clear_waiting=True)
            except (ConflictError, StepCancelled):
                raise
            except Exception as exc:
                self._block(world_id, str(exc))
                raise StepError(str(exc) or "这一拍未能完成，世界已停在原时刻") from exc
            self.last_error = ""
        return self.present()

    def _block(self, world_id, error):
        if self._shutdown.is_set():
            return
        with self._control:
            update_control(self.client, world_id, {"running": False, "waiting": True, "error": error[:300]})
            self._deadline = None
            self.last_error = error[:300]

    def set_running(self, running: bool, interval=None):
        if not isinstance(running, bool):
            raise ValueError("running 必须为布尔值")
        with self._control:
            spec = load_head(self.client)
            if spec is None:
                raise ValueError("还没有世界")
            changes = {"running": running}
            if interval is not None:
                if isinstance(interval, bool):
                    raise ValueError("推进间隔必须是 0.2–3600 秒")
                interval = float(interval)
                if not math.isfinite(interval) or not 0.2 <= interval <= 3600:
                    raise ValueError("推进间隔必须是 0.2–3600 秒")
                changes["interval"] = interval
            if running:
                changes.update(waiting=False, error="")
                self.last_error = ""
            control = update_control(self.client, spec["world_id"], changes)
            self._schedule = (spec["world_id"], control["interval"])
            self._deadline = self.clock() + control["interval"] if running else None
        self._wake.set()
        return self.present()

    def run_due(self):
        with self._control:
            spec = load_head(self.client)
            if spec is None or not spec.get("simulation", {}).get("running"):
                self._deadline = None
                return False
            interval = spec["simulation"]["interval"]
            schedule = (spec["world_id"], interval)
            now = self.clock()
            if self._schedule != schedule or self._deadline is None:
                self._schedule = schedule
                self._deadline = now + interval
            if now < self._deadline:
                return False
            self._deadline = now + interval
        try:
            self.step()
        except BusyError:
            return False
        finally:
            with self._control:
                if self._deadline is not None:
                    self._deadline = self.clock() + interval
        return True

    def start(self):
        if self._thread is not None:
            return
        self.migrate()
        self._thread = threading.Thread(target=self._loop, name="world-clock", daemon=True)
        self._thread.start()

    def _loop(self):
        while not self._shutdown.is_set():
            try:
                self.run_due()
            except Exception as exc:
                self.last_error = str(exc)[:300]
            self._wake.wait(0.2)
            self._wake.clear()

    def close(self, wait=True):
        with self._commit:
            self._shutdown.set()
        self._wake.set()
        if wait and self._thread is not None:
            self._thread.join(timeout=2)
