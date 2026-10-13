"""Passwordless, authenticated encryption of provider credentials at rest."""
import base64
import copy
import json
import os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class KeyStore:
    def __init__(self, root):
        self.path = Path(root) / 'provider.key'

    def cipher(self, create=False):
        if create and not self.path.exists():
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'wb') as f:
                    f.write(AESGCM.generate_key(bit_length=256))
                    f.flush()
                    os.fsync(f.fileno())
        self.path.chmod(0o600)
        return AESGCM(self.path.read_bytes())

    def decode(self, value):
        value = copy.deepcopy(value)
        for p in value.get('profiles', []):
            encrypted = p.pop('api_key_encrypted', None)
            if encrypted:
                data = base64.b64decode(encrypted, validate=True)
                p['api_key'] = self.cipher().decrypt(data[:12], data[12:], p['id'].encode()).decode()
        return value

    def encode(self, value):
        value = copy.deepcopy(value)
        cipher = self.cipher(create=True)
        for p in value.get('profiles', []):
            secret = p.pop('api_key', '')
            nonce = os.urandom(12)
            p['api_key_encrypted'] = base64.b64encode(nonce + cipher.encrypt(nonce, secret.encode(), p['id'].encode())).decode()
        return value

    def load(self, path, writer):
        raw = json.loads(path.read_text('utf-8'))
        decoded = self.decode(raw)
        if any('api_key' in p for p in raw.get('profiles', [])):
            writer(path, self.encode(decoded))
        return decoded
