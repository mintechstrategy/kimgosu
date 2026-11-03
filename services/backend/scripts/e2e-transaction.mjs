#!/usr/bin/env node
// 거래 전 구간 검증: 임시로그인 → 고수 서비스 등록 → 견적 → 수락 → 완료 → 리뷰.
//
//   node scripts/e2e-transaction.mjs [--base-url https://api-dev-kimgosu.mintech.ai]
//
// dev API의 테스트 계정만 사용한다. 만든 데이터는 이력이므로 지우지 않고 id를 출력한다.
import assert from 'node:assert/strict';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base-url', 'https://api-dev-kimgosu.mintech.ai');

let step = '';
const done = [];

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, body: json };
}

async function expect(name, method, path, options, status) {
  step = name;
  const r = await call(method, path, options);
  assert.equal(r.status, status, `${name}: ${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  done.push(`${name} (${r.status})`);
  return r.body;
}

async function main() {
  // 1. 임시 로그인 — slot 11은 고수, slot 1은 일반 사용자.
  const accounts = await expect('dev 계정 목록', 'GET', '/v1/auth/dev/accounts', {}, 200);
  const list = accounts.accounts ?? accounts;
  assert.ok(Array.isArray(list) && list.length > 0, 'dev 계정 목록이 비어 있다');
  const expertSlot = list.find((a) => a.expertActive === true);
  const userSlot = list.find((a) => a.role === 'USER' && a.expertActive !== true);
  assert.ok(expertSlot && userSlot, 'EXPERT/USER 슬롯을 찾지 못했다');

  const expert = await expect('고수 로그인', 'POST', '/v1/auth/dev/login', { body: { slot: expertSlot.slot } }, 200);
  const customer = await expect('일반 로그인', 'POST', '/v1/auth/dev/login', { body: { slot: userSlot.slot } }, 200);
  const expertToken = expert.session.accessToken;
  const customerToken = customer.session.accessToken;
  assert.ok(expertToken && customerToken, '토큰을 받지 못했다');

  await expect('고수 /v1/me', 'GET', '/v1/me', { token: expertToken }, 200);
  const expertId = expert.member.id;
  assert.ok(expertId, '고수 member id가 없다');

  // 2. 고수 서비스 등록 (이미 있으면 통과).
  await expect('고수 프로필', 'POST', '/v1/expert/profile', {
    token: expertToken,
    body: { introduction: 'E2E 검증용 프로필', region: '서울', careerYears: 5 },
  }, 201).catch(async (e) => {
    if (e.code !== 'ERR_ASSERTION') throw e;
    const r = await call('PATCH', '/v1/expert/profile', { token: expertToken, body: { introduction: 'E2E 검증용 프로필' } });
    assert.ok([200, 201].includes(r.status), `프로필 생성·수정 모두 실패: ${r.status}`);
  });

  const service = await expect('서비스 등록', 'POST', '/v1/expert/services', {
    token: expertToken,
    body: { category: 'E2E', title: `E2E 서비스 ${Date.now()}`, description: '검증용', priceType: 'FIXED', basePrice: 100000 },
  }, 201);

  const search = await expect('서비스 검색', 'GET', '/v1/experts?limit=20', {}, 200);
  const found = (search.experts ?? search.items ?? []).some((x) => x.expertId === expertId || x.memberId === expertId);
  assert.ok(found, '등록한 고수가 검색에 나오지 않는다');
  done.push('검색 노출 확인');

  // 3. 원장은 고객이 요청해 생긴다. 이미 있으면 첫 원장을 쓴다.
  let ledgerId;
  const existing = await call('GET', '/v1/ledgers', { token: expertToken });
  if (existing.status === 200 && (existing.body.items ?? existing.body.ledgers ?? []).length > 0) {
    ledgerId = (existing.body.items ?? existing.body.ledgers)[0].id;
    done.push('기존 원장 사용');
  } else {
    // 원장 생성 라우트가 아직 없다. 검색→원장→견적 진입 경로가 제품에 없으므로
    // 이 지점에서 멈추는 것이 맞다. 라우트가 생기면 그때 이 블록을 채운다.
    step = '원장 생성';
    const created = await call('POST', '/v1/ledgers', {
      token: customerToken, body: { expertId, message: 'E2E 검증 요청' },
    });
    assert.equal(created.status, 201,
      `원장 생성 라우트가 없다 (${created.status}). 고객이 거래를 시작할 경로가 제품에 없으므로 ` +
      '로그인·프로필·서비스·검색까지만 자동 검증된다.');
    ledgerId = created.body.id;
  }
  assert.ok(ledgerId, 'ledgerId를 얻지 못했다');

  // 4. 견적 → 수락 → 양측 완료.
  const quote = await expect('견적 제시', 'POST', `/v1/ledgers/${ledgerId}/quotes`, {
    token: expertToken,
    body: { amount: 1000000, message: 'E2E 견적', priceType: 'TOTAL', vatIncluded: false },
  }, 201);
  assert.equal(quote.totalAmount, 1100000, '부가세 별도 계산이 틀렸다');

  await expect('고객 수락', 'POST', `/v1/quotes/${quote.id}/respond`, {
    token: customerToken, body: { action: 'accept', expectedVersion: 1 },
  }, 200);

  await expect('고수 완료 확인', 'POST', `/v1/quotes/${quote.id}/complete`, { token: expertToken }, 200);
  await expect('고객 완료 확인', 'POST', `/v1/quotes/${quote.id}/complete`, { token: customerToken }, 200);
  done.push('양측 완료 확인');

  // 5. 리뷰.
  await expect('리뷰 작성', 'POST', `/v1/ledgers/${ledgerId}/reviews`, {
    token: customerToken, body: { rating: 5, body: 'E2E 검증 리뷰' },
  }, 201);

  const reviews = await expect('리뷰 조회', 'GET', `/v1/experts/${expertId}/reviews`, {}, 200);
  const items = reviews.items ?? reviews.reviews ?? [];
  assert.ok(items.length > 0, '리뷰가 조회되지 않는다');
  assert.ok(!('email' in (items[0] ?? {})), '공개 리뷰에 이메일이 노출된다');

  console.log('\n통과한 단계:');
  for (const d of done) console.log('  ✓', d);
  console.log('\n생성 데이터 (dev DB에 이력으로 남는다):');
  console.log(`  ledgerId  ${ledgerId}`);
  console.log(`  quoteId   ${quote.id}`);
  console.log(`  serviceId ${service.id ?? '(응답에 없음)'}`);
}

main().catch((error) => {
  console.error(`\n실패 단계: ${step || '(시작 전)'}`);
  console.error(error.message);
  process.exit(1);
});
