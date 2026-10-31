#!/usr/bin/env python3
"""Exact approved dev service only. Never read credentials or print environment/SQL errors."""
import argparse, hashlib, io, json, os, pathlib, subprocess, tarfile, urllib.request
P = pathlib.Path(__file__).resolve().parents[1]
IDENTITY = '/Users/mintech-mac/.hermes/profiles/project-lead/private-credentials/kimgosu-dev-163/identity_ed25519'
REMOTE = '/var/tmp/kg-auth-backend-01'
SSH = ['railway', 'ssh', '-p', '95b52b2c-e1c0-45da-909b-d7989ce08a90', '-e', 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18', '-s', 'eb0fec52-b955-4671-8f59-67a46fc1479d', '-i', IDENTITY, '--']
GUARD = 'test "$RAILWAY_PROJECT_ID" = 95b52b2c-e1c0-45da-909b-d7989ce08a90 && test "$RAILWAY_ENVIRONMENT_ID" = a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18 && test "$RAILWAY_SERVICE_ID" = eb0fec52-b955-4671-8f59-67a46fc1479d'
def run(command, data=None, timeout=180):
    result = subprocess.run(SSH + ['sh', '-c', GUARD + ' && ' + command], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Any SQL/driver error may include parameters; never send stderr to shared output.
        print(json.dumps({'operation': 'railway_ssh', 'exit': result.returncode, 'details': 'withheld'}))
        # The integration harness stdout is deliberately sanitized JSON-lines.
        if command.endswith('scripts/railway-integration.ts'):
            print(result.stdout.decode())
        raise SystemExit(result.returncode)
    return result.stdout.decode()
parser = argparse.ArgumentParser(); parser.add_argument('--apply', action='store_true'); parser.add_argument('--stage', action='store_true'); parser.add_argument('--test', action='store_true'); args = parser.parse_args()
if args.apply:
    migration_files = ['002_auth_lifecycle.sql','003_explicit_social_link.sql']
    ddl = b'\n'.join((P / 'migrations' / f).read_bytes() for f in migration_files)
    readback = b"\nSELECT json_build_object('schema','kg_membership','newTables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='kg_membership' AND table_name IN ('oauth_flows','registration_tickets','sms_challenges')),'refreshColumns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='kg_membership' AND table_name='sessions' AND column_name IN ('refresh_digest','refresh_expires_at','family_id')),'linkColumn',(SELECT count(*) FROM information_schema.columns WHERE table_schema='kg_membership' AND table_name='oauth_flows' AND column_name='link_member_id'),'ageAcknowledgementColumn',(SELECT count(*) FROM information_schema.columns WHERE table_schema='kg_membership' AND table_name='members' AND column_name='age14_confirmed_at'),'operationsStillDraft',EXISTS(SELECT 1 FROM kg_membership.policy_documents WHERE kind='OPERATIONS' AND version='review-v0.3-20261031' AND status='DRAFT'));\n"
    out = run("PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic' psql -X -q -At -v ON_ERROR_STOP=1 -U \"$PGUSER\" -d \"$PGDATABASE\"", ddl + readback)
    print(json.dumps({'operation': 'migrations002003', 'migrations': [{'file': f, 'sha256': hashlib.sha256((P / 'migrations' / f).read_bytes()).hexdigest()} for f in migration_files], 'readback': out.strip()}))
if args.stage:
    scratch = pathlib.Path(os.environ['TMPDIR']) / 'kg-auth-backend-01'; scratch.mkdir(mode=0o700, exist_ok=True)
    version = 'v24.22.2'; filename = f'node-{version}-linux-x64.tar.xz'; url = f'https://nodejs.org/dist/{version}/'
    expected = next(l.split()[0] for l in urllib.request.urlopen(url + 'SHASUMS256.txt',timeout=30).read().decode().splitlines() if l.endswith('  ' + filename))
    package = scratch / filename
    if not package.exists(): urllib.request.urlretrieve(url + filename, package)
    data = package.read_bytes(); actual = hashlib.sha256(data).hexdigest()
    if actual != expected: raise SystemExit('node archive checksum mismatch')
    installed = run(f'if test -x {REMOTE}/node/bin/node; then {REMOTE}/node/bin/node --version; else printf "absent"; fi').strip()
    if installed != version:
        print(run(f'install -d -m 700 {REMOTE}/node {REMOTE}/app && tar -xJf - --strip-components=1 -C {REMOTE}/node && {REMOTE}/node/bin/node --version', data, timeout=300).strip())
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as tar:
        for name in ['src','scripts/railway-integration.ts','migrations','node_modules','package.json','package-lock.json']:
            tar.add(P/name,arcname=name)
    print(run(f'tar -xzf - -C {REMOTE}/app && printf "backend-source-staged\\n"',stream.getvalue(), timeout=300).strip())
    print(json.dumps({'operation':'stage','nodeVersion':version,'nodeArchiveSha256':actual,'sourceArchiveSha256':hashlib.sha256(stream.getvalue()).hexdigest(),'remoteDirectory':REMOTE}))
if args.test:
    print(run(f'cd {REMOTE}/app && {REMOTE}/node/bin/node scripts/railway-integration.ts',timeout=300))
