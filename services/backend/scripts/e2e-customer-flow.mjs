#!/usr/bin/env node
// 7단계 고객 거래 흐름을 실제 dev API에서 끝까지 돌린다.
//
//   node scripts/e2e-customer-flow.mjs [--base-url https://api-dev-kimgosu.mintech.ai]
//
// 화면이 아니라 거래가 성립하는지를 본다. 단계별로 기대값과 실제 응답을 찍고,
// 기대와 다르면 그 자리에서 멈추고 exit 1. 아직 dev에 배포되지 않은 API
// (채팅 이미지 WS-51, 서비스 다중 이미지 WS-54)는 BLOCKED로 남기고 성공으로
// 세지 않는다. BLOCKED만 있고 실패가 없으면 exit 2.
//
// dev 테스트 계정(slot 11 고수, slot 1 일반)만 쓰고, 만든 데이터는 이력이므로
// 지우지 않고 id를 출력한다.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base-url', 'https://api-dev-kimgosu.mintech.ai');

// 1x1 투명 PNG. 내용은 중요하지 않고 R2에 실제로 올라갔는지만 본다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const rows = [];
const ids = {};
const startedAt = new Date().toISOString();
let step = '(시작 전)';

class Failed extends Error {
  constructor(expected, actual) {
    super('기대와 다르다');
    this.expected = expected;
    this.actual = actual;
  }
}

function record(no, lane, status, expected, actual) {
  rows.push({ step: no, lane, status, expected, actual });
  console.log(`  ${status}  ${lane}`);
  console.log(`        기대: ${expected}`);
  console.log(`        실제: ${actual}`);
}
const pass = (no, lane, expected, actual) => record(no, lane, 'PASS', expected, actual);
const blocked = (no, lane, expected, actual) => record(no, lane, 'BLOCKED', expected, actual);

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

function expectStatus(r, status, label) {
  const expected = `${label} → HTTP ${status}`;
  const actual = `${label} → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
  if (r.status !== status) throw new Failed(expected, actual);
  return r.body;
}

async function uploadImage(token, kind) {
  const presign = await call('POST', '/v1/uploads', { token, body: { contentType: 'image/png', kind } });
  // 호출부는 { presign: { status, body } } 를 기대한다. 성공 시 body만 돌려주면
  // 상태 비교가 항상 어긋나 정상 동작도 BLOCKED로 기록된다.
  if (presign.status !== 201) return { presign: presign.body, presignStatus: presign.status };
  const put = await fetch(presign.body.uploadUrl, {
    method: 'PUT',
    headers: presign.body.headers ?? { 'Content-Type': presign.body.contentType },
    body: PNG,
  });
  return { presign: presign.body, presignStatus: presign.status, putStatus: put.status };
}

async function main() {
  console.log(`7단계 고객 거래 E2E — ${BASE}`);

  // ── 1. 슬롯 11(고수) 로그인 ───────────────────────────────────────────────
  step = '1. 고수 로그인';
  console.log(`\n[1] ${step}`);
  const expert = expectStatus(await call('POST', '/v1/auth/dev/login', { body: { slot: 11 } }), 200, '고수 로그인');
  const expertToken = expert.session?.accessToken;
  const expertId = expert.member?.id;
  if (!expertToken || !expertId) throw new Failed('session.accessToken + member.id', JSON.stringify(expert).slice(0, 300));
  if (expert.member.expertActive !== true) throw new Failed('slot 11 expertActive=true', `expertActive=${expert.member.expertActive}`);
  ids.expertMemberId = expertId;
  pass(1, 'slot 11 로그인', 'HTTP 200, expertActive=true', `HTTP 200, ${expert.member.nickname ?? ''} expertActive=${expert.member.expertActive}`);

  // ── 2. 서비스 등록 + 이미지 업로드 ────────────────────────────────────────
  step = '2. 서비스 등록 + 이미지 업로드';
  console.log(`\n[2] ${step}`);
  const keys = [];
  for (let i = 0; i < 3; i++) {
    const { presign, putStatus } = await uploadImage(expertToken, 'service');
    if (!presign?.key) throw new Failed('POST /v1/uploads → 201 {key,uploadUrl}', `HTTP ${presign?.status ?? '?'} ${JSON.stringify(presign?.body ?? presign).slice(0, 300)}`);
    if (!String(presign.key).startsWith(`service/${expertId}/`)) {
      throw new Failed(`key prefix service/${expertId}/`, presign.key);
    }
    if (putStatus !== 200) throw new Failed('R2 presigned PUT → HTTP 200', `HTTP ${putStatus} for ${presign.key}`);
    keys.push(presign.key);
    if (i === 0) {
      pass(2, 'R2 presign → PUT → 키', 'HTTP 201 presign, PUT 200, key service/<memberId>/…', `PUT 200, key=${presign.key}`);
      const image = await fetch(presign.publicUrl);
      if (image.status !== 200) throw new Failed('업로드한 공개 URL → HTTP 200', `HTTP ${image.status} ${presign.publicUrl}`);
      pass(2, '공개 URL 조회', 'HTTP 200', `HTTP ${image.status} ${presign.publicUrl}`);
    }
  }

  // 프로필이 이미 있으면 409라서 PATCH로 넘긴다(재실행 가능해야 한다).
  const profile = await call('POST', '/v1/expert/profile', {
    token: expertToken,
    body: { introduction: 'E2E 7단계 검증용 프로필', activityRegion: '서울' },
  });
  if (profile.status === 409) {
    expectStatus(await call('PATCH', '/v1/expert/profile', { token: expertToken, body: { introduction: 'E2E 7단계 검증용 프로필' } }), 200, '고수 프로필 수정');
    pass(2, '고수 프로필', '기존 프로필 유지(409 후 PATCH 200)', 'HTTP 409 EXPERT_PROFILE_EXISTS → PATCH 200');
  } else {
    expectStatus(profile, 201, '고수 프로필 생성');
    pass(2, '고수 프로필', 'HTTP 201', 'HTTP 201');
  }

  const serviceBody = {
    category: 'E2E', title: `E2E 7단계 서비스 ${Date.now()}`, description: 'E2E 검증용 서비스',
    priceType: 'FIXED', basePrice: 200000,
  };
  let service = await call('POST', '/v1/expert/services', { token: expertToken, body: { ...serviceBody, imageKeys: keys } });
  let multiImages = service.status === 201 && Array.isArray(service.body.images) && service.body.images.length === 3;
  if (service.status === 201) {
    if (multiImages) {
      const ordered = service.body.images.every((img, i) => img.key === keys[i] && img.sortOrder === i);
      if (!ordered) throw new Failed('images[key,sortOrder] = 보낸 순서', JSON.stringify(service.body.images));
      pass(2, '서비스 다중 이미지 3장(WS-54)', 'HTTP 201, images 3장이 보낸 순서', `HTTP 201, ${service.body.images.map(i => `${i.sortOrder}:${i.key.split('/').pop()}`).join(', ')}`);
    } else {
      throw new Failed('POST /v1/expert/services imageKeys → 201 {images:[3]}', `HTTP 201 ${JSON.stringify(service.body).slice(0, 300)}`);
    }
  } else if (service.status === 400) {
    blocked(2, '서비스 다중 이미지 3장(WS-54)', 'HTTP 201, images 3장', `HTTP 400 ${JSON.stringify(service.body)} — imageKeys 미배포, 대표 이미지 1장으로 계속`);
    service = await call('POST', '/v1/expert/services', { token: expertToken, body: { ...serviceBody, imageKey: keys[0] } });
    expectStatus(service, 201, '서비스 등록(imageKey 1장)');
    multiImages = false;
  } else {
    expectStatus(service, 201, '서비스 등록');
  }
  const serviceRow = service.body;
  ids.serviceId = serviceRow.id;
  if (serviceRow.imageKey !== keys[0]) throw new Failed(`imageKey=${keys[0]}`, `imageKey=${serviceRow.imageKey}`);
  if (typeof serviceRow.imageUrl !== 'string' || !serviceRow.imageUrl.endsWith(keys[0])) {
    throw new Failed('imageUrl = 공개 URL + 첫 키', String(serviceRow.imageUrl));
  }
  pass(2, '서비스 저장 + 대표 이미지', 'imageKey/imageUrl = 첫 번째 키', `imageKey=${serviceRow.imageKey}`);

  // ── 3. 슬롯 1(일반) 로그인 ────────────────────────────────────────────────
  step = '3. 일반 사용자 로그인';
  console.log(`\n[3] ${step}`);
  const customer = expectStatus(await call('POST', '/v1/auth/dev/login', { body: { slot: 1 } }), 200, '일반 로그인');
  const customerToken = customer.session?.accessToken;
  const customerId = customer.member?.id;
  if (!customerToken || !customerId) throw new Failed('session.accessToken + member.id', JSON.stringify(customer).slice(0, 300));
  if (customer.member.expertActive === true) throw new Failed('slot 1 expertActive=false', 'expertActive=true');
  ids.customerMemberId = customerId;
  pass(3, 'slot 1 로그인', 'HTTP 200, expertActive=false', `HTTP 200, ${customer.member.nickname ?? ''} expertActive=${customer.member.expertActive}`);

  // ── 4. 검색 → 원장 → 견적 → 수락 ─────────────────────────────────────────
  step = '4. 검색 → 원장 → 견적 → 수락';
  console.log(`\n[4] ${step}`);
  const search = expectStatus(await call('GET', '/v1/experts?limit=50'), 200, '고수 검색');
  const listed = (search.experts ?? []).find(x => String(x.expertId) === String(expertId));
  if (!listed) throw new Failed(`검색 결과에 ${expertId} 포함`, `${(search.experts ?? []).length}명: ${(search.experts ?? []).map(x => x.expertId).join(',')}`);
  pass(4, '고수 검색 노출', `expertId=${expertId} 포함`, `expertId=${listed.expertId}, services=${(listed.services ?? []).length}`);

  const detail = expectStatus(await call('GET', `/v1/experts/${expertId}`), 200, '고수 상세');
  const detailService = (detail.services ?? []).find(s => s.id === serviceRow.id);
  if (!detailService) throw new Failed(`고수 상세 services에 ${serviceRow.id}`, `${(detail.services ?? []).length}개`);
  if (multiImages) {
    const ordered = Array.isArray(detailService.images) && detailService.images.length === 3
      && detailService.images.every((img, i) => img.key === keys[i] && typeof img.url === 'string');
    if (!ordered) throw new Failed('상세 services[].images 3장 + url', JSON.stringify(detailService.images));
    pass(4, '고수 상세 이미지', 'images 3장, url 포함', detailService.images.map(i => `${i.sortOrder}:${i.url.split('/').pop()}`).join(', '));
  } else {
    blocked(4, '고수 상세 다중 이미지(WS-54)', 'images 3장, url 포함', 'WS-54 미배포 — imageKey/imageUrl 1장만');
  }

  const ledger = await call('POST', '/v1/ledgers', { token: customerToken, body: { expertId } });
  if (![200, 201].includes(ledger.status) || !ledger.body?.id) {
    throw new Failed('POST /v1/ledgers → 200/201 {id}', `HTTP ${ledger.status} ${JSON.stringify(ledger.body).slice(0, 300)}`);
  }
  ids.ledgerId = ledger.body.id;
  pass(4, '원장 생성', 'HTTP 200/201 + id', `HTTP ${ledger.status}, created=${ledger.body.created}, id=${ledger.body.id}`);

  const quote = expectStatus(await call('POST', `/v1/ledgers/${ids.ledgerId}/quotes`, {
    token: expertToken,
    body: { amount: 200000, message: 'E2E 7단계 견적', priceType: 'TOTAL', vatIncluded: false },
  }), 201, '견적 제시');
  ids.quoteId = quote.id;
  if (quote.totalAmount !== 220000) throw new Failed('부가세 별도 totalAmount=220000', `totalAmount=${quote.totalAmount}`);
  pass(4, '견적 제시', 'HTTP 201, totalAmount=220000, version=1', `HTTP 201, totalAmount=${quote.totalAmount}, version=${quote.version}`);

  const accepted = expectStatus(await call('POST', `/v1/quotes/${quote.id}/respond`, {
    token: customerToken, body: { action: 'accept', expectedVersion: quote.version },
  }), 200, '견적 수락');
  if (accepted.status !== 'ACCEPTED' || !accepted.agreementId) throw new Failed('status=ACCEPTED + agreementId', `status=${accepted.status}, agreementId=${accepted.agreementId}`);
  pass(4, '견적 수락', 'HTTP 200, status=ACCEPTED, agreementId', `HTTP 200, status=${accepted.status}, version=${accepted.version}`);

  // ── 5. 채팅 메시지 + 사진 ────────────────────────────────────────────────
  step = '5. 채팅 메시지 + 사진';
  console.log(`\n[5] ${step}`);
  const textBody = `E2E 채팅 ${startedAt}`;
  const sent = expectStatus(await call('POST', `/v1/ledgers/${ids.ledgerId}/messages`, {
    token: customerToken, body: { body: textBody },
  }), 201, '텍스트 메시지 전송');
  ids.messageId = sent.id;
  const messages = expectStatus(await call('GET', `/v1/ledgers/${ids.ledgerId}/messages`, { token: expertToken }), 200, '메시지 조회');
  if (!(messages.messages ?? []).some(m => m.id === sent.id && m.body === textBody)) {
    throw new Failed('상대 조회에 보낸 메시지 포함', `HTTP 200, ${(messages.messages ?? []).length}건`);
  }
  pass(5, '텍스트 메시지', 'HTTP 201 → 상대 조회에서 동일 id/body', `HTTP 201, total=${messages.total}`);

  const chatUpload = await uploadImage(customerToken, 'chat');
  if (chatUpload.presignStatus === 201 && String(chatUpload.presign?.key ?? '').startsWith(`chat/${customerId}/`)) {
    const key = chatUpload.presign.key;
    ids.chatImageKey = key;
    const withImage = await call('POST', `/v1/ledgers/${ids.ledgerId}/messages`, {
      token: customerToken, body: { body: 'E2E 채팅 사진', imageKey: key },
    });
    if (withImage.status !== 201) {
      blocked(5, '채팅 사진(WS-51)', 'POST 메시지 imageKey → 201 + imageUrl', `HTTP ${withImage.status} ${JSON.stringify(withImage.body).slice(0, 300)}`);
    } else {
      const after = expectStatus(await call('GET', `/v1/ledgers/${ids.ledgerId}/messages`, { token: expertToken }), 200, '사진 메시지 조회');
      const row = (after.messages ?? []).find(m => m.id === withImage.body.id);
      if (!row?.imageUrl) throw new Failed('조회 메시지에 imageUrl', JSON.stringify(row).slice(0, 300));
      pass(5, '채팅 사진(WS-51)', 'POST 201 → 상대 조회에 imageUrl', `HTTP 201, imageUrl=${row.imageUrl}`);
    }
  } else {
    blocked(5, '채팅 사진(WS-51)', 'POST /v1/uploads kind=chat → 201 chat/<memberId>/…',
      `HTTP ${chatUpload.presignStatus ?? '?'} ${JSON.stringify(chatUpload.presign ?? {}).slice(0, 300)}`);
  }

  // ── 6. 양측 완료 확인 → COMPLETED ────────────────────────────────────────
  step = '6. 양측 완료 확인';
  console.log(`\n[6] ${step}`);
  const expertDone = expectStatus(await call('POST', `/v1/quotes/${quote.id}/complete`, {
    token: expertToken, body: { expectedVersion: accepted.version },
  }), 200, '고수 완료 확인');
  if (expertDone.status === 'COMPLETED') throw new Failed('한쪽만 확인 → ACCEPTED 유지', 'status=COMPLETED');
  pass(6, '고수 완료 확인', 'HTTP 200, status=ACCEPTED', `HTTP 200, status=${expertDone.status}, version=${expertDone.version}`);

  const customerDone = expectStatus(await call('POST', `/v1/quotes/${quote.id}/complete`, {
    token: customerToken, body: { expectedVersion: expertDone.version },
  }), 200, '고객 완료 확인');
  if (customerDone.status !== 'COMPLETED') throw new Failed('양측 확인 → status=COMPLETED', `status=${customerDone.status}`);
  pass(6, '고객 완료 확인', 'HTTP 200, status=COMPLETED', `HTTP 200, status=${customerDone.status}, completedAt=${customerDone.completedAt}`);

  // ── 7. 후기 작성 → 고수 후기 목록 노출 ───────────────────────────────────
  step = '7. 후기 작성 + 노출';
  console.log(`\n[7] ${step}`);
  const reviewBody = `E2E 7단계 리뷰 ${startedAt}`;
  const review = await call('POST', `/v1/ledgers/${ids.ledgerId}/reviews`, {
    token: customerToken, body: { rating: 5, body: reviewBody },
  });
  if (review.status === 201) {
    ids.reviewId = review.body.id;
    pass(7, '후기 작성', 'HTTP 201 + review id', `HTTP 201, id=${review.body.id}, rating=${review.body.rating}`);
  } else if (review.status === 409) {
    const mine = expectStatus(await call('GET', '/v1/me/reviews', { token: customerToken }), 200, '내가 쓴 후기');
    const existing = (mine.written ?? []).find(r => r.ledgerId === ids.ledgerId);
    if (!existing) throw new Failed('409 REVIEW_EXISTS면 기존 후기가 조회돼야 한다', JSON.stringify(review.body));
    ids.reviewId = existing.id;
    pass(7, '후기 작성', 'HTTP 201 또는 409 REVIEW_EXISTS(재실행)', `HTTP 409 REVIEW_EXISTS, 기존 id=${existing.id}`);
  } else {
    expectStatus(review, 201, '후기 작성');
  }

  const publicReviews = expectStatus(await call('GET', `/v1/experts/${expertId}/reviews`), 200, '고수 후기 목록');
  const listedReview = (publicReviews.reviews ?? []).find(r => r.id === ids.reviewId);
  if (!listedReview) throw new Failed(`고수 후기 목록에 ${ids.reviewId}`, `${(publicReviews.reviews ?? []).length}건`);
  if ('email' in listedReview || 'authorId' in listedReview) {
    throw new Failed('공개 후기에 email/authorId 없음', Object.keys(listedReview).join(','));
  }
  pass(7, '고수 후기 목록 노출', 'GET /v1/experts/:id/reviews에 동일 review id', `HTTP 200, id=${listedReview.id}, rating=${listedReview.rating}, count=${publicReviews.summary?.count}`);

  const postedDetail = await call('GET', `/v1/experts/${expertId}`);
  if (!('reviews' in (postedDetail.body ?? {}))) {
    console.log('        참고: GET /v1/experts/:id 응답에는 reviews 필드가 없다(후기 목록은 /reviews 라우트).');
  }
}

main().then(() => {
  const failed = rows.filter(r => r.status === 'FAIL');
  const blockedRows = rows.filter(r => r.status === 'BLOCKED');
  console.log(`\n단계별 결과 (${rows.length}개 검사): PASS ${rows.filter(r => r.status === 'PASS').length}, BLOCKED ${blockedRows.length}, FAIL ${failed.length}`);
  for (const b of blockedRows) console.log(`  BLOCKED  ${b.step}단계 ${b.lane}: ${b.actual}`);
  console.log('\n생성 데이터 (dev DB/R2에 이력으로 남는다):');
  console.log(`  expertMemberId ${ids.expertMemberId}`);
  console.log(`  customerMemberId ${ids.customerMemberId}`);
  console.log(`  serviceId ${ids.serviceId}`);
  console.log(`  ledgerId  ${ids.ledgerId}`);
  console.log(`  quoteId   ${ids.quoteId}`);
  console.log(`  messageId ${ids.messageId}`);
  console.log(`  reviewId  ${ids.reviewId}`);
  console.log(`  imageKeys ${[ids.chatImageKey].filter(Boolean).join(', ') || '(채팅 이미지 없음)'}`);
  if (blockedRows.length > 0) {
    console.log('\nBLOCKED 단계가 있어 7단계 전체 통과는 아니다.');
    process.exitCode = 2;
  }
}).catch((error) => {
  console.error(`\n실패 단계: ${step}`);
  if (error instanceof Failed) {
    console.error(`  기대: ${error.expected}`);
    console.error(`  실제: ${error.actual}`);
    rows.push({ step, lane: '중단', status: 'FAIL', expected: error.expected, actual: error.actual });
  } else {
    console.error(`  ${error.message}`);
    rows.push({ step, lane: '중단', status: 'FAIL', expected: '예외 없음', actual: error.message });
  }
  console.log('\n생성 데이터 (실패 시점까지):');
  for (const [key, value] of Object.entries(ids)) console.log(`  ${key} ${value}`);
  process.exitCode = 1;
});
