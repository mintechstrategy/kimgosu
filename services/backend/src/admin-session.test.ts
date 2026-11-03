// Operator-console login: token scope helpers and the attempt limiter.
// Pure module tests — no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_SESSION_PREFIX, bearerTokenPattern, isAdminSessionToken, opaque } from './security.ts';
import { createLoginLimiter, MAX_LOGIN_FAILURES, LOGIN_LOCK_SECONDS, LOGIN_WINDOW_SECONDS } from './admin-session.ts';

test('operator tokens are marked by prefix and never look like member tokens', () => {
  const adminToken = ADMIN_SESSION_PREFIX + opaque();
  const memberToken = opaque();
  assert.equal(isAdminSessionToken(adminToken), true);
  assert.equal(isAdminSessionToken(memberToken), false);
  assert.match(adminToken, bearerTokenPattern);
  assert.match(memberToken, bearerTokenPattern);
  assert.equal(bearerTokenPattern.test('adm_' + 'a'), false, 'a short token is not a bearer token');
});

test('five failures lock the client for five minutes, then expire', () => {
  let clock = 1_000_000;
  const limiter = createLoginLimiter({ now: () => clock });
  for (let i = 1; i < MAX_LOGIN_FAILURES; i++) {
    const result = limiter.fail('client-a');
    assert.equal(result.lockedForSeconds, 0);
    assert.equal(result.attemptsRemaining, MAX_LOGIN_FAILURES - i);
    assert.equal(limiter.lockedFor('client-a'), 0);
  }
  const fifth = limiter.fail('client-a');
  assert.equal(fifth.lockedForSeconds, LOGIN_LOCK_SECONDS);
  assert.equal(limiter.lockedFor('client-a'), LOGIN_LOCK_SECONDS);
  // Other clients are unaffected.
  assert.equal(limiter.lockedFor('client-b'), 0);

  clock += (LOGIN_LOCK_SECONDS - 1) * 1000;
  assert.equal(limiter.lockedFor('client-a'), 1);
  clock += 1000;
  assert.equal(limiter.lockedFor('client-a'), 0, 'the lock expires on its own');
  assert.equal(limiter.fail('client-a').attemptsRemaining, MAX_LOGIN_FAILURES - 1, 'the counter restarts after the lock');
});

test('a successful exchange clears the counter, an old window does not accumulate', () => {
  let clock = 0;
  const limiter = createLoginLimiter({ now: () => clock });
  limiter.fail('client-c'); limiter.fail('client-c'); limiter.fail('client-c');
  assert.equal(limiter.fail('client-c').attemptsRemaining, 1);
  limiter.succeed('client-c');
  assert.equal(limiter.fail('client-c').attemptsRemaining, MAX_LOGIN_FAILURES - 1);

  clock = LOGIN_WINDOW_SECONDS * 1000 + 1;
  assert.equal(limiter.fail('client-c').attemptsRemaining, MAX_LOGIN_FAILURES - 1, 'failures outside the window are forgotten');
});
