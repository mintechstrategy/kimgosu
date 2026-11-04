import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Row, Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';
import { audit, fail, requireActiveMember } from './kernel.ts';

/**
 * Expert (고수) profile + service catalogue.
 *
 * Authority: EXPERT is the members.expert_active flag (migration 006). The flag
 * is re-read from the database for every write; a client-supplied role is never
 * accepted. Ownership is enforced in SQL (expert_member_id = session member), and
 * a service that is not owned reports 404 rather than 403 so its existence is
 * not disclosed.
 */

const SCHEMA = 'kg_membership';
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;
const SERVICES_PER_EXPERT = 5;
const SERVICE_LIST_MAX = 50;
const MAX_IMAGES = 5;
const MAX_PERIODS = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const uuidSchema = { type: 'string', format: 'uuid' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const profileSelect = `p.member_id AS "expertId", p.introduction, p.career,
  p.activity_region AS "activityRegion", p.status, p.availability,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const serviceSelect = `s.id, s.category, s.title, s.description, s.price_type AS "priceType",
  s.base_price AS "basePrice", s.visibility, s.image_key AS "imageKey",
  s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;

// 이미지 자체는 R2에 있고 DB에는 키만 둔다. 공개 도메인이 바뀌어도 마이그레이션이 필요 없다.
const publicImageUrl = (key: unknown) =>
  typeof key === 'string' && key ? `${(process.env.R2_PUBLIC_BASE_URL ?? process.env.KG_R2_PUBLIC_BASE ?? '').replace(/\/+$/, '')}/${key}` : null;

// 업로드 키는 /v1/uploads가 `service/<memberId>/<uuid>.<ext>`로 발급한다. 남의
// 키를 자기 서비스에 붙이면 그 사람의 사진이 내 공개 목록에 노출된다.
const serviceImageKeys = (memberId: string, body: { imageKeys?: string[]; imageKey?: string | null }) => {
  const keys = body.imageKeys ?? (body.imageKey ? [body.imageKey] : []);
  if (keys.length > MAX_IMAGES) throw new ApiError(400, 'TOO_MANY_IMAGES');
  const ownPrefix = `service/${memberId}/`;
  if (keys.some(key => !key.startsWith(ownPrefix))) throw new ApiError(403, 'IMAGE_NOT_OWNED');
  return keys;
};

async function writeImages(sql: Sql, serviceId: string, keys: string[]) {
  await sql.query(`DELETE FROM ${SCHEMA}.expert_service_images WHERE service_id=$1`, [serviceId]);
  if (keys.length === 0) return;
  await sql.query(
    `INSERT INTO ${SCHEMA}.expert_service_images(id,service_id,image_key,sort_order)
     SELECT gen_random_uuid(), $1, image_key, sort_order - 1
       FROM unnest($2::text[]) WITH ORDINALITY AS t(image_key, sort_order)`,
    [serviceId, keys],
  );
}

/**
 * images[]를 sort_order 순으로 붙이고, imageKey/imageUrl은 첫 장으로 맞춘다.
 * 서비스가 여러 개여도 조회는 한 번이다.
 */
async function withImages(sql: Sql, rows: Row[]) {
  if (rows.length === 0) return rows;
  const images = (await sql.query(
    `SELECT service_id AS "serviceId", image_key AS "key", sort_order AS "sortOrder"
       FROM ${SCHEMA}.expert_service_images
      WHERE service_id = ANY($1::uuid[])
      ORDER BY service_id, sort_order`,
    [rows.map(row => String(row.id))],
  )).rows;
  const byService = new Map<string, { key: string; url: string | null; sortOrder: number }[]>();
  for (const image of images) {
    const serviceId = String(image.serviceId);
    const list = byService.get(serviceId) ?? [];
    list.push({ key: String(image.key), url: publicImageUrl(image.key), sortOrder: Number(image.sortOrder) });
    byService.set(serviceId, list);
  }
  return rows.map(row => {
    const list = byService.get(String(row.id)) ?? [];
    const imageKey = list[0]?.key ?? (row.imageKey as string | null | undefined) ?? null;
    return { ...row, imageKey, imageUrl: publicImageUrl(imageKey), images: list };
  });
}

const encodeCursor = (at: unknown, expertId: unknown) =>
  Buffer.from(`${new Date(String(at)).toISOString()}|${String(expertId)}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): { at: string; id: string } {
  let text = '';
  try { text = Buffer.from(raw, 'base64url').toString('utf8'); } catch { throw new ApiError(400, 'INVALID_CURSOR'); }
  const [at, id] = text.split('|');
  const time = Date.parse(at ?? '');
  if (!at || !id || Number.isNaN(time) || !uuidPattern.test(id)) throw new ApiError(400, 'INVALID_CURSOR');
  return { at: new Date(time).toISOString(), id };
}

/** Escape LIKE metacharacters so a search term cannot widen the match. */
const likeTerm = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

function assertPrice(priceType: string, basePrice: unknown) {
  const negotiable = priceType === 'NEGOTIABLE';
  if (negotiable && basePrice !== null && basePrice !== undefined) throw new ApiError(400, 'INVALID_PRICE');
  if (!negotiable && (basePrice === null || basePrice === undefined)) throw new ApiError(400, 'INVALID_PRICE');
}

/** YYYY-MM-DD shape and a real calendar day. 2026-02-30 passes the regex only. */
const isCalendarDay = (value: string) =>
  DATE_PATTERN.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const assertPeriod = (startsAt: string, endsAt: string) => {
  if (!isCalendarDay(startsAt) || !isCalendarDay(endsAt)) throw new ApiError(400, 'INVALID_PERIOD');
  if (endsAt < startsAt) throw new ApiError(400, 'INVALID_PERIOD');
};

export function registerExpertRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  /** Session → active member that currently holds the EXPERT role. */
  const requireExpert = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireMember(request, reply);
    if (!auth) return null;
    const member = (await db.query(
      `SELECT expert_active AS "expertActive" FROM ${SCHEMA}.members
        WHERE id=$1 AND withdrawn_at IS NULL AND status='ACTIVE'`,
      [auth.memberId],
    )).rows[0];
    if (!member) throw new ApiError(401, 'SESSION_INVALID');
    if (member.expertActive !== true) throw new ApiError(403, 'EXPERT_ROLE_REQUIRED');
    return auth;
  };

  // ── Profile ────────────────────────────────────────────────────────────────
  app.post<{ Body: { introduction: string; career?: string; activityRegion: string } }>('/v1/expert/profile', {
    schema: body({ introduction: string(1, 1000), career: string(1, 2000), activityRegion: string(1, 100) }, ['introduction', 'activityRegion']),
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const profile = await db.transaction(async sql => {
      const created = (await sql.query(
        `INSERT INTO ${SCHEMA}.expert_profiles(member_id,introduction,career,activity_region)
         VALUES($1,$2,$3,$4)
         ON CONFLICT (member_id) DO NOTHING
         RETURNING member_id`,
        [auth.memberId, request.body.introduction.trim(), request.body.career ?? null, request.body.activityRegion.trim()],
      )).rows[0];
      if (!created) throw new ApiError(409, 'EXPERT_PROFILE_EXISTS');
      return (await sql.query(
        `SELECT ${profileSelect} FROM ${SCHEMA}.expert_profiles p WHERE p.member_id=$1`, [auth.memberId],
      )).rows[0];
    });
    return reply.code(201).send(profile);
  });

  app.patch<{ Body: { introduction?: string; career?: string | null; activityRegion?: string } }>('/v1/expert/profile', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1, required: [],
      properties: { introduction: string(1, 1000), career: { type: ['string', 'null'], maxLength: 2000 }, activityRegion: string(1, 100) } } },
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const columns: Record<string, string> = { introduction: 'introduction', career: 'career', activityRegion: 'activity_region' };
    const values: unknown[] = [auth.memberId];
    const sets: string[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = (request.body as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(typeof value === 'string' && key !== 'career' ? value.trim() : value);
      sets.push(`${column}=$${values.length}`);
    }
    const updated = (await db.query(
      `UPDATE ${SCHEMA}.expert_profiles p SET ${sets.join(',')}, updated_at=now()
        WHERE p.member_id=$1
        RETURNING ${profileSelect}`,
      values,
    )).rows[0];
    if (!updated) throw new ApiError(404, 'EXPERT_PROFILE_NOT_FOUND');
    return updated;
  });

  // ── Services (owner) ───────────────────────────────────────────────────────
  app.post<{ Body: { category: string; title: string; description: string; priceType: string; basePrice?: number | null; visibility?: string; imageKey?: string | null; imageKeys?: string[] } }>('/v1/expert/services', {
    schema: body({
      category: string(1, 50), title: string(1, 100), description: string(1, 2000),
      priceType: { type: 'string', enum: ['FIXED', 'HOURLY', 'NEGOTIABLE'] },
      basePrice: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
      visibility: { type: 'string', enum: ['VISIBLE', 'HIDDEN'] },
      imageKey: { type: ['string', 'null'], minLength: 1, maxLength: 300 },
      imageKeys: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, uniqueItems: true },
    }, ['category', 'title', 'description', 'priceType']),
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    assertPrice(request.body.priceType, request.body.basePrice ?? null);
    const imageKeys = serviceImageKeys(String(auth.memberId), request.body);
    const service = await db.transaction(async sql => {
      const profile = (await sql.query(
        `SELECT 1 FROM ${SCHEMA}.expert_profiles WHERE member_id=$1`, [auth.memberId],
      )).rows[0];
      if (!profile) throw new ApiError(409, 'EXPERT_PROFILE_REQUIRED');
      const service = (await sql.query(
        `INSERT INTO ${SCHEMA}.expert_services(id,expert_member_id,category,title,description,price_type,base_price,visibility,image_key)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${serviceSelect.replace(/s\./g, '')}`,
        [randomUUID(), auth.memberId, request.body.category.trim(), request.body.title.trim(), request.body.description.trim(),
          request.body.priceType, request.body.basePrice ?? null, request.body.visibility ?? 'VISIBLE',
          imageKeys[0] ?? null],
      )).rows[0];
      await writeImages(sql, String(service.id), imageKeys);
      await audit(sql, auth.memberId, 'EXPERT_SERVICE_CREATED', 'expert_service', String(service.id), null, { visibility: service.visibility });
      return (await withImages(sql, [service]))[0];
    });
    return reply.code(201).send(service);
  });

  app.patch<{ Params: { id: string }; Body: { category?: string; title?: string; description?: string; priceType?: string; basePrice?: number | null; visibility?: string; imageKey?: string | null; imageKeys?: string[] } }>('/v1/expert/services/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuidSchema } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, required: [],
        properties: { category: string(1, 50), title: string(1, 100), description: string(1, 2000),
          priceType: { type: 'string', enum: ['FIXED', 'HOURLY', 'NEGOTIABLE'] },
          basePrice: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
          visibility: { type: 'string', enum: ['VISIBLE', 'HIDDEN'] },
          imageKey: { type: ['string', 'null'], minLength: 1, maxLength: 300 },
          imageKeys: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, uniqueItems: true } } },
    },
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    // imageKeys가 없으면 사진은 건드리지 않는다. imageKey(단일)는 예전 계약 그대로
    // 한 장짜리 imageKeys로 취급한다.
    const replacesImages = request.body.imageKeys !== undefined || request.body.imageKey !== undefined;
    const imageKeys = replacesImages ? serviceImageKeys(String(auth.memberId), request.body) : [];
    return db.transaction(async sql => {
      const current = (await sql.query(
        `SELECT id, price_type AS "priceType", base_price AS "basePrice"
           FROM ${SCHEMA}.expert_services WHERE id=$1 AND expert_member_id=$2 FOR UPDATE`,
        [request.params.id, auth.memberId],
      )).rows[0];
      if (!current) throw new ApiError(404, 'SERVICE_NOT_FOUND');
      const priceType = request.body.priceType ?? String(current.priceType);
      const basePrice = request.body.basePrice !== undefined ? request.body.basePrice : (current.basePrice as number | null);
      assertPrice(priceType, basePrice);

      const columns: Record<string, string> = {
        category: 'category', title: 'title', description: 'description',
        priceType: 'price_type', basePrice: 'base_price', visibility: 'visibility',
      };
      const values: unknown[] = [request.params.id, auth.memberId];
      const sets: string[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (request.body as Record<string, unknown>)[key];
        if (value === undefined) continue;
        values.push(typeof value === 'string' && ['category', 'title', 'description'].includes(key) ? value.trim() : value);
        sets.push(`${column}=$${values.length}`);
      }
      if (replacesImages) {
        values.push(imageKeys[0] ?? null);
        sets.push(`image_key=$${values.length}`);
      }
      const updated = (await sql.query(
        `UPDATE ${SCHEMA}.expert_services s SET ${sets.join(',')}, updated_at=now()
          WHERE s.id=$1 AND s.expert_member_id=$2
          RETURNING ${serviceSelect}`,
        values,
      )).rows[0];
      if (!updated) throw new ApiError(404, 'SERVICE_NOT_FOUND');
      if (replacesImages) await writeImages(sql, String(updated.id), imageKeys);
      await audit(sql, auth.memberId, 'EXPERT_SERVICE_UPDATED', 'expert_service', String(request.params.id), null, { visibility: updated.visibility });
      return (await withImages(sql, [updated]))[0];
    });
  });

  // ── Self ───────────────────────────────────────────────────────────────────
  // The app's expert screens read the caller's own profile, availability and
  // services. The public /v1/experts/:id view belongs to someone else, so it
  // cannot answer "am I on vacation right now".
  app.get('/v1/me/expert', async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const profile = (await db.query(
      `SELECT ${profileSelect} FROM ${SCHEMA}.expert_profiles p WHERE p.member_id=$1`, [auth.memberId],
    )).rows[0];
    if (!profile) throw new ApiError(404, 'EXPERT_PROFILE_REQUIRED');
    const services = (await db.query(
      `SELECT ${serviceSelect} FROM ${SCHEMA}.expert_services s
        WHERE s.expert_member_id=$1 ORDER BY s.created_at DESC`, [auth.memberId],
    )).rows;
    return { ...profile, services: await withImages(db, services) };
  });

  // 수신 중 / 일시중지 / 휴가. Operator visibility (status) is a different axis
  // and is not settable from here.
  app.patch<{ Body: { availability: string } }>('/v1/me/expert/availability', {
    schema: body({ availability: { type: 'string', enum: ['AVAILABLE', 'PAUSED', 'VACATION'] } }, ['availability']),
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const updated = await db.transaction(async sql => {
      const row = (await sql.query(
        `UPDATE ${SCHEMA}.expert_profiles p SET availability=$2, updated_at=now()
          WHERE p.member_id=$1 RETURNING ${profileSelect}`,
        [auth.memberId, request.body.availability],
      )).rows[0];
      if (!row) throw new ApiError(404, 'EXPERT_PROFILE_REQUIRED');
      await audit(sql, auth.memberId, 'EXPERT_AVAILABILITY_CHANGED', 'expert_profile', String(auth.memberId),
        null, { availability: request.body.availability });
      return row;
    });
    return updated;
  });

  // ── Vacation periods ───────────────────────────────────────────────────────
  // A period is a day range, not a status change. The search list keeps showing
  // the expert and only marks 휴가 중 while today falls inside one of these rows.
  const periodSelect = `id, to_char(starts_at,'YYYY-MM-DD') AS "startsAt",
  to_char(ends_at,'YYYY-MM-DD') AS "endsAt", reason, created_at AS "createdAt"`;
  const daySchema = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };

  app.get('/v1/me/expert/availability/periods', async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const rows = (await db.query(
      `SELECT ${periodSelect} FROM ${SCHEMA}.expert_availability_periods
        WHERE member_id=$1 ORDER BY starts_at DESC, created_at DESC`, [auth.memberId],
    )).rows;
    return { periods: rows };
  });

  app.post<{ Body: { startsAt: string; endsAt: string; reason?: string | null } }>('/v1/me/expert/availability/periods', {
    schema: body({ startsAt: daySchema, endsAt: daySchema, reason: { type: ['string', 'null'], maxLength: 100 } }, ['startsAt', 'endsAt']),
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    assertPeriod(request.body.startsAt, request.body.endsAt);
    const reason = request.body.reason?.trim() || null;
    const id = randomUUID();
    const period = await db.transaction(async sql => {
      const created = (await sql.query(
        `INSERT INTO ${SCHEMA}.expert_availability_periods(id,member_id,starts_at,ends_at,reason)
         VALUES($1,$2,$3,$4,$5) RETURNING ${periodSelect}`,
        [id, auth.memberId, request.body.startsAt, request.body.endsAt, reason],
      )).rows[0];
      await audit(sql, auth.memberId, 'EXPERT_AVAILABILITY_PERIOD_CREATED', 'expert_availability_period',
        String(id), null, { startsAt: request.body.startsAt, endsAt: request.body.endsAt });
      return created;
    });
    return reply.code(201).send(period);
  });

  app.delete<{ Params: { id: string } }>('/v1/me/expert/availability/periods/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuidSchema } } },
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    const deleted = await db.transaction(async sql => {
      const row = (await sql.query(
        `DELETE FROM ${SCHEMA}.expert_availability_periods
          WHERE id=$1 AND member_id=$2 RETURNING id`,
        [request.params.id, auth.memberId],
      )).rows[0];
      if (!row) throw new ApiError(404, 'PERIOD_NOT_FOUND');
      await audit(sql, auth.memberId, 'EXPERT_AVAILABILITY_PERIOD_DELETED', 'expert_availability_period',
        String(request.params.id));
      return row;
    });
    // 200 + JSON, not 204: both app clients parse every response as JSON.
    return { id: String(deleted.id) };
  });

  // ── Public search ──────────────────────────────────────────────────────────
  // Only visible services of an ACTIVE profile are searchable; order is fixed
  // newest-first and pagination is required (keyset cursor).
  app.get<{ Querystring: { limit?: string; cursor?: string; category?: string; q?: string } }>('/v1/experts', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: [],
      properties: { limit: { type: 'string', pattern: '^[0-9]{1,3}$' }, cursor: string(1, 200),
        category: string(1, 50), q: string(1, 100) } } },
  }, async (request) => {
    const limit = request.query.limit === undefined ? PAGE_DEFAULT : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) throw new ApiError(400, 'INVALID_REQUEST');
    const cursor = request.query.cursor === undefined ? null : decodeCursor(request.query.cursor);

    const filters = [`s.visibility='VISIBLE'`, `p.status='ACTIVE'`, `m.withdrawn_at IS NULL`];
    const values: unknown[] = [];
    const applyFilters = () => {
      if (request.query.category !== undefined) { values.push(request.query.category); filters.push(`s.category=$${values.length}`); }
      if (request.query.q !== undefined) {
        values.push(likeTerm(request.query.q));
        filters.push(`(s.title ILIKE $${values.length} ESCAPE '\\' OR s.description ILIKE $${values.length} ESCAPE '\\')`);
      }
    };
    applyFilters();

    let having = '';
    if (cursor) {
      values.push(cursor.at); const at = values.length;
      values.push(cursor.id); const id = values.length;
      having = `HAVING (max(s.created_at), p.member_id) < ($${at}::timestamptz, $${id}::uuid)`;
    }
    values.push(limit + 1);
    const pageSize = values.length;

    const grouped = (await db.query(
      `SELECT p.member_id AS "expertId", m.nickname, p.introduction, p.career,
              p.activity_region AS "activityRegion", p.availability,
              count(*)::int AS "serviceCount",
              min(s.base_price) AS "fromPrice",
              max(s.created_at) AS "lastServiceAt"
         FROM ${SCHEMA}.expert_services s
         JOIN ${SCHEMA}.expert_profiles p ON p.member_id=s.expert_member_id
         JOIN ${SCHEMA}.members m ON m.id=p.member_id
        WHERE ${filters.join(' AND ')}
        GROUP BY p.member_id, m.nickname, p.introduction, p.career, p.activity_region, p.availability
        ${having}
        ORDER BY max(s.created_at) DESC, p.member_id DESC
        LIMIT $${pageSize}`,
      values,
    )).rows;

    const hasMore = grouped.length > limit;
    const page = hasMore ? grouped.slice(0, limit) : grouped;
    if (page.length === 0) return { experts: [], nextCursor: null };

    // 휴가 기간은 한국 시간 기준 오늘을 포함하는지로 판정한다. 서버 시간대에 따라
    // 하루가 어긋나면 사용자가 보는 날짜와 표시가 달라진다.
    const vacationNow = new Set((await db.query(
      `SELECT DISTINCT member_id AS "memberId"
         FROM ${SCHEMA}.expert_availability_periods
        WHERE member_id = ANY($1::uuid[])
          AND (now() AT TIME ZONE 'Asia/Seoul')::date BETWEEN starts_at AND ends_at`,
      [page.map(row => String(row.expertId))],
    )).rows.map(row => String(row.memberId)));

    const serviceValues: unknown[] = [page.map(row => String(row.expertId))];
    const serviceFilters = [`s.visibility='VISIBLE'`, `s.expert_member_id = ANY($1::uuid[])`];
    if (request.query.category !== undefined) { serviceValues.push(request.query.category); serviceFilters.push(`s.category=$${serviceValues.length}`); }
    if (request.query.q !== undefined) {
      serviceValues.push(likeTerm(request.query.q));
      serviceFilters.push(`(s.title ILIKE $${serviceValues.length} ESCAPE '\\' OR s.description ILIKE $${serviceValues.length} ESCAPE '\\')`);
    }
    serviceValues.push(SERVICES_PER_EXPERT);
    const services = await withImages(db, (await db.query(
      `SELECT * FROM (
         SELECT ${serviceSelect}, s.expert_member_id AS "expertId",
                row_number() OVER (PARTITION BY s.expert_member_id ORDER BY s.created_at DESC, s.id DESC) AS rn
           FROM ${SCHEMA}.expert_services s
          WHERE ${serviceFilters.join(' AND ')}
       ) listed
       WHERE rn <= $${serviceValues.length}
       ORDER BY "createdAt" DESC, id DESC`,
      serviceValues,
    )).rows);

    const experts = page.map(row => ({
      ...row,
      onVacation: row.availability === 'VACATION' || vacationNow.has(String(row.expertId)),
      services: services.filter(service => String(service.expertId) === String(row.expertId)),
    }));
    const last = page[page.length - 1];
    return { experts, nextCursor: hasMore ? encodeCursor(last.lastServiceAt, last.expertId) : null };
  });

  app.get<{ Params: { id: string } }>('/v1/experts/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuidSchema } } },
  }, async (request, reply) => {
    const profile = (await db.query(
      `SELECT ${profileSelect}, m.nickname
         FROM ${SCHEMA}.expert_profiles p
         JOIN ${SCHEMA}.members m ON m.id=p.member_id
        WHERE p.member_id=$1 AND p.status='ACTIVE' AND m.withdrawn_at IS NULL`,
      [request.params.id],
    )).rows[0];
    // A hidden profile is indistinguishable from a missing one.
    if (!profile) return fail(reply, 404, 'EXPERT_NOT_FOUND');
    const services = await withImages(db, (await db.query(
      `SELECT ${serviceSelect} FROM ${SCHEMA}.expert_services s
        WHERE s.expert_member_id=$1 AND s.visibility='VISIBLE'
        ORDER BY s.created_at DESC, s.id DESC LIMIT ${SERVICE_LIST_MAX}`,
      [request.params.id],
    )).rows);
    return { expert: profile, services };
  });
}
