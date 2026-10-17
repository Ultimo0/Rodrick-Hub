/**
 * dom-patch.js
 * ------------------------------------------------------------------
 * Mise à jour "ciblée" du DOM, sans framework.
 *
 * Avant : à chaque heartbeat, le dashboard faisait `grid.innerHTML = ...`
 * — toutes les cartes étaient détruites puis recréées. Conséquences
 * visibles : l'animation "pouls" de chaque carte repartait de zéro, le
 * focus clavier sur un bouton était perdu, et le panneau de détails
 * remontait en haut de son défilement.
 *
 * Ici, on compare le nouveau HTML à ce qui est déjà à l'écran et on ne
 * touche QUE ce qui a changé (un texte, un attribut, une classe). Un
 * nœud inchangé n'est jamais retiré du document : il garde donc son
 * focus, son survol, son défilement et ses animations CSS en cours.
 *
 * Deux fonctions publiques :
 *   - patchHtml(container, html)            → pour un bloc libre (panneau de détails)
 *   - patchKeyedList(container, items, ...) → pour une liste de cartes identifiées
 *                                             par une clé (ajout, retrait, ordre)
 *
 * Limite assumée : ce module ne gère pas les <input> dont la valeur est
 * saisie par l'utilisateur (la valeur n'est pas un attribut). Aucune
 * carte ni aucun panneau du dashboard n'en contient aujourd'hui.
 */

const ELEMENT_NODE = 1;

function parseFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function syncAttributes(current, next) {
  for (const { name } of Array.from(current.attributes)) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of Array.from(next.attributes)) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
}

function syncChildren(current, next) {
  const currentNodes = Array.from(current.childNodes);
  const nextNodes = Array.from(next.childNodes);

  nextNodes.forEach((nextNode, index) => {
    const currentNode = currentNodes[index];
    if (currentNode) syncNode(currentNode, nextNode);
    else current.append(nextNode);
  });

  for (let index = nextNodes.length; index < currentNodes.length; index += 1) {
    currentNodes[index].remove();
  }
}

/**
 * Aligne `current` (déjà dans la page) sur `next` (le nouveau rendu).
 * Retourne le nœud qui est dans la page à l'issue de l'opération.
 */
export function syncNode(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return next;
  }
  if (current.nodeType !== ELEMENT_NODE) {
    // Texte ou commentaire : on ne réécrit que si le contenu a changé.
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  syncAttributes(current, next);
  syncChildren(current, next);
  return current;
}

/** Remplace le contenu de `container` par `html`, en ne modifiant que les différences. */
export function patchHtml(container, html) {
  syncChildren(container, parseFragment(html));
}

/**
 * Affiche `items` dans `container`, un élément par item, identifié par
 * `keyOf(item)` — qui doit correspondre à l'attribut `keyAttr` de
 * l'élément racine rendu par `htmlOf(item, index)`.
 *
 *  - élément déjà présent  → mis à jour sur place (jamais recréé)
 *  - nouvel item           → inséré
 *  - item disparu          → retiré
 *  - ordre différent       → seuls les éléments mal placés sont déplacés
 */
export function patchKeyedList(container, items, { keyOf, htmlOf, keyAttr = 'data-key' }) {
  const existing = new Map();
  for (const element of Array.from(container.children)) {
    existing.set(element.getAttribute(keyAttr), element);
  }

  const ordered = items.map((item, index) => {
    const key = String(keyOf(item));
    const next = parseFragment(htmlOf(item, index)).firstElementChild;
    const current = existing.get(key);
    existing.delete(key);
    return current ? syncNode(current, next) : next;
  });

  for (const stale of existing.values()) stale.remove();

  let cursor = container.firstElementChild;
  for (const element of ordered) {
    if (element === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(element, cursor);
  }
}
