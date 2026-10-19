import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

// Import SANS document : le module ne démarre rien, on teste les fonctions pures.
const { botCardHtml, botState, lastSeenLabel, summaryLabel } = await import('../public/js/my-bots.js');

const NOW = 1_800_000_000_000;
const bot = (over = {}) => ({ instanceId: 'i1', botName: 'RodrickBOT', ownerName: 'Njaka', version: '1.82.35', enabled: true, online: true, lastSeen: NOW, ...over });

test('état d\'un bot : désactivé > en ligne > hors ligne', () => {
  assert.equal(botState(bot()), 'online');
  assert.equal(botState(bot({ online: false })), 'offline');
  assert.equal(botState(bot({ enabled: false, online: true })), 'disabled');
});

test('"vu il y a" en minutes, heures, jours', () => {
  assert.equal(lastSeenLabel(NOW - 30_000, NOW), 'à l\u2019instant');
  assert.equal(lastSeenLabel(NOW - 12 * 60_000, NOW), 'vu il y a 12 min');
  assert.equal(lastSeenLabel(NOW - 3 * 3_600_000, NOW), 'vu il y a 3 h');
  assert.equal(lastSeenLabel(NOW - 2 * 86_400_000, NOW), 'vu il y a 2 j');
  assert.equal(lastSeenLabel(0, NOW), 'jamais vu');
});

test('résumé : combien de bots sont en ligne', () => {
  assert.equal(summaryLabel([bot(), bot({ online: false }), bot({ enabled: false })]), '1 sur 3 en ligne');
  assert.equal(summaryLabel([]), '0 sur 0 en ligne');
});

test('carte : classe d\'état, texte lisible sans la couleur, valeurs échappées', () => {
  const online = botCardHtml(bot(), NOW);
  assert.match(online, /mybot is-online/);
  assert.match(online, />En ligne</);

  const offline = botCardHtml(bot({ online: false, lastSeen: NOW - 5 * 60_000 }), NOW);
  assert.match(offline, /mybot is-offline/);
  assert.match(offline, /Hors ligne · vu il y a 5 min/);

  const evil = botCardHtml(bot({ botName: '<img src=x onerror=1>', ownerName: '"><script>' }), NOW);
  assert.doesNotMatch(evil, /<img|<script/);
});

const windows = [];
after(() => windows.forEach((w) => w.close()));

test('section "Mes bots" : liste, résumé, état vide et mise à jour sans recréer les cartes', { skip }, async () => {
  const dom = new jsdom.JSDOM(`<!doctype html><body>
    <section id="myBots" hidden><span class="mybots-summary" hidden></span><div class="mybots-list"></div><p class="mybots-empty" hidden>vide</p></section>
  </body>`, { url: 'http://localhost/' });
  windows.push(dom.window);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  let payload = { status: 200, instances: [bot(), bot({ instanceId: 'i2', online: false, lastSeen: NOW - 600_000 })] };
  globalThis.fetch = async () => ({ ok: payload.status === 200, status: payload.status, json: async () => ({ instances: payload.instances }) });
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // pas de relecture planifiée pendant le test

  // Nouvelle instance du module avec document défini → démarre tout seul.
  await import('../public/js/my-bots.js?with-dom');
  await new Promise((resolve) => setTimeout(resolve, 30));
  globalThis.setInterval = originalSetInterval;

  const section = dom.window.document.getElementById('myBots');
  const cards = [...section.querySelectorAll('.mybot')];
  assert.equal(section.hidden, false);
  assert.equal(cards.length, 2);
  assert.equal(section.querySelector('.mybots-summary').textContent, '1 sur 2 en ligne');
  assert.equal(section.querySelector('.mybots-empty').hidden, true);

  // Heartbeat suivant : i2 revient en ligne → même élément DOM, état mis à jour.
  payload = { status: 200, instances: [bot(), bot({ instanceId: 'i2', online: true })] };
  dom.window.dispatchEvent(new dom.window.CustomEvent('hub-realtime', { detail: { type: 'notification' } }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const after2 = [...section.querySelectorAll('.mybot')];
  assert.equal(after2[1], cards[1], 'la carte n\'est pas recréée');
  assert.ok(after2[1].classList.contains('is-online'));
  assert.equal(section.querySelector('.mybots-summary').textContent, '2 sur 2 en ligne');

  // Aucun bot lié : message d'accueil, plus de résumé.
  payload = { status: 200, instances: [] };
  dom.window.dispatchEvent(new dom.window.CustomEvent('hub-realtime', { detail: { type: 'notification' } }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(section.querySelectorAll('.mybot').length, 0);
  assert.equal(section.querySelector('.mybots-empty').hidden, false);
  assert.equal(section.querySelector('.mybots-summary').hidden, true);

  // Non connecté : la section disparaît.
  payload = { status: 401, instances: [] };
  dom.window.dispatchEvent(new dom.window.CustomEvent('hub-realtime', { detail: { type: 'notification' } }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(section.hidden, true);
});
