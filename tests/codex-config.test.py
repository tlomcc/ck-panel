import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('existing', Path(__file__).with_name('codex-service.test.py'))
existing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(existing)
service = existing.service


class ConfigTests(unittest.TestCase):
    setUp = existing.Lifecycle.setUp
    tearDown = existing.Lifecycle.tearDown

    def test_legacy_migrates_and_survives_reload_without_password(self):
        raw = (self.root/'config.json').read_text()
        self.assertNotIn(self.profile['api_key'], raw)
        self.assertNotIn('"api_key":', raw)
        self.assertIn('api_key_encrypted', raw)
        self.assertEqual((self.root/'provider.key').stat().st_mode & 0o777, 0o600)
        decoded = service.KeyStore(self.root).decode(json.loads(raw))
        self.assertEqual(decoded['profiles'][0]['api_key'], self.profile['api_key'])

    def test_ciphertext_bound_to_provider_and_missing_key_never_overwrites(self):
        raw = json.loads((self.root/'config.json').read_text())
        raw['profiles'][0]['id'] = 'different-provider'
        with self.assertRaises(Exception): self.m.key_store.decode(raw)
        (self.root/'provider.key').unlink()
        with self.assertRaises(FileNotFoundError): self.m.key_store.decode(json.loads((self.root/'config.json').read_text()))
        self.assertFalse((self.root/'provider.key').exists())

    def test_individual_save_preserves_other_supplier_and_blank_secret(self):
        p = dict(self.profile, id='other', name='untouched')
        self.m.save_profile({'profile':p})
        other = self.m.profile('other')
        self.m.save_profile({'profile':dict(self.profile, model='new-model', api_key=''), 'make_default':True})
        self.assertEqual(self.m.profile('other'), other)
        self.assertEqual(self.m.profile('p')['api_key'], self.profile['api_key'])
        self.assertEqual(self.m.config['default_profile'], 'p')
        self.assertNotIn(self.profile['api_key'], (self.root/'config.json').read_text())

    def test_stale_save_cannot_overwrite_newer_supplier(self):
        body = {'profile':dict(self.profile, model='first')}
        self.m.save_profile(body)
        with self.assertRaises(service.Problem) as result: self.m.save_profile(body)
        self.assertEqual(result.exception.status, 409)
        self.assertEqual(self.m.profile()['model'], 'first')

    def test_official_named_efforts_roundtrip(self):
        for effort in ('high', 'xhigh', 'max', 'ultra'):
            self.m.save_config({'profiles':[dict(self.profile, effort=effort)]})
            self.assertEqual(self.m.public_config()['profiles'][0]['effort'], effort)

    def test_unauthorized_client_fallback_is_distinct_cached_and_not_verified(self):
        error = HTTPError('https://example.test/models',401,'Unauthorized',{},io.BytesIO(b'{"type":"unauthorized_client_error"}'))
        with patch.object(service, 'urlopen', side_effect=error) as fetch:
            result = self.m.models('p')
            self.assertEqual(result['source'], 'configured')
            self.assertEqual(result['upstream_status'], 401)
            self.assertIn('unauthorized_client_error', result['warning'])
            self.assertEqual(result['models'], ['test-model'])
            cached = self.m.models('p', {'model':'manually-updated','refresh':True})
            self.assertEqual(cached['models'], ['manually-updated'])
            self.assertEqual(fetch.call_count, 1)
        self.assertNotIn(self.profile['api_key'], json.dumps(result))

    def test_draft_models_use_explicit_key_without_saving(self):
        class Response(io.BytesIO):
            pass
        with patch.object(service, 'urlopen', return_value=Response(b'{"data":[{"id":"z"},{"id":"a"},{"id":"a"}]}')) as fetch:
            before = (self.root/'config.json').read_bytes()
            result = self.m.models('p', {'api_key':'draft-secret'})
            self.assertEqual(result['models'], ['a','z'])
            self.assertEqual(fetch.call_args.args[0].get_header('Authorization'), 'Bearer draft-secret')
            self.assertEqual((self.root/'config.json').read_bytes(), before)
        with patch.object(service, 'urlopen') as fetch:
            with self.assertRaises(service.Problem): self.m.models('p', {'base_url':'https://another.test/v1'})
            fetch.assert_not_called()

    def test_key_change_bypasses_failure_cache(self):
        error = HTTPError('',401,'Unauthorized',{},io.BytesIO(b'{"error":{"code":"invalid_api_key"}}'))
        with patch.object(service, 'urlopen', side_effect=error): self.m.models('p')
        with patch.object(service, 'urlopen', return_value=io.BytesIO(b'{"data":[{"id":"ok"}]}')) as fetch:
            result = self.m.models('p', {'api_key':'new-key'})
            self.assertEqual(result['source'], 'upstream')
            self.assertEqual(fetch.call_count, 1)


if __name__ == '__main__': unittest.main()
