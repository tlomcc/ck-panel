"""Read the CK conversation view without loading native tool/code records."""
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

VISIBLE_KINDS = ('userMessage', 'agentMessage', 'request', 'resolved', 'warning', 'error', 'diary')
OUTPUT_MODE = 'replies_diary_questions'
SHANGHAI = ZoneInfo('Asia/Shanghai')


def public_item(row):
    item = dict(row)
    data = json.loads(item['data']) if isinstance(item.get('data'), str) else (item.get('data') or {})
    kind = item.get('kind')
    if kind not in VISIBLE_KINDS:
        return None
    if kind in ('request', 'resolved') and data.get('method'):
        # Questions remain actionable; approval requests never carry patches or tool arguments.
        params = data.get('params') or {}
        data = {key: data[key] for key in ('id', 'method') if key in data}
        data['params'] = {key: params[key] for key in ('questions', 'reason') if key in params}
    else:
        allowed = ('type', 'id', 'phase', 'status', 'scheduled_for', 'willRetry', 'turnId', 'path', 'date')
        data = {key: data[key] for key in allowed if key in data}
    item['data'] = data
    return item


def add_diaries(result, workspace, previous=''):
    window = result['window']
    first = datetime.fromtimestamp(window['created'], SHANGHAI).date().isoformat()
    last = datetime.fromtimestamp(window['updated'], SHANGHAI).date().isoformat()
    root = (Path(workspace) / 'diary').resolve()
    files = []
    for path in sorted(root.glob('*.md')):
        if (re.fullmatch(r'\d{4}-\d{2}-\d{2}\.md', path.name) and first <= path.stem <= last
                and path.is_file() and not path.is_symlink()):
            info = path.stat()
            files.append((path, info))
    signature = hashlib.sha256(json.dumps([(p.name, s.st_mtime_ns, s.st_size) for p, s in files]).encode()).hexdigest()
    result['diary_cursor'] = signature
    if signature == previous:
        return result
    for path, info in files:
        result['items'].append({'window_id': window['id'], 'id': 'diary:' + path.stem,
                               'kind': 'diary', 'text': path.read_text('utf-8'),
                               'data': {'path': str(path), 'date': path.stem},
                               'seq': window['seq'], 'created': info.st_mtime})
    return result


def snapshot(db, wid, after=0, workspace=None, diary_cursor=''):
    window = db.execute('SELECT * FROM windows WHERE id=?', (wid,)).fetchone()
    if window is None:
        raise LookupError('窗口不存在或已删除')
    marks = ','.join('?' for _ in VISIBLE_KINDS)
    rows = db.execute('SELECT * FROM items WHERE window_id=? AND seq>? AND kind IN (' + marks + ') ORDER BY created,id',
                      (wid, after, *VISIBLE_KINDS)).fetchall()
    schedules = db.execute('''SELECT s.*,COALESCE(t.status,s.status) AS state
        FROM schedules s LEFT JOIN tasks t ON t.request_id=s.request_id WHERE s.window_id=?
        ORDER BY CASE WHEN s.status='scheduled' THEN 0 ELSE 1 END,
        CASE WHEN s.status='scheduled' THEN s.scheduled_for ELSE -s.scheduled_for END LIMIT 100''', (wid,)).fetchall()
    result = {'window': dict(window), 'items': [public_item(row) for row in rows],
              'cursor': window['seq'], 'schedules': [dict(row) for row in schedules], 'output_mode': OUTPUT_MODE}
    if workspace is not None:
        add_diaries(result, workspace, diary_cursor)
    return result
