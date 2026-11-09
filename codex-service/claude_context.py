"""Any-only context policy using native Claude Code settings and hooks.

No provider transport, subscription credentials, or model implementation lives here.
The command hook runs locally; OCR never calls a model or an external OCR service.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time

ANY_PROFILE_ID = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e'
CONTEXT_WINDOW = 300000
IMAGE_CONTEXT_LIMIT = 160000
STALL_CONTEXT = 200000
STALL_RETRIES = 3
COMPACT_TIMEOUT = 300
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.pdf'}
POLICY = """Any Claude Code 上下文约定（用户 2026-11-09 授权）：
- 原生自动压缩窗口为 300K；这是工作窗口，不是供应商容量保证。提前保存任务交接，勿用大段日志撑满上下文。
- 大型项目任务默认拆给 2 个原生子代理，确有独立工作时可增至 6 个；简单问题/串行修改由主会话做。
  这是 Any CC 对“未明确要求不分派”的专项授权，不适用于其它引擎。用户本轮限制仍优先。
  子代理继承当前模型；只分配必要文件和具体目标，禁止互相覆盖文件、重复部署或复制整段历史。
  子代理只回传结论、修改路径、验证和阻塞，完整材料落盘；主会话统一审阅、验证和部署。
- 图片用服务器绝对路径。首次 Read 图片会优先得到本地中英文 OCR 文本；OCR 不代表已看过原图。
  文字不足以判断布局/图形时，再 Read 原路径。看原图必须经过成功压缩且当前上下文低于 160K。
  未成功压缩绝不绕过钩子、改用其它工具夹带图片或把图片/base64 粘进对话。
  任务中心会暂停该次读取，最多自动压缩一次再接续；终端按拦截说明执行 /compact 后继续。
  子代理不能借用主会话的压缩记录；需要原图时交给主会话或使用自己已成功压缩的上下文。
- 200K 以上连续重试达到 3 次属于止损信号，不能据此断言一定死锁；不要循环 /compact 或原样重发任务。
  压缩超过 5 分钟也应停止并保留记录。任务中心会给接续文件；新窗口先读交接、核已完成操作再继续。
- 大阶段结束、压缩前及收尾，在工作目录 work 下维护简短交接：任务目标、当前分支/文件、已验证项、下一步。
  不记录密钥或原始思考。原固定出口、人工事件复核、极简备份和每 60 秒进度规则继续有效。
"""


def enabled(profile):
    return profile.get('id') == ANY_PROFILE_ID


def native_settings(profile, *, hosted=False):
    if not enabled(profile):
        return None
    command = shlex.join([sys.executable, '-B', str(Path(__file__).resolve()), 'hook',
                          'hosted' if hosted else 'terminal'])
    hook = {'type': 'command', 'command': command, 'timeout': 60}
    return json.dumps({'autoCompactEnabled': True, 'hooks': {
        'SessionStart': [{'hooks': [hook]}],
        'SubagentStart': [{'hooks': [hook]}],
        'UserPromptSubmit': [{'hooks': [hook]}],
        'PostCompact': [{'hooks': [hook]}],
        'PreToolUse': [{'matcher': 'Read|mcp__.*', 'hooks': [hook]}],
    }}, ensure_ascii=False)


def token_count(usage):
    if not isinstance(usage, dict) or not any(k in usage for k in
            ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')):
        return None
    result = 0
    for key in ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'):
        value = usage.get(key, 0)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            return None
        result += int(value)
    return result


def transcript_tokens(path):
    """Read the latest assistant usage, never cumulative turn billing or images."""
    try:
        with Path(path).open('rb') as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - 2 * 1024 * 1024))
            lines = stream.read().splitlines()
        for line in reversed(lines):
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if row.get('type') == 'system' and row.get('subtype') == 'compact_boundary':
                break
            if row.get('type') == 'assistant':
                value = token_count((row.get('message') or {}).get('usage'))
                if value is not None:
                    return value
    except (OSError, TypeError):
        pass
    return None


def state_path(native, session_id, agent_id=''):
    name = hashlib.sha256((session_id + ':' + agent_id).encode()).hexdigest()[:32]
    return Path(native) / 'ck-context' / (name + '.json')


@contextmanager
def locked_state(native, session_id, agent_id=''):
    path = state_path(native, session_id, agent_id)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path.with_suffix('.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            value = json.loads(path.read_text()) if path.exists() else {}
        except (ValueError, OSError):
            value = {}
        yield value
        tmp = path.with_suffix('.tmp')
        with os.fdopen(os.open(tmp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'w') as out:
            json.dump(value, out, ensure_ascii=False)
        os.replace(tmp, path)


def read_state(native, session_id):
    try:
        return json.loads(state_path(native, session_id).read_text())
    except (OSError, ValueError):
        return {}


def record_tool_tokens(native, session_id, tool_id, tokens):
    """Correlate the native stream's actual usage with this exact root tool call."""
    with locked_state(native, session_id) as state:
        usage = state.setdefault('tool_tokens', {})
        usage[tool_id] = tokens
        state['tool_tokens'] = dict(list(usage.items())[-64:])


def image_tokens(data, native, session_id, agent_id, hosted):
    if not hosted or agent_id:
        return transcript_tokens(data.get('transcript_path'))
    # The transcript writer may lag the tool hook just after compaction. Wait
    # briefly for the host's exact tool-id usage, not an older transcript row.
    until = time.monotonic() + 1
    while True:
        usage = read_state(native, session_id).get('tool_tokens', {})
        if data.get('tool_use_id') in usage:
            return usage[data['tool_use_id']]
        if time.monotonic() >= until:
            return None
        time.sleep(.01)


def visual_input(name, inputs):
    if name != 'Read':
        return bool(re.search(r'(?:screenshot|view_image|read_image|image_view|vision)', name, re.I))
    path = Path(str(inputs.get('file_path', ''))).expanduser()
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return True
    try:
        with path.open('rb') as stream:
            magic = stream.read(16)
        return (magic.startswith((b'\x89PNG', b'\xff\xd8\xff', b'GIF8', b'BM', b'II*\x00', b'MM\x00*', b'%PDF'))
                or magic.startswith(b'RIFF') and magic[8:12] == b'WEBP')
    except OSError:
        return False


def ocr_image(path, native):
    """Return a local text path, or None when OCR cannot provide usable text."""
    path = Path(path).expanduser().resolve()
    if path.suffix.lower() == '.pdf' or path.stat().st_size > 25 * 1024 * 1024:
        return None
    result = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'chi_sim+eng', '--psm', '3'],
                            capture_output=True, timeout=25)
    text = result.stdout.decode('utf-8', 'replace').strip()
    if result.returncode or not any(ch.isalnum() for ch in text):
        return None
    stat = path.stat()
    digest = hashlib.sha256((str(path) + ':' + str(stat.st_mtime_ns) + ':' + str(stat.st_size)).encode()).hexdigest()
    target = Path(native) / 'ck-context' / (digest + '.ocr.txt')
    with os.fdopen(os.open(target, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'w') as out:
        out.write('本地 OCR 文本，尚未读取原图；可能漏字、误识别，不代表视觉检查已完成。\n\n' + text + '\n')
    return str(target)


def hook(data, *, hosted=False):
    event = data.get('hook_event_name')
    native = os.environ['CLAUDE_CONFIG_DIR']
    session_id = str(data['session_id'])
    agent_id = str(data.get('agent_id') or '')
    if not agent_id and 'subagents' in Path(str(data.get('transcript_path', ''))).parts:
        agent_id = Path(data['transcript_path']).stem
    if event == 'SubagentStart':
        return {'hookSpecificOutput': {'hookEventName': event, 'additionalContext':
            '只完成分配的独立子任务；不要再派子代理。继承现行固定出口和资料保护规则。'
            '回传简短结论、文件路径、验证与阻塞；禁止大段日志/图片/base64回灌主会话。'}}
    if event == 'SessionStart':
        if data.get('source') != 'compact':
            with locked_state(native, session_id, agent_id) as state:
                state.update(compacted=False, image_used=False, needs_compact=False,
                             deferred_tool_ids=[], tool_tokens={})
        return {'hookSpecificOutput': {'hookEventName': event, 'additionalContext': POLICY}}
    if event == 'UserPromptSubmit':
        with locked_state(native, session_id, agent_id) as state:
            if state.get('image_used'):
                state.update(compacted=False, image_used=False, deferred_tool_ids=[])
        return {}
    if event == 'PostCompact':
        with locked_state(native, session_id, agent_id) as state:
            state.update(compacted=True, image_used=False, needs_compact=False,
                         compact_seq=state.get('compact_seq', 0) + 1, compacted_at=time.time(), deferred_tool_ids=[])
        return {}
    name, inputs = data.get('tool_name', ''), data.get('tool_input') or {}
    if event != 'PreToolUse' or not visual_input(name, inputs):
        return {}
    tokens = image_tokens(data, native, session_id, agent_id, hosted)
    with locked_state(native, session_id, agent_id) as state:
        if name == 'Read':
            path = Path(str(inputs.get('file_path', ''))).expanduser().resolve()
            try:
                st = path.stat()
                key = hashlib.sha256((str(path) + ':' + str(st.st_mtime_ns) + ':' + str(st.st_size)).encode()).hexdigest()
                seen = state.setdefault('ocr_seen', [])
                if key not in seen:
                    seen.append(key)
                    state['ocr_seen'] = seen[-128:]
                    target = ocr_image(path, native)
                    if target:
                        return {'hookSpecificOutput': {'hookEventName': event,
                            'updatedInput': {'file_path': target}, 'additionalContext':
                            '此次 Read 已替换为本地 OCR 文本，原图没有发送给模型。'
                            '若需要看布局/图形，请再次 Read 原图片路径；届时必须先成功压缩。'}}
            except (OSError, subprocess.SubprocessError):
                pass
        if state.get('compacted') and tokens is not None and tokens < IMAGE_CONTEXT_LIMIT:
            state['image_used'] = True
            state['needs_compact'] = False
            return {}
        pending = state.setdefault('deferred_tool_ids', [])
        if data.get('tool_use_id') not in pending:
            pending.append(data.get('tool_use_id'))
        state.update(needs_compact=True, deferred_tool_ids=pending[-32:], observed_tokens=tokens)
        reason = ('看图前必须先成功压缩，且上下文低于 160K；此次图片尚未读取。'
                  '请先保留交接，再执行 /compact。压缩失败不得换工具绕过；可继续使用本地 OCR 文本。')
        return {'hookSpecificOutput': {'hookEventName': event,
            'permissionDecision': 'defer' if hosted and not agent_id else 'deny',
            'permissionDecisionReason': reason}}


def main():
    if len(sys.argv) < 2 or sys.argv[1] != 'hook':
        raise SystemExit('This module is a Claude Code command hook.')
    try:
        data = json.load(sys.stdin)
        print(json.dumps(hook(data, hosted=len(sys.argv) > 2 and sys.argv[2] == 'hosted'), ensure_ascii=False))
    except Exception:
        # Exit 2 is the native blocking-hook contract; a broken gate cannot
        # silently permit an image or expose local input/credentials in errors.
        print('Any 上下文钩子未能完成检查；停止此步骤，保留现状并检查本地钩子。', file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
