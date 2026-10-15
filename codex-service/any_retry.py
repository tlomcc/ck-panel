"""Opt-in ANY task continuation; run state never survives a service restart."""
import json
import random
import re
import time

# Bind to the installed ANY profile, including if its display name changes.
ANY_PROFILE_ID = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e'
CONTINUE_TASK = ('继续完成用户在本窗口提交的尚未完成任务，包括已追加的要求。'
                 '上次请求因供应商暂时不可用而结束。先核对已有进展，'
                 '保留已成功的操作和结果，不重复执行已完成的工作；完成任务后结束。')


def is_any(profile):
    return profile.get('id') == ANY_PROFILE_ID


def retryable(error):
    text = (error if isinstance(error, str) else json.dumps(error, ensure_ascii=False)).lower()
    if any(word in text for word in ('unauthorized', 'invalid api key', 'insufficient_quota',
                                     'insufficient balance', 'billing', 'model_refusal',
                                     'context_length_exceeded', 'permission denied')):
        return False
    return bool(re.search(r'\b(?:429|500|502|503|504)\b', text) or any(word in text for word in (
        'high demand', 'overloaded', 'overload', 'server busy', 'rate limit', 'rate_limit',
        'too many requests', 'temporarily unavailable', 'temporary error',
        'internalservererror', 'internal server error', 'service unavailable',
        '负载', '过载', '繁忙', '请求过多')))


class AnyRetry:
    def __init__(self, request_id, limit=None):
        self.request_id = request_id
        self.limit = limit
        self.count = 0
        self.due = 0
        self.pending = False

    def accepts(self, error):
        return retryable(error)

    def available(self):
        return self.limit is None or self.count < self.limit

    def schedule(self, error=None):
        self.pending = True
        self.due = time.monotonic() + random.SystemRandom().randint(1, 10)

    def ready(self):
        return not self.pending or time.monotonic() >= self.due

    def starting(self):
        if self.pending:
            self.count += 1
            self.pending = False

    @property
    def text(self):
        return (f'已重试 {self.count} 次' if self.limit is None
                else f'已重试 {self.count} / {self.limit} 次')
