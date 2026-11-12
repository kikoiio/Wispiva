#!/usr/bin/env python3
"""Cloud runtime check. Uses only a private Redis process and synthetic decisions."""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    if os.environ.get("CI") != "true" and os.environ.get("WISPIVA_ALLOW_LOCAL_HEAVY_CHECK") != "1":
        raise SystemExit("Run this Ray integration check in CI; local heavy checks need explicit authorization.")
    import redis
    from kernel.controller import Controller, StepError
    import ray
    from kernel.runtime import actors, shutdown
    from kernel.sim import World
    from kernel.store import list_history, load_world, save_world

    executable = shutil.which("redis-server")
    if not executable:
        raise SystemExit("redis-server is required")
    (ROOT / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="runtime-", dir=ROOT / ".tmp") as data, \
         tempfile.TemporaryDirectory(prefix="ws-ray-", dir="/var/tmp") as ray_data:
        os.environ["RAY_TMPDIR"] = ray_data
        socket = str(Path(data) / "redis.sock")
        process = subprocess.Popen([executable, "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no", "--maxmemory", "64mb"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        client = redis.Redis(unix_socket_path=socket, decode_responses=True)
        app = Controller(client)
        try:
            for _ in range(100):
                try:
                    client.ping()
                    break
                except redis.ConnectionError:
                    time.sleep(0.02)
            client.ping()
            # These two named characters speak without moving, across real Ray actors.
            world = World.from_spec({"name": "CI", "mode": "rules", "locations": [{"id": "yard", "name": "院子"}],
                "agents": [{"id": "a1", "name": "安", "location": "yard"}, {"id": "a2", "name": "柏", "location": "yard"}],
                "relations": [{"a": "a1", "b": "a2", "kind": "knows"}]})
            save_world(client, world.to_disk())
            first = app.step()
            assert first["tick"] == 1
            stored = load_world(client)
            assert stored["agents"][0]["incoming"], "delivery must survive the System commit"
            app.step()
            restored = load_world(client)
            assert any("收到来自" in memory["text"] for actor in restored["agents"] for memory in actor["memory"])
            assert len(list_history(client, restored["world_id"])) == 3
            # Exercise an actual actor restart without restarting or deleting Redis.
            shutdown()
            assert app.step()["tick"] == 3
            # A dead worker blocks this attempt, then a deliberate retry gets new handles.
            pod, _ = actors()
            ray.kill(pod, no_restart=True)
            try:
                app.step()
            except StepError:
                pass
            else:
                raise AssertionError("a dead worker should block its in-flight tick")
            assert app.present()["tick"] == 3
            assert app.step()["tick"] == 4
            # Failure after candidate planning must not commit even one phase.
            before = load_world(client)
            def fail_system(spec):
                raise RuntimeError("synthetic failure before commit")
            with patch("kernel.controller.Controller._advance", side_effect=fail_system):
                failing = Controller(client)
                try:
                    failing.step()
                except StepError:
                    pass
                else:
                    raise AssertionError("expected blocked tick")
            after = load_world(client)
            assert after["tick"] == before["tick"]
            assert after["events"] == before["events"]
            assert after["agents"] == before["agents"]
            print("Ray/Redis checks passed: delivery, restore, immutable history, actor restart/crash recovery, failure rollback.")
        finally:
            app.close()
            shutdown()
            client.close()
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
