import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

const SOURCE = readFileSync(new URL('../public/js/link.js', import.meta.url), 'utf8');
const TOKEN = 'a'.repeat(43);
const windows = [];
after(() => windows.forEach((w) => w.close()));

/** Monte link.html (le bloc utile) avec un faux serveur, exécute link.js comme le navigateur. */
async function mountLinkPage({ query = `?token=${TOKEN}`, stored = null, preview = { valid: true, botName: 'RodrickBOT', ownerName: 'Njaka' }, loggedIn = true, claim = { status: 200, body: { ok: true, bots: [{ botName: 'RodrickBOT' }] } } } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><body><h2 id="linkTitle"></h2><p id="linkText"></p><div id="linkActions"></div></body>', { runScripts: 'outside-only', url: `http://localhost/link.html${query}` });
  const { window } = dom;
  windows.push(window);
  if (stored) window.sessionStorage.setItem('hubPendingLink', stored);

  const calls = [];
  window.fetch = async (url, options = {}) => {
    calls.push([options.method || 'GET', url, options.body]);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith('/api/link/preview')) return reply(200, preview);
    if (url === '/api/auth/me') return loggedIn ? reply(200, { id: 1 }) : reply(401, {});
    if (url === '/api/link/claim') return reply(claim.status, claim.body);
    return reply(404, {});
  };

  window.eval(SOURCE);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { window, document: window.document, calls };
}

const actions = (document) => [...document.querySelectorAll('#linkActions > *')];

test('lien sans jeton : "Lien invalide"', { skip }, async () => {
  const { document, calls } = await mountLinkPage({ query: '' });
  assert.equal(document.getElementById('linkTitle').textContent, 'Lien invalide');
  assert.equal(calls.length, 0);
});

test('jeton refusé par le serveur : message selon la raison', { skip }, async () => {
  const expired = await mountLinkPage({ preview: { valid: false, reason: 'expired' } });
  assert.equal(expired.document.getElementById('linkTitle').textContent, 'Lien expiré');
  assert.match(expired.document.getElementById('linkText').textContent, /!hub/);

  const used = await mountLinkPage({ preview: { valid: false, reason: 'used' } });
  assert.equal(used.document.getElementById('linkTitle').textContent, 'Lien déjà utilisé');
});

test('le jeton quitte la barre d\'adresse', { skip }, async () => {
  const { window } = await mountLinkPage();
  assert.equal(window.location.search, '');
});

test('non connecté : connexion / inscription proposées, jeton gardé pour le retour', { skip }, async () => {
  const { window, document, calls } = await mountLinkPage({ loggedIn: false });
  const [login, register] = actions(document);
  assert.equal(login.getAttribute('href'), 'login.html');
  assert.equal(register.getAttribute('href'), 'register.html');
  assert.match(document.getElementById('linkText').textContent, /RodrickBOT \(Njaka\)/);

  login.addEventListener('click', (event) => event.preventDefault());
  login.click();
  assert.equal(window.sessionStorage.getItem('hubPendingLink'), TOKEN);
  assert.ok(!calls.some(([method, url]) => method === 'POST' && url === '/api/link/claim'), 'aucune liaison sans confirmation');
});

test('connecté : rien n\'est relié tant qu\'on n\'a pas confirmé', { skip }, async () => {
  const { document, calls } = await mountLinkPage();
  assert.equal(document.getElementById('linkTitle').textContent, 'Relier ce bot à ton compte ?');
  assert.equal(actions(document).length, 1);
  assert.ok(!calls.some(([, url]) => url === '/api/link/claim'));
});

test('confirmation : le jeton est envoyé, succès affiché, jeton oublié', { skip }, async () => {
  const { window, document, calls } = await mountLinkPage({ stored: TOKEN });
  actions(document)[0].click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const claimCall = calls.find(([, url]) => url === '/api/link/claim');
  assert.equal(claimCall[0], 'POST');
  assert.equal(JSON.parse(claimCall[2]).token, TOKEN);
  assert.equal(document.getElementById('linkTitle').textContent, 'Bot relié ✓');
  assert.equal(actions(document)[0].getAttribute('href'), 'index.html');
  assert.equal(window.sessionStorage.getItem('hubPendingLink'), null);
});

test('plusieurs bots reliés d\'un coup : le total est annoncé', { skip }, async () => {
  const { document } = await mountLinkPage({ claim: { status: 200, body: { ok: true, bots: [{ botName: 'A' }, { botName: 'B' }, { botName: 'C' }] } } });
  actions(document)[0].click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(document.getElementById('linkText').textContent, /3 bots/);
});

test('échec à la confirmation (409) : message de la raison', { skip }, async () => {
  const { document } = await mountLinkPage({ claim: { status: 409, body: { ok: false, reason: 'owner-taken' } } });
  actions(document)[0].click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.getElementById('linkTitle').textContent, 'Bot déjà relié');
});

test('noms venant du serveur : jamais interprétés comme du HTML', { skip }, async () => {
  const { document } = await mountLinkPage({ preview: { valid: true, botName: '<img src=x onerror=1>', ownerName: '<b>x</b>' } });
  assert.equal(document.querySelector('#linkText img'), null);
  assert.equal(document.querySelector('#linkText b'), null);
  assert.match(document.getElementById('linkText').textContent, /<img src=x onerror=1>/);
});
