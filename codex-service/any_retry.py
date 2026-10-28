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
    if any(word in text for word in ('unauthorized', 'invalid api key', 'invalid_api_key', 'insufficient_quota',
                                     'insufficient balance', 'billing', 'model_refusal',
                                     'context_length_exceeded', 'permission denied')):
        return False
    if any(word in text for word in ('cancelled', 'canceled', 'user interrupted',
                                     'ck_any_upstream_idle_timeout', 'ck_any_upstream_connection_error')):
        return False
    # Resume only after the native turn has failed; the existing switch and cap
    # still own continuation. Cancellation and ambiguous timeouts stay excluded.
    if any(word in text for word in ('stream closed before response.completed',
                                     'ck_any_upstream_stream_incomplete',
                                     'ck_any_upstream_http_incomplete')):
        return True
    return bool(re.search(r'\b(?:429|500|502|503|504)\b', text) or any(word in text for word in (
        'high demand', 'overloaded', 'overload', 'server busy', 'rate limit', 'rate_limit', 'rate-limit',
        'too many requests', 'temporarily unavailable', 'temporary error',
        'internalservererror', 'internal server error', 'service unavailable',
        '负载', '过载', '繁忙', '请求过多', '限流', '限速')))


def rate_limited(error):
    """A busy/overloaded response is not a rate limit just because it uses 429."""
    if not retryable(error):
        return False
    text = (error if isinstance(error, str) else json.dumps(error, ensure_ascii=False)).lower()
    if any(word in text for word in ('high demand', 'overload', 'server busy', '负载', '过载', '繁忙')):
        return False
    if re.search(r'\brate[ _-]?limit|too many requests|请求过多|限流|限速', text):
        return True
    return bool(re.search(r'\b429\b', text))


class AnyRetry:
    def __init__(self, request_id, limit=None):
        self.request_id = request_id
        self.limit = limit
        self.count = 0
        self.bounded_count = 0
        self.has_progress = False
        self.continuation = False
        self.due = 0
        self.pending = False

    def accepts(self, error):
        return retryable(error)

    def available(self, error=None):
        continuation = self.continuation if error is None else self.has_progress and rate_limited(error)
        return continuation or self.limit is None or self.bounded_count < self.limit

    def schedule(self, error=None):
        self.continuation = self.has_progress and rate_limited(error)
        self.pending = True
        self.due = time.monotonic() + random.SystemRandom().randint(1, 10)

    def ready(self):
        return not self.pending or time.monotonic() >= self.due

    def starting(self):
        if self.pending:
            self.count += 1
            if not self.continuation:
                self.bounded_count += 1
            self.pending = False

    @property
    def text(self):
        text = (f'已重试 {self.bounded_count} 次' if self.limit is None
                else f'已重试 {self.bounded_count} / {self.limit} 次')
        continued = self.count - self.bounded_count
        if continued or self.continuation:
            text += f' · 执行中限流已继续 {continued} 次（不限次数）'
        return text
