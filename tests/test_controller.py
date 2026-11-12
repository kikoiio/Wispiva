from copy import deepcopy
from unittest.mock import patch

from redis_support import RedisCase
from kernel.sim import World
from kernel.store import load_world


class ControllerTests(RedisCase):
    def controller(self, runner=None):
        from kernel.controller import Controller
        self.now = 0.0
        def advance(spec):
            world = World.from_spec(spec)
            world.tick()
            return world.to_disk()
        return Controller(self.client, runner=runner or advance, clock=lambda: self.now)

    def test_background_tick_does_not_need_a_browser_and_does_not_catch_up(self):
        app = self.controller()
        app.create("院子里的商人", use_model=False)
        app.set_running(True, interval=1)
        self.now = 1
        app.run_due()
        self.assertEqual(app.present()["tick"], 1)
        self.now = 100
        app.run_due()
        self.assertEqual(app.present()["tick"], 2)
        app.set_running(False)
        self.now = 101
        app.run_due()
        self.assertEqual(app.present()["tick"], 2)

    def test_restart_schedules_from_saved_time_without_offline_catchup(self):
        app = self.controller()
        app.create("院子里的商人", use_model=False)
        app.set_running(True, interval=1)
        self.now = 1
        app.run_due()
        restarted = self.controller()
        self.now = 1000
        restarted.run_due()
        self.assertEqual(restarted.present()["tick"], 1)
        self.now = 1001
        restarted.run_due()
        self.assertEqual(restarted.present()["tick"], 2)

    def test_failed_tick_commits_neither_partial_actions_nor_time(self):
        def fail(spec):
            spec["tick"] += 1
            spec["agents"] = []
            raise RuntimeError("provider unavailable")
        app = self.controller(fail)
        app.create("院子里的商人", use_model=False)
        before = deepcopy(load_world(self.client))
        from kernel.controller import StepError
        with self.assertRaises(StepError):
            app.step()
        after = load_world(self.client)
        self.assertEqual(after["tick"], before["tick"])
        self.assertEqual(after["agents"], before["agents"])
        self.assertEqual(after["events"], before["events"])
        self.assertTrue(app.present()["simulation"]["waiting"])
        self.assertFalse(app.present()["simulation"]["running"])

    def test_edit_during_tick_is_rejected_instead_of_overwriting_state(self):
        from kernel.controller import BusyError
        app = self.controller()
        app.create("院子里的商人", use_model=False)
        def during_tick(spec):
            with self.assertRaises(BusyError):
                app.add_agent("柏", spec["locations"][0]["id"], "test")
            world = World.from_spec(spec)
            world.tick()
            return world.to_disk()
        app.runner = during_tick
        app.step()
        self.assertEqual(app.present()["tick"], 1)

    def test_stop_requested_during_tick_is_preserved_at_commit(self):
        app = self.controller()
        app.create("院子里的商人", use_model=False)
        def during_tick(spec):
            app.set_running(False)
            world = World.from_spec(spec)
            world.tick()
            return world.to_disk()
        app.runner = during_tick
        app.set_running(True)
        app.step()
        self.assertFalse(app.present()["simulation"]["running"])

    def test_failed_creation_preserves_the_existing_world(self):
        app = self.controller()
        app.create("院子里的商人", use_model=False)
        before = deepcopy(load_world(self.client))
        with patch("kernel.controller.compile_text", side_effect=ValueError("model unavailable")):
            with self.assertRaises(ValueError):
                app.create("第二个世界", use_model=True)
        self.assertEqual(load_world(self.client), before)
