import copy
import json
import unittest
from unittest.mock import patch

from kernel.compile import compile_text
from kernel.decide import situation, model_decider
from kernel.sim import World


def world():
    return World.from_spec({
        'origin': 'ORIGIN_SECRET', 'mode': 'model',
        'locations': [{'id': 'x', 'name': '广场'}, {'id': 'y', 'name': '邻路'},
                      {'id': 'z', 'name': 'REMOTE_COORDINATES'}],
        'links': [['x', 'y'], ['y', 'z']],
        'agents': [{'id': 'a1', 'name': '甲', 'location': 'x'},
                   {'id': 'a2', 'name': '乙', 'location': 'x'},
                   {'id': 'a3', 'name': 'REMOTE_PERSON', 'location': 'z', 'goal': 'OTHER_GOAL'}],
        'rules': ['STRING_SECRET', {'text': 'DICT_SECRET'},
                  {'text': 'PUBLIC_NOTICE', 'public': True}],
        'relations': [{'a': 'a2', 'b': 'a3', 'kind': 'distrust'}],
    })


class PrivacyTests(unittest.TestCase):
    def test_prompt_only_includes_character_knowledge(self):
        w = world()
        prompt = situation(w, w.agents['a1'], [])
        for secret in ('ORIGIN_SECRET', 'REMOTE_COORDINATES', 'REMOTE_PERSON',
                       'OTHER_GOAL', 'STRING_SECRET', 'DICT_SECRET'):
            self.assertNotIn(secret, prompt)
        for known in ('甲', '乙', '邻路', 'PUBLIC_NOTICE'):
            self.assertIn(known, prompt)

    def test_decider_receives_only_observation(self):
        w = world()
        seen = []
        def decide(view, agent, messages):
            if agent['id'] == 'a1':
                seen.append(json.dumps(view.to_disk(), ensure_ascii=False))
            return {'action': 'wait'}
        w.run_agents(decider=decide)
        for secret in ('ORIGIN_SECRET', 'REMOTE_COORDINATES', 'REMOTE_PERSON', 'OTHER_GOAL', 'DICT_SECRET'):
            self.assertNotIn(secret, seen[0])

    def test_mail_roundtrip_keeps_sender_name_after_departure(self):
        w = world()
        w._speak(w.agents['a1'], 'a2', '信件')
        w.deliver_and_advance()
        w.remove_agent('a1')
        restored = World.from_spec(json.loads(json.dumps(w.to_disk())))
        self.assertEqual(restored.agents['a2']['incoming'][0]['sender_name'], '甲')
        restored.run_agents()
        self.assertTrue(any('来自甲' in m['text'] for m in restored.agents['a2']['memory']))

    def test_failed_or_invalid_late_plan_is_atomic(self):
        for bad in (None, {'action': 'fly'}, {'action': 'move'}, {'action': 'speak', 'target': []}, {'action': 'move', 'target': 'missing'}, 'error'):
            with self.subTest(bad=bad):
                w = world()
                w.agents['a1']['incoming'] = [{'from': 'a2', 'to': 'a1', 'text': '消息', 'sender_name': '乙'}]
                before = copy.deepcopy(w.to_disk())
                def decide(view, agent, messages):
                    if agent['id'] == 'a1':
                        return {'action': 'move', 'target': 'y'}
                    if bad == 'error':
                        raise RuntimeError('outage')
                    return bad
                with self.assertRaises(ValueError) as caught:
                    w.run_agents(decider=decide)
                self.assertEqual(type(caught.exception).__name__, 'SimulationBlocked')
                self.assertEqual(w.to_disk(), before)

    def test_events_are_not_truncated(self):
        w = world()
        for _ in range(71):
            w.tick()
        self.assertEqual(len(w.events), 213)
        self.assertEqual(len(w.snapshot()['events']), 213)
        self.assertEqual(len(w.to_disk()['events']), 213)

    def test_departed_id_is_never_reused(self):
        w = world()
        w.remove_agent('a3')
        w = World.from_spec(w.to_disk())
        w.add_agent('新', 'x')
        self.assertEqual(next(a['id'] for a in w.agents.values() if a['name'] == '新'), 'a4')

    def test_metadata_roundtrip(self):
        spec = world().to_disk()
        spec.update(mode='model', _revision=9, world_id='unique', next_agent_id=40,
                    simulation={'interval': 2}, archived_actors=[{'id': 'a39', 'name': '旧', 'place': 'x', 'hue': 50}])
        saved = World.from_spec(spec).to_disk()
        for key in ('mode', '_revision', 'world_id', 'next_agent_id', 'simulation', 'archived_actors'):
            self.assertEqual(saved.get(key), spec[key], key)

    def test_event_history_and_identity_survive_roundtrip(self):
        w = world()
        w.run_agents(decider=lambda v, a, m: {'action': 'move', 'target': 'y'} if a['id'] == 'a1' else {'action': 'wait'})
        moved = w.events[0]
        self.assertEqual((moved['location'], moved['from_location'], moved['to_location']), ('y', 'x', 'y'))
        self.assertEqual(moved['actor']['name'], '甲')
        w.remove_agent('a1')
        self.assertEqual(w.events[-1]['actor']['place'], 'y')
        for _ in range(70):
            w.tick()
        w._revision = 7
        w.world_id = 'identity'
        w.simulation = {'interval': 3}
        restored = World.from_spec(json.loads(json.dumps(w.to_disk())))
        self.assertEqual(len(restored.events), len(w.events))
        restored.add_agent('新', 'x')
        new = next(a for a in restored.agents.values() if a['name'] == '新')
        self.assertEqual(new['id'], 'a4')
        self.assertEqual(restored.snapshot()['archivedActors'][0]['id'], 'a1')
        self.assertEqual(restored.mode, 'model')
        self.assertEqual(restored.to_disk()['_revision'], 7)
        self.assertEqual(restored.to_disk()['world_id'], 'identity')
        self.assertEqual(restored.to_disk()['simulation'], {'interval': 3})
        self.assertEqual(restored.events[0], moved)
        # Over 200 events must survive both the live log and a second restore.
        for _ in range(70):
            restored.tick()
        self.assertGreater(len(restored.events), 200)
        self.assertEqual(len(World.from_spec(restored.to_disk()).events), len(restored.events))
        self.assertEqual(len(restored.snapshot()['events']), len(restored.events))

    def test_explicit_model_compile_never_falls_back(self):
        with patch('kernel.compile.chat_text', side_effect=RuntimeError('503')):
            with self.assertRaisesRegex(ValueError, '503'):
                compile_text('市集里有商人', use_model=True)
        with patch('kernel.compile.chat_text', return_value='{}'):
            with self.assertRaises(ValueError):
                compile_text('市集里有商人', use_model=True)
        self.assertEqual(compile_text('市集里有商人', use_model=False)['mode'], 'rules')

    def test_model_reply_with_wrong_field_types_blocks(self):
        w = world()
        before = copy.deepcopy(w.to_disk())
        with patch('kernel.decide.load_provider', return_value={'model': 'mock'}), \
             patch('kernel.decide.chat_text', return_value='{"action":"wait","line":{"secret":"x"}}'):
            with self.assertRaises(ValueError):
                w.run_agents(decider=model_decider)
        self.assertEqual(w.to_disk(), before)

    def test_model_compilation_keeps_public_flags_and_mode(self):
        payload = {'locations': [{'name': '广场'}], 'characters': [{'name': '甲', 'location': '广场'}],
                   'rules': ['私密规则', {'text': '公开规则', 'public': True}, {'text': '默认私密'}]}
        with patch('kernel.compile.chat_text', return_value=json.dumps(payload)):
            spec = compile_text('一个广场', use_model=True)
        self.assertEqual(spec['mode'], 'model')
        w = World.from_spec(spec)
        prompt = situation(w, next(iter(w.agents.values())), [])
        self.assertIn('公开规则', prompt)
        self.assertNotIn('私密规则', prompt)
        self.assertNotIn('默认私密', prompt)

    def test_own_relations_and_memories_are_visible_without_remote_location(self):
        w = world()
        w.agents['a1']['memory'] = [{'text': 'OWN_MEMORY'}]
        w.agents['a2']['memory'] = [{'text': 'OTHER_MEMORY'}]
        w.agents['a2']['goal'] = 'PRIVATE_LOCAL_GOAL'
        w.relations.append({'a': 'a1', 'b': 'a3', 'kind': 'trust'})
        prompts = []
        def fake_chat(system, prompt, **kwargs):
            prompts.append(prompt)
            return '{"action":"wait","line":"等候"}'
        with patch('kernel.decide.load_provider', return_value={'model': 'mock'}), \
             patch('kernel.decide.chat_text', side_effect=fake_chat):
            w.run_agents(decider=model_decider)
        self.assertIn('OWN_MEMORY', prompts[0])
        self.assertIn('REMOTE_PERSON', prompts[0])
        for private in ('REMOTE_COORDINATES', 'OTHER_MEMORY', 'PRIVATE_LOCAL_GOAL', 'ORIGIN_SECRET'):
            self.assertNotIn(private, prompts[0])

    def test_missing_model_blocks_instead_of_using_rules(self):
        w = world()
        with patch('kernel.decide.load_provider', return_value=None):
            with self.assertRaises(ValueError):
                w.run_agents(decider=model_decider)


if __name__ == '__main__':
    unittest.main()
