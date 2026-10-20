import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// La VRAIE page, sans ses balises <script> : on exécute nous-mêmes les scripts, avec un faux serveur.
const PAGE = read('../public/profile.html').replace(/<script[\s\S]*?<\/script>/g, '');
const VIEW = read('../public/js/profile-view.js');
const PROFILE = read('../public/js/profile.js');

const windows = [];
after(() => windows.forEach((w) => w.close()));

const USER = { id: 1, name: 'Rodrigue', email: 'r@test.io', role: 'admin', bio: 'Étudiant en informatique\nhttps://whatsapp.com/channel/abc', avatarUrl: null, createdAt: Date.UTC(2026, 9, 1) };

async function mountProfile({ user = USER, bots = [{ online: true, enabled: true }, { online: false, enabled: true }], posts = 7, unread = 12, statsFail = false, patch } = {}) {
  const dom = new jsdom.JSDOM(PAGE, { runScripts: 'outside-only', url: 'http://localhost/profile.html' });
  const { window } = dom;
  windows.push(window);

  const calls = [];
  window.fetch = async (url, options = {}) => {
    calls.push([options.method || 'GET', url, options.body]);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url === '/api/auth/me') return user ? reply(200, user) : reply(401, {});
    if (url === '/api/me/instances') return statsFail ? reply(500, {}) : reply(200, { instances: bots });
    if (url === '/api/profile/stats') return statsFail ? reply(500, {}) : reply(200, { posts });
    if (url === '/api/notifications') return reply(200, { notifications: [], unread });
    if (url === '/api/profile' && options.method === 'PATCH') return patch ? patch(options) : reply(200, { ok: true, user });
    return reply(404, {});
  };

  window.eval(VIEW);
  window.eval(PROFILE);
  await new Promise((resolve) => setTimeout(resolve, 40));
  return { window, document: window.document, calls };
}

const text = (document, id) => document.getElementById(id).textContent;

test('en-tête : nom, rôle, bio avec lien cliquable, compteurs et pastille', { skip }, async () => {
  const { document } = await mountProfile();

  assert.equal(document.getElementById('profileCard').style.display, 'block');
  assert.equal(text(document, 'pName'), 'Rodrigue');
  assert.equal(text(document, 'pRole'), 'Administrateur');
  assert.equal(document.querySelector('#bioText a').getAttribute('href'), 'https://whatsapp.com/channel/abc');
  assert.deepEqual(['statBots', 'statOnline', 'statPosts'].map((id) => text(document, id)), ['2', '1', '7']);

  const badge = document.getElementById('pUnread');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '9+');
  assert.match(badge.getAttribute('aria-label'), /12 notifications non lues/);
});

test('aucune notification non lue : pas de pastille', { skip }, async () => {
  const { document } = await mountProfile({ unread: 0 });
  assert.equal(document.getElementById('pUnread').hidden, true);
});

test('compteurs indisponibles : "–" plutôt qu\'un faux zéro', { skip }, async () => {
  const { document } = await mountProfile({ statsFail: true });
  assert.deepEqual(['statBots', 'statOnline', 'statPosts'].map((id) => text(document, id)), ['–', '–', '–']);
});

test('un bot désactivé n\'est pas compté "en ligne"', { skip }, async () => {
  const { document } = await mountProfile({ bots: [{ online: true, enabled: false }, { online: true, enabled: true }] });
  assert.equal(text(document, 'statBots'), '2');
  assert.equal(text(document, 'statOnline'), '1');
});

test('l\'édition est cachée jusqu\'au crayon, qui l\'ouvre et la referme', { skip }, async () => {
  const { document } = await mountProfile();
  const panel = document.getElementById('editPanel');
  const pencil = document.getElementById('editBtn');

  assert.equal(panel.hidden, true);
  pencil.click();
  assert.equal(panel.hidden, false);
  assert.equal(pencil.getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('nameInput').value, 'Rodrigue');

  pencil.click();
  assert.equal(panel.hidden, true);
  assert.equal(pencil.getAttribute('aria-expanded'), 'false');
});

test('annuler restaure ce qui était enregistré', { skip }, async () => {
  const { document } = await mountProfile();
  document.getElementById('editBtn').click();
  document.getElementById('nameInput').value = 'Autre nom';
  document.getElementById('bioInput').value = 'brouillon';

  document.getElementById('cancelEditBtn').click();

  assert.equal(document.getElementById('editPanel').hidden, true);
  assert.equal(document.getElementById('nameInput').value, 'Rodrigue');
  assert.equal(document.getElementById('bioInput').value, USER.bio);
  assert.equal(text(document, 'pName'), 'Rodrigue');
});

test('enregistrer : envoi du nom et de la bio, en-tête mis à jour, panneau refermé', { skip }, async () => {
  const { document, calls } = await mountProfile();
  document.getElementById('editBtn').click();
  document.getElementById('nameInput').value = '  Njaka  ';
  document.getElementById('bioInput').value = 'Nouvelle bio https://exemple.fr.';

  document.getElementById('saveProfileBtn').click();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const patch = calls.find(([method, url]) => method === 'PATCH' && url === '/api/profile');
  assert.deepEqual(JSON.parse(patch[2]), { name: 'Njaka', bio: 'Nouvelle bio https://exemple.fr.' });
  assert.equal(text(document, 'pName'), 'Njaka');
  assert.equal(document.querySelector('#bioText a').getAttribute('href'), 'https://exemple.fr/');
  assert.equal(document.getElementById('editPanel').hidden, true);
  assert.equal(text(document, 'avatarStatus'), 'Profil mis à jour.');
});

test('nom vide : refusé, le panneau reste ouvert', { skip }, async () => {
  const { document, calls } = await mountProfile();
  document.getElementById('editBtn').click();
  document.getElementById('nameInput').value = '   ';

  document.getElementById('saveProfileBtn').click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(document.getElementById('editPanel').hidden, false);
  assert.match(text(document, 'saveStatus'), /ne peut pas être vide/);
  assert.ok(!calls.some(([method]) => method === 'PATCH'));
});

test('refus du serveur : message affiché, en-tête inchangé', { skip }, async () => {
  const { document } = await mountProfile({ patch: async () => ({ ok: false, status: 400, json: async () => ({ error: 'La bio est trop longue.' }) }) });
  document.getElementById('editBtn').click();
  document.getElementById('nameInput').value = 'Autre';

  document.getElementById('saveProfileBtn').click();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(text(document, 'saveStatus'), 'La bio est trop longue.');
  assert.equal(text(document, 'pName'), 'Rodrigue');
  assert.equal(document.getElementById('editPanel').hidden, false);
});

test('sans bio : une invitation qui ouvre directement l\'édition', { skip }, async () => {
  const { document } = await mountProfile({ user: { ...USER, bio: '' } });
  const bio = document.getElementById('bioText');

  assert.ok(bio.classList.contains('is-empty'));
  assert.match(bio.textContent, /Ajoute une bio/);
  bio.click();
  assert.equal(document.getElementById('editPanel').hidden, false);
});

test('la pastille ouvre la cloche', { skip }, async () => {
  const { window, document } = await mountProfile();
  let opened = 0;
  const bell = document.createElement('button');
  bell.className = 'hub-bell-btn';
  bell.addEventListener('click', () => { opened++; });
  document.body.append(bell);

  document.getElementById('pUnread').click();
  assert.equal(opened, 1);
  assert.ok(window);
});

test('non connecté : message de connexion, pas de profil', { skip }, async () => {
  const { document } = await mountProfile({ user: null });
  assert.equal(document.getElementById('notLoggedIn').style.display, 'block');
  assert.equal(document.getElementById('profileCard').style.display, 'none');
});

test('nom de repli : l\'email quand le nom est vide', { skip }, async () => {
  const { document } = await mountProfile({ user: { ...USER, name: '' } });
  assert.equal(text(document, 'pName'), 'r@test.io');
});
