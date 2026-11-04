#!/usr/bin/env node
// 실패 경로 E2E: 잘 되는 길이 아니라 사고가 나는 길을 실제 dev API로 확인한다.
//
//   node scripts/e2e-failure-paths.mjs [--base-url https://api-dev-kimgosu.mintech.ai] [--json-out <path>]
//
// 판정: 기대 상태코드·에러코드와 다르면 FAIL. 아직 dev에 배포되지 않은 기능
// (예: 채팅 이미지 = WS-51)은 BLOCKED로 남기고 통과로 세지 않는다.
// 종료 코드: FAIL 있음 1, FAIL 없이 BLOCKED 있음 2, 전부 PASS 0.
//
// dev 테스트 계정만 쓰고, 만든 원장·견적은 이력으로 남긴다(지우지 않는다).
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base-url', 'https://api-dev-kimgosu.mintech.ai').replace(/\/+$/, '');
const JSON_OUT = arg('json-out', null);

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
  return { status: response.status, code: json?.error?.code ?? null, body: json };
}

/** 응답 → 판정에 쓰는 최소 표현. */
const actualOf = (response) => ({ status: response.status, code: response.code });

async function login(slot) {
  const r = await call('POST', '/v1/auth/dev/login', { body: { slot } });
  if (r.status !== 200 || !r.body?.session?.accessToken) {
    throw new Error(`dev 로그인 실패 (slot ${slot}): ${r.status} ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.session.accessToken, memberId: r.body.member.id };
}

async function setup() {
  const accounts = await call('GET', '/v1/auth/dev/accounts');
  if (accounts.status !== 200) throw new Error(`dev 계정 목록 실패: ${accounts.status}`);
  const list = accounts.body.accounts ?? accounts.body;
  const userSlot = list.find((a) => a.role === 'USER');
  const expertSlot = list.find((a) => a.expertActive === true);
  if (!userSlot || !expertSlot) throw new Error('USER/EXPERT 슬롯을 찾지 못했다');

  const user = await login(userSlot.slot);
  const expert = await login(expertSlot.slot);

  // 고객이 고수에게 거래를 시작하는 실제 경로. 이미 있으면 기존 원장이 돌아온다.
  const ledger = await call('POST', '/v1/ledgers', { token: user.token, body: { expertId: expert.memberId } });
  if (![200, 201].includes(ledger.status) || !ledger.body?.id) {
    throw new Error(`원장 준비 실패: ${ledger.status} ${JSON.stringify(ledger.body)}`);
  }

  // 수락까지 끝난 견적 하나. 3·5번이 이 견적을 다시 건드린다.
  const proposed = await call('POST', `/v1/ledgers/${ledger.body.id}/quotes`, {
    token: expert.token,
    body: { amount: 100000, message: 'E2E 실패경로 견적', priceType: 'TOTAL', vatIncluded: false },
  });
  if (proposed.status !== 201) throw new Error(`견적 준비 실패: ${proposed.status} ${JSON.stringify(proposed.body)}`);
  const accepted = await call('POST', `/v1/quotes/${proposed.body.id}/respond`, {
    token: user.token, body: { action: 'accept', expectedVersion: proposed.body.version },
  });
  if (accepted.status !== 200) throw new Error(`견적 수락 준비 실패: ${accepted.status} ${JSON.stringify(accepted.body)}`);

  return {
    slots: { user: userSlot.slot, expert: expertSlot.slot },
    user,
    expert,
    ledgerId: ledger.body.id,
    acceptedQuote: { id: proposed.body.id, version: accepted.body.version },
  };
}

function buildChecks(ctx) {
  const { user, expert } = ctx;
  return [
    {
      id: 1,
      title: '비로그인 원장 생성',
      expect: { status: 401, code: 'AUTH_REQUIRED' },
      run: () => call('POST', '/v1/ledgers', { body: { expertId: expert.memberId } }),
    },
    {
      id: 2,
      title: '일반 사용자가 고수 원장에 견적 제시',
      expect: { status: 403, code: 'EXPERT_ONLY' },
      run: () => call('POST', `/v1/ledgers/${ctx.ledgerId}/quotes`, {
        token: user.token, body: { amount: 1000, message: '남의 원장 견적 시도' },
      }),
    },
    {
      id: 3,
      title: '이미 수락된 견적 재수락',
      expect: { status: 409, code: 'INVALID_TRANSITION' },
      run: () => call('POST', `/v1/quotes/${ctx.acceptedQuote.id}/respond`, {
        token: user.token, body: { action: 'accept', expectedVersion: ctx.acceptedQuote.version },
      }),
    },
    {
      id: 4,
      title: '만료·미발급 state로 소셜 콜백',
      expect: { status: 401, code: 'OAUTH_STATE_INVALID' },
      run: async () => {
        const config = await call('GET', '/v1/auth/config');
        const provider = (config.body?.oauth?.providers ?? []).find((p) => p.connected === true);
        if (!provider) return { blocked: true, note: '연결된 소셜 provider가 없다(설정 문제, 기능 미배포 아님)' };
        // 발급된 적 없는 43자 state. 만료 state와 같은 1회용 소비 경로를 지난다.
        const state = randomBytes(32).toString('base64url');
        return call('GET', `/v1/auth/oauth/${provider.id}/callback?state=${state}&code=probe`);
      },
    },
    {
      id: 5,
      title: '같은 쪽이 완료 확인 두 번',
      expect: { status: 409, code: 'ALREADY_CONFIRMED' },
      run: async () => {
        const first = await call('POST', `/v1/quotes/${ctx.acceptedQuote.id}/complete`, {
          token: expert.token, body: { expectedVersion: ctx.acceptedQuote.version },
        });
        if (first.status !== 200) return first;
        return call('POST', `/v1/quotes/${ctx.acceptedQuote.id}/complete`, {
          token: expert.token, body: { expectedVersion: first.body.version },
        });
      },
    },
    {
      id: 6,
      title: '남의 키로 채팅 이미지 전송',
      expect: { status: 403, code: 'IMAGE_NOT_OWNED' },
      run: async () => {
        const response = await call('POST', `/v1/ledgers/${ctx.ledgerId}/messages`, {
          token: user.token, body: { imageKey: `chat/${expert.memberId}/${randomUUID()}.jpg` },
        });
        // 배포 전 서버는 imageKey를 모르는 필드로 보고 400 INVALID_REQUEST를 준다.
        // 그 400은 "남의 키를 거부했다"가 아니라 "이미지 기능이 없다"이므로 통과로 세지 않는다.
        if (response.status === 400 && response.code === 'INVALID_REQUEST') {
          return { blocked: true, note: 'dev API가 imageKey를 아직 받지 않는다(WS-51 미배포)' };
        }
        return response;
      },
    },
    {
      id: 7,
      title: '존재하지 않는 고수로 원장 생성',
      expect: { status: 404, code: 'EXPERT_NOT_FOUND' },
      run: () => call('POST', '/v1/ledgers', { token: user.token, body: { expertId: randomUUID() } }),
    },
    {
      id: 8,
      title: '활동 상태에 잘못된 값',
      expect: { status: 400, code: 'INVALID_REQUEST' },
      run: () => call('PATCH', '/v1/me/expert/availability', {
        token: expert.token, body: { availability: 'ON_BREAK' },
      }),
    },
  ];
}

const same = (expected, actual) => expected.status === actual.status && expected.code === actual.code;

async function main() {
  const startedAt = new Date().toISOString();
  const ctx = await setup();
  const checks = [];

  for (const check of buildChecks(ctx)) {
    let entry;
    try {
      const result = await check.run();
      if (result.blocked) {
        entry = { id: check.id, title: check.title, expected: check.expect, actual: null, verdict: 'BLOCKED', note: result.note };
      } else {
        const actual = actualOf(result);
        entry = { id: check.id, title: check.title, expected: check.expect, actual, verdict: same(check.expect, actual) ? 'PASS' : 'FAIL' };
      }
    } catch (error) {
      entry = { id: check.id, title: check.title, expected: check.expect, actual: null, verdict: 'FAIL', note: `호출 실패: ${error.message}` };
    }
    checks.push(entry);
    const shown = entry.actual ? `${entry.actual.status} ${entry.actual.code ?? ''}`.trim() : '-';
    const want = `${check.expect.status} ${check.expect.code}`;
    const note = entry.note ? `  (${entry.note})` : '';
    console.log(`${String(entry.id).padStart(2)}. ${entry.verdict.padEnd(7)} ${check.title} → ${shown} (기대 ${want})${note}`);
  }

  const count = (verdict) => checks.filter((c) => c.verdict === verdict).length;
  const summary = { pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED') };
  console.log(`\nPASS ${summary.pass} / FAIL ${summary.fail} / BLOCKED ${summary.blocked}  base=${BASE}`);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, `${JSON.stringify({
      baseUrl: BASE, startedAt, finishedAt: new Date().toISOString(),
      slots: ctx.slots, ledgerId: ctx.ledgerId, quoteId: ctx.acceptedQuote.id,
      checks, summary,
    }, null, 2)}\n`);
  }

  if (summary.fail > 0) process.exit(1);
  if (summary.blocked > 0) process.exit(2);
}

main().catch((error) => {
  console.error(`준비 단계 실패: ${error.message}`);
  process.exit(1);
});
