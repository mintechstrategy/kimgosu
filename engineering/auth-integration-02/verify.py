#!/usr/bin/env python3
"""Local-only KG-AUTH-INTEGRATION-02 replay. No network/service/DB/git mutation.
Requires the pinned source and existing local Node24/backend node_modules.
Produces developer evidence, never independent UIX QA or deployed-DB evidence.
"""
from pathlib import Path
import datetime, fnmatch, hashlib, json, os, re, shlex, shutil, subprocess, tarfile
P = Path(__file__).resolve().parents[2]
O = P / 'engineering/auth-integration-02'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def save(name, value): (O / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
def rows_check(rows):
    return [{'path': r['path'], 'expected': r['sha256'], 'actual': digest(P / r['path']) if (P / r['path']).is_file() else None} for r in rows if not (P/r['path']).is_file() or digest(P/r['path']) != r['sha256']]
baseline = json.loads((O/'BASELINE-VERIFICATION.json').read_text())
candidate = json.loads((O/'CANDIDATE.json').read_text())
assert not rows_check(candidate['files']), 'Frozen integration candidate drift'
backend = candidate['backendFiles']
assert hashlib.sha256(encoded(backend)).hexdigest() == candidate['backendSourceTreeSha256']
assert digest(P/'contracts/auth-membership.v0.1.json') == baseline['v01Sha256']
assert digest(P/'.git/index') == baseline['gitIndexSha256']
for path, sha in {**baseline['migrationHashes'], **baseline['protectedParentFiles']}.items(): assert digest(P/path) == sha, path
clients = []
for track, manifest, collection in [('app','CANDIDATE.json','files'),('web','candidate-manifest.json','sourceFiles')]:
    data = json.loads((P/'engineering/auth-three-tracks-01'/track/manifest).read_text())
    orig = data[collection]; rows = [{'path': k,'sha256': v} for k,v in orig.items()] if isinstance(orig, dict) else orig
    assert not rows_check(rows), track + ' source drift'
    field = 'sourceCandidateSha256' if track == 'app' else 'sourceManifestSha256'
    assert hashlib.sha256(encoded(orig)).hexdigest() == data[field]
    clients.append({'track':track,'files':len(rows),'hash':data[field],'drift':[]})
contract = json.loads((P/'contracts/auth-membership.v0.2.json').read_text())
v01 = json.loads((P/'contracts/auth-membership.v0.1.json').read_text())
assert contract['compatibility']['core9PreservedVerbatim'] == v01['implementedCore']
authority_path = contract['businessAuthority']['architectureCanonical']
assert authority_path == 'engineering/BACKEND-AUTHORITY.md'
authority = (P/authority_path).read_text(); agents = (P/'AGENTS.md').read_text()
assert agents.count('## 백엔드 비즈니스 로직 정본 원칙 — 사용자 확정') == 1 and authority_path in agents
for requirement in ['권한','회원상태','업무자격','금액','수수료','할인','견적','상태전이','기간/만료','유효제재','재가입','보존','문서효력','중복','동시성','입력','OS','보안 로컬저장','오래된 클라이언트','캐시','재동의']:
    assert requirement in authority, 'Architecture requirement missing: '+requirement
assert 'USER_CONFIRMED_DEFAULT_ARCHITECTURE' in contract['businessAuthority']['adoption']
assert authority_path in (P/'contracts/auth-membership.v0.2.md').read_text()
save('AUTHORITY-ADOPTION.json',{'status':'DOCUMENT_ADOPTION_AND_CONTRACT_ALIGNMENT_VERIFIED_NOT_FULL_CODE_COMPLIANCE','canonical':authority_path,'authoritySha256':digest(P/authority_path),'agentsSha256':digest(P/'AGENTS.md'),'contractSha256':digest(P/'contracts/auth-membership.v0.2.json'),'singleAgentsSection':True,'existingAllCodeCompliance':'NOT_CLAIMED_SEPARATE_AUDIT_VERDICT_NOT_UIX_QA','clientBaselineUnchanged':True,'broadRefactor':False})
source = '\n'.join((P/'services/backend/src'/name).read_text() for name in ['app.ts','auth.ts'])
actual = sorted((m.upper(),path) for m,path in re.findall(r"app\.(get|post|patch|options)(?:<[^\n]*?>)?\('([^']+)'",source))
expected = sorted([(o['method'],o['path']) for o in contract['operations']] + [('OPTIONS','/*')])
assert actual == expected and len(contract['operations']) == 21
# Error vocabulary is checked against actual throw/fail/send sites, not route names alone.
source_all = '\n'.join((P/'services/backend/src'/name).read_text() for name in ['app.ts','auth.ts','providers.ts'])
codes = set(re.findall(r"new ApiError\(\d+,\s*'([A-Z_]+)'",source_all)) | set(re.findall(r"fail\(reply,\s*\d+,\s*'([A-Z_]+)'",source_all)) | set(re.findall(r"code:\s*'([A-Z_]+)'",source_all))
declared = {e['code'] for e in contract['globalErrors']} | {e['code'] for op in contract['operations'] for e in op['errors']}
assert codes <= declared, 'Undocumented errors: ' + str(codes-declared)
# Strict .dockerignore has no positive broad file rules. Enumerate its explicit
# file un-ignore rules; this checker intentionally rejects broader future syntax.
ignore = (P/'.dockerignore').read_text().splitlines()
context = []
for line in ignore:
    line=line.strip()
    if not line.startswith('!') or line.endswith('/'): continue
    rel=line[1:]; assert not any(c in rel for c in '*?['), 'Broad context rule: '+rel
    assert (P/rel).is_file(), rel
    context.append(rel)
context = sorted(set(context))
assert set(context) == {'Dockerfile','.dockerignore','services/backend/Dockerfile','services/backend/package.json','services/backend/package-lock.json', *['services/backend/src/'+x+'.ts' for x in ['app','auth','database','providers','security','server']]}
copy_sources=[]
for docker in ['Dockerfile','services/backend/Dockerfile']:
    text=(P/docker).read_text()
    assert 'FROM node:24.22.2-bookworm-slim' in text and 'USER node' in text and 'CMD ["node", "src/server.ts"]' in text
    assert 'dist/cloud-server.js' not in text and 'npm run build' not in text
    for line in text.splitlines():
        if line.startswith('COPY '):
            for path in shlex.split(line)[1:-1]: assert path in context; copy_sources.append(path)
railway = json.loads((P/'railway.json').read_text())
assert railway['build']['dockerfilePath']=='services/backend/Dockerfile' and railway['deploy']['healthcheckPath']=='/health'
# Archive only actual minimal context. Normalized tar metadata is reproducible.
archive=O/'backend-build-context.tar'
with tarfile.open(archive,'w') as tar:
    for rel in context:
        info=tar.gettarinfo(str(P/rel),arcname=rel);info.mtime=0;info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o644
        with (P/rel).open('rb') as f:tar.addfile(info,f)
with tarfile.open(archive) as tar: assert sorted(tar.getnames())==context
save('BUILD-CONTEXT.json',{'taskId':'KG-AUTH-INTEGRATION-02','status':'STATIC_CONTEXT_AND_ARCHIVE_VERIFIED_NOT_DOCKER_BUILD','selectedDockerfile':'services/backend/Dockerfile','contextRoot':'repository root','files':[{'path':r,'sha256':digest(P/r),'bytes':(P/r).stat().st_size} for r in context],'fileCount':len(context),'copySources':sorted(set(copy_sources)),'archive':str(archive.relative_to(P)),'archiveSha256':digest(archive),'dockerExecutable':shutil.which('docker'),'imageBuild':'NOT_RUN_NO_DOCKER_EXECUTABLE_NO_INSTALL_OR_DAEMON_START'})
# Exact future publish list; no git add/commit/push is issued here.
allow = json.loads((O/'PUBLISH-ALLOWLIST.json').read_text())['files']
assert not rows_check(allow)
patterns={
 'private-key':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'github-token':re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})'),
 'aws-key':re.compile(rb'\bAKIA[A-Z0-9]{16}\b'),
 'credential-url':re.compile(rb'(?:postgres(?:ql)?|https?)://[^\s/:]+:[^\s/@]+@'),
 'literal-secret-assignment':re.compile(rb'(?i)(?:client_secret|password|access_token|refresh_token|identity_hmac_key)\s*[:=]\s*[\'\"][A-Za-z0-9_./+=-]{20,}[\'\"]')
}
findings=[]
for row in allow:
    rel=row['path']; assert '..' not in Path(rel).parts and not rel.startswith('/')
    assert not any(s in Path(rel).parts for s in ['node_modules','.cloudflare','.wrangler','.local-toolchains','.git'])
    assert not re.search(r'(^|/)(\.env(?:\..*)?|auth\.json|credentials\.json)$|\.(pem|key|p12|pfx|mobileprovision)$',rel)
    data=(P/rel).read_bytes()
    for kind,pattern in patterns.items():
        for match in pattern.finditer(data): findings.append({'path':rel,'kind':kind,'line':data[:match.start()].count(b'\n')+1})
save('SECRET-SCAN.json',{'scope':'Exact future Git source allowlist only, not repository/history/full security audit','fileCount':len(allow),'findingCount':len(findings),'findings':findings,'valuesPrinted':False})
assert not findings, 'Secret scan needs review (no matching values printed)'
env=os.environ.copy();env['PATH']=str(P/'.local-toolchains/node24/bin')+os.pathsep+env.get('PATH','')
commands=[('typecheck.log',['npm','--prefix','services/backend','run','check']),('unit.log',['npm','--prefix','services/backend','test']),('contract.log',['node','--test','--test-reporter=tap','engineering/auth-integration-02/contract.test.ts'])]
runs=[]
for log,argv in commands:
    result=subprocess.run(argv,cwd=P,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    (O/log).write_text(result.stdout)
    counts={key:int(matches[-1]) for key in ['tests','pass','fail','skipped'] if (matches:=re.findall(r'(?:#|ℹ) '+key+r' (\d+)',result.stdout))}
    runs.append({'argv':argv,'exit':result.returncode,'log':log,'logSha256':digest(O/log),'counts':counts})
assert not rows_check(candidate['files']), 'Post-run candidate drift'
assert digest(P/'.git/index')==baseline['gitIndexSha256']
report={'taskId':'KG-AUTH-INTEGRATION-02','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'LOCAL_PURE_DEVELOPER_TESTS_AND_STATIC_CONTRACT_VALIDATION_NOT_QA','backendSourceTreeSha256':candidate['backendSourceTreeSha256'],'contractSha256':digest(P/'contracts/auth-membership.v0.2.json'),'candidateSha256':candidate['candidateSha256'],'clientsUnchanged':clients,'coreCount':9,'extensionCount':12,'sourceRouteCountIncludingOptions':len(actual),'documentedErrorCodes':sorted(codes),'commands':runs,'gitIndexUnchanged':True,'v01Unchanged':True,'migrationsUnchanged':True,'realDbNewCandidate':'NOT_RUN_BLOCKED_WHILE_PERF','publicDeploy':'NOT_RUN_PROHIBITED_WHILE_PERF','independentQa':'NOT_RUN_PARENT_COLLECTION_REQUIRED','status':'PASS_LOCAL_ONLY' if all(r['exit']==0 for r in runs) else 'FAIL'}
save('VERIFICATION.json',report)
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(0 if report['status']=='PASS_LOCAL_ONLY' else 1)
