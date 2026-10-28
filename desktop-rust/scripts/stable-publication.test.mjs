import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('stable publication validates complete signed Rust artifacts without retired client assets', () => {
  execFileSync('python3', ['-B', '-c', String.raw`
import copy, hashlib, importlib.util, json, pathlib, tempfile
spec=importlib.util.spec_from_file_location('promote', 'promote-stable.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
version='1.4.363';revision='a'*40;prefix=f'Veymux_{version}_aarch64'
identity=dict(version=version,bundle='com.jovines.veymux',minimumMacOS='14.0',architecture='arm64',executable='Veymux',gatekeeperAccepted=True,notaryTicketValidated=True,updateTrustPinned=True)
root='https://github.com/Jovines/veymux/releases/download'
with tempfile.TemporaryDirectory() as temporary:
    base=pathlib.Path(temporary)
    metadata=dict(version=version,tag='v'+version,revision=revision,notarizationVerified=True,prerelease=False,
        config=dict(identifier='com.jovines.veymux',productName='Veymux'),endpoint=root+'/stable-channel/latest.json',
        appNotarySubmission='a'*36,dmgNotarySubmission='b'*36,verification={**identity,'dmgApp':identity.copy(),'rustZipApp':identity.copy()})
    manifest=dict(version=version,platforms={'darwin-aarch64':dict(url=root+'/v'+version+'/'+prefix+'.app.tar.gz',signature='signature')})
    files={prefix+'.dmg':b'dmg',prefix+'.app.tar.gz':b'archive',prefix+'.app.tar.gz.sig':b'signature','latest.json':json.dumps(manifest).encode(),f'Veymux-Rust-darwin-arm64-{version}.zip':b'zip'}
    def prepare(meta, payloads):
        meta=copy.deepcopy(meta)
        meta['artifacts']=[dict(name=name,size=len(data),sha256=hashlib.sha256(data).hexdigest()) for name,data in payloads.items()]
        all_files={**payloads,'release.json':json.dumps(meta).encode()}
        for name,data in all_files.items():(base/name).write_bytes(data)
        return dict(tag_name='v'+version,draft=True,prerelease=False,assets=[dict(name=name,state='uploaded',size=len(data),digest='sha256:'+hashlib.sha256(data).hexdigest()) for name,data in all_files.items()])
    def rejected(meta,payloads,message):
        release=prepare(meta,payloads)
        try: module.validate(base,release,version,revision)
        except (ValueError,KeyError): pass
        else: raise AssertionError(message)
    module.validate(base,prepare(metadata,files),version,revision)
    rejected(metadata,{**files,f'Veymux-darwin-arm64-{version}.zip':b'old-client'},'Retired client archives must not enter a Rust release')
    missing=dict(files);missing.pop(prefix+'.app.tar.gz.sig')
    rejected(metadata,missing,'Rust releases still require signed updater assets')
    bad=copy.deepcopy(metadata);bad['verification']['dmgApp']['gatekeeperAccepted']=False
    rejected(bad,files,'Rust releases still require DMG Gatekeeper verification')
    release=prepare(metadata,files);release['assets'][0]['digest']='sha256:'+'0'*64
    try: module.validate(base,release,version,revision)
    except ValueError: pass
    else: raise AssertionError('Digest mismatches must reject publication')
`], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'pipe' });
});
