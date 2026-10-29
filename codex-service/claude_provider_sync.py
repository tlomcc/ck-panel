"""Mirror the existing API catalog over SSH; never copy subscription state."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from key_store import KeyStore
from claude_api_config import api_base


class SourceKeyStore(KeyStore):
    def cipher(self, create=False):
        if create:
            raise ValueError('The shared source is read-only')
        return AESGCM(self.path.read_bytes())


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.incoming-' + str(os.getpid()))
    with temporary.open('x', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, path)


def receive(root, payload):
    profiles = payload.get('profiles')
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 20:
        raise ValueError('Invalid provider catalog')
    if not re.fullmatch('[a-f0-9]{64}', str(payload.get('access_hash', ''))):
        raise ValueError('Invalid task authentication hash')
    ids, accepted = set(), []
    for profile in profiles:
        pid = profile.get('id', '')
        if not re.fullmatch('[a-zA-Z0-9_-]{1,80}', pid) or pid in ids:
            raise ValueError('Invalid provider ID')
        ids.add(pid)
        api_base(profile.get('base_url', ''))
        key = profile.get('api_key', '')
        if not isinstance(key, str) or len(key) > 8192 or any(ord(c) < 32 for c in key):
            raise ValueError('Invalid provider credential')
        accepted.append({k: profile.get(k, '') for k in
                         ('id', 'name', 'base_url', 'api_key', 'model', 'effort', 'revision')})
    value = {'profiles': accepted, 'access_hash': payload['access_hash'],
             'default_profile': payload.get('default_profile'),
             'source_revision': payload['source_revision'], 'synced_at': time.time()}
    path = root / 'config.json'
    if path.exists() and json.loads(path.read_text()).get('source_revision') == value['source_revision']:
        return {'ok': True, 'changed': False, 'profiles': len(accepted)}
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_json(path, KeyStore(root).encode(value))
    return {'ok': True, 'changed': True, 'profiles': len(accepted)}


def watch(source, destination):
    previous = None
    last_success = 0
    status_path = Path('/var/lib/ck-claude-provider-sync/status.json')
    while True:
        try:
            raw = (source / 'config.json').read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            # A heartbeat also restores a missing domestic catalog after recovery.
            if previous != digest or not status_path.exists() or time.monotonic() - last_success > 300:
                value = SourceKeyStore(source).decode(json.loads(raw))
                payload = {k: value.get(k) for k in ('profiles', 'access_hash', 'default_profile')}
                payload['source_revision'] = digest
                proc = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'ConnectTimeout=10', destination,
                    '/opt/ck-claude-tasks/venv/bin/python /opt/ck-claude-tasks/claude_provider_sync.py receive'],
                    input=json.dumps(payload), text=True, capture_output=True, timeout=25)
                if proc.returncode or not json.loads(proc.stdout).get('ok'):
                    raise RuntimeError('SSH catalog sync failed')
                previous = digest
                last_success = time.monotonic()
                atomic_json(status_path, {'ok': True, 'updated': time.time(),
                                         'source_revision': digest, 'profiles': len(payload['profiles'])})
            time.sleep(5)
        except Exception:
            # Neither remote stderr nor the input payload belongs in the journal.
            atomic_json(status_path, {'ok': False, 'updated': time.time(),
                                     'error': '供应商同步暂时失败，稍后自动重连；现有任务不受影响'})
            time.sleep(15)


if __name__ == '__main__':
    os.umask(0o077)
    if sys.argv[1:] == ['receive']:
        try:
            print(json.dumps(receive(Path(os.environ.get('CK_CLAUDE_STATE', '/var/lib/ck-claude-tasks')),
                                     json.load(sys.stdin))))
        except Exception:
            raise SystemExit('Provider catalog was not installed')
    elif sys.argv[1:] == ['watch']:
        watch(Path('/var/lib/ck-codex'), 'ck-cn')
    else:
        raise SystemExit('Expected receive or watch')
