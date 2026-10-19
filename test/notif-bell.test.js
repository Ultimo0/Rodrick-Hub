import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';

// jsdom : devDependency, requis uniquement pour ces tests (ignorés sinon).
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

const BELL_SOURCE = readFileSync(new URL('../public/js/notif-bell.js', import.meta.url), 'utf8');

// La cloche garde un minuteur (rafraîchissement des "il y a 5 min") : sans
// fermer les fenêtres jsdom à la fin, le processus de test ne se terminerait jamais.
const openWindows = [];
after(() => openWindows.forEach((window) => window.close()));

function notification(id, over = {}) {
  return { id, type: 'release', title: `Titre ${id}`, body: `Corps ${id}`, link: '/releases.html', createdAt: Date.now() - id * 60_000, ...over };
}

/** Monte la page, simule les réponses du serveur, exécute notif-bell.js comme le navigateur le ferait. */
async function mountBell({ loggedIn = true, notifications = [], unread = 0, pushStatus = 'not-subscribed' } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><body><nav id="hubNav"><span id="authStatus"></span></nav></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  openWindows.push(window);
  const calls = [];

  window.fetch = async (url, options = {}) => {
    calls.push([options.method || 'GET', url, options.body]);
    const json = (data, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => data });
    if (url === '/api/auth/me') return loggedIn ? json({ id: 1, name: 'Alice' }) : json({}, false);
    if (url === '/api/notifications') return json({ notifications, unread });
    if (url === '/api/notifications/seen') return json({ ok: true });
    return json({}, false);
  };

  const pushCalls = [];
  window.RodrickPush = {
    getStatus: async () => pushStatus,
    toggle: async () => { pushCalls.push('toggle'); pushStatus = pushStatus === 'subscribed' ? 'not-subscribed' : 'subscribed'; return pushStatus; },
  };

  window.eval(BELL_SOURCE);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { window, document: window.document, calls, pushCalls };
}

test('visiteur non connecté : aucune cloche', { skip }, async () => {
  const { document } = await mountBell({ loggedIn: false });
  assert.equal(document.getElementById('hubBell'), null);
});

test('cloche placée avant l\'avatar, badge = nombre de non lues (9+ au-delà)', { skip }, async () => {
  const { document } = await mountBell({ notifications: [notification(1)], unread: 2 });
  const bell = document.getElementById('hubBell');
  assert.equal(bell.nextElementSibling.id, 'authStatus');
  const badge = bell.querySelector('.hub-bell-badge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '2');

  const many = await mountBell({ notifications: [notification(1)], unread: 25 });
  assert.equal(many.document.querySelector('.hub-bell-badge').textContent, '9+');
});

test('aucune non lue : badge caché ; liste vide : message "Rien de nouveau"', { skip }, async () => {
  const { document } = await mountBell({ notifications: [], unread: 0 });
  assert.equal(document.querySelector('.hub-bell-badge').hidden, true);
  assert.equal(document.querySelector('.hub-bell-empty').hidden, false);
});

test('le panneau affiche les 3 notifications et surligne les non lues', { skip }, async () => {
  const { document } = await mountBell({ notifications: [notification(1), notification(2), notification(3)], unread: 2 });
  const panel = document.querySelector('.hub-bell-panel');
  assert.equal(panel.hidden, true);

  document.querySelector('.hub-bell-btn').click();
  assert.equal(panel.hidden, false);
  assert.equal(document.querySelector('.hub-bell-btn').getAttribute('aria-expanded'), 'true');

  const items = [...document.querySelectorAll('.hub-bell-item')];
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.classList.contains('is-new')), [true, true, false]);
  assert.match(items[0].textContent, /Titre 1/);
  assert.match(items[0].textContent, /il y a 1 min/);
});

test('ouvrir la cloche marque tout comme lu côté serveur et éteint le badge', { skip }, async () => {
  const { document, calls } = await mountBell({ notifications: [notification(1)], unread: 1 });
  document.querySelector('.hub-bell-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(calls.some(([method, url, body]) => method === 'POST' && url === '/api/notifications/seen' && JSON.parse(body).section === 'inbox'));
  assert.equal(document.querySelector('.hub-bell-badge').hidden, true);
});

test('Échap et clic en dehors ferment le panneau', { skip }, async () => {
  const { window, document } = await mountBell({ notifications: [notification(1)], unread: 0 });
  const panel = document.querySelector('.hub-bell-panel');

  document.querySelector('.hub-bell-btn').click();
  assert.equal(panel.hidden, false);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(panel.hidden, true);

  document.querySelector('.hub-bell-btn').click();
  document.body.click();
  assert.equal(panel.hidden, true);
});

test('interrupteur : reflète l\'état push et l\'active/désactive', { skip }, async () => {
  const { document, pushCalls } = await mountBell({ pushStatus: 'not-subscribed' });
  document.querySelector('.hub-bell-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const toggle = document.querySelector('.hub-switch-input');
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, false);

  toggle.checked = true;
  toggle.dispatchEvent(new document.defaultView.Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(pushCalls, ['toggle']);
  assert.equal(toggle.checked, true);
});

test('notifications refusées par le navigateur : interrupteur bloqué avec explication', { skip }, async () => {
  const { document } = await mountBell({ pushStatus: 'denied' });
  document.querySelector('.hub-bell-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(document.querySelector('.hub-switch-input').disabled, true);
  const hint = document.querySelector('.hub-bell-hint');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /bloquées/);
});

test('un événement temps réel relit la liste', { skip }, async () => {
  const { window, document, calls } = await mountBell({ notifications: [], unread: 0 });
  const before = calls.filter(([, url]) => url === '/api/notifications').length;

  window.dispatchEvent(new window.CustomEvent('hub-realtime', { detail: { type: 'notification' } }));
  await new Promise((resolve) => setTimeout(resolve, 550));

  assert.equal(calls.filter(([, url]) => url === '/api/notifications').length, before + 1);
  assert.ok(document.getElementById('hubBell'));
});

test('contenu échappé et liens limités au Hub (pas de XSS ni de lien externe)', { skip }, async () => {
  const evil = notification(1, { title: '<img src=x onerror=alert(1)>', body: '<script>x</script>', link: 'javascript:alert(1)' });
  const { document } = await mountBell({ notifications: [evil, notification(2, { link: '//evil.example' })], unread: 0 });

  assert.equal(document.querySelector('.hub-bell-list img'), null);
  assert.equal(document.querySelector('.hub-bell-list script'), null);
  const hrefs = [...document.querySelectorAll('.hub-bell-item')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, ['/index.html', '/index.html']);
});
