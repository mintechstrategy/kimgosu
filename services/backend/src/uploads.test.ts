import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presignPut } from './uploads.ts';

process.env.R2_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';
process.env.R2_PUBLIC_BUCKET = 'kimgosu-dev-public';
process.env.R2_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.R2_PUBLIC_BASE_URL = 'https://media-dev-kimgosu.mintech.ai/';
process.env.R2_REGION = 'auto';

test('a presigned PUT keeps the S3 date format and signs only the host header', () => {
  const { uploadUrl, publicUrl } = presignPut('service/m1/a.png', 600);
  const url = new URL(uploadUrl);

  assert.equal(url.host, 'abc123.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/kimgosu-dev-public/service/m1/a.png');
  // 밀리초가 들어가면 서명이 어긋난다. 20261104T025041Z 형식만 허용.
  assert.match(url.searchParams.get('X-Amz-Date')!, /^\d{8}T\d{6}Z$/);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature')!, /^[0-9a-f]{64}$/);
  // 마지막 빗금이 겹치면 공개 URL이 깨진다.
  assert.equal(publicUrl, 'https://media-dev-kimgosu.mintech.ai/service/m1/a.png');
});
