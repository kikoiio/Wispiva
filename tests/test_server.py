import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from redis_support import RedisCase
from kernel.controller import Controller
from kernel.server import Handler
from kernel.sim import World


class HttpTests(RedisCase):
    def setUp(self):
        super().setUp()
        def advance(spec):
            world = World.from_spec(spec)
            world.tick()
            return world.to_disk()
        self.app = Controller(self.client, runner=advance)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.controller = self.app
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.app.close()

    def request(self, path, payload=None, method=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method,
                                         headers={"content-type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as response:
            return response.code, json.loads(response.read())
        with response:
            return response.status, json.loads(response.read())

    def test_world_edits_tick_and_historical_snapshot_over_http(self):
        self.assertEqual(self.request("/api/world")[0], 404)
        code, created = self.request("/api/worlds", {"text": "院子里的商人", "use_model": False})
        self.assertEqual(code, 200)
        world_id, revision = created["world_id"], created["revision"]
        code, edited = self.request("/api/world/agents", {"name": "新来者", "location": created["locations"][0]["id"]})
        self.assertEqual(code, 200)
        self.assertEqual(len(edited["actors"]), len(created["actors"]) + 1)
        self.assertEqual(self.request("/api/world/tick", {}, "POST")[1]["tick"], 1)
        code, history = self.request(f"/api/world/history/{revision}?world_id={world_id}")
        self.assertEqual(code, 200)
        self.assertEqual(history["tick"], 0)
        self.assertEqual(len(history["actors"]), len(created["actors"]))
        self.assertEqual(len(self.request("/api/world/history")[1]["entries"]), 3)
        self.assertEqual(len(self.request("/api/worlds")[1]["worlds"]), 1)

    def test_model_failure_is_json_and_does_not_advance(self):
        self.request("/api/worlds", {"text": "院子里的商人"})
        def fail(spec):
            raise RuntimeError("provider unavailable")
        self.app.runner = fail
        code, error = self.request("/api/world/tick", {}, "POST")
        self.assertEqual(code, 503)
        self.assertIn("provider unavailable", error["error"])
        self.assertEqual(error["world"]["tick"], 0)
        self.assertTrue(error["world"]["simulation"]["waiting"])

    def test_status_does_not_publish_redis_credentials(self):
        with patch("kernel.server.provider_status", return_value={"configured": False, "model": ""}):
            code, status = self.request("/api/status")
        self.assertEqual(code, 200)
        self.assertIs(status["redis"], True)
        self.assertNotIn("ray", status)

    def test_invalid_control_and_history_requests_are_json(self):
        self.request("/api/worlds", {"text": "院子里的商人"})
        for payload in ({"running": "yes"}, {"running": True, "interval": 0}, {"running": True, "interval": float("nan")}):
            self.assertEqual(self.request("/api/world/run", payload)[0], 400)
        self.assertEqual(self.request("/api/world/history?limit=10000")[0], 400)
        self.assertEqual(self.request("/api/world/history/nope")[0], 400)

    def test_run_and_stop_state_are_owned_by_server(self):
        self.request("/api/worlds", {"text": "院子里的商人"})
        code, running = self.request("/api/world/run", {"running": True, "interval": 0.2})
        self.assertEqual(code, 200)
        self.assertTrue(running["simulation"]["running"])
        self.assertTrue(self.request("/api/world")[1]["simulation"]["running"])
        self.assertFalse(self.request("/api/world/run", {"running": False})[1]["simulation"]["running"])
