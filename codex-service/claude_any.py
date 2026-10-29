#!/usr/bin/env python3
"""Launch an API-only terminal session using the task center's Any profile."""
import json
import os
from pathlib import Path
import sys
from claude_api_config import api_environment, claude_model
from key_store import KeyStore


def main():
    root = Path('/var/lib/ck-claude-tasks')
    value = KeyStore(root).decode(json.loads((root / 'config.json').read_text()))
    profile = next((p for p in value['profiles'] if p['id'] == '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e'), None)
    if not profile:
        raise SystemExit('共用供应商配置中没有 Any')
    option_path = root / 'claude-options.json'
    options = json.loads(option_path.read_text()) if option_path.exists() else {}
    model = claude_model(profile, options.get('profiles', {}).get(profile['id'], {}).get('model'))
    directory = root / 'terminal' / 'any'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    args = sys.argv[1:]
    if args and args[0] in ('auth', 'setup-token', 'gateway', 'install', 'update', 'upgrade'):
        raise SystemExit('此入口使用 Any API，不执行官方账号登录或更新；请由管理员维护客户端')
    cli = '/opt/ck-claude-tasks/bin/claude'
    os.execve(cli, [cli, '--model', model, *args], api_environment(profile, directory))


if __name__ == '__main__':
    main()
