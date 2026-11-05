import copy
import json
import unittest
from pathlib import Path
from unittest import mock
from genesis.genesis import GenesisError, actor_memories, generate, parse_json, public_view, validate
from genesis.model_adapter import responses_model
from model.adapter import Config, ModelError


def draft():
    return {'schemaVersion': 1, 'title': '河谷', 'description': '一个河谷',
            'places': [{'id': 'bank', 'name': '岸', 'description': '河岸'}],
            'actors': [{'id': 'a', 'name': '甲', 'role': '旅人', 'goal': '找到住处', 'placeId': 'bank'}],
            'memories': [{'actorId': 'a', 'text': '私人的经历'}], 'rules': [],
            'layout': {'places': [{'placeId': 'bank', 'space': 'outdoor', 'grid': [0, 0]}], 'connections': []}}


def scene_draft():
    value = draft()
    value['schemaVersion'] = 2
    value['layout']['places'][0] = {
        'placeId': 'bank', 'space': 'indoor', 'grid': [0, 0],
        'scene': {'version': 1, 'palette': 'study', 'furnishings': [
            {'kind': 'armchair', 'at': [-3, 1], 'facing': 'east', 'basis': 'inferred'}]}}
    return value

class GenesisTests(unittest.TestCase):
    def test_story_object_schema_and_validator_accept_the_red_headed_league_fixture(self):
        schema_dir = Path(__file__).parent
        moment = json.loads((schema_dir.parent / 'validation' / 'red_headed_league' / 'moment.json')
                            .read_text(encoding='utf-8'))
        self.assertEqual(validate(moment), [])
        for name in ('schema.json', 'scene_schema.json'):
            schema = json.loads((schema_dir / name).read_text(encoding='utf-8'))
            self.assertIn('storyObjects', schema['properties'])
            self.assertNotIn('storyObjects', schema['required'])
            self.assertEqual(schema['properties']['storyObjects']['maxItems'], 16)
            self.assertEqual(set(schema['$defs']['storyObject']['required']), {
                'id', 'placeId', 'at', 'node', 'label', 'reach', 'initialState',
                'states', 'renderByState', 'facets', 'grants', 'transitions'})
            self.assertFalse(schema['$defs']['storyObject']['additionalProperties'])

    def test_vertical_level_is_indoor_and_connects_at_the_same_grid(self):
        value = draft()
        value['places'][0]['name'] = 'Shop'
        value['layout']['places'][0]['space'] = 'indoor'
        value['places'].append({'id': 'cellar', 'name': 'Cellar', 'description': 'Below the shop'})
        value['layout']['places'].append({
            'placeId': 'cellar', 'space': 'indoor', 'grid': [0, 0], 'level': -1})
        value['layout']['connections'] = [{'from': 'bank', 'to': 'cellar'}]
        self.assertEqual(validate(value), [])
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][1]['grid'] = [0, 1]
        self.assertIn('vertical_connection', {e['code'] for e in validate(invalid)})
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][1]['space'] = 'outdoor'
        self.assertIn('level_space', {e['code'] for e in validate(invalid)})

    def test_scene_generation_uses_v2_schema_and_text_only_narrative_prompt(self):
        seen = []
        def model(system, user):
            seen.append((system, json.loads(user)))
            return json.dumps(scene_draft(), ensure_ascii=False)
        result = generate('一间适合侦探会客的书房', model, scene=True)
        self.assertEqual(result, scene_draft())
        self.assertIn('narrative intent', seen[0][0])
        self.assertIn('derive the room design from the text', seen[0][0])
        self.assertIn('Furnishing coordinates use [x,z]', seen[0][0])
        self.assertIn('[-3,-1]', seen[0][0])
        self.assertIn('"const": 2', seen[0][0])
        self.assertEqual(seen[0][1], {'intent': '一间适合侦探会客的书房'})

    def test_scene_schema_enumerates_exact_runtime_legal_cells(self):
        from genesis.interior import furnishing_cell
        schema = json.loads(Path(__file__).with_name('scene_schema.json').read_text(encoding='utf-8'))
        at = schema['properties']['layout']['properties']['places']['items']['properties']['scene']\
            ['properties']['furnishings']['items']['properties']['at']
        schema_cells = {tuple(cell) for cell in at['enum']}
        runtime_cells = {(x, z) for x in range(-4, 5) for z in range(-3, 4)
                         if furnishing_cell([x, z]) is not None}
        self.assertEqual(schema_cells, runtime_cells)

    def test_scene_validation_is_bounded_and_requires_v2_indoor_place(self):
        value = scene_draft()
        self.assertEqual(validate(value), [])
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][0]['scene']['furnishings'][0]['at'] = [0, 0]
        self.assertIn('placement', {e['code'] for e in validate(invalid)})
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][0]['scene']['furnishings'][0]['basis'] = 'certain'
        self.assertIn('basis', {e['code'] for e in validate(invalid)})
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][0]['space'] = 'outdoor'
        self.assertIn('space', {e['code'] for e in validate(invalid)})
        invalid = copy.deepcopy(value)
        invalid['schemaVersion'] = 1
        self.assertIn('version', {e['code'] for e in validate(invalid)})
        invalid = copy.deepcopy(value)
        invalid['layout']['places'][0]['scene']['furnishings'][0]['node'] = 'arbitrary:node'
        self.assertIn('fields', {e['code'] for e in validate(invalid)})

    def test_shared_community_prompt_preserves_common_start_without_assigning_jobs(self):
        from genesis.genesis import PROMPT
        self.assertIn('one common starting place', PROMPT)
        self.assertIn('unless the user explicitly requests separate starts', PROMPT)
        self.assertIn('do not assign a predetermined division of labor', PROMPT)

    def test_generation_and_private_projection(self):
        seen = []
        def model(system, user):
            seen.append((system, json.loads(user)))
            return json.dumps(draft(), ensure_ascii=False)
        result = generate('安静的河谷', model)
        self.assertEqual(seen[0][1], {'intent': '安静的河谷'})
        self.assertNotIn('私人的经历', json.dumps(public_view(result), ensure_ascii=False))
        self.assertNotIn('goal', public_view(result)['actors'][0])
        public = public_view(result)
        public['actors'][0]['name'] = 'changed'
        self.assertEqual(result['actors'][0]['name'], '甲')
        self.assertEqual(actor_memories(result, 'a'), ['私人的经历'])
        with self.assertRaises(GenesisError): actor_memories(result, 'unknown')

    def test_bad_inputs_fail_closed(self):
        for output in ('{"x":1,"x":2}', '{"x":NaN}', '```json\n{}\n```', 'x'*9000):
            with self.subTest(output=output[:20]), self.assertRaises(GenesisError): parse_json(output)
        for model in (lambda *_: '{}', lambda *_: (_ for _ in ()).throw(RuntimeError('secret'))):
            with self.assertRaises(GenesisError) as e: generate('idea', model)
            self.assertNotIn('secret', str(e.exception))
        with self.assertRaises(GenesisError): generate(' ', lambda *_: '{}')
        for attempts in (0, 4, True):
            with self.subTest(attempts=attempts), self.assertRaises(GenesisError):
                generate('idea', lambda *_: '{}', max_attempts=attempts)

    def test_generation_attempt_limit_is_bounded_and_keeps_default_retries(self):
        calls = []
        def model(*_):
            calls.append(1)
            raise RuntimeError('transport_error')
        with self.assertRaises(GenesisError):
            generate('idea', model, max_attempts=1)
        self.assertEqual(len(calls), 1)

        calls.clear()
        with self.assertRaises(GenesisError):
            generate('idea', model)
        self.assertEqual(len(calls), 3)

    def test_invalid_model_draft_is_retried_with_bounded_schema_diagnostics(self):
        invalid = draft()
        invalid['actors'][0]['placeId'] = 'missing'
        seen = []

        def model(system, user):
            seen.append((system, json.loads(user)))
            return json.dumps(invalid if len(seen) == 1 else draft(), ensure_ascii=False)

        self.assertEqual(generate('河谷', model), draft())
        self.assertEqual(len(seen), 2)
        self.assertEqual(seen[0][1], {'intent': '河谷'})
        self.assertEqual(seen[1][1], {
            'intent': '河谷',
            'previous_validation_errors': [{'path': '$.actors[0].placeId', 'code': 'reference'}],
        })
        self.assertIn('Correct the previous output', seen[1][0])

    def test_invalid_model_output_stops_after_three_attempts(self):
        calls = []

        def model(*_):
            calls.append(1)
            return '{}'

        with self.assertRaises(GenesisError) as error:
            generate('idea', model)
        self.assertEqual(error.exception.code, 'invalid_draft')
        self.assertEqual(len(calls), 3)

    def test_transient_provider_failure_retries_with_bounded_backoff(self):
        calls = []

        def model(*_):
            calls.append(1)
            if len(calls) == 1:
                raise ModelError('rate_limited')
            return json.dumps(draft(), ensure_ascii=False)

        with mock.patch('time.sleep') as sleep:
            result = generate('河谷', model)
        self.assertEqual(result, draft())
        self.assertEqual(len(calls), 2)
        sleep.assert_called_once_with(1)

    def test_transient_provider_failure_stops_after_three_attempts(self):
        calls = []

        def model(*_):
            calls.append(1)
            raise ModelError('transport_error')

        with mock.patch('time.sleep') as sleep, self.assertRaises(GenesisError) as error:
            generate('河谷', model)
        self.assertEqual(error.exception.code, 'model_failed')
        self.assertEqual(len(calls), 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_place_materials_are_optional_and_limited(self):
        d = draft()
        d['layout']['places'][0]['floor'] = 'default:cobble'
        d['layout']['places'][0]['windows'] = False
        self.assertEqual(validate(d), [])
        d['layout']['places'][0]['roof'] = 'default:wood'
        self.assertIn('fields', {e['code'] for e in validate(d)})
        d = draft()
        d['layout']['places'][0]['wall'] = 'air'
        self.assertIn('material', {e['code'] for e in validate(d)})
        d = draft()
        d['layout']['places'][0]['windows'] = 1
        self.assertIn('enum', {e['code'] for e in validate(d)})

    def test_references_layout_and_unknown_fields(self):
        d = draft(); d['actors'][0]['placeId'] = 'missing'; d['layout']['places'][0]['grid'] = [True, 0]; d['extra'] = 1
        self.assertTrue(validate(d))
        del d['extra']
        self.assertEqual({e['code'] for e in validate(d)}, {'reference', 'grid'})
        d = draft(); d['layout']['connections'] = [{'from': 'bank', 'to': 'bank'}]
        self.assertIn('reference', {e['code'] for e in validate(d)})
        d = draft(); d['memories'][0]['actorId'] = 'missing'
        self.assertIn('reference', {e['code'] for e in validate(d)})

    def test_blueprint_requires_indoor_and_owns_its_materials(self):
        d = draft()
        place = d['layout']['places'][0]
        place.update(space='indoor', blueprint='victorian_sitting_room_v1')
        self.assertEqual(validate(d), [])
        place['space'] = 'outdoor'
        self.assertIn('blueprint', {e['code'] for e in validate(d)})
        place['space'] = 'indoor'
        place['floor'] = 'default:wood'
        self.assertIn('blueprint_material_override', {e['code'] for e in validate(d)})
        del place['floor']
        place['blueprint'] = 'arbitrary-code'
        self.assertIn('blueprint', {e['code'] for e in validate(d)})

    def test_existing_transport_without_network(self):
        calls = []
        usages = []
        def transport(config, body):
            calls.append(json.loads(body))
            event = {'type': 'response.completed', 'response': {'status': 'completed', 'output': [{'type':'message','content':[{'type':'output_text','text':json.dumps(draft(), ensure_ascii=False)}]}],
                     'usage': {'input_tokens': 12, 'output_tokens': 3, 'total_tokens': 15}}}
            return ('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode()
        model = responses_model(Config('https://example.test/v1', 'test', 'dummy'), transport=transport,
                                usage_callback=usages.append)
        self.assertEqual(generate('河谷', model), draft())
        self.assertEqual(calls[0]['input'][1]['role'], 'user')
        self.assertTrue(calls[0]['stream'])
        self.assertEqual(usages, [{'input_tokens': 12, 'output_tokens': 3, 'total_tokens': 15}])

    def test_scene_generation_uses_configured_anthropic_transport(self):
        requests, usages = [], []
        def transport(config, body):
            requests.append(json.loads(body))
            response = {'type': 'message', 'content': [
                {'type': 'text', 'text': json.dumps(scene_draft(), ensure_ascii=False)}],
                'usage': {'input_tokens': 120, 'output_tokens': 70}}
            return json.dumps(response, ensure_ascii=False).encode()
        config = Config.from_values('https://example.test/api/llm/anthropic', 'test-model', 'key')
        model = responses_model(config, transport=transport, usage_callback=usages.append)
        self.assertEqual(generate('一间靠墙摆放书架的书房', model, scene=True), scene_draft())
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]['model'], 'test-model')
        self.assertEqual(requests[0]['messages'][0]['role'], 'user')
        self.assertIn('schemaVersion 2', requests[0]['system'])
        self.assertNotIn('stream', requests[0])
        self.assertEqual(usages, [{'input_tokens': 120, 'output_tokens': 70}])

if __name__ == '__main__': unittest.main()
