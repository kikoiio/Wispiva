import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

import redis


class RedisCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        executable = shutil.which("redis-server") or root / ".tools/redis/bin/redis-server"
        if not Path(executable).is_file():
            raise unittest.SkipTest("redis-server is required for the isolated store checks")
        (root / ".tmp").mkdir(exist_ok=True)
        cls.directory = tempfile.TemporaryDirectory(prefix="store-test-", dir=root / ".tmp")
        socket = str(Path(cls.directory.name) / "redis.sock")
        cls.process = subprocess.Popen(
            [str(executable), "--port", "0", "--unixsocket", socket,
             "--save", "", "--appendonly", "no", "--maxmemory", "32mb"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        cls.client = redis.Redis(unix_socket_path=socket, decode_responses=True)
        for _ in range(100):
            try:
                cls.client.ping()
                return
            except redis.ConnectionError:
                time.sleep(0.01)
        cls.tearDownClass()
        raise RuntimeError("isolated Redis did not start")

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.directory.cleanup()

    def setUp(self):
        self.client.flushdb()
