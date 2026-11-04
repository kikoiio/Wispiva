"""Local provider store. No display and no network."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from model.adapter import Config, ModelError
from model.providers import ProviderConfigError, load_config, load_store, new_provider, save_store


def env_for(root):
    return {'XDG_CONFIG_HOME': str(root), 'HOME': str(root),
            'LLM_BASE_URL': 'https://api.example/v1', 'MODEL_NAME': 'from-env',
            'LLM_API_KEY': 'env-key', 'MODEL': '1', 'LLM_MODEL': 'old-name',
            'XUNFEI_MODEL': 'ignored'}


class ProviderStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = env_for(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_file_uses_the_actions_slot_and_ignores_old_names(self):
        config = load_config(self.env)
        self.assertEqual(config.model, 'from-env')
        self.assertEqual(config.endpoint(), 'https://api.example/v1/responses')
        self.assertNotIn('env-key', repr(config))

    def test_selected_provider_is_private_and_beats_the_environment(self):
        first = new_provider()
        first.update(name='SCNet', base_url='https://api.scnet.cn/api/llm/anthropic',
                     model='GLM-5.3-Flash', api_key='local-key')
        second = new_provider()
        second.update(name='备用', base_url='https://api.example/v1', model='other', api_key='other-key')
        save_store({'selected': first['id'], 'providers': [first, second]}, self.env)
        path = self.root / 'wispiva' / 'providers.json'
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        loaded = load_store(self.env)
        self.assertEqual(loaded['selected'], first['id'])
        self.assertEqual(loaded['providers'][0]['api_key'], 'local-key')
        config = load_config(self.env)
        self.assertEqual((config.model, config.protocol), ('GLM-5.3-Flash', 'anthropic'))
        self.assertNotIn('local-key', repr(config))

    def test_no_selection_keeps_the_environment_provider(self):
        item = new_provider()
        item.update(name='备用', base_url='https://api.example/v1', model='other', api_key='other-key')
        save_store({'selected': None, 'providers': [item]}, self.env)
        self.assertEqual(load_config(self.env).model, 'from-env')

    def test_incomplete_selection_is_rejected_and_a_bad_file_does_not_fall_open(self):
        item = new_provider()
        item.update(name='半成品', base_url='', model='', api_key='')
        with self.assertRaises(ProviderConfigError):
            save_store({'selected': item['id'], 'providers': [item]}, self.env)
        path = self.root / 'wispiva' / 'providers.json'
        path.parent.mkdir(mode=0o700)
        path.write_text('{', encoding='utf-8')
        os.chmod(path, 0o600)
        with self.assertRaisesRegex(ModelError, '^invalid_config$'):
            load_config(self.env)
        self.assertIsInstance(Config.from_env(self.env), Config)

    def test_symlinked_config_is_not_followed(self):
        outside = self.root / 'outside.json'
        outside.write_text('[]', encoding='utf-8')
        directory = self.root / 'wispiva'
        directory.mkdir(mode=0o700)
        (directory / 'providers.json').symlink_to(outside)
        with self.assertRaises(ProviderConfigError):
            load_store(self.env)
        item = new_provider()
        item.update(name='SCNet', base_url='https://api.example/v1', model='m', api_key='k')
        with self.assertRaises(ProviderConfigError):
            save_store({'selected': item['id'], 'providers': [item]}, self.env)
        self.assertEqual(outside.read_text(encoding='utf-8'), '[]')

    def test_stdin_save_reports_a_code_without_echoing_the_key(self):
        item = new_provider()
        item.update(name='SCNet', base_url='https://api.example/v1', model='m', api_key='stdin-key')
        status = self.root / 'status'
        env = os.environ.copy()
        env.update(self.env)
        env['WISPIVA_PROVIDER_STATUS'] = str(status)
        completed = subprocess.run(
            [sys.executable, '-B', '-m', 'model.providers'],
            input=json.dumps({'selected': item['id'], 'providers': [item]}),
            text=True, capture_output=True, env=env, cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(status.read_text(encoding='utf-8').strip(), 'ok')
        self.assertNotIn('stdin-key', completed.stdout + completed.stderr)
        self.assertEqual(load_store(self.env)['providers'][0]['api_key'], 'stdin-key')
