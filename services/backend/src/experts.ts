import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';

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

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const uuidSchema = { type: 'string', format: 'uuid' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const profileSelect = `p.member_id AS "expertId", p.introduction, p.career,
  p.activity_region AS "activityRegion", p.status,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const serviceSelect = `s.id, s.category, s.title, s.description, s.price_type AS "priceType",
  s.base_price AS "basePrice", s.visibility,
  s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;

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

async function audit(sql: Sql, actor: unknown, action: string, targetId: string, detail?: Row) {
  await sql.query(
    `INSERT INTO ${SCHEMA}.audit_log(actor_member_id,action,target_type,target_id,detail)
     VALUES($1,$2,'expert_service',$3,$4)`,
    [actor, action, targetId, JSON.stringify(detail ?? {})],
  );
}

function assertPrice(priceType: string, basePrice: unknown) {
  const negotiable = priceType === 'NEGOTIABLE';
  if (negotiable && basePrice !== null && basePrice !== undefined) throw new ApiError(400, 'INVALID_PRICE');
  if (!negotiable && (basePrice === null || basePrice === undefined)) throw new ApiError(400, 'INVALID_PRICE');
}

export function registerExpertRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  /** Session → active member. */
  const requireMember = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return null;
    if (auth.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
    return auth;
  };

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
    return db.transaction(async sql => {
      const created = (await sql.query(
        `INSERT INTO ${SCHEMA}.expert_profiles(member_id,introduction,career,activity_region)
         VALUES($1,$2,$3,$4)
         ON CONFLICT (member_id) DO NOTHING
         RETURNING member_id`,
        [auth.memberId, request.body.introduction.trim(), request.body.career ?? null, request.body.activityRegion.trim()],
      )).rows[0];
      if (!created) throw new ApiError(409, 'EXPERT_PROFILE_EXISTS');
      const profile = (await sql.query(
        `SELECT ${profileSelect} FROM ${SCHEMA}.expert_profiles p WHERE p.member_id=$1`, [auth.memberId],
      )).rows[0];
      return reply.code(201).send(profile);
    });
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
  app.post<{ Body: { category: string; title: string; description: string; priceType: string; basePrice?: number | null; visibility?: string } }>('/v1/expert/services', {
    schema: body({
      category: string(1, 50), title: string(1, 100), description: string(1, 2000),
      priceType: { type: 'string', enum: ['FIXED', 'HOURLY', 'NEGOTIABLE'] },
      basePrice: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
      visibility: { type: 'string', enum: ['VISIBLE', 'HIDDEN'] },
    }, ['category', 'title', 'description', 'priceType']),
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
    assertPrice(request.body.priceType, request.body.basePrice ?? null);
    return db.transaction(async sql => {
      const profile = (await sql.query(
        `SELECT 1 FROM ${SCHEMA}.expert_profiles WHERE member_id=$1`, [auth.memberId],
      )).rows[0];
      if (!profile) throw new ApiError(409, 'EXPERT_PROFILE_REQUIRED');
      const service = (await sql.query(
        `INSERT INTO ${SCHEMA}.expert_services(id,expert_member_id,category,title,description,price_type,base_price,visibility)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${serviceSelect.replace(/s\./g, '')}`,
        [randomUUID(), auth.memberId, request.body.category.trim(), request.body.title.trim(), request.body.description.trim(),
          request.body.priceType, request.body.basePrice ?? null, request.body.visibility ?? 'VISIBLE'],
      )).rows[0];
      await audit(sql, auth.memberId, 'EXPERT_SERVICE_CREATED', String(service.id), { visibility: service.visibility });
      return reply.code(201).send(service);
    });
  });

  app.patch<{ Params: { id: string }; Body: { category?: string; title?: string; description?: string; priceType?: string; basePrice?: number | null; visibility?: string } }>('/v1/expert/services/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuidSchema } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, required: [],
        properties: { category: string(1, 50), title: string(1, 100), description: string(1, 2000),
          priceType: { type: 'string', enum: ['FIXED', 'HOURLY', 'NEGOTIABLE'] },
          basePrice: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
          visibility: { type: 'string', enum: ['VISIBLE', 'HIDDEN'] } } },
    },
  }, async (request, reply) => {
    const auth = await requireExpert(request, reply); if (!auth) return;
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
      const updated = (await sql.query(
        `UPDATE ${SCHEMA}.expert_services s SET ${sets.join(',')}, updated_at=now()
          WHERE s.id=$1 AND s.expert_member_id=$2
          RETURNING ${serviceSelect}`,
        values,
      )).rows[0];
      if (!updated) throw new ApiError(404, 'SERVICE_NOT_FOUND');
      await audit(sql, auth.memberId, 'EXPERT_SERVICE_UPDATED', String(request.params.id), { visibility: updated.visibility });
      return updated;
    });
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
              p.activity_region AS "activityRegion",
              count(*)::int AS "serviceCount",
              min(s.base_price) AS "fromPrice",
              max(s.created_at) AS "lastServiceAt"
         FROM ${SCHEMA}.expert_services s
         JOIN ${SCHEMA}.expert_profiles p ON p.member_id=s.expert_member_id
         JOIN ${SCHEMA}.members m ON m.id=p.member_id
        WHERE ${filters.join(' AND ')}
        GROUP BY p.member_id, m.nickname, p.introduction, p.career, p.activity_region
        ${having}
        ORDER BY max(s.created_at) DESC, p.member_id DESC
        LIMIT $${pageSize}`,
      values,
    )).rows;

    const hasMore = grouped.length > limit;
    const page = hasMore ? grouped.slice(0, limit) : grouped;
    if (page.length === 0) return { experts: [], nextCursor: null };

    const serviceValues: unknown[] = [page.map(row => String(row.expertId))];
    const serviceFilters = [`s.visibility='VISIBLE'`, `s.expert_member_id = ANY($1::uuid[])`];
    if (request.query.category !== undefined) { serviceValues.push(request.query.category); serviceFilters.push(`s.category=$${serviceValues.length}`); }
    if (request.query.q !== undefined) {
      serviceValues.push(likeTerm(request.query.q));
      serviceFilters.push(`(s.title ILIKE $${serviceValues.length} ESCAPE '\\' OR s.description ILIKE $${serviceValues.length} ESCAPE '\\')`);
    }
    serviceValues.push(SERVICES_PER_EXPERT);
    const services = (await db.query(
      `SELECT * FROM (
         SELECT ${serviceSelect}, s.expert_member_id AS "expertId",
                row_number() OVER (PARTITION BY s.expert_member_id ORDER BY s.created_at DESC, s.id DESC) AS rn
           FROM ${SCHEMA}.expert_services s
          WHERE ${serviceFilters.join(' AND ')}
       ) listed
       WHERE rn <= $${serviceValues.length}
       ORDER BY "createdAt" DESC, id DESC`,
      serviceValues,
    )).rows;

    const experts = page.map(row => ({
      ...row,
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
    if (!profile) return reply.code(404).send({ error: { code: 'EXPERT_NOT_FOUND' } });
    const services = (await db.query(
      `SELECT ${serviceSelect} FROM ${SCHEMA}.expert_services s
        WHERE s.expert_member_id=$1 AND s.visibility='VISIBLE'
        ORDER BY s.created_at DESC, s.id DESC LIMIT ${SERVICE_LIST_MAX}`,
      [request.params.id],
    )).rows;
    return { expert: profile, services };
  });
}
