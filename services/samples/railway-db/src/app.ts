import Fastify from 'fastify';
import { timingSafeEqual, createHash } from 'node:crypto';
import { UUID } from './store.ts';
import type { Store } from './store.ts';

export function buildApp(store: Store, token: string, options: { tokenIsHash?: boolean; expiresAt?: number; release?: string } = {}) {
  if (token.length < 32) throw new Error('ephemeral authentication required');
  const expected = Buffer.from(options.tokenIsHash ? token : createHash('sha256').update(token).digest('hex'));
  const app = Fastify({ logger: false, bodyLimit: 4096, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const origin = request.headers.origin;
    if (origin && origin !== 'https://dev-kimgosu.mintech.ai') return reply.code(403).send({ error: 'origin-denied' });
    if (origin) {
      reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
      reply.header('access-control-allow-headers', 'Authorization, Content-Type');
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
    if (options.release && request.url === '/health') return;
    if (options.expiresAt !== undefined && Date.now() >= options.expiresAt) {
      return reply.code(401).send({ error: 'diagnostic-session-expired' });
    }
    const authorization = request.headers.authorization ?? '';
    const supplied = Buffer.from(createHash('sha256').update(authorization.startsWith('Bearer ') ? authorization.slice(7) : '').digest('hex'));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
  if (options.release) app.get('/health', async () => ({ status: 'ok', scope: 'diagnostic-only', release: options.release }));
  app.setErrorHandler((error, _request, reply) => {
    if (error && typeof error === 'object' && 'validation' in error) {
      return reply.code(400).send({ error: 'invalid-input' });
    }
    return reply.code(503).send({ error: 'storage-unavailable', reconciliation: 'GET the same ID before retrying' });
  });
  app.post<{ Body: { id: string; message: string } }>('/sample/records', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['id', 'message'], properties: {
      id: { type: 'string', pattern: UUID }, message: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    } } },
  }, async (request, reply) => {
    const result = await store.create(request.body.id, request.body.message);
    if (!result) return reply.code(409).send({ error: 'duplicate-id' });
    return reply.code(201).send(result);
  });
  app.get<{ Params: { id: string } }>('/sample/records/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } },
  }, async (request, reply) => {
    const result = await store.read(request.params.id);
    if (!result) return reply.code(404).send({ error: 'not-found' });
    return result;
  });
  return app;
}
