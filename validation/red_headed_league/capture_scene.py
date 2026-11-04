#!/usr/bin/env python3
"""Capture a new product world's furnished Baker Street room in actual Luanti.

Run only after authorization for the GUI/CI workload. This is a visual fixture:
the normal genesis publication and product projection build the room; a worldmod
only fixes cameras/daylight and hides people/HUD to match the empty reference.
No real model is called and these images are not evidence of agent behavior.

All working files (including private creation records and logs) stay beneath
<repo>/.tmp/interior. --output must name a NEW directory; only two raw X11 PNGs
and an allowlisted summary are published there. Existing worlds are never used.
The capture budget is 95 seconds, with a further 25 for owned-process cleanup.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.luanti.control import send_command
from engine.luanti.recovery_journal import MARKER_FILE
from genesis.store import DraftStore
from genesis.world_create import create_world


FIXTURE = Path(__file__).resolve().parent
REFERENCE = ROOT / "docs/references/red-headed-league/baker-sitting-room-reference.png"
BLUEPRINT = "victorian_sitting_room_v1"
PLAYER = "rhl_capture"
PORT = 30087
WIDTH, HEIGHT = 1536, 960
VIEWS = {"reference": "baker-reference-view.png", "reverse": "baker-reverse-view.png"}


class CaptureError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise CaptureError(message)


def remaining(deadline):
    seconds = deadline - time.monotonic()
    require(seconds > 0, "capture deadline exceeded")
    return seconds


def read_log(path):
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def failure_diagnostics(work):
    # Only engine errors from this disposable, credential-free fixture. Never
    # print full logs or model/draft content into the public Actions output.
    for name in ("server.log", "resume.log", "world/private/product.log", "client-launch.log", "client.log", "xvfb.log"):
        lines = [line for line in read_log(work / name).splitlines()
                 if ("ERROR[" in line or "Error:" in line or "error:" in line
                     or "Error " in line or "SOCIETY fail=" in line
                     or "launch:" in line or "launch.py:" in line or "wispiva launcher:" in line
                     or "run_product.sh:" in line or "product-world frozen" in line)]
        for line in lines[-12:]:
            print(f"capture diagnostic ({name}): {line[:700]}", file=sys.stderr)
    # Session and checkpoint status only; no actor identity, memories or text.
    marker = work / "world" / MARKER_FILE
    print(f"capture diagnostic: session marker exists={marker.exists()}", file=sys.stderr)


class Processes:
    """Only signal groups created by this invocation via start_new_session."""

    def __init__(self, cleanup_deadline):
        self.items = []
        self.cleanup_deadline = cleanup_deadline

    def start(self, name, command, *, env, cwd, log, pass_fds=()):
        with log.open("wb") as stream:
            process = subprocess.Popen(
                command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, start_new_session=True, pass_fds=pass_fds,
            )
        self.items.append((name, process))
        return process

    def check(self):
        for name, process in self.items:
            status = process.poll()
            require(status is None, f"{name} exited before capture completed (status {status})")

    @staticmethod
    def group_members(process):
        members = []
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                # comm may contain spaces/parentheses; pgrp follows state/ppid.
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                if int(fields[2]) == process.pid and fields[0] not in ("Z", "X"):
                    members.append(int(entry.name))
            except (FileNotFoundError, ProcessLookupError):
                pass
        return members

    @staticmethod
    def signal_group(process, signum):
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            pass

    def stop(self, name, process):
        problems = []
        status = process.poll()
        if status is not None:
            problems.append(f"{name} exited unexpectedly (status {status})")
        else:
            try:
                if name == "Luanti client":
                    # Stop the actual client first so view_product.sh can
                    # reap it. Killing a shell and child simultaneously can
                    # orphan a zombie in CI containers without a reaper.
                    children = [pid for pid in self.group_members(process) if pid != process.pid]
                    for pid in children:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                    if not children:
                        process.terminate()
                elif name == "product server":
                    # Let the engine exit normally, then let the launcher
                    # finish durable verification. The wrapper's TERM trap
                    # exits 143 and can mask a failed launcher exit status.
                    engines = []
                    for pid in self.group_members(process):
                        try:
                            if Path(f"/proc/{pid}/comm").read_text().strip() == "luantiserver":
                                engines.append(pid)
                        except FileNotFoundError:
                            pass
                    if engines:
                        for pid in engines:
                            os.kill(pid, signal.SIGTERM)
                    else:
                        process.terminate()
                else:
                    # run_product.sh traps TERM and checkpoints its server;
                    # Xvfb is a direct child with no wrapper.
                    process.terminate()
            except ProcessLookupError:
                pass
        try:
            status = process.wait(timeout=max(0.1, min(8, self.cleanup_deadline - time.monotonic() - 3)))
        except subprocess.TimeoutExpired:
            problems.append(f"{name} required forced shutdown")
            self.signal_group(process, signal.SIGKILL)
            status = process.wait(timeout=1)
        if status not in (0, -signal.SIGTERM, 128 + signal.SIGTERM):
            problems.append(f"{name} shutdown failed (status {status})")
        if self.group_members(process):
            # A wrapper may already have exited while a descendant remains.
            # This group belongs to us; never pgrep/pkill other tasks.
            self.signal_group(process, signal.SIGTERM)
            until = min(self.cleanup_deadline - 1, time.monotonic() + 1)
            while self.group_members(process) and time.monotonic() < until:
                time.sleep(0.05)
            if self.group_members(process):
                self.signal_group(process, signal.SIGKILL)
                problems.append(f"{name} left descendants after shutdown")
        return problems

    def close(self):
        problems = []
        # Client, server wrapper + its fixture worker, then Xvfb. Even a failed
        # shutdown must not prevent cleanup of the other owned process groups.
        for name, process in reversed(self.items):
            try:
                problems.extend(self.stop(name, process))
            except Exception as exc:
                self.signal_group(process, signal.SIGKILL)
                problems.append(f"{name} cleanup error: {exc}")
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    problems.append(f"{name} still did not exit after SIGKILL")
        require(not problems, "; ".join(problems))


def wait_for(predicate, *, processes, deadline, product_log, description):
    while True:
        require(time.monotonic() < deadline, f"timed out waiting for {description}")
        processes.check()
        require("SOCIETY fail=" not in read_log(product_log), "product runtime reported failure")
        if predicate():
            return
        time.sleep(min(0.1, remaining(deadline)))


def prepare_world(work):
    draft = json.loads((FIXTURE / "moment.json").read_text(encoding="utf-8"))
    baker = next((place for place in draft["layout"]["places"] if place["placeId"] == "baker"), {})
    require(baker.get("blueprint") == BLUEPRINT, "moment.json must select the Baker sitting-room blueprint")
    world = work / "world"
    store = DraftStore(work / "drafts.sqlite", create=True)
    try:
        record = store.create(draft)
        store.confirm(record["id"], record["revision"], work / "origin.sqlite")
        create_world(store, record["id"], record["revision"], world)
    finally:
        store.close()
    # Fail if an old compiler silently discarded the blueprint declaration.
    manifest = json.loads((world / "private/wispiva-origin.json").read_text(encoding="utf-8"))
    compiled = next(place for place in manifest["public"]["places"] if place["id"] == "baker")
    require(compiled.get("blueprint") == BLUEPRINT, "published product world lost its interior blueprint")
    mod = world / "worldmods/wispiva_scene_capture"
    mod.mkdir(mode=0o700)
    (mod / "mod.conf").write_text(
        "name = wispiva_scene_capture\n"
        "description = Isolated empty-room screenshot fixture, not model evidence\n"
        "depends = society, default, player_api\n", encoding="utf-8",
    )
    shutil.copyfile(FIXTURE / "scene_capture.lua", mod / "init.lua")
    (world / "rhl-capture-fixture").write_text("wispiva-interior-reference-v1\n", encoding="utf-8")
    with (world / "world.mt").open("a", encoding="utf-8") as stream:
        stream.write("load_mod_wispiva_scene_capture = true\n")
    return world


def image_info(path):
    require(path.is_file() and path.stat().st_size > 1024, "screenshot missing or too small")
    with path.open("rb") as stream:
        header = stream.read(24)
    require(header[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "capture is not a PNG")
    width, height = struct.unpack(">II", header[16:24])
    require((width, height) == (WIDTH, HEIGHT), "unexpected screenshot dimensions")
    return {"file": path.name, "width": width, "height": height,
            "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def capture(output):
    started = time.monotonic()
    deadline = started + 95
    processes = Processes(started + 120)
    rt = Path(os.environ.get("LUANTI_RT", ROOT / "engine/luanti/.runtime")).resolve()
    for program in ("Xvfb", "import"):
        require(shutil.which(program), f"required program unavailable: {program}")
    for program in ("luanti", "luantiserver"):
        require(os.access(rt / "root/usr/libexec/luanti" / program, os.X_OK), f"runtime {program} unavailable")
    require(REFERENCE.is_file(), "generated room reference is missing")
    # Reserve a brand new artifact directory. Do not overwrite earlier evidence.
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    scratch = ROOT / ".tmp/interior"
    scratch.mkdir(parents=True, mode=0o700, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="capture-", dir=scratch))
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("LLM_") or key in ("MODEL_NAME", "OPENAI_API_KEY", "WAYLAND_DISPLAY"):
            env.pop(key)
    env.update({"TMPDIR": str(work), "LUANTI_RT": str(rt), "WISPIVA_PROVIDER_FORM": "0",
                "XDG_CONFIG_HOME": str(work / "config"), "XDG_CACHE_HOME": str(work / "cache"),
                "LIBGL_ALWAYS_SOFTWARE": "1", "GALLIUM_DRIVER": "llvmpipe",
                "LP_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "LC_ALL": "C.UTF-8"})
    product_log = work / "world/private/product.log"
    images = []
    failure = None
    try:
        world = prepare_world(work)
        display_file = work / "display-number"
        with display_file.open("wb") as descriptor:
            processes.start("Xvfb", ["Xvfb", "-displayfd", str(descriptor.fileno()), "-ac", "-noreset",
                            "-screen", "0", f"{WIDTH}x{HEIGHT}x24", "-nolisten", "tcp"],
                            env=env, cwd=work, log=work / "xvfb.log", pass_fds=(descriptor.fileno(),))
        wait_for(lambda: display_file.read_text().strip().isdigit(), processes=processes,
                 deadline=deadline, product_log=product_log, description="X display")
        env["DISPLAY"] = ":" + display_file.read_text().strip()
        processes.start("product server", [str(ROOT / "engine/luanti/run_product.sh"),
                        "--world", str(world), "--serve", "--fake-model", "--model-workers", "1",
                        "--no-view-guide", "--no-resource-nodes", "--speed", "0",
                        "--reflection-every", "0", "--port", str(PORT)],
                        env=env, cwd=ROOT, log=work / "server.log")
        wait_for(lambda: "SOCIETY origin projection " in read_log(product_log)
                 and "SOCIETY spawn count=" in read_log(product_log), processes=processes,
                 deadline=deadline, product_log=product_log, description="product projection")
        paused = send_command(world, "pause", timeout=min(5, remaining(deadline)))
        require(paused["ok"] and paused["status"]["paused"] and paused["status"]["rate"] == 0
                and paused["status"]["pending_models"] == 0, "product decisions did not freeze")
        frozen_time = paused["status"]["logical_time"]
        client_config = work / "client.conf"
        client_config.write_text(
            f"screen_w = {WIDTH}\nscreen_h = {HEIGHT}\nfullscreen = true\n"
            "enable_sound = false\nvideo_driver = opengl\nenable_shaders = false\n"
            "enable_dynamic_shadows = false\nenable_clouds = false\nenable_3d_clouds = false\n"
            "enable_fog = false\nshow_debug = false\nshow_chat = false\n"
            "fps_max = 30\nfps_max_unfocused = 30\nviewing_range = 40\n"
            "num_emerge_threads = 1\n", encoding="utf-8",
        )
        processes.start("Luanti client", [str(ROOT / "engine/luanti/view_product.sh"),
                        "--port", str(PORT), "--name", PLAYER, "--config", str(client_config),
                        "--logfile", str(work / "client.log")],
                        env=env, cwd=ROOT, log=work / "client-launch.log")
        wait_for(lambda: f"RHL_CAPTURE client-connected player={PLAYER}" in read_log(product_log),
                 processes=processes, deadline=deadline, product_log=product_log, description="client join")
        for view, filename in VIEWS.items():
            marker = f"RHL_CAPTURE camera-ready id={view} player={PLAYER}"
            wait_for(lambda: marker in read_log(product_log), processes=processes,
                     deadline=deadline, product_log=product_log, description=f"{view} camera")
            path = work / filename
            with (work / "import.log").open("ab") as log:
                subprocess.run(["import", "-window", "root", str(path)], env=env, cwd=work,
                               stdout=log, stderr=log, check=True, timeout=min(8, remaining(deadline)))
            processes.check()
            images.append(image_info(path))
            if view == "reference":
                # Handshake holds the first camera until the PNG is complete;
                # slow CI cannot accidentally capture the second view twice.
                with (world / "rhl-capture-next").open("x", encoding="utf-8") as stream:
                    stream.write("reverse\n")
        require(images[0]["sha256"] != images[1]["sha256"], "both cameras produced identical images")
        status = send_command(world, "status", timeout=min(5, remaining(deadline)))
        require(status["ok"] and status["status"]["paused"]
                and status["status"]["logical_time"] == frozen_time
                and status["status"]["pending_models"] == 0, "world advanced during screenshot fixture")
        require("SOCIETY ev=model-request " not in read_log(product_log), "fixture unexpectedly requested model work")
        require("SOCIETY fail=" not in read_log(product_log), "product runtime reported failure")
    except BaseException as exc:
        failure = exc
        failure_diagnostics(work)
        raise
    finally:
        try:
            processes.close()
        except Exception as cleanup_error:
            if failure is not None:
                raise CaptureError(f"{failure}; cleanup failed: {cleanup_error}") from None
            raise
    # Publish only after screenshots AND process cleanup succeed. Never copy the
    # private draft/manifest, world database, logs or worker spool to artifacts.
    require(time.monotonic() - started <= 120, "capture exceeded its total time budget")
    final_log = read_log(product_log)
    require("SOCIETY product-checkpoint commit " in final_log
            and "SOCIETY fail=" not in final_log, "product did not checkpoint cleanly on shutdown")
    require(not (world / MARKER_FILE).exists(), "launcher retained a recovery marker after capture")
    # Reload the same committed map, rather than treating a successful first
    # projection as proof that furniture/rug orientations survive persistence.
    resumed = Processes(started + 120)
    try:
        resumed.start("product server", [str(ROOT / "engine/luanti/run_product.sh"),
                      "--world", str(world), "--serve", "--resume", "--fake-model",
                      "--no-view-guide", "--no-resource-nodes", "--speed", "0",
                      "--reflection-every", "0", "--port", str(PORT)],
                      env=env, cwd=ROOT, log=work / "resume.log")
        wait_for(lambda: "SOCIETY origin projection verified " in read_log(product_log)
                 and "SOCIETY spawn count=" in read_log(product_log), processes=resumed,
                 deadline=deadline, product_log=product_log, description="saved room recovery")
        status = send_command(world, "status", timeout=min(5, remaining(deadline)))
        require(status["ok"] and status["status"]["paused"]
                and status["status"]["logical_time"] == frozen_time
                and status["status"]["pending_models"] == 0, "saved room time changed on recovery")
    except BaseException:
        failure_diagnostics(work)
        raise
    finally:
        try:
            resumed.close()
        except Exception:
            failure_diagnostics(work)
            raise
    final_log = read_log(product_log)
    require("SOCIETY product-checkpoint commit " in final_log
            and "SOCIETY fail=" not in final_log, "recovered room did not checkpoint cleanly")
    summary = {
        "format": "wispiva-interior-capture", "version": 1,
        "fixture": "empty-room visual comparison; no AI behavior evidence",
        "blueprint": BLUEPRINT, "actual_luanti_client_connected": True,
        "camera_ready": list(VIEWS), "world_created_from_confirmed_moment": True,
        "decisions_paused": True, "real_model_calls": 0, "owned_processes_stopped": True,
        "product_checkpoint_committed": True,
        "saved_room_and_orientations_recovered": True,
        "mod_storage_backend": "sqlite3" if (world / "mod_storage.sqlite").is_file() else "files",
        "rendering": "Xvfb / Mesa llvmpipe / OpenGL; unmodified root-window captures",
        "people_and_hud_hidden": True, "lighting": "fixed noon daylight; no clouds",
        "reference": {"file": str(REFERENCE.relative_to(ROOT)), "generated": True,
                      "sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest()},
        "scene_capture_sha256": hashlib.sha256((FIXTURE / "scene_capture.lua").read_bytes()).hexdigest(),
        "git_sha": os.environ.get("GITHUB_SHA"), "screenshots": images,
    }
    for filename in VIEWS.values():
        shutil.copyfile(work / filename, output / filename)
    (output / "capture-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="new directory for public PNGs and summary only")
    args = parser.parse_args(argv)
    os.umask(0o077)
    def interrupted(signum, _frame):
        raise CaptureError(f"capture interrupted by signal {signum}")
    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        capture(args.output.absolute())
    except Exception as exc:
        # Private engine logs remain in .tmp/interior, never printed or uploaded.
        print(f"interior capture failed: {exc}", file=sys.stderr)
        return 1
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    print("Captured two actual Luanti room views; visual fixture only, no model evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
