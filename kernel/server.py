"""Local HTTP interface to the persistent world and server-owned clock."""

from __future__ import annotations

import json
import os
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import redis

from kernel.art import attach
from kernel.controller import BusyError, Controller, StepError
from kernel.model import provider_status
from kernel.runtime import connect, shutdown
from kernel.sim import World
from kernel.store import ConflictError, list_history, list_worlds, load_revision

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / "view"
TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
}


class Handler(BaseHTTPRequestHandler):
    @property
    def app(self):
        return self.server.controller

    def do_GET(self):
        try:
            self._get()
        except (ValueError, TypeError) as error:
            self._json({"error": str(error)}, 400)
        except redis.RedisError:
            self._json({"error": "Redis 不可用，请检查本机存储服务"}, 503)

    def _get(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/status":
            self._json({**provider_status(), "redis": bool(self.app.client.ping()),
                        "scheduler_error": self.app.last_error})
            return
        if path == "/api/world":
            world = self.app.present()
            self._json(world or {"error": "还没有世界"}, 200 if world else 404)
            return
        if path == "/api/worlds":
            self._json({"worlds": list_worlds(self.app.client)})
            return
        if path.startswith("/api/world/history"):
            query = parse_qs(url.query)
            world_id = query.get("world_id", [""])[0]
            if not world_id:
                world = self.app.present()
                if world is None:
                    self._json({"error": "还没有世界"}, 404)
                    return
                world_id = world["world_id"]
            if path == "/api/world/history":
                offset = int(query.get("offset", [0])[0])
                limit = int(query.get("limit", [50])[0])
                self._json({"world_id": world_id, "entries": list_history(self.app.client, world_id, offset, limit)})
                return
            prefix = "/api/world/history/"
            if path.startswith(prefix):
                spec = load_revision(self.app.client, world_id, int(path[len(prefix):]))
                if spec is None:
                    self._json({"error": "没有这个历史节点"}, 404)
                    return
                payload = attach(World.from_spec(spec).snapshot())
                payload.update(world_id=spec["world_id"], revision=spec["_revision"], historical=True)
                self._json(payload)
                return
        if path.startswith("/api/"):
            self._json({"error": "没有这个接口"}, 404)
            return
        self._file("/index.html" if path == "/" else path)

    def do_POST(self):
        try:
            self._post()
        except (BusyError, ConflictError) as error:
            self._json({"error": str(error)}, 409)
        except (ValueError, TypeError, UnicodeError) as error:
            self._json({"error": str(error)}, 400)
        except StepError as error:
            self._json({"error": str(error), "world": self.app.present()}, 503)
        except redis.RedisError:
            self._json({"error": "Redis 不可用，请检查本机存储服务"}, 503)
        except RuntimeError as error:
            self._json({"error": str(error)[:300]}, 503)

    def _post(self):
        path = urlparse(self.path).path
        if path == "/api/worlds":
            body = self._body()
            use_model = body.get("use_model", False)
            if not isinstance(use_model, bool):
                raise ValueError("use_model 必须为布尔值")
            self._json(self.app.create(str(body.get("text") or ""), use_model))
            return
        if path == "/api/world/tick":
            self._json(self.app.step())
            return
        if path == "/api/world/run":
            body = self._body()
            self._json(self.app.set_running(body.get("running"), body.get("interval")))
            return
        if path == "/api/world/agents":
            body = self._body()
            self._json(self.app.add_agent(str(body.get("name") or ""), str(body.get("location") or ""), str(body.get("goal") or "")))
            return
        self._json({"error": "没有这个接口"}, 404)

    def do_DELETE(self):
        prefix = "/api/world/agents/"
        path = urlparse(self.path).path
        if not path.startswith(prefix):
            self._json({"error": "没有这个接口"}, 404)
            return
        try:
            self._json(self.app.remove_agent(unquote(path[len(prefix):])))
        except (BusyError, ConflictError) as error:
            self._json({"error": str(error)}, 409)
        except ValueError as error:
            self._json({"error": str(error)}, 400)
        except redis.RedisError:
            self._json({"error": "Redis 不可用，请检查本机存储服务"}, 503)

    def _body(self):
        length = int(self.headers.get("content-length") or 0)
        if not 0 <= length <= 1024 * 1024:
            raise ValueError("请求体不能超过 1 MiB")
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("请求体要是一个对象")
        return data

    def _json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _file(self, requested):
        file = (VIEW / unquote(requested).lstrip("/")).resolve()
        if VIEW.resolve() not in file.parents or not file.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("content-type", TYPES.get(file.suffix, "application/octet-stream"))
        self.send_header("cache-control", "no-cache")
        self.send_header("content-length", str(file.stat().st_size))
        self.end_headers()
        with file.open("rb") as source:
            while chunk := source.read(64 * 1024):
                self.wfile.write(chunk)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")


def main():
    os.chdir(ROOT)
    client = connect()
    client.ping()
    app = Controller(client)
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("PORT") or 4173)), Handler)
    server.controller = app
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        app.start()
        print(f"http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.close(wait=False)
        shutdown()
        app.close()
        server.server_close()
        client.close()


if __name__ == "__main__":
    main()
