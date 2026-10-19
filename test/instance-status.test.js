import assert from 'node:assert/strict';
import test from 'node:test';
import { instanceStatus, computeStatusTransitions, describeTransition, applyStatusCheck } from '../src/utils/instanceStatus.js';

const LIMIT = 10 * 60 * 1000;
const NOW = 1_000_000_000;
const inst = (over = {}) => ({ instanceId: 'i1', userId: 7, botName: 'RodrickBOT', ownerName: 'Njaka', lastSeen: NOW - 1000, statusNotified: 'online', ...over });

test('en ligne tant que le dernier heartbeat date de moins de 10 min', () => {
  assert.equal(instanceStatus(NOW - 9 * 60 * 1000, NOW, LIMIT), 'online');
  assert.equal(instanceStatus(NOW - 10 * 60 * 1000, NOW, LIMIT), 'offline');
  assert.equal(instanceStatus(null, NOW, LIMIT), 'offline');
  assert.equal(instanceStatus('999999000', NOW, LIMIT), 'online'); // BIGINT renvoyé en texte par pg
});

test('aucun changement → aucune transition', () => {
  assert.deepEqual(computeStatusTransitions([inst()], NOW, LIMIT), []);
});

test('passage hors ligne puis retour en ligne sont notifiés', () => {
  const down = computeStatusTransitions([inst({ lastSeen: NOW - LIMIT - 1 })], NOW, LIMIT);
  assert.equal(down.length, 1);
  assert.deepEqual([down[0].status, down[0].notify], ['offline', true]);

  const up = computeStatusTransitions([inst({ statusNotified: 'offline' })], NOW, LIMIT);
  assert.deepEqual([up[0].status, up[0].notify], ['online', true]);
});

test('première observation : état enregistré sans notifier', () => {
  const [t] = computeStatusTransitions([inst({ statusNotified: null })], NOW, LIMIT);
  assert.deepEqual([t.status, t.notify], ['online', false]);
});

test('suppressOffline retient les alertes "hors ligne" mais pas "en ligne"', () => {
  const stale = inst({ lastSeen: NOW - LIMIT - 1 });
  assert.deepEqual(computeStatusTransitions([stale], NOW, LIMIT, { suppressOffline: true }), []);
  assert.equal(computeStatusTransitions([inst({ statusNotified: 'offline' })], NOW, LIMIT, { suppressOffline: true }).length, 1);
});

test('texte des notifications', () => {
  assert.deepEqual(describeTransition(inst(), 'offline'), { type: 'bot-offline', title: 'Bot hors ligne', body: 'RodrickBOT (Njaka) ne répond plus.', link: '/index.html' });
  assert.equal(describeTransition(inst({ ownerName: '' }), 'online').body, 'RodrickBOT est de nouveau en ligne.');
});

test('applyStatusCheck : enregistre d\'abord, puis notifie le bon compte, une seule fois', async () => {
  const calls = [];
  const deps = {
    listLinkedInstances: async () => [inst({ lastSeen: NOW - LIMIT - 1 })],
    setStatusNotified: async (id, status) => calls.push(['state', id, status]),
    createNotification: async (n) => { calls.push(['create', n.userId, n.type]); return { id: 1, ...n }; },
    sendToUser: async (userId, event) => calls.push(['ws', userId, event.type]),
    sendPushToUser: async (userId, payload) => calls.push(['push', userId, payload.title]),
  };

  const changed = await applyStatusCheck({ now: NOW, offlineAfterMs: LIMIT, deps });

  assert.equal(changed, 1);
  assert.deepEqual(calls, [['state', 'i1', 'offline'], ['create', 7, 'bot-offline'], ['ws', 7, 'notification'], ['push', 7, 'Bot hors ligne']]);
});

test('applyStatusCheck : une panne d\'envoi n\'empêche pas de traiter les autres instances', async () => {
  const seen = [];
  const deps = {
    listLinkedInstances: async () => [inst({ instanceId: 'a', lastSeen: 0 }), inst({ instanceId: 'b', lastSeen: 0 })],
    setStatusNotified: async (id) => seen.push(id),
    createNotification: async () => { throw new Error('base indisponible'); },
    sendToUser: async () => {},
    sendPushToUser: async () => {},
  };
  const original = console.error; console.error = () => {};
  try { await applyStatusCheck({ now: NOW, offlineAfterMs: LIMIT, deps }); } finally { console.error = original; }
  assert.deepEqual(seen, ['a', 'b']);
});
