import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { audit, requireActiveMember } from './kernel.ts';

// Only still images are accepted, and the app or browser uploads them straight
// to R2. Nothing large passes through this API, so the worker never buffers a
// photo and the request body stays tiny.
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
type ContentType = keyof typeof ALLOWED;

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * R2 speaks the S3 API, so a presigned PUT is plain SigV4 over a canonical
 * request. Signing it here keeps the dependency list unchanged.
 */
export function presignPut(key: string, expiresIn: number) {
  const endpoint = new URL(env('R2_ENDPOINT'));
  const bucket = env('R2_PUBLIC_BUCKET');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secret = env('R2_SECRET_ACCESS_KEY');
  const region = process.env.R2_REGION || 'auto';

  // X-Amz-Date is YYYYMMDDTHHMMSSZ: milliseconds break the signature.
  const amzDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalRequest = [
    'PUT', path, query.toString(),
    `host:${endpoint.host}`, '', 'host', 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), 's3'), 'aws4_request');
  query.set('X-Amz-Signature', createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex'));

  return {
    uploadUrl: `${endpoint.origin}${path}?${query.toString()}`,
    publicUrl: `${env('R2_PUBLIC_BASE_URL').replace(/\/+$/, '')}/${key}`,
  };
}

export function registerUploadRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  // The client asks for a slot, uploads the bytes itself, then stores the key on
  // a service. The key is scoped to the caller so nobody can overwrite another
  // member's object. `chat` is the only kind the chat route accepts, because it
  // verifies the key against `chat/<sender member id>/`.
  app.post<{ Body: { contentType: ContentType; kind?: 'service' | 'avatar' | 'chat' } }>('/v1/uploads', {
    schema: body({
      contentType: { type: 'string', enum: Object.keys(ALLOWED) },
      kind: { type: 'string', enum: ['service', 'avatar', 'chat'] },
    }, ['contentType']),
  }, async (request, reply) => {
    const auth = await requireMember(request, reply);
    if (!auth) return undefined;

    const contentType = request.body.contentType;
    const kind = request.body.kind ?? 'service';
    const key = `${kind}/${auth.memberId}/${randomUUID()}.${ALLOWED[contentType]}`;
    const expiresIn = 600;

    await audit(db, auth.memberId, 'UPLOAD_PRESIGNED', 'object', key, null, { contentType, kind });

    reply.code(201);
    return { key, expiresIn, contentType, ...presignPut(key, expiresIn), headers: { 'Content-Type': contentType } };
  });
}
