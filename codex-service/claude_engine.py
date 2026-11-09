"""Adapt official Claude Code SDK sessions to the task center's event contract."""
import asyncio
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import uuid

from claude_api_config import api_environment
import claude_context

class ClaudeEngine:
    FEEDBACK_INTERVAL = 15

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
        self.feedback_state = ''
        self.feedback_text = ''
        self.feedback_data = {}
        self.started_at = 0
        self.retry_at = None
        self.active_tools = set()
        self.context_policy = claude_context.enabled(self.profile)
        self.context_tokens = None
        self.context_input_tokens = None
        self.context_error = ''
        self.compact_started = None
        self.context_abort_sent = False
        self.context_abort_timer = None
        self.task_text = ''
        self.context_handoff = None

    def feedback(self, state, text, *, terminal=False, refresh=False, **data):
        """Persist one visible status card, including before the first model token."""
        with self.lock:
            if not self.turn_id or ((self.stopping or not self.executing) and not terminal):
                return
            if not refresh:
                text = self.manager.redact(text)
                if (state, text, data) == (self.feedback_state, self.feedback_text, self.feedback_data):
                    return
                self.feedback_state, self.feedback_text, self.feedback_data = state, text, data
            elapsed = max(0, int(time.monotonic() - self.started_at)) if self.started_at else 0
            visible = self.feedback_text
            details = dict(self.feedback_data, state=self.feedback_state,
                           turnId=self.turn_id, elapsed_seconds=elapsed)
            if self.feedback_state == 'retrying' and self.retry_at is not None:
                left = max(0, math.ceil(self.retry_at - time.monotonic()))
                visible += ('\n约 ' + str(left) + ' 秒后重试。') if left else '\n正在等待重试结果。'
                details['retry_in_seconds'] = left
            if elapsed and not terminal:
                visible += '\n本次任务已用时 ' + str(elapsed) + ' 秒。'
            # A late heartbeat must never change a stopped, deleted or newer turn.
            with self.manager.store.lock:
                row = self.manager.store.db.execute(
                    'SELECT turn_id,status FROM windows WHERE id=?', (self.wid,)).fetchone()
                if not row or row['turn_id'] != self.turn_id or row['status'] not in ('starting', 'running', 'waiting'):
                    return
                self.manager.store.item(self.wid, 'cc-status:' + self.turn_id, 'warning', visible, details)

    async def feedback_loop(self):
        while True:
            await asyncio.sleep(self.FEEDBACK_INTERVAL)
            if self.stopping:
                return
            if (self.context_policy and self.compact_started is not None
                    and time.monotonic() - self.compact_started >= claude_context.COMPACT_TIMEOUT):
                self.context_error = self.context_error or '上下文压缩已超过 5 分钟，已停止继续等待；此次压缩未确认成功。'
                await self.abort_context()
            if self.feedback_state:
                self.feedback(self.feedback_state, self.feedback_text, refresh=True)

    async def abort_context(self):
        if self.context_abort_sent or self.stopping or not self.client:
            return
        self.context_abort_sent = True
        self.feedback('context_stopped', self.context_error + '\n正在停止请求并保留接续资料。')
        if self.main_task:
            self.context_abort_timer = self.loop.call_later(12, self.main_task.cancel)
        try:
            await asyncio.wait_for(self.client.interrupt(), timeout=10)
        except (Exception, asyncio.CancelledError):
            if self.main_task:
                self.main_task.cancel()

    def context_failure(self):
        """Write references and the unfinished request, never raw tool output/thinking."""
        if not self.context_handoff:
            path = self.home / ('context-handoff-' + self.turn_id + '.md')
            touched = []
            for item in self.tools.values():
                for change in item.get('changes', []):
                    touched.append(str(change.get('path', '')) + ' — ' + item.get('status', 'unknown'))
            text = ('# Any CC 任务接续\n\n'
                    '这是停止时的定位记录，不是任务成功证明，也不是对完整历史的模型总结。\n\n'
                    '- 工作目录：' + self.manager.store.one(self.wid)['cwd'] + '\n'
                    '- 原窗口：' + self.wid + '\n- 原生会话：' + self.session_id + '\n'
                    '- 原生记录：' + str(self.home / 'native' / 'projects') + '/*/' + self.session_id + '.jsonl\n'
                    '- 停止原因：' + self.context_error + '\n\n'
                    '## 当前未完成的任务\n\n' + self.task_text + '\n\n'
                    '## 尚未处理的追加指令\n\n' + ('\n\n'.join(self.pending) or '无排队追加指令') + '\n\n'
                    '## 本轮涉及的文件\n\n' + ('\n'.join(touched) or '请按原窗口的工具记录核对；未自动推断文件修改。') + '\n\n'
                    '新窗口先读工作目录现行规则、日记和项目交接，再核 Git/现役状态。'
                    '按需读取旧记录中的最近用户任务、文字结论和工具状态；不要整文件载入图片、base64或原始思考。'
                    '已经执行的命令、发布和数据写入必须先核实，不能直接重放。受限材料继续保留待处理。\n')
            text = self.manager.redact(text)
            with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as out:
                out.write(text)
            self.context_handoff = str(path)
        error = self.context_error + '\n请新建窗口，发送：读取 ' + self.context_handoff + '，核对已完成操作后继续。'
        return {'id': self.turn_id, 'status': 'failed', 'error': {'message': error}}

    def retry_feedback(self, data):
        def number(*keys):
            for key in keys:
                value = data.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                    return max(0, int(value))
            return None
        status = number('error_status', 'status_code')
        attempt = number('attempt', 'retryAttempt')
        maximum = number('max_retries', 'maxRetries')
        delay = number('retry_delay_ms', 'retryInMs')
        if (self.context_policy and attempt is not None and attempt >= claude_context.STALL_RETRIES
                and ((self.context_tokens or 0) >= claude_context.STALL_CONTEXT or self.compact_started is not None)):
            self.context_error = '长上下文请求已连续重试 3 次，触发止损；可能是供应商故障或会话拥塞，未判定为死锁。'
            return
        self.retry_at = time.monotonic() + delay / 1000 if delay is not None else None
        text = '供应商返回 HTTP ' + str(status) if status else '供应商请求暂时失败'
        text += '，Claude Code 正在按原版策略重试。'
        if attempt is not None:
            text += '\n第 ' + str(attempt) + (' / ' + str(maximum) if maximum else '') + ' 次重试。'
        text += '\n可以点击「停止任务」结束等待。'
        self.feedback('retrying', text, http_status=status, attempt=attempt, max_retries=maximum)

    def failure_text(self, text):
        text = self.manager.redact(str(text))[:2000]
        match = re.search(r'\b(?:401|403|408|429|500|502|503|504|529)\b', text)
        if match:
            return '供应商返回 HTTP ' + match.group() + '，本次任务未完成。\n' + text
        return text or 'Claude Code 进程退出，本次任务未完成。'

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
                self.feedback_state, self.feedback_text, self.feedback_data = '', '', {}
                self.started_at = time.monotonic()
                self.retry_at = None
                self.active_tools.clear()
                self.tools.clear()
                self.context_error, self.context_handoff = '', None
                self.compact_started = None
                self.context_abort_sent = False
                text = '\n'.join(x['text'] for x in params['input'] if x.get('type') == 'text')
                self.task_text = text
                self.emit('turn/started', turn={'id': self.turn_id})
                self.feedback('starting', '任务已收到，正在国内 VPS 启动 Claude Code。')
                self.worker = threading.Thread(target=self.run, args=(text,), daemon=True)
                self.worker.start()
                return {'turn': {'id': self.turn_id}}
        elif method == 'turn/steer':
            with self.lock:
                if not self.executing or not self.accepting or params['expectedTurnId'] != self.turn_id:
                    raise Problem('本轮已结束，请作为下一条任务发送', 409)
                addition = '\n'.join(x['text'] for x in params['input'] if x.get('type') == 'text')
                self.pending.append(addition)
                self.task_text += '\n\n补充指令：\n' + addition
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
                if self.context_error:
                    outcome = self.context_failure()
                else:
                    error = self.failure_text(exc)
                    outcome = {'id': self.turn_id, 'status': 'failed', 'error': {'message': error}}
        finally:
            self.loop = self.client = self.main_task = None
            with self.lock:
                if self.stopping:
                    self.feedback('interrupted', '任务已停止，已保留会话和执行记录。', terminal=True)
                elif outcome:
                    if outcome['status'] == 'failed':
                        self.feedback('failed', '本次任务失败，具体报错见下方。', terminal=True)
                    else:
                        self.feedback('completed', 'Claude Code 已完成本次任务。', terminal=True)
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
        self.feedback('waiting_answer', 'Claude Code 正在等待你的回答，请在下方问题区域回复。')
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
        self.loop = asyncio.get_running_loop()
        self.main_task = asyncio.current_task()
        heartbeat = asyncio.create_task(self.feedback_loop())
        try:
            return await self.native_conversation(text)
        finally:
            if self.context_abort_timer:
                self.context_abort_timer.cancel()
                self.context_abort_timer = None
            heartbeat.cancel()
            try:
                await heartbeat
            except asyncio.CancelledError:
                pass

    async def native_conversation(self, text):
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
        native = self.home / 'native'
        native.mkdir(mode=0o700, exist_ok=True)
        # Claude persists the transcript before a tool runs. A task can be
        # stopped before ResultMessage, so completion is not a resume marker.
        persisted = any(p.stat().st_size for p in
                        (native / 'projects').glob('*/' + self.session_id + '.jsonl'))
        self.context_tokens = None
        if self.context_policy and persisted:
            transcript = next((native / 'projects').glob('*/' + self.session_id + '.jsonl'))
            self.context_tokens = claude_context.transcript_tokens(transcript)
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
            settings=claude_context.native_settings(self.profile, hosted=True),
            can_use_tool=self.permission,
            include_partial_messages=True, stderr=lambda _: None,
            **kwargs,
        )
        async with ClaudeSDKClient(options=options) as client:
            self.client = client
            image_compactions = 0
            compacting_image = None
            compact_sequence = 0
            compact_boundary = False
            deferred_image_inputs = []
            await client.query(text, session_id=self.session_id)
            self.feedback('requesting', 'Claude Code 已启动，正在等待供应商返回。')
            async for message in client.receive_messages():
                if self.stopping:
                    return
                kind = type(message).__name__
                if kind == 'ResultMessage':
                    if self.context_error:
                        return self.context_failure()
                    usage = getattr(message, 'usage', {}) or {}
                    total = sum(int(usage.get(k) or 0) for k in
                                ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'))
                    self.emit('thread/tokenUsage/updated', tokenUsage={'total': {'totalTokens': total}})
                    failed = bool(message.is_error) or message.subtype != 'success'
                    if compacting_image is not None:
                        state = claude_context.read_state(native, self.session_id)
                        if failed or not compact_boundary or state.get('compact_seq', 0) <= compact_sequence or not state.get('compacted'):
                            self.context_error = '看图前压缩未确认成功，已拦截图片并停止自动继续。'
                            return self.context_failure()
                        compacting_image = None
                        self.compact_started = None
                        self.feedback('requesting', '看图前压缩已确认成功，正在接续刚才的读取。')
                        await client.query('看图前的原生压缩已经确认成功。继续本轮被推迟的图片读取，工具及参数为 '
                            + json.dumps(deferred_image_inputs, ensure_ascii=False)
                            + '。从压缩摘要接续原任务，先核已完成操作，不重放已完成的写入、部署或命令。',
                            session_id=self.session_id)
                        continue
                    deferred = getattr(message, 'deferred_tool_use', None)
                    if deferred is not None:
                        state = claude_context.read_state(native, self.session_id) if self.context_policy else {}
                        if (not self.context_policy or not state.get('needs_compact')
                                or deferred.id not in state.get('deferred_tool_ids', [])):
                            return {'id': self.turn_id, 'status': 'failed', 'error': {'message': '工具被原生钩子推迟，本次任务尚未完成。'}}
                        if image_compactions >= 1:
                            self.context_error = '本轮已经为看图压缩过一次，仍未满足读取条件；停止重复压缩并保留原图。'
                            return self.context_failure()
                        if self.active_tools - set(state.get('deferred_tool_ids', [])):
                            self.context_error = '图片读取已推迟，但还有并行工具未确认结束；先核对执行记录，停止自动压缩接续。'
                            return self.context_failure()
                        deferred_image_inputs = []
                        for iid in state.get('deferred_tool_ids', []):
                            item = self.tools.get(iid)
                            if item:
                                deferred_image_inputs.append({'name': item.get('name'), 'input': item.get('input', {})})
                                item.update(status='failed', output='读取已推迟，图片尚未进入模型；等待成功压缩后接续。')
                                self.active_tools.discard(iid)
                                self.emit('item/completed', item=dict(item))
                        if not deferred_image_inputs:
                            deferred_image_inputs = [{'name': deferred.name, 'input': deferred.input}]
                        image_compactions += 1
                        compacting_image = deferred
                        compact_sequence = state.get('compact_seq', 0)
                        compact_boundary = False
                        self.compact_started = time.monotonic()
                        self.feedback('compacting', '图片读取已暂停，正在先压缩上下文；失败时不会放行图片。')
                        await client.query('/compact 保留当前任务、用户约束、工作目录、已完成改动与验证、待办和必要路径。'
                            '不要复制图片、base64、大段日志或原始思考。说明刚才的图片读取尚未执行，接续时先核已完成操作。',
                            session_id=self.session_id)
                        continue
                    with self.lock:
                        pending, self.pending = self.pending, []
                        if not pending or failed:
                            self.accepting = False
                    if pending and not failed:
                        self.feedback('requesting', '正在同一会话中处理你的补充指令，等待供应商返回。')
                        await client.query('\n\n'.join(pending), session_id=self.session_id)
                        continue
                    if failed:
                        errors = getattr(message, 'errors', None) or [getattr(message, 'result', None) or message.subtype]
                        error = self.failure_text('\n'.join(str(x) for x in errors))
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
                if kind == 'SystemMessage' and message.subtype == 'compact_boundary':
                    compact_boundary = True
                if compacting_image is None or kind == 'SystemMessage':
                    self.consume(message)
                if self.context_error:
                    await self.abort_context()
            raise RuntimeError('Claude Code 未返回完整结束记录；请检查已完成操作后继续')

    def consume(self, message):
        kind = type(message).__name__
        if kind == 'SystemMessage':
            data = getattr(message, 'data', {}) or {}
            if message.subtype in ('api_retry', 'api_error'):
                self.retry_feedback(data)
            elif message.subtype == 'init':
                self.feedback('requesting', 'Claude Code 已启动，正在等待供应商返回。')
            elif message.subtype == 'status':
                state = data.get('status')
                if state == 'compacting':
                    if self.context_policy and self.compact_started is None:
                        self.compact_started = time.monotonic()
                    self.feedback('compacting', '正在整理会话上下文，完成后继续任务。')
                elif state == 'requesting' and self.feedback_state != 'retrying':
                    self.feedback('requesting', '正在等待供应商返回。')
            elif message.subtype == 'compact_boundary':
                self.compact_started = None
                self.context_tokens = None
                self.context_input_tokens = None
            return
        if kind == 'StreamEvent':
            event = message.event
            if event.get('type') == 'message_start':
                tokens = claude_context.token_count(event.get('message', {}).get('usage'))
                if not getattr(message, 'parent_tool_use_id', None):
                    self.context_tokens = tokens
                    self.context_input_tokens = (tokens - int(event['message']['usage'].get('output_tokens', 0))
                                                 if tokens is not None else None)
                self.message_id = event.get('message', {}).get('id') or uuid.uuid4().hex
                self.feedback('responding', '已收到供应商响应，Claude Code 正在处理任务。')
            elif event.get('type') == 'content_block_delta':
                delta = event.get('delta') or {}
                if delta.get('type') == 'text_delta':
                    self.feedback('responding', 'Claude Code 正在生成回复。')
                    iid = 'cc:' + self.turn_id + ':' + self.message_id
                    self.last_text_id = iid
                    self.emit('item/agentMessage/delta', itemId=iid, delta=delta.get('text', ''))
                elif delta.get('type') == 'thinking_delta':
                    self.feedback('thinking', 'Claude Code 正在思考，尚未生成可显示的回复。')
                    self.manager.progress(self.wid, self.turn_id)
            elif event.get('type') == 'message_delta' and not getattr(message, 'parent_tool_use_id', None):
                output = (event.get('usage') or {}).get('output_tokens')
                if self.context_input_tokens is not None and isinstance(output, int) and output >= 0:
                    self.context_tokens = self.context_input_tokens + output
            return  # Raw thinking and signatures are never stored in panel items.
        if kind == 'AssistantMessage':
            text = ''.join(getattr(block, 'text', '') for block in message.content
                           if type(block).__name__ == 'TextBlock')
            if getattr(message, 'error', None):
                self.feedback('provider_error', self.failure_text(text or message.error))
                return
            if text:
                iid = 'cc:' + self.turn_id + ':' + (self.message_id or uuid.uuid4().hex)
                self.last_text_id = iid
                self.emit('item/completed', item={'id': iid, 'type': 'agentMessage',
                                                'text': text, 'phase': 'commentary'})
            for block in message.content:
                if type(block).__name__ != 'ToolUseBlock':
                    continue
                if self.context_policy and not getattr(message, 'parent_tool_use_id', None):
                    claude_context.record_tool_tokens(self.home / 'native', self.session_id, block.id, self.context_tokens)
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
                self.active_tools.add(block.id)
                self.feedback('working', 'Claude Code 正在执行工具：' + self.manager.redact(block.name)[:80] + '。')
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
                self.active_tools.discard(value.get('tool_use_id'))
                content = value.get('content', '')
                output = content if isinstance(content, str) else '\n'.join(x.get('text', '') for x in (content or []) if isinstance(x, dict))
                item.update(status='failed' if value.get('is_error') else 'completed')
                if item['type'] == 'commandExecution':
                    item['aggregatedOutput'] = output
                else:
                    item['output'] = output
                self.tools[value.get('tool_use_id')] = item
                self.emit('item/completed', item=item)
                if not self.active_tools:
                    self.feedback('requesting', '工具执行已结束，正在等待模型继续处理。')

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
