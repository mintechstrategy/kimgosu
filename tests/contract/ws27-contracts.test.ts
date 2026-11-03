// WS-27 — 신규 라우트 계약 인벤토리 검증.
//
// 이 테스트는 "계약 파일의 operation 목록"을 실제로 등록된 Fastify 라우트와
// 맞춘다. 라우트 목록은 소스 문자열 정규식이 아니라 각 모듈의 register 함수를
// 실제 Fastify 인스턴스에 등록하면서 onRoute 훅으로 수집한다. 따라서 템플릿
// 리터럴로 만들어진 경로(/v1/agreements/:id/accept 등)도 정확히 잡히고,
// 모듈에 라우트가 추가·삭제되면 계약과의 차집합이 곧바로 실패가 된다.
//
// 요청/params/query 스키마는 핸들러가 Fastify에 넘긴 schema 객체와 깊은 비교한다.
// 응답 스키마는 핸들러가 응답 스키마를 선언하지 않으므로(핸들러 반환값/SQL
// 프로젝션이 근거) 여기서는 JSON Schema 컴파일 유효성만 검사한다.
// SQL/provider는 호출되지 않는다(등록 단계만 관찰).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildApp } from '../../services/backend/src/app.ts';
import { registerLedgerRoutes } from '../../services/backend/src/ledger.ts';
import { registerQuoteRoutes } from '../../services/backend/src/quotes.ts';
import { registerChatRoutes } from '../../services/backend/src/chat.ts';
import { registerReviewRoutes } from '../../services/backend/src/reviews.ts';
import { registerAdminRoutes } from '../../services/backend/src/admin.ts';
import { registerAdminSessionRoutes } from '../../services/backend/src/admin-session.ts';
import { registerAdminPolicyRoutes } from '../../services/backend/src/admin-policy.ts';
import { registerRegisterRoutes } from '../../services/backend/src/register.ts';

const require = createRequire(new URL('../../services/backend/package.json', import.meta.url));
const Ajv = require('ajv');
const fastify = require('fastify');

const NAMES = ['ledger-quotes', 'chat', 'reviews', 'admin', 'registration'] as const;
type Name = typeof NAMES[number];
const load = (name: Name) =>
  JSON.parse(readFileSync(new URL(`../../contracts/${name}.v0.1.json`, import.meta.url), 'utf8'));
const CONTRACTS = NAMES.map(load);
const contractOf = (name: Name) => CONTRACTS[NAMES.indexOf(name)];
const operationKey = (o: { method: string; path: string }) => o.method + ' ' + o.path;

// sourceModules 경로 -> 실제 등록 함수. 계약이 새 모듈을 선언하면 여기에도
// 등록해야 하며, 빠지면 아래 테스트가 즉시 실패한다.
type Register = (app: any, sql: any, authenticate: any) => void;
const REGISTERERS: Record<string, Register> = {
  'services/backend/src/ledger.ts': (app, sql, authenticate) => registerLedgerRoutes(app, sql, authenticate),
  'services/backend/src/quotes.ts': (app, sql, authenticate) => registerQuoteRoutes(app, sql, authenticate),
  'services/backend/src/chat.ts': (app, sql, authenticate) => registerChatRoutes(app, sql, authenticate),
  'services/backend/src/reviews.ts': (app, sql, authenticate) => registerReviewRoutes(app, sql, authenticate),
  'services/backend/src/admin.ts': (app, sql, authenticate) => registerAdminRoutes(app, sql, authenticate),
  // WS-23: operator session exchange lives in its own module; the admin contract
  // declares it as a source module, so the harness must register it too.
  'services/backend/src/admin-session.ts': (app, sql) => registerAdminSessionRoutes(app, sql, {}),
  'services/backend/src/admin-policy.ts': (app, sql, authenticate) => registerAdminPolicyRoutes(app, sql, authenticate),
  // register.ts 는 authenticate 대신 AuthOptions 를 받는다. 등록만 관찰하므로 빈 옵션.
  'services/backend/src/register.ts': (app, sql) => registerRegisterRoutes(app, sql, {}),
};

const dbDouble = {
  async query() { return { rows: [], rowCount: 0 }; },
  async transaction(work: (sql: unknown) => unknown) { return work(dbDouble); },
};
const authenticateDouble = async () => null;

async function enumerate(sourceModules: string[]) {
  const app = fastify({ logger: false });
  const routes: string[] = [];
  const schemas = new Map<string, Record<string, unknown> | null>();
  app.addHook('onRoute', (route: { method: string | string[]; url: string | string[]; schema?: Record<string, unknown> }) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const urls = Array.isArray(route.url) ? route.url : [route.url];
    for (const method of methods) for (const url of urls) {
      // Fastify adds HEAD automatically for GET; the contract lists the
      // explicit verb only, so HEAD is not part of the inventory.
      if (method === 'HEAD') continue;
      routes.push(method + ' ' + url);
      schemas.set(method + ' ' + url, route.schema ?? null);
    }
  });
  for (const file of sourceModules) {
    const register = REGISTERERS[file];
    assert.ok(register, 'no registerer wired for ' + file);
    register(app, dbDouble, authenticateDouble);
  }
  await app.ready();
  await app.close();
  return { routes, schemas };
}

const sorted = (values: string[]) => [...values].sort();
const sameSet = (actual: string[], expected: string[], label: string) => {
  assert.deepEqual(sorted(actual), sorted(expected), label);
};

for (const name of NAMES) test(`${name}: 계약이 JSON Schema로 유효하다`, () => {
  const contract = contractOf(name);
  assert.equal(contract.schemaDialect, 'http://json-schema.org/draft-07/schema#');
  assert.ok(Array.isArray(contract.operations) && contract.operations.length > 0);
  const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
  const compile = (schema: unknown) => ajv.compile({ definitions: contract.schemaDefinitions, ...(schema as object) });
  for (const operation of contract.operations) {
    for (const key of ['requestSchema', 'paramsSchema', 'querySchema'] as const) {
      if (operation[key]) compile(operation[key]);
    }
    assert.ok(operation.responses && Object.keys(operation.responses).length > 0, operation.id + ': no response');
    for (const schema of Object.values(operation.responses)) compile(schema);
    for (const error of operation.errors ?? []) {
      if (error.body) compile(error.body);
      assert.ok(Number.isInteger(error.status) && typeof error.code === 'string', operation.id + ': bad error entry');
    }
    assert.ok(Array.isArray(operation.errors) && operation.errors.length > 0, operation.id + ': no errors');
  }
});

for (const name of NAMES) test(`${name}: operation 목록 = 실제 등록 라우트 (양방향)`, async () => {
  const contract = contractOf(name);
  const { routes, schemas } = await enumerate(contract.sourceModules);
  sameSet(contract.operations.map(operationKey), routes, name + ' inventory mismatch');

  // 계약에 중복 operation이 없어야 한다.
  const keys = contract.operations.map(operationKey);
  assert.equal(new Set(keys).size, keys.length, name + ': duplicate operation');

  // 핸들러가 Fastify에 넘긴 schema와 계약 스키마가 동일해야 한다.
  for (const operation of contract.operations) {
    const schema = schemas.get(operationKey(operation)) ?? {};
    assert.deepEqual(operation.requestSchema ?? null, (schema as Record<string, unknown>).body ?? null,
      operation.id + ': request schema differs from handler schema');
    assert.deepEqual(operation.paramsSchema ?? null, (schema as Record<string, unknown>).params ?? null,
      operation.id + ': params schema differs from handler schema');
    assert.deepEqual(operation.querySchema ?? null, (schema as Record<string, unknown>).querystring ?? null,
      operation.id + ': query schema differs from handler schema');
  }
});

test('전체 앱(buildApp)에 29개 operation이 실제로 등록되어 있다', async () => {
  const app = buildApp(dbDouble as never, 'ws27-contract');
  await app.ready();
  try {
    for (const contract of CONTRACTS) for (const operation of contract.operations) {
      assert.equal(app.hasRoute({ method: operation.method as 'GET', url: operation.path }), true,
        operationKey(operation) + ' is not registered by buildApp');
    }
  } finally {
    await app.close();
  }
});

test('5개 계약은 서로 겹치지 않고, 계약에 없는 라우트는 문서화된 목록뿐이다', async () => {
  const claimed: string[] = [];
  for (const contract of CONTRACTS) claimed.push(...contract.operations.map(operationKey));
  assert.equal(new Set(claimed).size, claimed.length, 'two contracts claim the same route');
  assert.equal(claimed.length, 29);

  const v02 = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.2.json', import.meta.url), 'utf8'));
  const v03 = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.3.json', import.meta.url), 'utf8'));
  const covered = new Set<string>([
    ...claimed,
    ...v02.operations.map(operationKey),
    ...v03.operations.map(operationKey),
    'GET /health',
    'OPTIONS *',
  ]);

  const app = buildApp(dbDouble as never, 'ws27-contract');
  await app.ready();
  const tree = app.printRoutes({ commonPrefix: false });
  await app.close();
  const inventory = parseRoutes(tree);
  assert.ok(inventory.length >= 50, 'route inventory parsing looks broken: ' + inventory.length);

  // 계약이 없는 라우트의 문서화된 목록. 여기 남는 목록이 매 실행마다 드러난다.
  //  - 전문가(experts) 도메인은 이번 웨이브에서 계약을 작성하지 않았다.
  //  - Apple form_post 콜백(WS-21)은 auth 계약(auth-membership.v0.3.json, 동결)에
  //    아직 등재되지 않았다. v0.3을 수정하지 않는 것이 이 카드의 제약이므로
  //    후속 auth 계약 개정 카드에서 등재해야 한다.
  const documentedGaps = [
    'POST /v1/expert/profile',
    'PATCH /v1/expert/profile',
    'POST /v1/expert/services',
    'PATCH /v1/expert/services/:id',
    'GET /v1/experts',
    'GET /v1/experts/:id',
    'POST /v1/auth/oauth/apple/callback',
  ];
  const unclaimed = inventory.filter(route => !covered.has(route));
  sameSet(unclaimed, documentedGaps, 'unclaimed routes changed: a live route is missing from every contract');
});

// printRoutes 트리를 (METHOD /path) 목록으로 평탄화한다. HEAD는 GET 중복이라 버린다.
function parseRoutes(tree: string): string[] {
  const stack: string[] = [];
  const routes: string[] = [];
  for (const raw of tree.split('\n')) {
    if (!raw.trim()) continue;
    const core = raw.replace(/^(?:[│ ]   )*/, '');
    const depth = (raw.length - core.length) / 4;
    const match = core.match(/^(?:├── |└── )?(.*?) \(([A-Z, ]+)\)$/);
    if (!match) continue;
    const [, segment, methods] = match;
    const path = (/^\//.test(segment!) && depth === 0 ? segment! : (stack[depth - 1] ?? '') + segment!).replace(/\/+/g, '/');
    stack[depth] = path;
    stack.length = depth + 1;
    for (const method of methods!.split(',').map(value => value.trim())) {
      if (method !== 'HEAD') routes.push(method + ' ' + path);
    }
  }
  return routes;
}

test('검증력 확인: 라우트를 하나 빼면 인벤토리 비교가 실패한다', async () => {
  const contract = contractOf('chat');
  const { routes } = await enumerate(contract.sourceModules);
  const removed = { ...contract, operations: contract.operations.filter((o: { id: string }) => o.id !== 'messageList') };
  assert.throws(
    () => sameSet(removed.operations.map(operationKey), routes, 'chat inventory mismatch'),
    (error: Error) => error.name === 'AssertionError',
    'a contract missing one route must fail the inventory comparison',
  );
});
