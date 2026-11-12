import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kernel.model import load_provider, provider_status


class ModelConfigTests(unittest.TestCase):
    def test_environment_overrides_file_without_exposing_key_in_status(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".tmp") as directory:
            config = Path(directory) / "provider.env"
            config.write_text('WISPIVA_LLM_BASE_URL="https://example.invalid/v1"\nWISPIVA_LLM_MODEL=file-model\nWISPIVA_LLM_API_KEY=file-secret\n')
            with patch.dict(os.environ, {"WISPIVA_ENV_FILE": str(config), "WISPIVA_LLM_MODEL": "env-model"}, clear=True):
                self.assertEqual(load_provider()["model"], "env-model")
                self.assertEqual(load_provider()["api_key"], "file-secret")
                self.assertEqual(provider_status(), {"configured": True, "model": "env-model"})

    def test_incomplete_environment_is_an_explicit_configuration_failure(self):
        with patch.dict(os.environ, {"WISPIVA_ENV_FILE": "/nonexistent/wispiva-test"}, clear=True):
            with self.assertRaises(ValueError):
                load_provider()
            self.assertFalse(provider_status()["configured"])

    def test_invalid_provider_file_does_not_crash_status(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".tmp") as directory:
            config = Path(directory)
            (config / "empty.env").touch()
            (config / "wispiva").mkdir()
            for content in ('[]', '{"providers":["bad"]}', '{"providers":[{"api_key":12,"base_url":"https://example.invalid","model":"test"}]}'):
                (config / "wispiva/providers.json").write_text(content)
                with patch.dict(os.environ, {"WISPIVA_ENV_FILE": str(config / "empty.env"), "XDG_CONFIG_HOME": directory}, clear=True):
                    self.assertFalse(provider_status()["configured"])
