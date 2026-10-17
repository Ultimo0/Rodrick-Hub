import assert from 'node:assert/strict';
import test from 'node:test';

// jsdom n'est requis que pour ce test (devDependency) : s'il n'est pas
// installé, les tests sont ignorés au lieu de faire échouer `npm test`.
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'jsdom non installé (npm install --save-dev jsdom)';

async function setup() {
  const dom = new jsdom.JSDOM('<!doctype html><body><div id="root"></div></body>');
  globalThis.document = dom.window.document;
  const { patchHtml, patchKeyedList } = await import('../public/js/dom-patch.js');
  return { root: dom.window.document.getElementById('root'), patchHtml, patchKeyedList };
}

const card = (id, label) =>
  `<article data-instance-id="${id}" class="card"><span class="label">${label}</span><button type="button">Go</button></article>`;
const options = {
  keyOf: (item) => item.id,
  htmlOf: (item) => card(item.id, item.label),
  keyAttr: 'data-instance-id',
};
const ids = (root) => Array.from(root.children).map((el) => el.getAttribute('data-instance-id'));

test('un élément inchangé reste le même nœud DOM (focus, animation conservés)', { skip }, async () => {
  const { root, patchKeyedList } = await setup();
  patchKeyedList(root, [{ id: 'a', label: 'un' }, { id: 'b', label: 'deux' }], options);
  const [cardA, cardB] = Array.from(root.children);

  patchKeyedList(root, [{ id: 'a', label: 'un' }, { id: 'b', label: 'DEUX' }], options);

  assert.equal(root.children[0], cardA);
  assert.equal(root.children[1], cardB);
  assert.equal(cardB.querySelector('.label').textContent, 'DEUX');
});

test('seul le texte modifié est réécrit, pas ses voisins', { skip }, async () => {
  const { root, patchKeyedList } = await setup();
  patchKeyedList(root, [{ id: 'a', label: 'un' }], options);
  const button = root.querySelector('button');
  const label = root.querySelector('.label');

  patchKeyedList(root, [{ id: 'a', label: 'deux' }], options);

  assert.equal(root.querySelector('button'), button);
  assert.equal(root.querySelector('.label'), label);
  assert.equal(label.textContent, 'deux');
});

test('ajoute, retire et réordonne sans recréer les cartes conservées', { skip }, async () => {
  const { root, patchKeyedList } = await setup();
  patchKeyedList(root, [{ id: 'a', label: '1' }, { id: 'b', label: '2' }, { id: 'c', label: '3' }], options);
  const [cardA, , cardC] = Array.from(root.children);

  patchKeyedList(root, [{ id: 'c', label: '3' }, { id: 'd', label: '4' }, { id: 'a', label: '1' }], options);

  assert.deepEqual(ids(root), ['c', 'd', 'a']);
  assert.equal(root.children[0], cardC);
  assert.equal(root.children[2], cardA);
});

test('vider la liste retire toutes les cartes', { skip }, async () => {
  const { root, patchKeyedList } = await setup();
  patchKeyedList(root, [{ id: 'a', label: '1' }], options);
  patchKeyedList(root, [], options);
  assert.equal(root.children.length, 0);
});

test('attributs et classes sont synchronisés (ajout, changement, retrait)', { skip }, async () => {
  const { root, patchHtml } = await setup();
  patchHtml(root, '<p class="a" title="x" data-old="1">t</p>');
  const paragraph = root.firstElementChild;

  patchHtml(root, '<p class="a b" title="y">t</p>');

  assert.equal(root.firstElementChild, paragraph);
  assert.equal(paragraph.className, 'a b');
  assert.equal(paragraph.getAttribute('title'), 'y');
  assert.equal(paragraph.hasAttribute('data-old'), false);
});

test('patchHtml conserve la position de défilement et retire les blocs en trop', { skip }, async () => {
  const { root, patchHtml } = await setup();
  patchHtml(root, '<div class="scroll"><p>1</p><p>2</p><p>3</p></div>');
  const scroll = root.firstElementChild;

  patchHtml(root, '<div class="scroll"><p>1</p><p>2</p></div>');

  assert.equal(root.firstElementChild, scroll);
  assert.equal(scroll.children.length, 2);
});

test('un changement de balise remplace le nœud', { skip }, async () => {
  const { root, patchHtml } = await setup();
  patchHtml(root, '<span>x</span>');
  patchHtml(root, '<strong>x</strong>');
  assert.equal(root.firstElementChild.tagName, 'STRONG');
});

test('un bouton désactivé par le JS est réactivé par le rendu suivant', { skip }, async () => {
  const { root, patchHtml } = await setup();
  patchHtml(root, '<button type="button">Désactiver cette instance</button>');
  const button = root.firstElementChild;
  button.disabled = true;
  button.textContent = 'Mise à jour…';

  patchHtml(root, '<button type="button">Réactiver cette instance</button>');

  assert.equal(root.firstElementChild, button);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Réactiver cette instance');
});
