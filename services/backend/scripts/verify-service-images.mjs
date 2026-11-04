#!/usr/bin/env node
// 서비스 포트폴리오 사진 3장을 실제 API로 올리고, 저장·재조회·순서·5장 초과 거절을 확인한다.
//
//   node scripts/verify-service-images.mjs [--base-url https://api-dev-kimgosu.mintech.ai] [--slot 11]
//
// 흐름은 앱과 같다: POST /v1/uploads → 반환된 uploadUrl로 PUT → key를 imageKeys로 저장.
// dev에 다중 이미지(WS-54)가 아직 배포되지 않았으면 3장 저장 단계는 BLOCKED로 남기고
// 성공으로 세지 않는다(BLOCKED만 있으면 exit 2). 요청 본문·응답만 출력하며 토큰은 찍지 않는다.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base-url', 'https://api-dev-kimgosu.mintech.ai');
const SLOT = Number(arg('slot', '11'));

// 1x1 PNG. 세 장을 구분하려고 뒤에 주석 바이트만 다르게 붙인다.
const png = (tag) => Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.from(`ws59-${tag}`),
]);

const rows = [];
class Failed extends Error {
  constructor(expected, actual) {
    super('기대와 다르다');
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

function expect(r, status, label) {
  if (r.status !== status) {
    throw new Failed(`${label} → HTTP ${status}`, `${label} → HTTP ${r.status} ${redact(r.body)}`);
  }
  return r.body;
}

// 세션 토큰은 응답 본문에 들어 있다. 출력·기록에는 절대 남기지 않는다.
function redact(body) {
  const text = JSON.stringify(body ?? null);
  return text.replace(/"(accessToken|refreshToken)":"[^"]*"/g, '"$1":"<redacted>"').slice(0, 300);
}

async function upload(token, tag) {
  const bytes = png(tag);
  const presign = expect(await call('POST', '/v1/uploads', { token, body: { contentType: 'image/png', kind: 'service' } }), 201, '업로드 슬롯');
  if (!presign.uploadUrl || !presign.key) throw new Failed('uploadUrl + key', JSON.stringify(presign).slice(0, 300));
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
  if (!put.ok) throw new Failed('R2 PUT 200', `R2 PUT ${put.status} ${(await put.text()).slice(0, 200)}`);
  const readBack = await fetch(presign.publicUrl);
  const downloaded = Buffer.from(await readBack.arrayBuffer());
  if (!readBack.ok || !downloaded.equals(bytes)) {
    throw new Failed('공개 URL 200 + 바이트 일치', `공개 URL ${readBack.status}, ${downloaded.length}B`);
  }
  return { key: presign.key, url: presign.publicUrl, bytes: bytes.length };
}

const main = async () => {
  console.log(`서비스 사진 3장 검증 — ${BASE} (slot ${SLOT})`);
  const login = expect(await call('POST', '/v1/auth/dev/login', { body: { slot: SLOT } }), 200, '고수 로그인');
  const token = login.session?.accessToken;
  const memberId = login.member?.id;
  if (!token || !memberId) throw new Failed('session.accessToken + member.id', redact(login));

  const first = [];
  for (const tag of ['a', 'b', 'c']) {
    const image = await upload(token, tag);
    first.push(image);
    pass(`사진 presign → PUT → 공개 URL (${tag})`, 'HTTP 201, PUT 200, 공개 URL 200 + 바이트 일치',
      `키 ${image.key}, ${image.bytes}B`);
  }

  const keys = first.map(image => image.key);
  let self = await call('GET', '/v1/me/expert', { token });
  if (self.status === 404 && self.body?.error?.code === 'EXPERT_PROFILE_REQUIRED') {
    await call('POST', '/v1/expert/profile', { token, body: { introduction: 'WS-59 사진 검증용 프로필', activityRegion: '서울' } });
    self = await call('GET', '/v1/me/expert', { token });
  }
  expect(self, 200, '내 서비스 목록');
  const existing = (self.body.services ?? [])[0];
  const body = {
    category: existing?.category ?? '욕실 리모델링',
    title: existing?.title ?? 'WS-59 검증 서비스',
    description: existing?.description ?? '포트폴리오 사진 3장 검증',
    priceType: existing?.priceType ?? 'FIXED',
    basePrice: existing?.basePrice ?? 100000,
    imageKeys: keys,
  };
  const saved = existing
    ? await call('PATCH', `/v1/expert/services/${existing.id}`, { token, body })
    : await call('POST', '/v1/expert/services', { token, body });

  if (saved.status === 400 && saved.body?.error?.code === 'INVALID_REQUEST') {
    blocked('사진 3장 저장', 'HTTP 201/200 + images 3장',
      'HTTP 400 INVALID_REQUEST — imageKeys가 아직 dev에 배포되지 않았다(WS-54)');
    blocked('고객 상세 images 3장', 'services[].images 3장, sortOrder 0,1,2', '저장이 막혀 확인할 수 없다');
    blocked('6장 저장 거절', 'HTTP 400 TOO_MANY_IMAGES', 'imageKeys 미배포로 확인할 수 없다');
    return 2;
  }
  const serviceId = (saved.body?.id ?? existing?.id);
  const check = (lane, payload) => {
    const images = payload?.images ?? [];
    const ordered = (Array.isArray(images) ? images : []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const ok = ordered.length === 3 &&
      ordered[0].key === keys[0] && ordered[1].key === keys[1] && ordered[2].key === keys[2] &&
      ordered.map(image => image.sortOrder).join(',') === '0,1,2' &&
      payload.imageKey === keys[0] && payload.imageUrl === first[0].url;
    if (!ok) {
      throw new Failed(`${lane} → images 3장, sortOrder 0,1,2, imageKey=첫 장`,
        `${lane} → ${JSON.stringify(images).slice(0, 400)}, imageKey=${payload?.imageKey}`);
    }
    pass(lane, 'images 3장, sortOrder 0,1,2, imageKey/imageUrl=첫 장',
      `keys ${ordered.map(image => image.key.split('/').pop()).join(' → ')}, sortOrder 0,1,2`);
  };

  if (saved.status !== 201 && saved.status !== 200) {
    throw new Failed('사진 3장 저장 → HTTP 200/201', `HTTP ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
  }
  check('사진 3장 저장', saved.body);

  const selfAfter = expect(await call('GET', '/v1/me/expert', { token }), 200, '내 서비스 재조회');
  const mine = (selfAfter.services ?? []).find(service => service.id === serviceId);
  check('내 서비스 재조회', mine);

  const detail = expect(await call('GET', `/v1/experts/${memberId}`), 200, '고객용 고수 상세');
  const inDetail = (detail.services ?? []).find(service => service.id === serviceId);
  check('고객 상세', inDetail);

  const extra = [];
  for (const tag of ['d', 'e', 'f']) extra.push((await upload(token, tag)).key);
  const tooMany = await call('PATCH', `/v1/expert/services/${serviceId}`, {
    token,
    body: { ...body, imageKeys: [...keys, ...extra] },
  });
  if (tooMany.status === 400 && tooMany.body?.error?.code === 'TOO_MANY_IMAGES') {
    pass('6장 저장 거절', 'HTTP 400 TOO_MANY_IMAGES', 'HTTP 400 TOO_MANY_IMAGES');
  } else {
    throw new Failed('6장 저장 거절 → HTTP 400 TOO_MANY_IMAGES', `HTTP ${tooMany.status} ${JSON.stringify(tooMany.body).slice(0, 300)}`);
  }
  // 6장 요청이 거절된 뒤에도 원래 3장이 그대로 남아야 한다.
  const finalSelf = expect(await call('GET', '/v1/me/expert', { token }), 200, '거절 후 재조회');
  check('거절 후 3장 유지', (finalSelf.services ?? []).find(service => service.id === serviceId));

  console.log(`\n서비스 ${serviceId}, 사진 키 ${keys.join(', ')}`);
  return 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof Failed) {
    record('실패', 'FAIL', error.expected, error.actual);
  } else {
    record('실패', 'FAIL', '예외 없음', error.stack ?? String(error));
  }
  process.exitCode = 1;
}

const blockedCount = rows.filter(row => row.status === 'BLOCKED').length;
const failedCount = rows.filter(row => row.status === 'FAIL').length;
console.log(`\n검사 ${rows.length}건: PASS ${rows.filter(row => row.status === 'PASS').length}, BLOCKED ${blockedCount}, FAIL ${failedCount}`);
