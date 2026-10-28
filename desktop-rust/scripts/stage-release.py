#!/usr/bin/env python3
"""Upload a verified exact-source release as a draft. Never move update feeds."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

def run(*args):
    return subprocess.check_output(args,text=True).strip()

def main():
    base=Path(sys.argv[1]).resolve()
    metadata=json.loads((base/'release.json').read_text())
    revision=run('git','rev-parse','HEAD')
    if run('git','status','--porcelain') or run('git','branch','--show-current')!='master' or run('git','rev-parse','origin/master')!=revision:
        raise ValueError('Require a clean master synchronized with origin/master')
    if metadata['revision']!=revision or metadata['notarizationVerified'] is not True:
        raise ValueError('Wrong source or unverified notarization')
    version=metadata['version'];preview=metadata['prerelease'];tag=('preview-v' if preview else 'v')+version
    if not re.fullmatch(r'\d+\.\d+\.\d+',version) or metadata['tag']!=tag:
        raise ValueError('Invalid release version/tag')
    repo='Jovines/veymux'
    # Ref creation refuses an existing tag. A failed upload can be resumed only
    # after reviewing that draft; this entry never overwrites a released version.
    run('git','push','origin',f'{revision}:refs/tags/{tag}')
    notes=('Veymux Preview: signed macOS Rust client.' if preview else
           'Veymux Rust macOS 正式版，要求 macOS 14+（Apple Silicon）。\n\n提供 DMG、ZIP 和签名自动更新包。桌面与服务独立更新；现有终端会话继续运行。')
    with tempfile.NamedTemporaryFile(mode='w',suffix='.md') as temporary:
        temporary.write(notes);temporary.flush()
        args=['gh','release','create',tag,'--repo',repo,'--verify-tag','--draft','--latest=false','--title',('Veymux Preview ' if preview else 'Veymux v')+version,'--notes-file',temporary.name]
        if preview:args.append('--prerelease')
        run(*args)
    names=[a['name'] for a in metadata['artifacts']]+['release.json']
    for name in names:
        if Path(name).name!=name:raise ValueError('Invalid artifact name')
        run('gh','release','upload',tag,str(base/name),'--repo',repo)
    print(f'Uploaded verified draft {tag}; review and promote with the matching publisher.')

if __name__=='__main__':
    main()
