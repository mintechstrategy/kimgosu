#!/usr/bin/env node
// 확장 E2E — 취소(WS-71)·신고(WS-61/68)·인앱 알림(WS-75)을 실제 dev API에서 확인한다.
//
//   node scripts/e2e-extended.mjs [--base-url https://api-dev-kimgosu.mintech.ai]
//                                 [--cancel-slot 2] [--flow-slot 3]
//
// e2e-customer-flow.mjs는 정상 거래 경로만 본다. 이 스크립트는 그 뒤에 붙은 세
// 흐름을 단계별 기대/실제로 찍고, 기대와 다르면 그 단계에서 멈춘다.
//
// 아직 dev에 배포되지 않은 라우트는 404 ROUTE_NOT_FOUND로 판별해 BLOCKED로
// 남긴다. BLOCKED는 통과가 아니다. 취소는 원장당 한 번만 성립하므로 취소 흐름은
// 전용 계정 쌍(--cancel-slot)을 쓰고, 이미 취소된 원장이면 새 쌍으로 재실행해야
// 한다고 알린 뒤 BLOCKED 처리한다.
//
// exit 0 = 전 단계 PASS, 1 = FAIL, 2 = FAIL 없이 BLOCKED만 있음.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base-url', 'https://api-dev-kimgosu.mintech.ai');
const CANCEL_SLOT = Number(arg('cancel-slot', 2));
const FLOW_SLOT = Number(arg('flow-slot', 3));
const ADMIN_SLOT = 21;

// 1x1 투명 PNG. 내용은 중요하지 않고 R2에 실제로 올라갔는지만 본다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const rows = [];
const ids = { startedAt: new Date().toISOString() };
let step = '(시작 전)';

class Failed extends Error {
  constructor(expected, actual) {
    super('기대와 다르다');
    this.expected = expected;
    this.actual = actual;
  }
}

// 해당 라우트가 이 배포에 아예 없다는 뜻. 실패가 아니라 미배포다.
class Undeployed extends Error {
  constructor(lane, expected, actual) {
    super('미배포');
    this.lane = lane;
    this.expected = expected;
    this.actual = actual;
  }
}

function record(lane, status, expected, actual) {
  rows.push({ lane, status, expected, actual });
  console.log(`  ${status}  ${lane}`);
  console.log(`        기대: ${expected}`);
  console.log(`        실제: ${actual}`);
}
const pass = (lane, expected, actual) => record(lane, 'PASS', expected, actual);
const blocked = (lane, expected, actual) => record(lane, 'BLOCKED', expected, actual);

const isRouteMissing = r => r.status === 404 && r.body?.error?.code === 'ROUTE_NOT_FOUND';

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

// 미배포 라우트면 Undeployed를 던지고, 아니면 상태를 검사한다.
function expectDeployed(lane, r) {
  if (isRouteMissing(r)) throw new Undeployed(lane, '라우트 존재', `HTTP 404 ROUTE_NOT_FOUND — dev 미배포`);
  return r;
}

function expectStatus(r, status, label) {
  const expected = `${label} → HTTP ${status}`;
  const actual = `${label} → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
  if (r.status !== status) throw new Failed(expected, actual);
  return r.body;
}

async function login(slot, label) {
  const auth = expectStatus(await call('POST', '/v1/auth/dev/login', { body: { slot } }), 200, `${label} 로그인`);
  const token = auth.session?.accessToken;
  const memberId = auth.member?.id;
  if (!token || !memberId) throw new Failed('session.accessToken + member.id', JSON.stringify(auth).slice(0, 300));
  return { token, memberId, member: auth.member };
}

// 같은 상대와는 원장이 하나뿐이라 두 번째 호출은 200 + created:false로 기존 원장이 온다.
async function openLedger(customerToken, expertId) {
  const r = await call('POST', '/v1/ledgers', { token: customerToken, body: { expertId } });
  if (![200, 201].includes(r.status) || !r.body?.id) {
    throw new Failed('POST /v1/ledgers → 200/201 {id}', `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  return { ...r.body, httpStatus: r.status };
}

async function uploadImage(token, kind) {
  const presign = await call('POST', '/v1/uploads', { token, body: { contentType: 'image/png', kind } });
  if (presign.status !== 201) return { presignStatus: presign.status, presign: presign.body };
  const put = await fetch(presign.body.uploadUrl, {
    method: 'PUT',
    headers: presign.body.headers ?? { 'Content-Type': presign.body.contentType },
    body: PNG,
  });
  return { presignStatus: presign.status, presign: presign.body, putStatus: put.status };
}

async function proposeQuote(expertToken, ledgerId, amount) {
  return call('POST', `/v1/ledgers/${ledgerId}/quotes`, {
    token: expertToken,
    body: { amount, message: `E2E 확장 견적 ${ids.startedAt}`, priceType: 'TOTAL', vatIncluded: false },
  });
}

// ── 흐름 1: 거래 시작 → 견적 → 채팅(사진) → 취소 요청 → 상대 수락 → CANCELLED ──
async function cancelFlow(ctx) {
  step = '취소 흐름 — 원장 생성';
  console.log(`\n[취소] 거래 시작 → 견적 → 채팅(사진) → 취소 요청 → 상대 수락 → CANCELLED`);
  const ledger = await openLedger(ctx.cancelCustomer.token, ctx.expert.memberId);
  ids.cancelLedgerId = ledger.id;
  pass('취소 — 원장 생성/재사용', 'POST /v1/ledgers → 200/201 + id',
    `HTTP ${ledger.httpStatus}, id=${ledger.id}, created=${ledger.created}`);

  const state = await call('GET', `/v1/ledgers/${ledger.id}/cancel`, { token: ctx.cancelCustomer.token });
  expectDeployed('취소 — 원장 취소 상태 조회', state);
  const current = expectStatus(state, 200, `GET /v1/ledgers/:id/cancel`);
  if (current.status !== 'ACTIVE') {
    throw new Undeployed('취소 — 요청/수락 전이',
      '원장 status=ACTIVE에서 시작',
      `status=${current.status} — 이 계정 쌍의 원장은 이전 실행에서 이미 취소됐다. --cancel-slot 을 다른 값으로 지정해 재실행해야 한다`);
  }

  step = '취소 흐름 — 견적';
  const quote = await proposeQuote(ctx.expert.token, ledger.id, 150000);
  expectStatus(quote, 201, '견적 제시');
  ids.cancelQuoteId = quote.body.id;
  pass('취소 — 견적 제시', 'HTTP 201 + quote id', `HTTP 201, quoteId=${quote.body.id}, status=${quote.body.status}`);

  step = '취소 흐름 — 채팅 + 사진';
  const text = await call('POST', `/v1/ledgers/${ledger.id}/messages`, {
    token: ctx.cancelCustomer.token, body: { body: `E2E 취소 흐름 채팅 ${ids.startedAt}` },
  });
  expectStatus(text, 201, '채팅 텍스트 전송');
  pass('취소 — 채팅 텍스트', 'POST 메시지 → 201 + id', `HTTP 201, messageId=${text.body.id}`);
  const upload = await uploadImage(ctx.cancelCustomer.token, 'chat');
  if (upload.presignStatus === 201 && String(upload.presign?.key ?? '').startsWith(`chat/${ctx.cancelCustomer.memberId}/`)) {
    const photo = await call('POST', `/v1/ledgers/${ledger.id}/messages`, {
      token: ctx.cancelCustomer.token, body: { body: 'E2E 취소 흐름 사진', imageKey: upload.presign.key },
    });
    if (photo.status === 201 && photo.body?.imageUrl) {
      ids.cancelChatImageKey = upload.presign.key;
      pass('취소 — 채팅 사진', 'POST 메시지 imageKey → 201 + imageUrl', `HTTP 201, imageUrl=${photo.body.imageUrl}`);
    } else {
      blocked('취소 — 채팅 사진', 'POST 메시지 imageKey → 201 + imageUrl',
        `HTTP ${photo.status} ${JSON.stringify(photo.body).slice(0, 300)}`);
    }
  } else {
    blocked('취소 — 채팅 사진', 'POST /v1/uploads kind=chat → 201 chat/<memberId>/…',
      `HTTP ${upload.presignStatus} ${JSON.stringify(upload.presign ?? {}).slice(0, 300)}`);
  }

  step = '취소 흐름 — 취소 요청';
  const requested = await call('POST', `/v1/ledgers/${ledger.id}/cancel`, {
    token: ctx.cancelCustomer.token, body: { reasonCode: 'SCHEDULE', detail: 'E2E 취소 요청' },
  });
  expectDeployed('취소 — 고객 취소 요청', requested);
  const requestBody = expectStatus(requested, 200, '고객 취소 요청');
  if (requestBody.status !== 'CANCEL_REQUESTED' || requestBody.requestedByMe !== true) {
    throw new Failed('status=CANCEL_REQUESTED, requestedByMe=true',
      `status=${requestBody.status}, requestedByMe=${requestBody.requestedByMe}`);
  }
  pass('취소 — 고객 취소 요청', 'HTTP 200, status=CANCEL_REQUESTED, requestedByMe=true',
    `HTTP 200, status=${requestBody.status}, reasonCode=${requestBody.reasonCode}`);

  step = '취소 흐름 — 같은 쪽 재요청 거부';
  const again = await call('POST', `/v1/ledgers/${ledger.id}/cancel`, {
    token: ctx.cancelCustomer.token, body: { reasonCode: 'PRICE' },
  });
  expectStatus(again, 409, '같은 쪽 재요청');
  if (again.body?.error?.code !== 'CANCEL_ALREADY_REQUESTED') {
    throw new Failed('409 CANCEL_ALREADY_REQUESTED', JSON.stringify(again.body).slice(0, 300));
  }
  pass('취소 — 같은 쪽 재요청', 'HTTP 409 CANCEL_ALREADY_REQUESTED', `HTTP 409 ${again.body.error.code}`);

  step = '취소 흐름 — 상대 수락';
  const accepted = await call('POST', `/v1/ledgers/${ledger.id}/cancel`, { token: ctx.expert.token, body: {} });
  expectStatus(accepted, 200, '고수 취소 수락');
  if (accepted.body.status !== 'CANCELLED' || !accepted.body.cancelledAt) {
    throw new Failed('status=CANCELLED + cancelledAt', JSON.stringify(accepted.body).slice(0, 300));
  }
  pass('취소 — 상대 수락', 'HTTP 200, status=CANCELLED, cancelledAt',
    `HTTP 200, status=${accepted.body.status}, cancelledAt=${accepted.body.cancelledAt}`);

  step = '취소 흐름 — 취소 상태 재조회';
  const reread = await call('GET', `/v1/ledgers/${ledger.id}/cancel`, { token: ctx.expert.token });
  const after = expectStatus(reread, 200, '취소 상태 재조회');
  if (after.status !== 'CANCELLED') throw new Failed('status=CANCELLED', `status=${after.status}`);
  pass('취소 — 재조회', 'GET → status=CANCELLED, requestedByMe=false',
    `HTTP 200, status=${after.status}, requestedByMe=${after.requestedByMe}`);
}

// ── 흐름 2: 메시지 신고 → 관리자 목록 노출 → 처리 ─────────────────────────
async function reportFlow(ctx) {
  step = '신고 흐름 — 원장/견적/메시지 준비';
  console.log(`\n[신고] 메시지 신고 → 관리자 목록 노출 → 처리`);
  const ledger = await openLedger(ctx.flowCustomer.token, ctx.expert.memberId);
  ids.flowLedgerId = ledger.id;
  pass('신고 — 원장 생성/재사용', 'POST /v1/ledgers → 200/201 + id',
    `HTTP ${ledger.httpStatus}, id=${ledger.id}, created=${ledger.created}`);

  const quote = await proposeQuote(ctx.expert.token, ledger.id, 180000);
  expectStatus(quote, 201, '견적 제시(알림 생성 트리거)');
  ids.flowQuoteId = quote.body.id;
  pass('신고 — 견적 제시', 'HTTP 201 + quote id', `HTTP 201, quoteId=${quote.body.id}`);

  const message = await call('POST', `/v1/ledgers/${ledger.id}/messages`, {
    token: ctx.expert.token, body: { body: `E2E 신고 대상 메시지 ${ids.startedAt}` },
  });
  expectStatus(message, 201, '고수 메시지 전송');
  ids.reportedMessageId = message.body.id;
  pass('신고 — 신고 대상 메시지', 'POST 메시지 → 201 + id', `HTTP 201, messageId=${message.body.id}`);

  step = '신고 흐름 — 메시지 신고';
  const report = await call('POST', '/v1/reports', {
    token: ctx.flowCustomer.token,
    body: { targetType: 'MESSAGE', targetId: message.body.id, reasonCode: 'ABUSE', detail: 'E2E 신고 검증' },
  });
  expectDeployed('신고 — 메시지 신고 접수', report);
  const created = expectStatus(report, 201, 'POST /v1/reports');
  if (created.targetType !== 'MESSAGE' || String(created.targetId) !== String(message.body.id) || created.status !== 'OPEN') {
    throw new Failed('targetType=MESSAGE, targetId=보낸 메시지, status=OPEN', JSON.stringify(created).slice(0, 300));
  }
  ids.reportId = created.id;
  pass('신고 — 메시지 신고 접수', 'HTTP 201, status=OPEN, targetId=신고한 메시지',
    `HTTP 201, id=${created.id}, status=${created.status}`);

  step = '신고 흐름 — 관리자 세션';
  const adminMember = await login(ADMIN_SLOT, '관리자');
  const exchange = await call('POST', '/v1/admin/session', { body: { sessionToken: adminMember.token } });
  expectDeployed('신고 — 관리자 세션 교환', exchange);
  const adminSession = expectStatus(exchange, 201, 'POST /v1/admin/session');
  const adminToken = adminSession.adminToken;
  if (!adminToken) throw new Failed('adminToken', JSON.stringify(adminSession).slice(0, 300));

  step = '신고 흐름 — 관리자 목록 노출';
  const list = await call('GET', '/v1/admin/reports?status=OPEN&limit=20', { token: adminToken });
  expectDeployed('신고 — 관리자 신고 목록', list);
  const page = expectStatus(list, 200, 'GET /v1/admin/reports');
  const listed = (page.reports ?? []).find(r =>
    r.targetType === 'MESSAGE' && String(r.targetMemberId) === String(ctx.expert.memberId));
  if (!listed) {
    throw new Failed('관리자 OPEN 목록에 방금 신고 노출(신고자/대상 고수 기준)',
      `total=${page.total}, 최근 ${(page.reports ?? []).length}건에 대상 고수 메시지 신고 없음`);
  }
  pass('신고 — 관리자 목록 노출', 'GET /v1/admin/reports?status=OPEN에 방금 신고 포함',
    `HTTP 200, id=${listed.id}, status=${listed.status}, total=${page.total}`);

  step = '신고 흐름 — 관리자 상세 확인';
  const detail = await call('GET', `/v1/admin/reports/${listed.id}`, { token: adminToken });
  const detailBody = expectStatus(detail, 200, 'GET /v1/admin/reports/:id');
  if (String(detailBody.targetMessage?.id) !== String(message.body.id)) {
    throw new Failed(`상세 targetMessage.id=${message.body.id}`, JSON.stringify(detailBody).slice(0, 300));
  }
  if (String(detailBody.id) !== String(created.id)) {
    throw new Failed(`목록 첫 항목 = 방금 신고 ${created.id}`, `목록 항목 id=${detailBody.id}`);
  }
  pass('신고 — 관리자 상세', '상세의 신고 id·대상 메시지가 접수 결과와 일치',
    `HTTP 200, id=${detailBody.id}, targetMessage=${detailBody.targetMessage.id}`);

  step = '신고 흐름 — 관리자 처리';
  const resolve = await call('POST', `/v1/admin/reports/${created.id}/status`, {
    token: adminToken, body: { status: 'REVIEWED', memo: 'E2E 처리 검증' },
  });
  expectStatus(resolve, 200, 'POST /v1/admin/reports/:id/status');
  if (resolve.body.status !== 'REVIEWED') throw new Failed('status=REVIEWED', `status=${resolve.body.status}`);
  const resolved = await call('GET', `/v1/admin/reports/${created.id}`, { token: adminToken });
  const resolvedBody = expectStatus(resolved, 200, '처리 후 재조회');
  if (resolvedBody.status !== 'REVIEWED' || resolvedBody.resolution?.status !== 'REVIEWED') {
    throw new Failed('재조회 status=REVIEWED + resolution.status=REVIEWED',
      `status=${resolvedBody.status}, resolution=${JSON.stringify(resolvedBody.resolution)}`);
  }
  pass('신고 — 관리자 처리', '처리 후 재조회 status=REVIEWED, resolution 존재',
    `HTTP 200, status=${resolvedBody.status}, memo=${resolvedBody.resolution?.memo}`);
}

// ── 흐름 3: 견적 도착 알림 → 읽음 처리 → 배지 감소 ─────────────────────────
async function notificationFlow(ctx) {
  step = '알림 흐름 — 견적 도착 알림 생성';
  console.log(`\n[알림] 견적 도착 알림 생성 → 읽음 처리 → 배지 감소`);
  const before = await call('GET', '/v1/notifications', { token: ctx.flowCustomer.token });
  expectDeployed('알림 — 수신함 조회', before);

  // 기준선을 읽은 뒤 견적을 다시 내야 "이 견적으로 늘었다"를 말할 수 있다.
  const baseline = expectStatus(before, 200, 'GET /v1/notifications(기준)');
  const baselineUnread = Number(baseline.unreadCount ?? 0);

  step = '알림 흐름 — 견적 도착';
  const quote = await proposeQuote(ctx.expert.token, ids.flowLedgerId, 190000);
  expectStatus(quote, 201, '견적 제시(알림 트리거)');
  ids.notifyQuoteId = quote.body.id;

  const after = await call('GET', '/v1/notifications?kind=QUOTE', { token: ctx.flowCustomer.token });
  const inbox = expectStatus(after, 200, 'GET /v1/notifications?kind=QUOTE');
  const row = (inbox.notifications ?? []).find(n =>
    String(n.ledgerId) === String(ids.flowLedgerId) && n.readAt === null);
  if (!row) {
    throw new Failed('방금 견적(ledgerId 일치)에 대한 미읽음 QUOTE 알림',
      `unreadCount=${inbox.unreadCount}, 최근 ${(inbox.notifications ?? []).length}건에 해당 알림 없음`);
  }
  ids.notificationId = row.id;
  if (Number(inbox.unreadCount) <= baselineUnread) {
    throw new Failed(`배지 증가(기준 ${baselineUnread} 초과)`, `unreadCount=${inbox.unreadCount}`);
  }
  pass('알림 — 견적 도착 알림', '고객 수신함에 ledgerId 일치 미읽음 QUOTE 알림 + 배지 증가',
    `id=${row.id}, unreadCount=${baselineUnread}→${inbox.unreadCount}`);

  step = '알림 흐름 — 읽음 처리';
  const readAll = await call('POST', '/v1/notifications/read-all', { token: ctx.flowCustomer.token });
  expectDeployed('알림 — 전체 읽음', readAll);
  const readBody = expectStatus(readAll, 200, 'POST /v1/notifications/read-all');
  if (Number(readBody.unreadCount) !== 0) throw new Failed('unreadCount=0', `unreadCount=${readBody.unreadCount}`);

  const finalInbox = await call('GET', '/v1/notifications', { token: ctx.flowCustomer.token });
  const finalBody = expectStatus(finalInbox, 200, '읽음 후 재조회');
  const readRow = (finalBody.notifications ?? []).find(n => String(n.id) === String(row.id));
  if (Number(finalBody.unreadCount) !== 0 || !readRow?.readAt) {
    throw new Failed('배지 0 + 해당 알림 readAt 채워짐',
      `unreadCount=${finalBody.unreadCount}, readAt=${readRow?.readAt ?? '없음'}`);
  }
  pass('알림 — 읽음 처리 + 배지 감소', 'read-all → unreadCount=0, 알림 readAt 설정',
    `updated=${readBody.updated}, unreadCount ${baselineUnread}→0`);
}

async function main() {
  console.log(`확장 E2E (취소·신고·알림) — ${BASE}`);
  console.log(`계정: 고수 11, 취소 고객 ${CANCEL_SLOT}, 신고/알림 고객 ${FLOW_SLOT}, 관리자 ${ADMIN_SLOT}`);

  step = '로그인';
  console.log(`\n[0] ${step}`);
  const expert = await login(11, '고수');
  const cancelCustomer = await login(CANCEL_SLOT, '취소 고객');
  const flowCustomer = await login(FLOW_SLOT, '신고/알림 고객');
  ids.expertMemberId = expert.memberId;
  ids.cancelCustomerMemberId = cancelCustomer.memberId;
  ids.flowCustomerMemberId = flowCustomer.memberId;
  pass('로그인', '4개 계정 dev 로그인', `고수=${expert.memberId}, 취소=${cancelCustomer.memberId}, 알림=${flowCustomer.memberId}`);

  const ctx = { expert, cancelCustomer, flowCustomer };
  for (const flow of [cancelFlow, reportFlow, notificationFlow]) {
    try {
      await flow(ctx);
    } catch (error) {
      if (error instanceof Undeployed) {
        blocked(error.lane, error.expected, error.actual);
        continue;
      }
      throw error;
    }
  }
}

main().then(() => {
  const failed = rows.filter(r => r.status === 'FAIL');
  const blockedRows = rows.filter(r => r.status === 'BLOCKED');
  console.log(`\n흐름 결과 (${rows.length}개 검사): PASS ${rows.filter(r => r.status === 'PASS').length}, BLOCKED ${blockedRows.length}, FAIL ${failed.length}`);
  for (const b of blockedRows) console.log(`  BLOCKED  ${b.lane}: ${b.actual}`);
  console.log('\n생성 데이터 (dev DB/R2에 이력으로 남는다):');
  for (const [key, value] of Object.entries(ids)) console.log(`  ${key} ${value}`);
  if (blockedRows.length > 0) {
    console.log('\nBLOCKED 단계가 있어 3개 흐름 전체 통과는 아니다(미배포 라우트).');
    process.exitCode = 2;
  }
}).catch((error) => {
  console.error(`\n실패 단계: ${step}`);
  if (error instanceof Failed) {
    console.error(`  기대: ${error.expected}`);
    console.error(`  실제: ${error.actual}`);
    rows.push({ lane: step, status: 'FAIL', expected: error.expected, actual: error.actual });
  } else {
    console.error(`  ${error.message}`);
    rows.push({ lane: step, status: 'FAIL', expected: '예외 없음', actual: error.message });
  }
  console.log('\n생성 데이터 (실패 시점까지):');
  for (const [key, value] of Object.entries(ids)) console.log(`  ${key} ${value}`);
  process.exitCode = 1;
});
