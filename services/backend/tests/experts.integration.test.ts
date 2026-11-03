// Expert (고수) profile + service registration/search against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/experts.integration.test.ts
//
// Only ws-13 tables (expert_profiles, expert_services) are cleared. Members are
// created with random ids and deleted individually in after().

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const app = buildApp(postgresSql(pool), 'integration-experts', {});

type Actor = { id: string; token: string };
const token = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 10);
const expertA: Actor = { id: randomUUID(), token: token() };
const expertB: Actor = { id: randomUUID(), token: token() };
const customer: Actor = { id: randomUUID(), token: token() };

const auth = (bearerToken: string) => ({ authorization: `Bearer ${bearerToken}` });

async function seedMember(actor: Actor, nickname: string, expert: boolean) {
  const principalId = randomUUID();
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [actor.id, principalId, nickname, `${nickname}-${actor.id.slice(0, 8)}@dev.invalid`, nickname, sha(`phone-${actor.id}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), actor.id, sha(actor.token), sha('r-' + actor.token), randomUUID()],
  );
}

const serviceBody = (overrides: Record<string, unknown> = {}) => ({
  category: '욕실 리모델링',
  title: '욕실 타일 교체',
  description: '철거부터 줄눈까지 3일 작업',
  priceType: 'FIXED',
  basePrice: 1200000,
  ...overrides,
});

before(async () => {
  await pool.query(`TRUNCATE kg_membership.expert_services, kg_membership.expert_profiles CASCADE`);
  await seedMember(expertA, '고수A', true);
  await seedMember(expertB, '고수B', true);
  await seedMember(customer, '고객C', false);
});

after(async () => {
  await app.close();
  const ids = [expertA.id, expertB.id, customer.id];
  await pool.query(`DELETE FROM kg_membership.expert_services WHERE expert_member_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM kg_membership.expert_profiles WHERE member_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [ids]);
  const principals = (await pool.query(`SELECT principal_id FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [ids]))
    .rows.map(row => String(row.principal_id));
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [ids]);
  if (principals.length > 0) await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [principals]);
  await pool.end();
});

test('a non-EXPERT member cannot register a profile or a service', async () => {
  const profile = await app.inject({
    method: 'POST', url: '/v1/expert/profile', headers: auth(customer.token),
    payload: { introduction: '무단 등록', activityRegion: '서울' },
  });
  assert.equal(profile.statusCode, 403);
  assert.equal(profile.json().error.code, 'EXPERT_ROLE_REQUIRED');

  const service = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(customer.token), payload: serviceBody(),
  });
  assert.equal(service.statusCode, 403);

  const rows = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.expert_services`)).rows[0];
  assert.equal(rows.n, 0, 'a rejected request must not persist a service row');
});

test('profile requires a session and the expert role stays server-verified', async () => {
  const anonymous = await app.inject({ method: 'POST', url: '/v1/expert/profile', payload: { introduction: 'x', activityRegion: 'y' } });
  assert.equal(anonymous.statusCode, 401);

  // Flipping expert_active off in the database revokes the ability immediately.
  await pool.query(`UPDATE kg_membership.members SET expert_active=false WHERE id=$1`, [expertB.id]);
  const downgraded = await app.inject({
    method: 'POST', url: '/v1/expert/profile', headers: auth(expertB.token),
    payload: { introduction: '강등됨', activityRegion: '부산' },
  });
  assert.equal(downgraded.statusCode, 403);
  await pool.query(`UPDATE kg_membership.members SET expert_active=true WHERE id=$1`, [expertB.id]);
});

test('an expert creates a profile, patches it, and re-reads it from the database', async () => {
  const created = await app.inject({
    method: 'POST', url: '/v1/expert/profile', headers: auth(expertA.token),
    payload: { introduction: '욕실 전문 15년', career: '2010년부터 타일 시공', activityRegion: '서울·경기' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().expertId, expertA.id);
  assert.equal(created.json().status, 'ACTIVE');

  const duplicate = await app.inject({
    method: 'POST', url: '/v1/expert/profile', headers: auth(expertA.token),
    payload: { introduction: '중복', activityRegion: '서울' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'EXPERT_PROFILE_EXISTS');

  const patched = await app.inject({
    method: 'PATCH', url: '/v1/expert/profile', headers: auth(expertA.token),
    payload: { activityRegion: '서울·경기·인천' },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().activityRegion, '서울·경기·인천');
  assert.equal(patched.json().introduction, '욕실 전문 15년');

  const row = (await pool.query(
    `SELECT introduction, activity_region FROM kg_membership.expert_profiles WHERE member_id=$1`, [expertA.id],
  )).rows[0];
  assert.equal(row.activity_region, '서울·경기·인천');
  assert.equal(row.introduction, '욕실 전문 15년');
});

test('service creation persists and is re-readable', async () => {
  const created = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(expertA.token), payload: serviceBody(),
  });
  assert.equal(created.statusCode, 201);
  const serviceId = created.json().id;
  assert.match(serviceId, /^[0-9a-f-]{36}$/);
  assert.equal(created.json().visibility, 'VISIBLE');
  assert.equal(created.json().basePrice, 1200000);

  const row = (await pool.query(
    `SELECT expert_member_id, title, price_type, base_price, visibility FROM kg_membership.expert_services WHERE id=$1`,
    [serviceId],
  )).rows[0];
  assert.equal(row.expert_member_id, expertA.id);
  assert.equal(row.title, '욕실 타일 교체');
  assert.equal(row.price_type, 'FIXED');
  assert.equal(row.base_price, 1200000);
  assert.equal(row.visibility, 'VISIBLE');

  const detail = await app.inject({ method: 'GET', url: `/v1/experts/${expertA.id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().services.length, 1);
  assert.equal(detail.json().services[0].id, serviceId);
});

test('price type and base price must stay consistent', async () => {
  const missing = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(expertA.token),
    payload: serviceBody({ priceType: 'NEGOTIABLE' }),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, 'INVALID_PRICE');

  const negotiable = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(expertA.token),
    payload: serviceBody({ priceType: 'NEGOTIABLE', basePrice: null, title: '상담 후 견적' }),
  });
  assert.equal(negotiable.statusCode, 201);
  assert.equal(negotiable.json().basePrice, null);

  // Switching an existing priced service to NEGOTIABLE without clearing the price is refused.
  const conflict = await app.inject({
    method: 'PATCH', url: `/v1/expert/services/${negotiable.json().id}`, headers: auth(expertA.token),
    payload: { priceType: 'FIXED', basePrice: 500000 },
  });
  assert.equal(conflict.statusCode, 200);
  const back = await app.inject({
    method: 'PATCH', url: `/v1/expert/services/${negotiable.json().id}`, headers: auth(expertA.token),
    payload: { priceType: 'NEGOTIABLE' },
  });
  assert.equal(back.statusCode, 400);
  assert.equal(back.json().error.code, 'INVALID_PRICE');

  // Restore negotiable state for the search assertions below.
  const restored = await app.inject({
    method: 'PATCH', url: `/v1/expert/services/${negotiable.json().id}`, headers: auth(expertA.token),
    payload: { priceType: 'NEGOTIABLE', basePrice: null },
  });
  assert.equal(restored.statusCode, 200);
});

test('another expert cannot modify a service and is told it does not exist', async () => {
  await app.inject({
    method: 'POST', url: '/v1/expert/profile', headers: auth(expertB.token),
    payload: { introduction: 'B 소개', activityRegion: '대전' },
  });
  const own = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(expertA.token),
    payload: serviceBody({ title: 'A 소유 서비스' }),
  });
  assert.equal(own.statusCode, 201);
  const id = own.json().id;

  const foreign = await app.inject({
    method: 'PATCH', url: `/v1/expert/services/${id}`, headers: auth(expertB.token),
    payload: { title: '가로채기' },
  });
  assert.equal(foreign.statusCode, 404, 'a service owned by someone else must not be disclosed');
  assert.equal(foreign.json().error.code, 'SERVICE_NOT_FOUND');

  const row = (await pool.query(`SELECT title FROM kg_membership.expert_services WHERE id=$1`, [id])).rows[0];
  assert.equal(row.title, 'A 소유 서비스', 'the foreign update must not change the row');

  const missing = await app.inject({
    method: 'PATCH', url: `/v1/expert/services/${randomUUID()}`, headers: auth(expertB.token),
    payload: { title: '없는 서비스' },
  });
  assert.equal(missing.statusCode, 404);
});

test('search returns only visible services and hides the rest', async () => {
  const hidden = await app.inject({
    method: 'POST', url: '/v1/expert/services', headers: auth(expertA.token),
    payload: serviceBody({ title: '비노출 서비스', visibility: 'HIDDEN' }),
  });
  assert.equal(hidden.statusCode, 201);

  const search = await app.inject({ method: 'GET', url: '/v1/experts' });
  assert.equal(search.statusCode, 200);
  const body = search.json();
  const titles = body.experts.flatMap((e: { services: { title: string }[] }) => e.services.map(s => s.title));
  assert.ok(!titles.includes('비노출 서비스'), 'a hidden service must never be listed');
  assert.ok(titles.includes('욕실 타일 교체'));

  const counted = body.experts.find((e: { expertId: string }) => e.expertId === expertA.id);
  const visibleRows = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.expert_services WHERE expert_member_id=$1 AND visibility='VISIBLE'`,
    [expertA.id],
  )).rows[0].n;
  assert.equal(counted.serviceCount, visibleRows, 'serviceCount must count visible rows only');

  const detail = await app.inject({ method: 'GET', url: `/v1/experts/${expertA.id}` });
  assert.ok(!detail.json().services.some((s: { title: string }) => s.title === '비노출 서비스'));

  // Renaming the hidden service must not leak it into the result either.
  const byTitle = await app.inject({ method: 'GET', url: '/v1/experts?q=' + encodeURIComponent('비노출') });
  assert.equal(byTitle.statusCode, 200);
  assert.equal(byTitle.json().experts.length, 0);
});

test('search pagination is stable, newest-first, and complete', async () => {
  // spread service creation times so the keyset order is unambiguous
  for (const [i, title] of ['페이지1', '페이지2', '페이지3'].entries()) {
    const created = await app.inject({
      method: 'POST', url: '/v1/expert/services', headers: auth(expertB.token),
      payload: serviceBody({ category: '도배', title: `${title}-${i}`, priceType: 'HOURLY', basePrice: 30000 + i }),
    });
    assert.equal(created.statusCode, 201);
    await pool.query(`UPDATE kg_membership.expert_services SET created_at=now()+($2::int * interval '1 second') WHERE id=$1`,
      [created.json().id, i + 1]);
  }

  const first = await app.inject({ method: 'GET', url: '/v1/experts?limit=1' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().experts.length, 1);
  assert.ok(first.json().nextCursor, 'a full page must return a next cursor');

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await app.inject({ method: 'GET', url: '/v1/experts?limit=2' + query });
    assert.equal(response.statusCode, 200);
    const json = response.json() as { experts: { expertId: string }[]; nextCursor: string | null };
    seen.push(...json.experts.map((e: { expertId: string }) => e.expertId));
    cursor = json.nextCursor;
    if (!cursor) break;
  }
  assert.equal(new Set(seen).size, seen.length, 'pages must not repeat an expert');
  const total = (await pool.query(
    `SELECT count(DISTINCT p.member_id)::int AS n FROM kg_membership.expert_profiles p
       JOIN kg_membership.expert_services s ON s.expert_member_id=p.member_id
      WHERE s.visibility='VISIBLE' AND p.status='ACTIVE'`,
  )).rows[0].n;
  assert.equal(seen.length, total, 'every visible expert is reachable across pages');

  const badCursor = await app.inject({ method: 'GET', url: '/v1/experts?cursor=not-a-cursor' });
  assert.equal(badCursor.statusCode, 400);

  const tooLarge = await app.inject({ method: 'GET', url: '/v1/experts?limit=99' });
  assert.equal(tooLarge.statusCode, 400);
});

test('a hidden expert profile is not searchable and reports 404 on detail', async () => {
  await pool.query(`UPDATE kg_membership.expert_profiles SET status='HIDDEN' WHERE member_id=$1`, [expertB.id]);
  const search = await app.inject({ method: 'GET', url: '/v1/experts?limit=50' });
  assert.ok(!search.json().experts.some((e: { expertId: string }) => e.expertId === expertB.id));
  const detail = await app.inject({ method: 'GET', url: `/v1/experts/${expertB.id}` });
  assert.equal(detail.statusCode, 404);
  await pool.query(`UPDATE kg_membership.expert_profiles SET status='ACTIVE' WHERE member_id=$1`, [expertB.id]);
});

test('service writes are recorded in the audit log', async () => {
  const rows = (await pool.query(
    `SELECT action FROM kg_membership.audit_log WHERE actor_member_id=$1 AND target_type='expert_service'`,
    [expertA.id],
  )).rows;
  assert.ok(rows.some(r => r.action === 'EXPERT_SERVICE_CREATED'));
  assert.ok(rows.some(r => r.action === 'EXPERT_SERVICE_UPDATED'));
});
