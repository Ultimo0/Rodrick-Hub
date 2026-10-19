import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LINK_TOKEN_TTL_MS, generateToken, hashToken, isWellFormedToken, isValidOwnerHash, tokenProblem, buildLinkUrl,
} from '../src/utils/linkToken.js';

test('jeton : 43 caractères URL-safe, différent à chaque appel', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(isWellFormedToken(a), true);
});

test('seuls les jetons de la bonne forme sont acceptés', () => {
  for (const bad of ['', 'court', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}!`, null, undefined, 42, {}]) {
    assert.equal(isWellFormedToken(bad), false, String(bad));
  }
});

test('empreinte du jeton : SHA-256 hexadécimal stable, jamais égale au jeton', () => {
  const token = generateToken();
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(generateToken()));
  assert.notEqual(hashToken(token), token);
});

test('empreinte du propriétaire : 64 caractères hexadécimaux en minuscules', () => {
  assert.equal(isValidOwnerHash('a'.repeat(64)), true);
  for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '237600000000', null, undefined]) {
    assert.equal(isValidOwnerHash(bad), false, String(bad));
  }
});

test('un jeton est inutilisable s\'il est inconnu, utilisé ou expiré', () => {
  const now = 1_000_000;
  assert.equal(tokenProblem(undefined, now), 'invalid');
  assert.equal(tokenProblem({ usedAt: now - 1, expiresAt: now + 1000 }, now), 'used');
  assert.equal(tokenProblem({ usedAt: null, expiresAt: now }, now), 'expired');
  assert.equal(tokenProblem({ usedAt: null, expiresAt: String(now - 5) }, now), 'expired'); // BIGINT renvoyé en texte par pg
  assert.equal(tokenProblem({ usedAt: null, expiresAt: now + 1 }, now), null);
  assert.equal(LINK_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('lien : base sans barre finale, jeton en paramètre', () => {
  assert.equal(buildLinkUrl('https://hub.example/', 'abc'), 'https://hub.example/link.html?token=abc');
  assert.equal(buildLinkUrl('https://hub.example', 'abc'), 'https://hub.example/link.html?token=abc');
});
