"""Third-party API settings for the domestic Claude Code task runtime."""
import os
import re
from urllib.parse import urlsplit, urlunsplit

DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
ANY_PROFILE_ID = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e'
ANY_MODEL = 'claude-opus-5-5[1m]'
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')
PROXY = 'http://127.0.0.1:19009'
OFFICIAL = ('anthropic.com', 'claude.ai', 'claude.com')


def claude_model(profile, value=None):
    model = str(value or (ANY_MODEL if profile.get('id') == ANY_PROFILE_ID else DEFAULT_MODEL)).strip()
    if profile.get('id') == ANY_PROFILE_ID and model in ('claude-opus-5-5', 'claude-opus-5-5[1M]'):
        model = ANY_MODEL
    return model


def api_base(value, *, test=False):
    url = urlsplit(str(value).strip().rstrip('/'))
    local_test = test and url.scheme == 'http' and url.hostname == '127.0.0.1'
    if ((url.scheme != 'https' and not local_test) or not url.hostname
            or url.username or url.password or url.query or url.fragment):
        raise ValueError('供应商需要不含账号或查询参数的 HTTPS 地址')
    host = url.hostname.lower().rstrip('.')
    if any(host == name or host.endswith('.' + name) for name in OFFICIAL):
        raise ValueError('国内 Claude Code 任务仅使用第三方 API 供应商')
    path = url.path.rstrip('/')
    if path.endswith('/v1'):
        path = path[:-3]
    return urlunsplit((url.scheme, url.netloc, path, '', ''))


def api_environment(profile, config_dir, *, test=False):
    if not profile.get('api_key'):
        raise ValueError('请先在共用供应商配置中保存 API 密钥')
    # Do not inherit another agent's login, proxy, model or provider variables.
    # The SDK merges this mapping over os.environ, so explicitly clear inherited
    # credentials as well as constructing a clean environment for the terminal.
    env = {k: '' if re.search(r'(?i)(claude|anthropic|openai|codex|api.?key|token|secret|proxy)', k)
           else v for k, v in os.environ.items()}
    proxy = '' if test else PROXY
    env.update({
        'ANTHROPIC_API_KEY': profile['api_key'],
        'ANTHROPIC_AUTH_TOKEN': '', 'CLAUDE_CODE_OAUTH_TOKEN': '',
        'ANTHROPIC_BASE_URL': api_base(profile['base_url'], test=test),
        'ANTHROPIC_CUSTOM_HEADERS': '',
        'CLAUDE_CONFIG_DIR': str(config_dir),
        'CLAUDE_CODE_USE_BEDROCK': '0', 'CLAUDE_CODE_USE_VERTEX': '0',
        'CLAUDE_CODE_USE_FOUNDRY': '0',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1',
        'DISABLE_AUTOUPDATER': '1',
        'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy, 'ALL_PROXY': '',
        'http_proxy': proxy, 'https_proxy': proxy, 'all_proxy': '',
        'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
        'LANG': 'C.UTF-8', 'TZ': 'Asia/Shanghai',
    })
    return env
