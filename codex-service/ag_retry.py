"""Continue an AG task only after a completed turn reports rate limiting."""
import json
import re
import time
from urllib.parse import urlsplit
from any_retry import AnyRetry, retryable

AG_PROFILE_ID = 'computer-api'


def is_ag(profile):
    return (profile.get('id') == AG_PROFILE_ID
            and urlsplit(profile.get('base_url', '')).hostname == 'agentrouter.org')


class AgRetry(AnyRetry):
    def accepts(self, error):
        text = (error if isinstance(error, str) else json.dumps(error, ensure_ascii=False)).lower()
        normalized = re.sub(r'rate[ _-]?limit', 'rate limit', text).replace('限流', 'rate limit')
        return retryable(normalized) and bool(
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
