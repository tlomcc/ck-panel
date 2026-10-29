"""Adapt official Claude Code SDK sessions to the task center's event contract."""
import asyncio
import json
import os
from pathlib import Path
import threading
import time
import uuid

from claude_api_config import api_environment

class ClaudeEngine:
    def __init__(self, manager, wid, profile):
        self.manager, self.wid, self.profile = manager, wid, dict(profile)
        self.profile_fingerprint = json.dumps(profile, sort_keys=True)
        self.requests, self.answers, self.tools = {}, {}, {}
        self.stopping, self.worker, self.executing = False, None, False
        self.accepting = False
        self.lock = threading.RLock()
        self.loop = self.client = self.main_task = None
        self.pending = []
        self.last_used = time.monotonic()
        self.home = manager.window_home(wid)
        self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.session_id = manager.store.one(wid).get('thread_id') or str(uuid.uuid4())
        self.turn_id = self.message_id = ''
        self.last_text_id = None

    def emit(self, method, **params):
        if not self.stopping:
            self.manager.event(self, {'method': method, 'params': dict(params, turnId=self.turn_id)})

    def rpc(self, method, params=None, **_):
        from service import Problem
        params = params or {}
        self.last_used = time.monotonic()
        if method == 'thread/start':
            return {'thread': {'id': self.session_id}}
        if method == 'thread/resume':
            self.session_id = str(uuid.UUID(params['threadId']))
        elif method in ('thread/name/set', 'thread/delete'):
            # Native records live only in this window's config directory. The
            # manager removes that entire directory on an explicit delete.
            return {}
        elif method == 'turn/start':
            with self.lock:
                if self.executing:
                    raise Problem('Claude Code 仍在执行当前任务', 409)
                self.turn_id = uuid.uuid4().hex
                self.pending = []
                self.executing = True
                self.accepting = True
                self.last_text_id = None
                text = '\n'.join(x['text'] for x in params['input'] if x.get('type') == 'text')
                self.emit('turn/started', turn={'id': self.turn_id})
                self.worker = threading.Thread(target=self.run, args=(text,), daemon=True)
                self.worker.start()
                return {'turn': {'id': self.turn_id}}
        elif method == 'turn/steer':
            with self.lock:
                if not self.executing or not self.accepting or params['expectedTurnId'] != self.turn_id:
                    raise Problem('本轮已结束，请作为下一条任务发送', 409)
                self.pending.append('\n'.join(x['text'] for x in params['input'] if x.get('type') == 'text'))
            return {}
        elif method == 'turn/interrupt':
            self.stopping = True
            if self.loop and self.client:
                asyncio.run_coroutine_threadsafe(self.client.interrupt(), self.loop)
        else:
            raise Problem('Claude Code 不支持此操作', 400)
        return {}

    def run(self, text):
        outcome = None
        try:
            outcome = asyncio.run(self.conversation(text))
        except BaseException as exc:
            if not self.stopping:
                error = self.manager.redact(str(exc))[:1600] or 'Claude Code 进程退出'
                outcome = {'id': self.turn_id, 'status': 'failed', 'error': {'message': error}}
        finally:
            self.loop = self.client = self.main_task = None
            with self.lock:
                self.executing = False
                self.accepting = False
                if outcome:
                    self.emit('turn/completed', turn=outcome)

    async def permission(self, name, inputs, context):
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny
        if name != 'AskUserQuestion':
            return PermissionResultAllow(updated_input=inputs)
        if self.stopping:
            return PermissionResultDeny(message='任务已停止', interrupt=True)
        rid = uuid.uuid4().hex
        questions = inputs.get('questions') or []
        ui = [{'id': 'q' + str(i), 'header': q.get('header', ''), 'question': q['question'],
               'options': q.get('options', [])} for i, q in enumerate(questions)]
        future = asyncio.get_running_loop().create_future()
        self.answers[rid] = future
        event = {'id': rid, 'method': 'item/tool/requestUserInput',
                 'params': {'questions': ui, 'turnId': self.turn_id}}
        self.requests[rid] = event
        self.manager.store.item(self.wid, 'request:' + rid, 'request', '', event)
        self.manager.store.update(self.wid, status='waiting')
        try:
            result = await future
            answers = {q['question']: '\n'.join(result['answers']['q' + str(i)]['answers'])
                       for i, q in enumerate(questions)}
            return PermissionResultAllow(updated_input=dict(inputs, answers=answers))
        finally:
            self.answers.pop(rid, None)

    def send(self, event):
        future = self.answers.get(str(event.get('id')))
        if future and self.loop:
            def resolve():
                if not future.done():
                    future.set_result(event['result'])
            self.loop.call_soon_threadsafe(resolve)

    async def conversation(self, text):
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
        self.loop = asyncio.get_running_loop()
        self.main_task = asyncio.current_task()
        native = self.home / 'native'
        native.mkdir(mode=0o700, exist_ok=True)
        # Claude persists the transcript before a tool runs. A task can be
        # stopped before ResultMessage, so completion is not a resume marker.
        persisted = any(p.stat().st_size for p in
                        (native / 'projects').glob('*/' + self.session_id + '.jsonl'))
        kwargs = {'resume': self.session_id} if persisted else {'session_id': self.session_id}
        options = ClaudeAgentOptions(
            cli_path=os.environ.get('CK_CLAUDE_BIN', '/opt/ck-claude-tasks/bin/claude'),
            cwd=self.manager.store.one(self.wid)['cwd'],
            env=api_environment(self.profile, native, test=self.manager.test_loopback),
            model=self.profile['model'], effort=self.profile.get('effort', 'high'),
            # Keep Claude Code's original system prompt, built-in tools, plugins,
            # memory and user/project/local settings. Only UI permissions and
            # progress events are adapted; provider requests stay native.
            system_prompt={'type': 'preset', 'preset': 'claude_code'},
            setting_sources=['user', 'project', 'local'],
            can_use_tool=self.permission,
            include_partial_messages=True, stderr=lambda _: None,
            **kwargs,
        )
        async with ClaudeSDKClient(options=options) as client:
            self.client = client
            await client.query(text, session_id=self.session_id)
            async for message in client.receive_messages():
                if self.stopping:
                    return
                kind = type(message).__name__
                if kind == 'ResultMessage':
                    usage = getattr(message, 'usage', {}) or {}
                    total = sum(int(usage.get(k) or 0) for k in
                                ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'))
                    self.emit('thread/tokenUsage/updated', tokenUsage={'total': {'totalTokens': total}})
                    failed = bool(message.is_error) or message.subtype != 'success'
                    with self.lock:
                        pending, self.pending = self.pending, []
                        if not pending or failed:
                            self.accepting = False
                    if pending and not failed:
                        await client.query('\n\n'.join(pending), session_id=self.session_id)
                        continue
                    if failed:
                        errors = getattr(message, 'errors', None) or [getattr(message, 'result', None) or message.subtype]
                        error = self.manager.redact('\n'.join(str(x) for x in errors))
                        outcome = {'id': self.turn_id, 'status': 'failed', 'error': {'message': error}}
                    else:
                        if self.last_text_id:
                            with self.manager.store.lock:
                                old = self.manager.store.db.execute('SELECT text,data FROM items WHERE window_id=? AND id=?',
                                    (self.wid, self.last_text_id)).fetchone()
                            if old:
                                self.manager.store.item(self.wid, self.last_text_id, 'agentMessage', old['text'],
                                                        dict(json.loads(old['data']), phase='final_answer'))
                        outcome = {'id': self.turn_id, 'status': 'completed'}
                    return outcome
                self.consume(message)
            raise RuntimeError('Claude Code 未返回完整结束记录；请检查已完成操作后继续')

    def consume(self, message):
        kind = type(message).__name__
        if kind == 'StreamEvent':
            event = message.event
            if event.get('type') == 'message_start':
                self.message_id = event.get('message', {}).get('id') or uuid.uuid4().hex
            elif event.get('type') == 'content_block_delta':
                delta = event.get('delta') or {}
                if delta.get('type') == 'text_delta':
                    iid = 'cc:' + self.turn_id + ':' + self.message_id
                    self.last_text_id = iid
                    self.emit('item/agentMessage/delta', itemId=iid, delta=delta.get('text', ''))
                elif delta.get('type') == 'thinking_delta':
                    self.manager.progress(self.wid, self.turn_id)
            return  # Raw thinking and signatures are never stored in panel items.
        if kind == 'AssistantMessage':
            text = ''.join(getattr(block, 'text', '') for block in message.content
                           if type(block).__name__ == 'TextBlock')
            if text:
                iid = 'cc:' + self.turn_id + ':' + (self.message_id or uuid.uuid4().hex)
                self.last_text_id = iid
                self.emit('item/completed', item={'id': iid, 'type': 'agentMessage',
                                                'text': text, 'phase': 'commentary'})
            for block in message.content:
                if type(block).__name__ != 'ToolUseBlock':
                    continue
                inputs = block.input or {}
                if block.name in ('Bash', 'PowerShell'):
                    item = {'id': block.id, 'type': 'commandExecution', 'status': 'running',
                            'command': inputs.get('command', '')}
                elif block.name in ('Write', 'Edit', 'NotebookEdit'):
                    item = {'id': block.id, 'type': 'fileChange', 'status': 'running',
                            'changes': [{'path': inputs.get('file_path') or inputs.get('notebook_path', ''),
                                         'diff': inputs.get('new_string') or inputs.get('content', '')}]}
                else:
                    item = {'id': block.id, 'type': 'tool', 'status': 'running',
                            'name': block.name, 'input': inputs}
                self.tools[block.id] = item
                self.emit('item/started', item=item)
        elif kind == 'UserMessage':
            blocks = message.content if isinstance(message.content, list) else []
            for block in blocks:
                value = block if isinstance(block, dict) else vars(block)
                if value.get('type') != 'tool_result' and type(block).__name__ != 'ToolResultBlock':
                    continue
                item = dict(self.tools.get(value.get('tool_use_id'), {}))
                if not item:
                    continue
                content = value.get('content', '')
                output = content if isinstance(content, str) else '\n'.join(x.get('text', '') for x in (content or []) if isinstance(x, dict))
                item.update(status='failed' if value.get('is_error') else 'completed')
                if item['type'] == 'commandExecution':
                    item['aggregatedOutput'] = output
                else:
                    item['output'] = output
                self.emit('item/completed', item=item)

    def close(self):
        self.stopping = True
        with self.lock:
            self.accepting = False
        if self.loop and self.client:
            try:
                future = asyncio.run_coroutine_threadsafe(self.client.interrupt(), self.loop)
                future.result(timeout=3)
            except Exception:
                pass
            # Cancellation runs the SDK context manager's process cleanup in its
            # owning event loop, including when a tool is waiting for an answer.
            def cancel():
                if self.main_task:
                    self.main_task.cancel()
            try:
                self.loop.call_soon_threadsafe(cancel)
            except RuntimeError:
                pass
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(timeout=8)
        self.requests.clear()
