import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

const SOURCE = readFileSync(new URL('../public/js/profile-view.js', import.meta.url), 'utf8');
const windows = [];
after(() => windows.forEach((w) => w.close()));

function setup() {
  const dom = new jsdom.JSDOM('<!doctype html><body><p id="bio"></p></body>', { runScripts: 'outside-only' });
  windows.push(dom.window);
  dom.window.eval(SOURCE);
  return { view: dom.window.ProfileView, bio: dom.window.document.getElementById('bio') };
}

test('pastille : le nombre exact jusqu\'à 9, "9+" au-delà', { skip }, () => {
  const { view } = setup();
  assert.deepEqual([0, 1, 9, 10, 250].map(view.formatBadge), ['0', '1', '9', '9+', '9+']);
});

test('bio : le texte reste du texte, une adresse devient un lien', { skip }, () => {
  const { view, bio } = setup();
  view.renderBio(bio, 'Étudiant en informatique\nhttps://whatsapp.com/channel/0029VbCDXki59PwNcJW60G39');

  const link = bio.querySelector('a');
  assert.equal(link.getAttribute('href'), 'https://whatsapp.com/channel/0029VbCDXki59PwNcJW60G39');
  assert.equal(link.textContent, 'https://whatsapp.com/channel/0029VbCDXki59PwNcJW60G39');
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
  assert.match(bio.textContent, /^Étudiant en informatique\nhttps/);
});

test('bio : la ponctuation de fin de phrase n\'entre pas dans le lien', { skip }, () => {
  const { view, bio } = setup();
  view.renderBio(bio, 'Voir https://exemple.fr/page. Merci !');
  assert.equal(bio.querySelector('a').getAttribute('href'), 'https://exemple.fr/page');
  assert.equal(bio.textContent, 'Voir https://exemple.fr/page. Merci !');
});

test('bio : plusieurs liens et du texte autour, dans l\'ordre', { skip }, () => {
  const { view, bio } = setup();
  view.renderBio(bio, 'a https://un.fr b http://deux.fr c');
  assert.deepEqual([...bio.querySelectorAll('a')].map((a) => a.textContent), ['https://un.fr', 'http://deux.fr']);
  assert.equal(bio.textContent, 'a https://un.fr b http://deux.fr c');
});

test('bio : jamais de HTML ni de lien javascript:', { skip }, () => {
  const { view, bio } = setup();
  view.renderBio(bio, '<img src=x onerror=alert(1)> <script>x</script> javascript:alert(1) <a href="https://x.fr">y</a>');

  assert.equal(bio.querySelector('img'), null);
  assert.equal(bio.querySelector('script'), null);
  assert.ok([...bio.querySelectorAll('a')].every((a) => a.protocol === 'https:' || a.protocol === 'http:'));
  assert.match(bio.textContent, /<img src=x onerror=alert\(1\)>/);
});

test('bio vide ou absente : élément vidé, sans erreur', { skip }, () => {
  const { view, bio } = setup();
  bio.textContent = 'ancien';
  view.renderBio(bio, '');
  assert.equal(bio.textContent, '');
  view.renderBio(bio, undefined);
  assert.equal(bio.childNodes.length, 0);
});
