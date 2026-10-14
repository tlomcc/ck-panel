"""Continue an AG task only after a completed turn reports rate limiting."""
import json
import re
import time
from urllib.parse import urlsplit
CONTINUE_TASK = ('继续完成用户在本窗口提交的尚未完成任务，包括已追加的要求。'
                 '上次请求因供应商暂时不可用而结束。先核对已有进展，'
                 '保留已成功的操作和结果，不重复执行已完成的工作；完成任务后结束。')


AG_PROFILE_ID = 'computer-api'


def is_ag(profile):
    return (profile.get('id') == AG_PROFILE_ID
            and urlsplit(profile.get('base_url', '')).hostname == 'agentrouter.org')


class AgRetry:
    def __init__(self, request_id):
        self.request_id = request_id
        self.count = 0
        self.due = 0
        self.pending = False

    def ready(self):
        return not self.pending or time.monotonic() >= self.due

    def starting(self):
        if self.pending:
            self.count += 1
            self.pending = False

    def accepts(self, error):
        text = (error if isinstance(error, str) else json.dumps(error, ensure_ascii=False)).lower()
        normalized = re.sub(r'rate[ _-]?limit', 'rate limit', text).replace('限流', 'rate limit')
        if any(word in normalized for word in (
                'unauthorized', 'invalid api key', 'insufficient_quota',
                'insufficient balance', 'billing', 'model_refusal',
                'context_length_exceeded', 'permission denied')):
            return False
        return bool(
            re.search(r'\brate[ _-]?limit|\b429\b|too many requests|请求过多|限流', text))

    def schedule(self, error=None):
        self.delay = min(60, 10 * 2 ** min(self.count, 3))
        # Honor a numeric Retry-After if the CLI includes it in the error.
        text = error if isinstance(error, str) else json.dumps(error or {}, ensure_ascii=False)
        hint = re.search(r'retry[ _-]?after(ms)?[\s\"\x27:=]+(\d+(?:\.\d+)?)', text, re.I)
        if hint:
            self.delay = max(self.delay, float(hint[2]) / (1000 if hint[1] else 1))
        self.pending = True
        self.due = time.monotonic() + self.delay

    @property
    def text(self):
        if self.pending:
            return f'AG 限流，等待 {self.delay:g} 秒后继续 · 已自动继续 {self.count} 次'
        return f'AG 限流后已自动继续 {self.count} 次'
