import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
run = Path(__file__).resolve().parent
env = dict(os.environ, TMPDIR=str(run))
scenario = sys.argv[1:]
logpath = run / 'artifacts' / ('godot-' + ('-'.join(scenario) or 'all') + '.log')
with logpath.open('w') as log:
    engine = subprocess.Popen(['godot', '--headless', '--path', 'world', '--audio-driver', 'Dummy'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.monotonic() + 30
        while 'WISPIVA_READY' not in logpath.read_text():
            if engine.poll() is not None or time.monotonic() > deadline:
                print(logpath.read_text())
                raise RuntimeError('Godot readiness failed')
            time.sleep(.1)
        started = time.monotonic()
        proof = subprocess.run(['node', '--experimental-strip-types', 'host/src/prove.ts', *scenario], cwd=root, env=env, timeout=600)
        print(f'Proof elapsed {time.monotonic() - started:.2f}s', flush=True)
        raise SystemExit(proof.returncode)
    finally:
        if engine.poll() is None:
            os.killpg(engine.pid, signal.SIGTERM)
        engine.wait(timeout=10)
