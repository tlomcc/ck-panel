import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).parents[1] / 'codex-service'))
from claude_api_config import api_base, api_environment, DEFAULT_MODEL, PROXY, ANY_PROFILE_ID, ANY_MODEL
from claude_provider_sync import receive
from claude_service import ClaudeManager, Problem
from claude_engine import ClaudeEngine


class FakeEngine:
    def __init__(self, manager, wid, profile):
        self.profile = dict(profile)
        self.profile_fingerprint = json.dumps(profile, sort_keys=True)
        self.requests, self.calls, self.closed = {}, [], False
        self.session_id = str(uuid.uuid4())
        manager.window_home(wid).mkdir(parents=True, exist_ok=True)

    def rpc(self, method, params=None, **kwargs):
        self.calls.append((method, params))
        if method == 'thread/start': return {'thread': {'id': self.session_id}}
        if method == 'turn/start': return {'turn': {'id': str(uuid.uuid4())}}
        return {}

    def close(self): self.closed = True
    def send(self, value): self.calls.append(('answer', value))


def catalog(revision='a' * 64, key='private-fixture-credential'):
    return {'profiles': [{'id': 'provider-one', 'name': '供应商', 'base_url': 'https://provider.example/v1',
                          'api_key': key, 'model': 'codex-original', 'effort': 'max', 'revision': revision}],
            'access_hash': hashlib.sha256(b'fixture-access').hexdigest(),
            'default_profile': 'provider-one', 'source_revision': revision}


class Configuration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        receive(self.root, catalog())
        self.manager = ClaudeManager(self.root, FakeEngine, start_worker=False)

    def tearDown(self):
        self.manager.shutdown()
        self.manager.store.db.close()
        self.tmp.cleanup()

    def create(self, key='create-fixture-001'):
        return self.manager.create({'request_id': key})

    def test_sync_is_encrypted_and_noop_does_not_rewrite(self):
        path = self.root / 'config.json'
        before = path.read_bytes()
        self.assertNotIn(b'private-fixture-credential', before)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'provider.key').stat().st_mode & 0o777, 0o600)
        self.assertFalse(receive(self.root, catalog())['changed'])
        self.assertEqual(path.read_bytes(), before)

    def test_claude_model_selection_keeps_shared_codex_config_byte_identical(self):
        before = (self.root / 'config.json').read_bytes()
        profile = self.manager.public_config()['profiles'][0]
        self.assertEqual(profile['model'], DEFAULT_MODEL)
        profile.update(model='claude-opus-4-6', effort='low')
        self.manager.save_profile({'profile': profile, 'expected_revision': profile['revision']})
        self.assertEqual(self.manager.profile()['model'], 'claude-opus-4-6')
        self.assertEqual((self.root / 'config.json').read_bytes(), before)

    def test_shared_key_rotation_updates_next_task_and_preserves_claude_choice(self):
        profile = self.manager.profile()
        self.manager.save_profile({'profile': dict(profile, api_key='', model='claude-opus-4-6'),
                                   'expected_revision': profile['revision']})
        window = self.create()
        engine = self.manager.engines[window['id']]
        self.manager.store.update(window['id'], status='running')
        receive(self.root, catalog('b' * 64, 'rotated-fixture-credential'))
        self.assertEqual(self.manager.profile()['api_key'], 'rotated-fixture-credential')
        self.assertEqual(self.manager.profile()['model'], 'claude-opus-4-6')
        self.assertFalse(engine.closed)
        self.assertNotIn('private-fixture-credential', self.manager.redact('private-fixture-credential'))
        self.assertNotIn('rotated-fixture-credential', json.dumps(self.manager.public_config()))

    def test_conflicting_claude_options_are_rejected(self):
        profile = self.manager.public_config()['profiles'][0]
        first = {'profile': dict(profile, model='claude-opus-4-6'), 'expected_revision': profile['revision']}
        self.manager.save_profile(first)
        with self.assertRaises(Problem): self.manager.save_profile(first)

    def test_any_opus_selection_retains_the_requested_million_context_option(self):
        data = catalog('c' * 64)
        data['profiles'][0]['id'] = ANY_PROFILE_ID
        data['default_profile'] = ANY_PROFILE_ID
        receive(self.root, data)
        profile = self.manager.public_config()['profiles'][0]
        self.assertEqual(profile['model'], ANY_MODEL)
        before = (self.root / 'config.json').read_bytes()
        saved = self.manager.save_profile({'profile': dict(profile, model='claude-opus-5-5[1M]'),
                                           'expected_revision': profile['revision']})
        self.assertEqual(saved['profiles'][0]['model'], ANY_MODEL)
        self.assertEqual((self.root / 'config.json').read_bytes(), before)

    def test_credential_or_address_writes_are_rejected_without_mutation(self):
        before = (self.root / 'config.json').read_bytes()
        p = self.manager.public_config()['profiles'][0]
        for changes in ({'api_key': 'replacement'}, {'base_url': 'https://another.example'}, {'name': 'renamed'}):
            with self.assertRaises(Problem):
                self.manager.save_profile({'profile': dict(p, **changes), 'expected_revision': p['revision']})
        self.assertEqual((self.root / 'config.json').read_bytes(), before)

    def test_create_submit_close_resume_delete_are_idempotent_and_isolated(self):
        one = self.create()
        self.assertEqual(one['id'], self.create()['id'])
        two = self.create('create-fixture-002')
        body = {'request_id': 'send-fixture-001', 'text': 'Only the requested work'}
        self.manager.submit(one['id'], body)
        self.manager.submit(one['id'], body)
        self.assertEqual(self.manager.store.db.execute('SELECT count(*) FROM tasks').fetchone()[0], 1)
        self.manager.action(one['id'], 'close', {})
        self.manager.action(one['id'], 'reopen', {})
        self.assertEqual(self.manager.store.one(one['id'])['thread_id'], one['thread_id'])
        self.manager.action(one['id'], 'delete', {})
        self.assertEqual([w['id'] for w in self.manager.store.list()], [two['id']])
        self.assertFalse(self.manager.window_home(one['id']).parent.exists())

    def test_restart_preserves_schedules_and_never_replays_active_work(self):
        window = self.create()
        self.manager.submit(window['id'], {'request_id': 'send-fixture-001', 'text': 'possibly already executed'})
        self.manager.store.item(window['id'], 'request:r', 'request', '', {'params': {'questions': []}})
        second = ClaudeManager(self.root, FakeEngine, start_worker=False)
        try:
            self.assertEqual(second.store.one(window['id'])['status'], 'interrupted')
            self.assertFalse(second.engines)
            self.assertEqual(second.store.snapshot(window['id'])['items'][-1]['kind'], 'resolved')
        finally:
            second.shutdown(); second.store.db.close()

    def test_api_only_proxy_settings_fail_closed(self):
        p = self.manager.profile()
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://untrusted:8888', 'CLAUDE_CODE_OAUTH_TOKEN': 'subscription-fixture',
                                    'OPENAI_API_KEY': 'inherited-provider-fixture'}):
            env = api_environment(p, '/private/window')
        self.assertEqual(env['HTTPS_PROXY'], PROXY)
        self.assertEqual(env['HTTP_PROXY'], PROXY)
        self.assertEqual(env['ALL_PROXY'], '')
        self.assertEqual(env['CLAUDE_CODE_OAUTH_TOKEN'], '')
        self.assertEqual(env['ANTHROPIC_AUTH_TOKEN'], '')
        self.assertEqual(env['OPENAI_API_KEY'], '')
        for address in ('https://api.anthropic.com', 'https://claude.ai', 'https://platform.claude.com',
                        'http://provider.example', 'https://user:secret@provider.example',
                        'https://provider.example?key=secret'):
            with self.assertRaises(ValueError): api_base(address)
        self.assertEqual(api_base('https://provider.example/anthropic/v1'), 'https://provider.example/anthropic')

    def test_late_steer_is_rejected_without_a_false_sent_record(self):
        window = self.create()
        engine = ClaudeEngine(self.manager, window['id'], self.manager.profile())
        self.manager.engines[window['id']] = engine
        engine.turn_id, engine.executing, engine.accepting = 'ending-turn', True, False
        self.manager.store.update(window['id'], status='running', turn_id=engine.turn_id)
        with self.assertRaises(Problem):
            self.manager.action(window['id'], 'steer', {'request_id': 'late-steer-001', 'text': 'Keep this draft'})
        self.assertFalse(self.manager.store.db.execute("SELECT 1 FROM items WHERE id='steer:late-steer-001'").fetchone())

    def test_partial_text_is_replaced_by_complete_message_and_raw_thinking_omitted(self):
        window = self.create()
        engine = ClaudeEngine(self.manager, window['id'], self.manager.profile())
        engine.turn_id = 'fixture-turn'
        self.manager.store.update(window['id'], status='running', turn_id=engine.turn_id)
        def stream(event): engine.consume(type('StreamEvent', (), {'event': event})())
        stream({'type': 'message_start', 'message': {'id': 'm1'}})
        stream({'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': 'partial'}})
        stream({'type': 'content_block_delta', 'delta': {'type': 'thinking_delta', 'thinking': 'PRIVATE_REASONING'}})
        block = type('TextBlock', (), {'text': 'complete reply'})()
        engine.consume(type('AssistantMessage', (), {'content': [block]})())
        data = self.manager.store.snapshot(window['id'])
        self.assertEqual([i['text'] for i in data['items']], ['complete reply'])
        self.assertNotIn('PRIVATE_REASONING', json.dumps(data))

    def test_user_question_uses_existing_panel_answer_contract(self):
        window = self.create()
        engine = ClaudeEngine(self.manager, window['id'], self.manager.profile())
        self.manager.engines[window['id']] = engine
        engine.turn_id = 'question-turn'
        allow = type('PermissionResultAllow', (), {'__init__': lambda self, **kwargs: self.__dict__.update(kwargs)})
        deny = type('PermissionResultDeny', (), {'__init__': lambda self, **kwargs: self.__dict__.update(kwargs)})
        async def check():
            engine.loop = asyncio.get_running_loop()
            pending = asyncio.create_task(engine.permission('AskUserQuestion', {'questions': [
                {'question': '选择范围', 'options': [{'label': '仅本次'}]}]}, None))
            await asyncio.sleep(0)
            rid = next(iter(engine.requests))
            self.assertEqual(self.manager.store.one(window['id'])['status'], 'waiting')
            self.manager.action(window['id'], 'answer', {'request_id': rid, 'answers': {'q0': '仅本次'}})
            result = await asyncio.wait_for(pending, 1)
            self.assertEqual(result.updated_input['answers'], {'选择范围': '仅本次'})
            engine.loop = None
        with patch.dict(sys.modules, {'claude_agent_sdk': types.SimpleNamespace(PermissionResultAllow=allow, PermissionResultDeny=deny)}):
            asyncio.run(check())


if __name__ == '__main__': unittest.main()
