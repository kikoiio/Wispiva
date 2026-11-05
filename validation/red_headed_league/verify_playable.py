"""Real-provider acceptance with an automated, connected Luanti player.

Run on CI. Private worlds, model inputs, and dialogue never become artifacts.
The test mod moves the player and submits production forms; NPC decisions are
unmodified model proposals validated by the production executor.
"""
import argparse
from collections import Counter
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from engine.luanti.control import send_command
from engine.luanti.launch import _checkpoint_fields, _verify_product_checkpoint
from validation.red_headed_league.capture_scene import Processes, prepare_world, require, read_log


def checkpoint(world):
    fields, _ = _checkpoint_fields(world)
    _verify_product_checkpoint(world, (world / 'wispiva-world-id').read_text().strip())
    return json.loads(fields['agent_state'])


def run(output, budget):
    os.umask(0o077)
    scratch = ROOT / '.tmp/playable'
    scratch.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(dir=scratch))
    env = dict(os.environ)
    env.pop('WAYLAND_DISPLAY', None)
    env['WISPIVA_PROVIDER_FORM'] = '0'
    require(all(env.get(k) for k in ('LLM_BASE_URL', 'MODEL_NAME', 'LLM_API_KEY')),
            'configured provider variables are required')
    world = prepare_world(work)
    shutil.rmtree(world / 'worldmods/wispiva_scene_capture')
    with (world / 'world.mt').open('a') as f:
        f.write('load_mod_wispiva_scene_capture = false\nload_mod_wispiva_playable_probe = true\n')
    mod = world / 'worldmods/wispiva_playable_probe'
    mod.mkdir()
    (mod / 'mod.conf').write_text('name = wispiva_playable_probe\ndepends = society, default, player_api\n')
    shutil.copyfile(Path(__file__).with_name('playable_probe.lua'), mod / 'init.lua')
    (world / 'rhl-playable-probe').write_text('automated-player-v1\n')
    started = time.monotonic()
    deadline = started + budget
    processes = Processes(deadline + 25)
    log = world / 'private/product.log'
    last_progress = [0]

    def wait(predicate, label):
        while time.monotonic() < deadline:
            processes.check()
            text = read_log(log)
            if time.monotonic() - last_progress[0] >= 30:
                last_progress[0] = time.monotonic()
                print(json.dumps({'waiting_for': label,
                                  'model_actions': text.count('ev=model-action '),
                                  'model_attempts': text.count('ev=model-attempt '),
                                  'player_messages_sent': text.count('player-message=true'),
                                  'two_replies': 'two-distinct-replies-and-journal=true' in text,
                                  'story_events': text.count('ev=story-object ')}), flush=True)
            require('SOCIETY fail=' not in text, 'runtime failure during ' + label)
            if predicate(text):
                return
            time.sleep(0.25)
        text = read_log(log)
        print(json.dumps({'incomplete': label, 'model_actions': text.count('ev=model-action '),
                          'model_attempts': text.count('ev=model-attempt '),
                          'investigated': 'investigation-and-journal=true' in text,
                          'two_replies': 'two-distinct-replies-and-journal=true' in text,
                          'story_events': text.count('ev=story-object '),
                          'action_kinds': dict(Counter(re.findall(r'ev=model-action agent=\d+ request=\d+ kind=([a-z_]+)', text))),
                          'attempt_errors': dict(Counter(re.findall(r'ev=model-attempt .*?error=([a-z_]+)', text)))}), flush=True)
        raise RuntimeError('acceptance deadline: ' + label)

    try:
        display = work / 'display'
        with display.open('wb') as fd:
            processes.start('Xvfb', ['Xvfb', '-displayfd', str(fd.fileno()), '-ac', '-noreset',
                            '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
                            env=env, cwd=ROOT, log=work / 'xvfb.log', pass_fds=(fd.fileno(),))
        wait(lambda _: display.read_text().strip().isdigit(), 'display')
        env['DISPLAY'] = ':' + display.read_text().strip()
        base = [str(ROOT / 'engine/luanti/run_product.sh'), '--world', str(world), '--serve',
                '--model-workers', '1', '--interval', '3', '--reflection-every', '3',
                '--no-resource-nodes', '--port', '30088']
        processes.start('product server', base + ['--speed', '1', '--audit-model'],
                        env=env, cwd=ROOT, log=work / 'server.log')
        wait(lambda text: 'SOCIETY spawn count=' in text, 'projection')
        config = work / 'client.conf'
        config.write_text('screen_w = 1280\nscreen_h = 800\nenable_sound = false\n'
                          'fps_max = 15\nfps_max_unfocused = 15\nenable_shaders = false\n'
                          'enable_dynamic_shadows = false\nnum_emerge_threads = 1\n')
        processes.start('Luanti client', [str(ROOT / 'engine/luanti/view_product.sh'),
                        '--port', '30088', '--name', 'rhl_acceptance', '--config', str(config),
                        '--logfile', str(work / 'client.log')], env=env, cwd=ROOT,
                        log=work / 'client-launch.log')
        wait(lambda text: 'RHL_PLAYABLE complete=true' in text, 'player replies and model consequence')
        send_command(world, 'pause', timeout=10)
    finally:
        processes.close()
    first_log = read_log(log)
    balance = re.findall(r'resource-verify [^\n]*?ok=(true|false)', first_log)
    require(balance and all(value == 'true' for value in balance), 'resource reconciliation failed')
    first = checkpoint(world)
    require(not (world / 'wispiva-session-recovery.json').exists(), 'unclean first shutdown')
    narrative = first['narrative']
    interactions = narrative['interactions']
    replies = [x for x in interactions if x['kind'] == 'reply']
    addresses = [x for x in interactions if x['kind'] == 'address']
    require(len(replies) == 2 and len(addresses) == 2, 'conversation count mismatch')
    require(all(x['status'] == 'answered' for x in addresses), 'unanswered player input')
    require(len({x['text'] for x in replies}) == 2, 'identical replies')
    require(any(x['kind'] == 'object_transition' for x in interactions), 'no narrative consequence')
    for reply in replies:
        require(reply['source']['id'] == 'holmes' and reply['audience']['id'] == 'rhl_acceptance',
                'private reply audience mismatch')
    seen_messages = set()
    audited_requests = 0
    for path in (world / 'private/model-audit').glob('*/request-*.json'):
        request = json.loads(path.read_text())
        envelope = request['context']['model_input']
        audited_requests += 1
        for item in envelope['knowledge'].get('rumors') or []:
            if item['source']['kind'] == 'player_message':
                require(envelope['actor']['id'] == 'holmes', 'player message reached another actor')
                require(item['access']['scope'] in ('direct', 'private') and
                        item['access']['audience'] == ['holmes'], 'incorrect message scope')
                if item['access']['scope'] == 'direct':
                    seen_messages.add(item['source']['id'])
    require({x['id'] for x in addresses} <= seen_messages, 'player input absent from provider audit')
    attempt_errors = Counter()
    for path in (world / 'private/model-audit').glob('*/response-*.json'):
        response = json.loads(path.read_text())
        attempts = response.get('attempts') or []
        require(len(attempts) <= 3, 'worker retry hard ceiling exceeded')
        attempt_errors.update(x.get('error') or 'none' for x in attempts)
    public_events = json.dumps(first['world_events'], ensure_ascii=False)
    require(all(x['text'] not in public_events for x in addresses + replies),
            'private conversation text appeared in public event records')
    # Prevent a new test conversation on reload; the production narrative state
    # must survive without the driving mod being present.
    with (world / 'world.mt').open('a') as f:
        f.write('load_mod_wispiva_playable_probe = false\n')
    processes = Processes(time.monotonic() + 65)
    deadline = time.monotonic() + 40
    try:
        processes.start('product server', base + ['--resume', '--speed', '0'],
                        env=env, cwd=ROOT, log=work / 'resume.log')
        wait(lambda text: 'SOCIETY spawn count=' in text and 'origin projection verified' in text,
             'same-world recovery')
        status = send_command(world, 'status', timeout=10)
        require(status['status']['paused'] and status['status']['pending_models'] == 0,
                'recovery was not paused')
    finally:
        processes.close()
    second = checkpoint(world)
    expected_narrative = copy.deepcopy(first['narrative'])
    for operation in (expected_narrative.get('operations') or {}).values():
        operation['receipt']['checkpointed'] = True
    require(expected_narrative == second['narrative'],
            'narrative content changed across paused recovery')
    for key in ('long_term', 'world_events'):
        require(first[key] == second[key], key + ' changed across paused recovery')
    require(not (world / 'wispiva-session-recovery.json').exists(), 'unclean recovered shutdown')
    processes = Processes(time.monotonic() + 205)
    deadline = time.monotonic() + 180
    try:
        processes.start('product server', base + ['--resume', '--speed', '1'],
                        env=env, cwd=ROOT, log=work / 'continued.log')
        wait(lambda text: 'ev=model-action ' in text, 'model continuation after recovery')
        send_command(world, 'pause', timeout=10)
    finally:
        processes.close()
    continued = checkpoint(world)
    require(continued['narrative'] == second['narrative'],
            'answered conversations or completed object transition replayed after recovery')
    require(not (world / 'wispiva-session-recovery.json').exists(), 'unclean continued shutdown')
    output.mkdir(parents=True, exist_ok=False)
    summary = {'format': 'wispiva-playable-acceptance', 'version': 1,
               'driver': 'automated connected player; teleports and production form callbacks',
               'model': env['MODEL_NAME'], 'real_model': True,
               'human_playtest': False, 'investigation_and_journal': True,
               'private_player_messages': len(addresses), 'distinct_model_replies': len(replies),
               'changed_world_node': True, 'same_world_clean_recovery': True,
               'narrative_memory_events_unchanged_on_recovery': True,
               'real_model_continued_after_recovery': True,
               'model_actions': first_log.count('ev=model-action '),
               'model_attempts': first_log.count('ev=model-attempt '),
               'audited_requests': audited_requests, 'direct_message_scope_verified': True,
               'private_text_absent_from_public_events': True,
               'retry_ceiling_verified': True, 'attempt_errors': dict(attempt_errors),
               'conversation_digest': hashlib.sha256(json.dumps(interactions, sort_keys=True).encode()).hexdigest(),
               'elapsed_seconds': round(time.monotonic() - started, 1)}
    (output / 'playable-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--budget', type=int, default=600)
    args = parser.parse_args()
    run(args.output, args.budget)
