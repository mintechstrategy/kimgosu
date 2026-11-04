// WS-11 계약 회귀: contracts/auth-membership.v0.3.json 의 oauthStart /
// oauthCallback 스키마가 실제 라우트 응답과 일치하는지 확인한다.
// SQL/provider는 명시적 double이며, 여기서는 "계약 인벤토리 ↔ 실제 와이어"만 본다.
// 실제 DB 검증은 services/backend/tests/oauth.integration.test.ts 가 담당한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../services/backend/src/app.ts';
import type { Sql, Row } from '../../services/backend/src/app.ts';

const require = createRequire(new URL('../../services/backend/package.json', import.meta.url));
const Ajv = require('ajv');
const contract = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.3.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
const compile = (schema: unknown) => ajv.compile({ definitions: contract.schemaDefinitions, ...(schema as object) });
const operation = (id: string) => contract.operations.find((o: { id: string }) => o.id === id);
const validate = (id: string, value: unknown) => {
  const v = compile(operation(id).responses['200']);
  assert(v(value), id + ': ' + ajv.errorsText(v.errors));
};
const source = readFileSync(new URL('../../services/backend/src/oauth.ts', import.meta.url), 'utf8');
const routes = [...source.matchAll(/app\.(get|post|patch)(?:<[^\n]*?>)?\('([^']+)'/g)].map(m => m[1].toUpperCase() + ' ' + m[2]);

const IDENTITY_KEY = 'ws11-contract-identity-key-0123456789abcdefgh';
const provider = {
  authorize: (state: string, codeChallenge: string) => `https://provider.invalid/authorize?state=${state}&code_challenge=${codeChallenge}`,
  exchange: async () => ({ subject: 'ws11-contract-subject', name: '계약검수', email: 'contract@example.com' }),
};

class DoubleSql implements Sql {
  mode: 'existing' | 'new' = 'existing';
  queries: string[] = [];
  async query(text: string) {
    this.queries.push(text);
    const rows = (r: Row[]) => ({ rows: r, rowCount: r.length });
    if (text.startsWith('INSERT INTO kg_membership.oauth_flows')) return rows([]);
    if (text.startsWith('UPDATE kg_membership.oauth_flows')) return rows([{ state_digest: 'D'.repeat(64), link_member_id: null }]);
    if (text.includes('FROM kg_membership.social_links l JOIN')) {
      return rows(this.mode === 'existing'
        ? [{ id: randomUUID(), customerNumber: '1001', status: 'ACTIVE', effectiveStatus: 'ACTIVE' }] : []);
    }
    if (text.startsWith('SELECT principal_id FROM kg_membership.social_links')) return rows(this.mode === 'existing' ? [{ principal_id: randomUUID() }] : []);
    if (text.startsWith('INSERT INTO kg_membership.members')) return rows([]);
    if (text.startsWith('SELECT customer_no')) return rows([{ customerNumber: '1002' }]);
    if (text.startsWith('INSERT INTO kg_membership.sessions')) return rows([]);
    return rows([]);
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> { return work(this); }
}

const appWith = (db: Sql) => buildApp(db, 'contract-double', {
  identityKey: IDENTITY_KEY, providers: { kakao: provider, naver: provider, apple: provider },
});

test('v0.3 oauthStart/oauthCallback 스키마가 컴파일되고 실제 라우트 경로와 일치한다', () => {
  for (const id of ['oauthStart', 'oauthCallback']) {
    const o = operation(id);
    if (o.paramsSchema) compile(o.paramsSchema);
    if (o.querySchema) compile(o.querySchema);
    for (const schema of Object.values(o.responses)) compile(schema);
    assert.ok(routes.includes(o.method + ' ' + o.path), id + ' route missing in oauth.ts');
  }
  assert.equal(routes.length, 2, 'oauth.ts must expose exactly the two declared operations');
});

test('oauthStart 200 응답이 선언 스키마와 일치한다', async t => {
  const db = new DoubleSql(); const app = appWith(db); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/auth/oauth/kakao/start' });
  assert.equal(res.statusCode, 200);
  validate('oauthStart', res.json());
  assert.deepEqual(Object.keys(res.json()).sort(), ['authorizationUrl', 'expiresInSeconds', 'provider', 'state']);
});

test('oauthCallback 200 응답이 선언 스키마와 일치한다 (AUTHENTICATED / REGISTERED)', async t => {
  for (const mode of ['existing', 'new'] as const) {
    const db = new DoubleSql(); db.mode = mode; const app = appWith(db); t.after(() => app.close());
    const res = await app.inject({ url: `/v1/auth/oauth/kakao/callback?state=${'S'.repeat(43)}&code=contract-code` });
    assert.equal(res.statusCode, 200, mode);
    validate('oauthCallback', res.json());
    assert.equal(res.json().outcome, mode === 'existing' ? 'AUTHENTICATED' : 'REGISTERED');
  }
});

test('선언된 오류 코드가 실제 응답과 일치한다', async t => {
  const noProviders = buildApp(new DoubleSql(), 'contract-double', {}); t.after(() => noProviders.close());
  const notConfigured = await noProviders.inject({ method: 'POST', url: '/v1/auth/oauth/naver/start' });
  assert.equal(notConfigured.statusCode, 503);
  assert.equal(notConfigured.json().error.code, 'PROVIDER_NOT_CONFIGURED');

  const db = new DoubleSql();
  db.query = async (text: string) => (text.startsWith('UPDATE kg_membership.oauth_flows')
    ? { rows: [], rowCount: 0 }
    : { rows: [], rowCount: 0 });
  const app = appWith(db); t.after(() => app.close());
  const invalid = await app.inject({ url: `/v1/auth/oauth/kakao/callback?state=${'S'.repeat(43)}&code=contract-code` });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().error.code, 'OAUTH_STATE_INVALID');

  const undeclared = operation('oauthCallback').errors.filter((e: { status: number }) => e.status === 400).map((e: { code: string }) => e.code);
  assert.ok(undeclared.includes('INVALID_REQUEST'));
});

test('auth/config 의 oauth 블록이 v0.3 authConfig.oauth 스키마와 일치하고 실제 연결 상태를 숨기지 않는다', async t => {
  const db: Sql = { async query() { return { rows: [], rowCount: 0 }; }, async transaction<T>(work: (sql: Sql) => Promise<T>) { return work(db); } };
  const app = buildApp(db, 'contract-double', {}); t.after(() => app.close());
  const res = await app.inject({ url: '/v1/auth/config' });
  assert.equal(res.statusCode, 200);
  // v0.3 authConfig 200 의 required 에는 pre-existing policySnapshot 이 들어 있어
  // metadata=policy-v0.3 옵트인 없이는 전체 본문 검증이 성립하지 않는다(WS-11 범위 밖).
  // WS-11 이 추가한 oauth 블록만 v0.3 서브스키마로 검증하고, 나머지 본문은 v0.2
  // baseline 스키마로 여전히 유효한지 확인한다(순수 추가 변경 증명).
  const oauthSchema = operation('authConfig').responses['200'].properties.oauth;
  const oauthValidate = ajv.compile({ definitions: contract.schemaDefinitions, ...oauthSchema });
  assert(oauthValidate(res.json().oauth), 'oauth: ' + ajv.errorsText(oauthValidate.errors));
  const v02 = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.2.json', import.meta.url), 'utf8'));
  const v02Schema = v02.operations.find((o: { id: string }) => o.id === 'authConfig').responses['200'];
  const baseline = ajv.compile({ definitions: v02.schemaDefinitions, ...v02Schema });
  assert(baseline(res.json()), 'v0.2 baseline: ' + ajv.errorsText(baseline.errors));
  // 연결 상태는 자격증명 유무에서만 나온다. 구글도 같은 규칙으로 목록에 있다.
  assert.deepEqual(res.json().oauth.providers.map((p: { id: string; connected: boolean }) => [p.id, p.connected]),
    [['google', false], ['kakao', false], ['naver', false], ['apple', false]]);
});
