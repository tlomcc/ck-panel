"""Context-policy boundaries without a provider, native process, or production state."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'codex-service'))
import claude_context as policy
from claude_api_config import api_environment
from claude_engine import ClaudeEngine


class ContextPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.image = self.root / 'image.png'
        self.image.write_bytes(b'\x89PNG\r\n\x1a\n')
        self.transcript = self.root / 'session.jsonl'
        self.env = patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(self.root / 'native')})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)

    def call(self, event, **extra):
        data = {'hook_event_name': event, 'session_id': 'fixture', 'transcript_path': str(self.transcript),
                'tool_name': 'Read', 'tool_use_id': 'read-1', 'tool_input': {'file_path': str(self.image)}}
        data.update(extra)
        if event == 'PreToolUse' and not data.get('agent_id'):
            policy.record_tool_tokens(self.root / 'native', 'fixture', data['tool_use_id'], policy.transcript_tokens(self.transcript))
        return policy.hook(data, hosted=True)

    def usage(self, **values):
        self.transcript.write_text(json.dumps({'type': 'assistant', 'message': {'usage': values}}) + '\n')

    def test_only_any_receives_window_and_hooks(self):
        base = {'api_key': 'fixture', 'base_url': 'http://127.0.0.1:1'}
        any_env = api_environment(dict(base, id=policy.ANY_PROFILE_ID), self.root, test=True)
        other_env = api_environment(dict(base, id='other'), self.root, test=True)
        self.assertEqual(any_env['CLAUDE_CODE_AUTO_COMPACT_WINDOW'], '300000')
        self.assertNotEqual(other_env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'), '300000')
        self.assertIsNone(policy.native_settings({'id': 'other'}))
        self.assertIn('PostCompact', json.loads(policy.native_settings({'id': policy.ANY_PROFILE_ID}))['hooks'])

    def test_token_count_includes_cache_and_rejects_invalid_values(self):
        self.assertEqual(policy.token_count({'input_tokens': 100, 'cache_read_input_tokens': 210000,
                                           'cache_creation_input_tokens': 1000, 'output_tokens': 20}), 211120)
        for bad in (None, {}, {'input_tokens': True}, {'input_tokens': -1}, {'input_tokens': float('inf')}):
            self.assertIsNone(policy.token_count(bad))

    def test_only_latest_context_usage_is_read(self):
        self.transcript.write_text('\n'.join(json.dumps(row) for row in [
            {'type': 'assistant', 'message': {'usage': {'input_tokens': 250000}}},
            {'type': 'system', 'subtype': 'compact_boundary'},
            {'type': 'assistant', 'message': {'usage': {'input_tokens': 12000, 'cache_read_input_tokens': 2000}}},
        ]))
        self.assertEqual(policy.transcript_tokens(self.transcript), 14000)
        self.transcript.write_text(self.transcript.read_text().rsplit('\n', 1)[0])
        self.assertIsNone(policy.transcript_tokens(self.transcript))

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_low_context_without_successful_compaction_defers(self, _):
        self.usage(input_tokens=1000)
        result = self.call('PreToolUse')['hookSpecificOutput']
        self.assertEqual(result['permissionDecision'], 'defer')
        self.assertTrue(policy.read_state(self.root / 'native', 'fixture')['needs_compact'])

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_parallel_image_requests_keep_both_deferred_ids(self, _):
        self.usage(input_tokens=1000)
        self.call('PreToolUse', tool_use_id='first')
        self.call('PreToolUse', tool_use_id='second')
        self.assertEqual(policy.read_state(self.root / 'native', 'fixture')['deferred_tool_ids'], ['first', 'second'])

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_successful_compaction_allows_low_context_image(self, _):
        self.call('PostCompact')
        self.usage(input_tokens=14000)
        self.assertEqual(self.call('PreToolUse'), {})
        self.assertTrue(policy.read_state(self.root / 'native', 'fixture')['image_used'])

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_unknown_or_large_context_never_passes_image_gate(self, _):
        self.call('PostCompact')
        for value in (None, 160000, 200000):
            if value is None:
                self.transcript.write_text('{}')
            else:
                self.usage(input_tokens=value)
            self.assertEqual(self.call('PreToolUse')['hookSpecificOutput']['permissionDecision'], 'defer')

    @patch.object(policy, 'ocr_image')
    def test_first_read_returns_ocr_without_authorizing_vision(self, ocr):
        ocr.return_value = str(self.root / 'local.ocr.txt')
        result = self.call('PreToolUse')['hookSpecificOutput']
        self.assertEqual(result['updatedInput']['file_path'], ocr.return_value)
        self.assertNotIn('permissionDecision', result)
        self.assertEqual(self.call('PreToolUse')['hookSpecificOutput']['permissionDecision'], 'defer')
        self.assertEqual(ocr.call_count, 1)

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_next_image_turn_requires_a_new_compaction(self, _):
        self.call('PostCompact')
        self.call('UserPromptSubmit')
        self.usage(input_tokens=1000)
        self.assertEqual(self.call('PreToolUse'), {})
        self.call('UserPromptSubmit')
        self.assertEqual(self.call('PreToolUse')['hookSpecificOutput']['permissionDecision'], 'defer')

    @patch.object(policy, 'ocr_image', return_value=None)
    def test_subagent_cannot_borrow_parent_compaction(self, _):
        self.call('PostCompact')
        self.usage(input_tokens=1000)
        result = self.call('PreToolUse', agent_id='child-1')['hookSpecificOutput']
        self.assertEqual(result['permissionDecision'], 'deny')

    def test_text_read_never_creates_a_compaction_request(self):
        text = self.root / 'source.py'
        text.write_text('print(1)')
        self.assertEqual(self.call('PreToolUse', tool_input={'file_path': str(text)}), {})
        self.assertFalse(policy.read_state(self.root / 'native', 'fixture').get('needs_compact'))

    def test_image_detection_covers_magic_and_screenshot_tools(self):
        other = self.root / 'renamed.txt'
        other.write_bytes(b'\x89PNG\r\n\x1a\n')
        self.assertTrue(policy.visual_input('Read', {'file_path': str(other)}))
        self.assertTrue(policy.visual_input('mcp__browser__take_screenshot', {}))
        self.assertFalse(policy.visual_input('mcp__browser__click', {}))

    def test_missing_new_usage_cannot_reuse_pre_compaction_counts(self):
        engine = ClaudeEngine.__new__(ClaudeEngine)
        engine.context_tokens = engine.context_input_tokens = 1000
        engine.feedback = lambda *args, **kwargs: None
        message_type = type('StreamEvent', (), {})
        message = message_type()
        message.event = {'type': 'message_start', 'message': {'id': 'new', 'usage': {}}}
        engine.consume(message)
        message.event = {'type': 'message_delta', 'usage': {'output_tokens': 10}}
        engine.consume(message)
        self.assertIsNone(engine.context_tokens)


unittest.main()
