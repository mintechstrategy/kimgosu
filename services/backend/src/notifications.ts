import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { requireActiveMember } from './kernel.ts';

/** 알림함 필터 4종. 서버가 이 네 값만 받는다. */
export const NOTIFICATION_KINDS = ['QUOTE', 'AGREEMENT', 'REVIEW', 'REPORT'] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

/**
 * Write one inbox row inside the caller's transaction, so a notification is
 * never committed for an event that rolled back.
 */
export async function notify(
  sql: Sql,
  notification: { memberId: unknown; kind: NotificationKind; title: string; body: string; ledgerId?: unknown },
) {
  await sql.query(
    `INSERT INTO kg_membership.notifications(id,member_id,kind,title,body,ledger_id)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), notification.memberId, notification.kind, notification.title, notification.body,
      notification.ledgerId ?? null],
  );
}

export function registerNotificationRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  app.get<{ Querystring: { kind?: string } }>('/v1/notifications', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { kind: { type: 'string', enum: [...NOTIFICATION_KINDS] } },
      },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const kind = request.query.kind ?? null;
    const rows = await db.query(
      `SELECT id, kind, title, body, ledger_id AS "ledgerId", created_at AS "createdAt", read_at AS "readAt"
         FROM kg_membership.notifications
        WHERE member_id=$1 AND ($2::text IS NULL OR kind=$2)
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
      [auth.memberId, kind],
    );
    // Badge count is the unfiltered unread total: a chip the user is not
    // looking at must not change the number on the bell.
    const unread = await db.query(
      `SELECT count(*)::int AS count FROM kg_membership.notifications
        WHERE member_id=$1 AND read_at IS NULL`,
      [auth.memberId],
    );
    return { notifications: rows.rows, unreadCount: Number(unread.rows[0]!.count) };
  });

  app.post('/v1/notifications/read-all', async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const result = await db.query(
      `UPDATE kg_membership.notifications SET read_at=now()
        WHERE member_id=$1 AND read_at IS NULL`,
      [auth.memberId],
    );
    return { updated: result.rowCount ?? 0, unreadCount: 0 };
  });
}
