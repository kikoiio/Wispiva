"""Fail-closed checkpoint interruption checks in disposable CI worlds only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from engine.luanti.control import send_command
from engine.luanti.launch import _checkpoint_fields, _verify_product_checkpoint, recover_committed_checkpoint
from engine.luanti.recovery_journal import RecoveryRequired
from validation.red_headed_league.capture_scene import Processes, prepare_world, require, read_log


def run():
    os.umask(0o077)
    root = ROOT / '.tmp/checkpoint-faults'
    root.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(dir=root))
    world = prepare_world(work)
    shutil.rmtree(world / 'worldmods/wispiva_scene_capture')
    with (world / 'world.mt').open('a') as f:
        f.write('load_mod_wispiva_scene_capture = false\n')
    env = dict(os.environ, WISPIVA_PROVIDER_FORM='0')
    for name in list(env):
        if name.startswith('LLM_') or name in ('MODEL_NAME', 'OPENAI_API_KEY'):
            env.pop(name)
    base = [str(ROOT / 'engine/luanti/run_product.sh'), '--world', str(world), '--fake-model',
            '--reflection-every', '0', '--model-workers', '1', '--interval', '0.5',
            '--no-resource-nodes', '--port', '30089']
    initial = subprocess.run(base + ['--seconds', '30', '--decisions', '1', '--speed', '1'],
                             env=env, cwd=ROOT, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, timeout=50)
    require(initial.returncode == 0, 'fixture did not checkpoint cleanly')
    identity = (world / 'wispiva-world-id').read_text().strip()
    _verify_product_checkpoint(world, identity)
    fields, _ = _checkpoint_fields(world)
    require(json.loads(fields['agent_state'])['version'] == 2, 'fixture is not narrative checkpoint v2')
    backup = work / 'committed'
    shutil.copytree(world, backup, symlinks=True)
    summary = {'format': 'wispiva-checkpoint-interruptions', 'version': 1,
               'model': 'deterministic fixture; no provider calls', 'stages': {}}
    for stage in ('after_map', 'after_environment', 'after_agents', 'before_commit', 'after_commit'):
        processes = Processes(time.monotonic() + 50)
        process = processes.start('product server', base + ['--serve', '--resume', '--fault-stage', stage],
                                  env=env, cwd=ROOT, log=work / (stage + '.log'))
        log = world / 'private/product.log'
        try:
            if stage == 'after_map':
                require(process.wait(timeout=35) != 0, 'startup fault unexpectedly succeeded')
                require(not processes.group_members(process), 'startup fault left descendants')
            else:
                deadline = time.monotonic() + 30
                while 'SOCIETY spawn count=' not in read_log(log):
                    require(process.poll() is None, 'fault server exited before shutdown')
                    require(time.monotonic() < deadline, 'fault server did not become ready')
                    time.sleep(0.1)
                send_command(world, 'pause', timeout=5)
                problems = processes.stop('product server', process)
                require(problems == ['product server shutdown failed (status 1)'],
                        'unexpected interruption cleanup: ' + repr(problems))
            processes.items.clear()
            require('injected-fault stage=' + stage in read_log(log), 'requested fault did not execute')
            marker = world / 'wispiva-session-recovery.json'
            require(marker.exists(), 'incomplete checkpoint lost its marker')
            try:
                recover_committed_checkpoint(world, expected_world_id=identity)
            except RecoveryRequired:
                pass
            else:
                raise RuntimeError('incomplete checkpoint was accepted: ' + stage)
            require(marker.exists(), 'rejected recovery removed the marker')
            summary['stages'][stage] = {'interruption_observed': True, 'recovery_rejected': True,
                                        'marker_retained': True, 'owned_processes_exited': True}
        finally:
            processes.close()
        world.rename(work / ('interrupted-' + stage))
        shutil.copytree(backup, world, symlinks=True)
    output = root / 'artifacts'
    output.mkdir(exist_ok=False)
    (output / 'checkpoint-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    run()
