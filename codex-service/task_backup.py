#!/usr/bin/env python3
"""One local backup unit per task, capturing only explicitly named paths."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = Path(os.environ.get('CK_TASK_BACKUPS', '/var/backups/ck-codex'))


def main():
    parser = argparse.ArgumentParser(description='极简备份：每个任务一个单元，只复制指定的必要文件。')
    parser.add_argument('task', help='本次任务的固定名称，同一任务重复使用同一个名称')
    parser.add_argument('--before', nargs='*', default=[])
    parser.add_argument('--after', nargs='*', default=[])
    parser.add_argument('--ref', action='append', default=[], help='可恢复的 Git commit 或 release 引用')
    parser.add_argument('--note', default='')
    args = parser.parse_args()
    if not re.fullmatch(r'[\w\-\u4e00-\u9fff]{1,100}', args.task):
        parser.error('任务名称只允许中英文、数字、横线和下划线')
    folder = BASE / args.task
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = folder/'manifest.json'
    value = json.loads(manifest.read_text('utf-8')) if manifest.exists() else {'task':args.task,'created':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),'files':{},'references':[]}
    for phase in ('before','after'):
        for source in getattr(args, phase):
            path = Path(source).resolve(strict=True)
            if not path.is_file():
                raise SystemExit('只接受具体文件；目录/整库请选取实际受影响内容：'+str(path))
            if path.stat().st_size > 32*1024*1024:
                raise SystemExit('文件超过32MB，请优先引用Git/release或导出受影响数据记录')
            identifier = hashlib.sha256(str(path).encode()).hexdigest()[:12]+'-'+path.name
            target = folder/phase/identifier
            target.parent.mkdir(exist_ok=True,mode=0o700)
            if phase=='before' and target.exists():
                continue
            shutil.copy2(path,target)
            target.chmod(0o600)
            value['files'][phase+':'+str(path)]={'source':str(path),'stored':str(target.relative_to(folder)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    value['references']=list(dict.fromkeys(value['references']+args.ref))
    value['updated']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()
    if args.note:value['note']=args.note
    manifest.write_text(json.dumps(value,ensure_ascii=False,indent=2),'utf-8')
    manifest.chmod(0o600)
    (folder/'恢复说明.md').write_text('# '+args.task+'\n\n'+value.get('note','')+'\n\n本机任务备份，不复制到另一台机器。before 是受影响文件的修改前版本，after 是未由 Git/release 保存的修改后版本。按 manifest.json 的 source 路径恢复所需文件；配置恢复前先确认现役没有后续修改。references 中的 Git commit/release 可直接作为恢复来源，不重复打包。只读检查不调用本工具。\n','utf-8')
    print(str(folder))


if __name__=='__main__':main()
