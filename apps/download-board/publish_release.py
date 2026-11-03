#!/usr/bin/env python3
"""Publish a verified post-QA app build; never publish candidate files."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[2]
SITE=Path(__file__).resolve().parent/'site'
PROJECT='kimgosu-app-downloads'
ORIGIN='https://appdownload.mintech.ai'
# Every final-build record must carry these fields; examples/release-record.aos-apk.example.json is the template.
REQUIRED_FIELDS=('stage','qaAccepted','candidate','qaCompletedAt','builtAt','artifact','artifactSHA256',
                 'platform','kind','version','build','notes','qaResult','sourceManifest')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(Path(p).read_text())
def apk_badging(aapt2,artifact):
    if aapt2:
        try: result=subprocess.run([aapt2,'dump','badging',str(artifact)],capture_output=True,text=True,check=True)
        except (OSError,subprocess.CalledProcessError): result=None
        if result is not None:
            m=re.search(r"package: name='[^']+' versionCode='([^']+)' versionName='([^']+)'",result.stdout)
            if m: return m.group(2),m.group(1)
    return apk_manifest_version(artifact)
# versionName/versionCode always come from the APK's own AndroidManifest.xml. aapt2 is used
# when available; without it the AXML chunk is parsed directly, so the board can never display
# a version that the artifact does not carry.
AXML_VERSION_CODE,AXML_VERSION_NAME=0x0101021b,0x0101021c
def axml_string_pool(data,off):
    kind,header=struct.unpack_from('<HH',data,off)
    if kind!=0x0001: raise ValueError('AndroidManifest.xml string pool is missing')
    count,=struct.unpack_from('<I',data,off+8);flags,=struct.unpack_from('<I',data,off+16);start,=struct.unpack_from('<I',data,off+20)
    utf8=bool(flags&0x100);strings=[]
    for i in range(count):
        p=off+start+struct.unpack_from('<I',data,off+header+i*4)[0]
        if utf8:
            n=data[p];p+=2 if n&0x80 else 1;n=data[p]
            if n&0x80: n=((n&0x7f)<<8)|data[p+1];p+=2
            else: p+=1
            strings.append(data[p:p+n].decode('utf-8','replace'))
        else:
            n,=struct.unpack_from('<H',data,p);p+=2
            if n&0x8000: n=((n&0x7fff)<<16)|struct.unpack_from('<H',data,p)[0];p+=2
            strings.append(data[p:p+n*2].decode('utf-16-le','replace'))
    size,=struct.unpack_from('<I',data,off+4)
    return strings,off+size
def apk_manifest_version(apk):
    with zipfile.ZipFile(apk) as z: data=z.read('AndroidManifest.xml')
    strings,off=axml_string_pool(data,8);ids=[]
    if struct.unpack_from('<H',data,off)[0]==0x0180:
        _kind,header,size=struct.unpack_from('<HHI',data,off)
        ids=list(struct.unpack_from('<%dI'%((size-header)//4),data,off+header));off+=size
    while off<len(data):
        kind,_header,size=struct.unpack_from('<HHI',data,off)
        if kind==0x0102:
            attr_start,attr_size,attr_count=struct.unpack_from('<HHH',data,off+24)
            found={}
            for i in range(attr_count):
                a=off+16+attr_start+i*attr_size
                _ns,name,raw=struct.unpack_from('<III',data,a)
                _tsize,_reserved,dtype,value=struct.unpack_from('<HBBI',data,a+12)
                resource=ids[name] if name<len(ids) else 0
                label=strings[name] if name<len(strings) else ''
                if resource==AXML_VERSION_CODE or label=='versionCode': found['versionCode']=value
                elif resource==AXML_VERSION_NAME or label=='versionName':
                    if dtype==0x03 and value<len(strings): found['versionName']=strings[value]
                    elif raw<len(strings): found['versionName']=strings[raw]
            if 'versionCode' in found and 'versionName' in found:
                return str(found['versionName']),str(found['versionCode'])
        off+=size
    raise ValueError('APK version metadata could not be read')
def timestamp(text):
    d=datetime.fromisoformat(text.replace('Z','+00:00'))
    if d.tzinfo is None: raise ValueError('Timezone is required')
    return d

def prepare(record_path):
    r=load(record_path)
    missing=[k for k in REQUIRED_FIELDS if k not in r]
    if missing: raise ValueError('Release record is missing required fields: '+', '.join(missing))
    notes=r.get('notes')
    if not isinstance(notes,list) or not notes or any(not isinstance(n,str) or not n.strip() for n in notes):
        raise ValueError('At least one non-empty change note is required')
    if r.get('stage')!='post-qa-final' or r.get('qaAccepted') is not True:
        raise ValueError('Parent must verify QA PASS and complete the final build first')
    qa_path=Path(r['qaResult']['path']);source_path=Path(r['sourceManifest']['path'])
    if digest(qa_path)!=r['qaResult']['sha256'] or digest(source_path)!=r['sourceManifest']['sha256']:
        raise ValueError('QA/source proof changed')
    qa=load(qa_path);source=load(source_path)
    if qa.get('overallVerdict') not in ('PASS','PASS_SCOPED') or qa.get('candidate')!=r['candidate'] or source['candidate']!=r['candidate']:
        raise ValueError('Exact reviewed candidate has not passed QA')
    for rel,pin in source['files'].items():
        p=(ROOT/rel).resolve()
        if ROOT not in p.parents or not p.is_file() or digest(p)!=pin: raise ValueError('Reviewed source changed: '+rel)
    artifact=Path(r['artifact']).resolve()
    if not artifact.is_file() or digest(artifact)!=r['artifactSHA256']: raise ValueError('Final artifact hash mismatch')
    qa_end=timestamp(r['qaCompletedAt']);built=timestamp(r['builtAt'])
    if built<qa_end or artifact.stat().st_mtime<qa_end.timestamp(): raise ValueError('This is a pre-QA candidate, not a post-QA build')
    if artifact.stat().st_size>25*1024*1024: raise ValueError('Pages single-file limit exceeded; no unapproved storage fallback')
    version=str(r['version']);build=str(r['build'])
    if not re.fullmatch(r'[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[A-Za-z0-9.-]+)?',version) or not re.fullmatch(r'[0-9]+',build):
        raise ValueError('Explicit real version/build required')
    kind=r['kind'];platform=r['platform']
    if kind=='android-apk' and platform=='aos':
        if artifact.suffix!='.apk': raise ValueError('APK required')
        apk_version,apk_build=apk_badging(r.get('aapt2'),artifact)
        if (apk_build,apk_version)!=(build,version): raise ValueError('APK version differs from the release record')
        version,build=apk_version,apk_build
        label='Android 개발용 APK';notice='Android 기기용 개발 빌드입니다. 기기의 설치 허용 안내를 확인하세요.'
    elif kind in ('ios-simulator','ios-device-ipa') and platform=='ios':
        with zipfile.ZipFile(artifact) as z:
            candidates=[n for n in z.namelist() if n.endswith('.app/Info.plist')]
            if len(candidates)!=1: raise ValueError('Exactly one app bundle required')
            info=plistlib.loads(z.read(candidates[0]))
            bundle=(str(info['CFBundleShortVersionString']),str(info['CFBundleVersion']))
            if bundle!=(version,build): raise ValueError('iOS bundle version differs')
            version,build=bundle
            if kind=='ios-simulator':
                if artifact.suffix!='.zip' or 'iPhoneSimulator' not in info.get('CFBundleSupportedPlatforms',[]): raise ValueError('Simulator ZIP required')
                label='iOS Simulator ZIP';notice='Mac의 iOS 시뮬레이터 전용입니다. 실제 iPhone에는 설치할 수 없습니다.'
            else:
                if artifact.suffix!='.ipa' or r.get('deviceSignatureVerified') is not True or 'iPhoneOS' not in info.get('CFBundleSupportedPlatforms',[]): raise ValueError('Verified signed device IPA required')
                if not r.get('installationNotice'): raise ValueError('IPA installation/provisioning scope must be explicit')
                label='iOS 서명 IPA';notice=r['installationNotice']
    else: raise ValueError('Unsupported platform/kind combination')
    sha=digest(artifact)
    # The hash is a manifest field, never part of the file name: a hash-bearing name
    # made every re-publish a new path, which is what allowed duplicate entries to pile up.
    relative=f'downloads/v{version}/kimgosu-{platform}-{version}-b{build}{artifact.suffix}'
    target=SITE/relative
    data=load(SITE/'releases.json')
    published=[x for x in data.get('releases',[]) if x.get('platform')==platform and x.get('status')=='published']
    # Accumulation is keyed on platform+version+build, not on the file path.
    same=[x for x in published if x.get('version')==version and str(x.get('build'))==build]
    if same:
        if any(x.get('sha256')!=sha for x in same):
            raise ValueError(f'{platform} {version} build {build} is already published with a different artifact; bump version/build instead of replacing it')
        entry=same[0]
        # Already-published entries keep their original (immutable) path, including legacy
        # entries whose file name still carries a hash prefix. Restore a lost file there.
        existing=SITE/entry['file'].lstrip('/')
        if not existing.exists():
            existing.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(artifact,existing)
        elif digest(existing)!=sha: raise ValueError('Published file was modified: '+entry['file'])
        return entry
    older=[x for x in published if x.get('version')==version and str(x.get('build','')).isdigit() and int(x['build'])>int(build)]
    if older: raise ValueError(f'{platform} {version} build {older[0]["build"]} is already published; refusing to add older build {build}')
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and digest(target)!=sha: raise ValueError('Never overwrite a published version')
    if not target.exists(): shutil.copyfile(artifact,target)
    entry={'platform':platform,'kind':kind,'kindLabel':label,'version':version,'build':build,'builtAt':r['builtAt'],'publishedAt':datetime.now(timezone.utc).isoformat(),'status':'published','qaStatus':'PASS','file':'/'+relative,'bytes':artifact.stat().st_size,'sha256':sha,'installationNotice':notice,'notes':r.get('notes',[])}
    data['releases'].append(entry)
    data['updatedAt']=datetime.now(timezone.utc).isoformat();data.pop('message',None)
    (SITE/'releases.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
    return entry

def deploy(entry):
    node=ROOT/'.local-toolchains/node-v24.22.2-darwin-arm64/bin/node'
    candidates=list((Path.home()/'.npm/_npx').glob('*/node_modules/wrangler/bin/wrangler.js'))
    if not candidates: raise RuntimeError('Existing Wrangler installation required; no automatic installation/auth change')
    wrangler=max(candidates,key=lambda p:p.stat().st_mtime)
    subprocess.run([str(node),str(wrangler),'pages','deploy',str(SITE),'--project-name',PROJECT,'--branch','main','--commit-message','Publish verified app '+entry['platform']+' '+entry['version']+' build '+entry['build']],cwd=SITE.parent,check=True)
    op=urllib.request.build_opener(urllib.request.ProxyHandler({}));headers={'User-Agent':'Kimgosu-Release-Verification/1.0'}
    with op.open(urllib.request.Request(ORIGIN+entry['file'],headers=headers),timeout=60) as response:
        body=response.read()
        if response.status!=200 or len(body)!=entry['bytes'] or hashlib.sha256(body).hexdigest()!=entry['sha256']: raise ValueError('Remote artifact verification failed')
    with op.open(urllib.request.Request(ORIGIN+'/releases.json',headers=headers),timeout=30) as response:
        remote=json.load(response)
        if not any(x['file']==entry['file'] and x['sha256']==entry['sha256'] and x['version']==entry['version'] for x in remote['releases']): raise ValueError('Remote version board did not update')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-record',required=True);p.add_argument('--deploy',action='store_true');a=p.parse_args()
    try:
        entry=prepare(a.release_record)
        if a.deploy: deploy(entry)
        print(json.dumps({'entry':entry,'deployedAndReadBack':a.deploy},ensure_ascii=False))
    except (ValueError,KeyError,FileNotFoundError) as error:
        p.exit(78,str(error)+'\n')
