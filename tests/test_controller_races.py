"""Small Redis integration regressions; no Ray, models, or background scheduler."""

from threading import Event, Thread
from unittest.mock import patch

from redis_support import RedisCase
from kernel.controller import Controller
from kernel.sim import World
from kernel.store import ConflictError, PREFIX, list_history, load_control, load_world, save_world


class ControllerRaceTests(RedisCase):
    def setUp(self):
        super().setUp()
        save_world(self.client, {
            "name": "竞态测试", "mode": "rules", "tick": 0,
            "locations": [{"id": "yard", "name": "院子"}],
            "agents": [{"id": "a1", "name": "甲", "location": "yard"}],
            "events": [{"tick": 0, "agent": "a1", "action": "join", "ok": True, "text": "甲来到院子"}],
        })
        self.world_id = load_world(self.client)["world_id"]

    @staticmethod
    def advance(spec):
        world = World.from_spec(spec)
        world.tick()
        return world.to_disk()

    def test_other_controller_stop_survives_commit_and_control_retry(self):
        """Stop after the committing writer read control, forcing a WATCH retry."""
        computed = Event()
        stopped = Event()
        runner_calls = []
        other = Controller(self.client, runner=self.advance)

        def runner(spec):
            runner_calls.append(spec["tick"])
            candidate = self.advance(spec)
            computed.set()
            return candidate

        app = Controller(self.client, runner=runner)
        app.set_running(True, interval=1)
        before = load_world(self.client)
        control_key = f"{PREFIX}:world:{self.world_id}:control"
        real_get = self.client.get
        real_pipeline = self.client.pipeline

        def after_read(key, value):
            # Reentrant calls made by the other Controller must not retrigger.
            if key == control_key and computed.is_set() and not stopped.is_set():
                stopped.set()
                other.set_running(False, interval=2)
                self.assertFalse(load_control(self.client, self.world_id)["running"])
            return value

        def get(key, *args, **kwargs):
            return after_read(key, real_get(key, *args, **kwargs))

        def pipeline(*args, **kwargs):
            pipe = real_pipeline(*args, **kwargs)
            pipe_get = pipe.get

            def read(key, *read_args, **read_kwargs):
                return after_read(key, pipe_get(key, *read_args, **read_kwargs))

            pipe.get = read
            return pipe

        # Old code reads via client.get; WATCH transactions use pipeline.get.
        with patch.object(self.client, "get", side_effect=get), \
             patch.object(self.client, "pipeline", side_effect=pipeline):
            app.step()

        self.assertTrue(stopped.is_set(), "the stop interleaving was not exercised")
        control = load_control(self.client, self.world_id)
        self.assertFalse(control["running"], "a tick commit resurrected a stopped simulation")
        self.assertEqual(control["interval"], 2)
        self.assertFalse(control["waiting"])
        self.assertEqual(control["error"], "")
        after = load_world(self.client)
        self.assertEqual(after["tick"], 1)
        self.assertEqual(after["_revision"], before["_revision"] + 1)
        self.assertEqual(len(list_history(self.client, self.world_id)), 2)
        self.assertEqual(runner_calls, [0], "control contention must not rerun the model turn")

    def test_world_cas_conflict_does_not_block_the_winning_controller(self):
        other = Controller(self.client, runner=self.advance)

        def runner(spec):
            other.add_agent("乙", "yard")
            return self.advance(spec)

        app = Controller(self.client, runner=runner)
        app.set_running(True)
        outcome = None
        try:
            app.step()
        except Exception as exc:
            outcome = exc

        saved = load_world(self.client)
        self.assertEqual(saved["tick"], 0)
        self.assertEqual([agent["name"] for agent in saved["agents"]], ["甲", "乙"])
        control = load_control(self.client, self.world_id)
        self.assertTrue(control["running"], "a stale tick writer stopped the winning controller")
        self.assertFalse(control["waiting"])
        self.assertEqual(control["error"], "")
        self.assertIsInstance(outcome, ConflictError)
        self.assertEqual(len(list_history(self.client, self.world_id)), 2)

    def test_close_before_runner_returns_prevents_late_commit(self):
        entered = Event()
        release = Event()
        errors = []

        def runner(spec):
            entered.set()
            if not release.wait(timeout=5):
                raise RuntimeError("test failed to release the runner")
            return self.advance(spec)

        app = Controller(self.client, runner=runner)
        before = load_world(self.client)

        def step():
            try:
                app.step()
            except Exception as exc:
                errors.append(exc)

        # Exercise cancellation of a manual step too; no scheduler is needed.
        worker = Thread(target=step, daemon=True, name="controller-cancel-test")
        worker.start()
        try:
            self.assertTrue(entered.wait(timeout=2), "runner never started")
            app.close()
        finally:
            release.set()
            worker.join(timeout=3)
        self.assertFalse(worker.is_alive(), "test worker did not exit")
        after = load_world(self.client)
        self.assertEqual(after["tick"], before["tick"], "a cancelled tick committed after close")
        for key in ("_revision", "agents", "events", "outbox"):
            self.assertEqual(after.get(key), before.get(key), key)
        self.assertEqual(len(list_history(self.client, self.world_id)), 1)
        for error in errors:
            self.assertIsInstance(error, (RuntimeError, ValueError))

    def test_paused_scheduler_does_not_hydrate_event_history(self):
        runner_calls = []

        def runner(spec):
            runner_calls.append(spec)
            return self.advance(spec)

        app = Controller(self.client, runner=runner)
        with patch.object(self.client, "lrange", wraps=self.client.lrange) as reads:
            for _ in range(3):
                self.assertFalse(app.run_due())
        event_reads = [call.args for call in reads.call_args_list if str(call.args[0]).endswith(":events")]
        self.assertEqual(event_reads, [], "paused polling fetched the entire event history")
        self.assertEqual(runner_calls, [])
        self.assertEqual(load_world(self.client)["tick"], 0)
