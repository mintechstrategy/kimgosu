/**
 * Live R2 check: presign a PUT with the deployed credentials, upload a real
 * image, then read it back from the public URL and compare the bytes.
 *
 *   node --experimental-strip-types services/backend/scripts/verify-r2-upload.mjs <file>
 *
 * Credentials come from the environment; they are never printed.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { presignPut } from '../src/uploads.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: verify-r2-upload.mjs <image-file>');
  process.exit(1);
}

const bytes = await readFile(file);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sourceHash = sha(bytes);
const contentType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
const key = `service/verify/${Date.now()}-${sha(bytes).slice(0, 8)}.${contentType === 'image/png' ? 'png' : 'jpg'}`;

const { uploadUrl, publicUrl } = presignPut(key, 600);

const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
console.log('PUT   ', put.status, put.statusText);
if (!put.ok) {
  console.error(await put.text());
  process.exit(1);
}

const get = await fetch(publicUrl);
console.log('GET   ', get.status, get.statusText);
if (!get.ok) process.exit(1);

const downloaded = Buffer.from(await get.arrayBuffer());
console.log('원본  ', bytes.length, 'bytes', sourceHash.slice(0, 16));
console.log('다운로드', downloaded.length, 'bytes', sha(downloaded).slice(0, 16));
console.log('일치  ', sha(downloaded) === sourceHash ? 'YES' : 'NO');
console.log('공개 URL', publicUrl);
if (sha(downloaded) !== sourceHash) process.exit(1);
