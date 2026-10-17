(function initHubNavigation() {
  'use strict';

/**
 * nav.js
 * ------------------------------------------------------------------
 * Source UNIQUE de la liste des pages du Hub. Avant ce fichier, chacune
 * des pages HTML recopiait à la main les mêmes liens — et cette
 * duplication avait déjà dérivé : login.html, register.html et
 * profile.html n'avaient que 3 liens sur 5, sans qu'on s'en rende compte
 * en éditant une page à la fois.
 *
 * Ce fichier peuple DEUX zones à partir de la même liste :
 *   1. #hubNavLinks   — la barre du haut (desktop, et visible mais sans
 *                       les liens sur mobile, voir style.css)
 *   2. #hubTabBar      — la barre d'onglets fixée en bas, visible
 *                       UNIQUEMENT sur mobile (créée ici, pas dans le HTML,
 *                       pour ne pas alourdir chaque page d'un bloc de plus)
 *
 * Chaque page HTML n'a donc plus qu'un conteneur vide à tenir à jour
 * (aucun) — ajouter une page au Hub se fait en modifiant UNE seule fois
 * PAGES ci-dessous, plus jamais un lien à corriger page par page.
 *
 * Ce fichier gère aussi le balayage tactile (swipe) gauche/droite pour
 * changer de page — voir initSwipeNavigation() plus bas.
 */

// Icônes en SVG "trait" (stroke), dans l'esprit Feather/Lucide, dessinées
// à la main plutôt qu'importées d'une bibliothèque — juste quelques icônes,
// inutile d'ajouter une dépendance externe pour ça. stroke="currentColor"
// est la partie importante : l'icône hérite automatiquement de la couleur
// CSS de son lien parent (.hub-tabbar-icon), donc elle s'adapte toute
// seule aux 4 thèmes ET à l'état actif, sans variante à maintenir.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c2.3 2 3.8 5.3 3.8 8.7 0 1.9-.5 3.7-1.2 5L12 19l-2.6-2.8c-.7-1.3-1.2-3.1-1.2-5 0-3.4 1.5-6.7 3.8-8.7z"/><path d="M9.3 15.3 7 17.6l-.8 2.7 2.7-.8 2.3-2.3"/><circle cx="12" cy="10.2" r="1.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.8 1.7 1L11 21h4l.3-2.6c.6-.2 1.2-.6 1.7-1l2.5 1 2-3.4z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="20" x2="5" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="15"/></svg>',
  tiles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
};

const PAGES = [
  { href: 'index.html', label: 'Accueil', icon: ICONS.home },
  { href: 'dashboard.html', label: 'Instances', icon: ICONS.tiles, adminOnly: true },
  { href: 'releases.html', label: 'Versions', icon: ICONS.rocket },
  { href: 'commands.html', label: 'Commandes', icon: ICONS.gear },
  { href: 'community.html', label: 'Communauté', icon: ICONS.chat },
  { href: 'stats.html', label: 'Statistiques', icon: ICONS.chart },
];

// Seules ces deux pages ont un "badge de nouveauté" — Dashboard/Commandes/
// Statistiques n'ont pas de notion de "contenu pas encore vu".
const NOTIF_SECTIONS = { 'releases.html': 'releases', 'community.html': 'community' };
const localSeenKey = (section) => `rodrick_hub_seen_${section}`;

// Rempli par computeBadgeState() au chargement, puis tenu à jour par le
// flux temps réel (voir initRealtimeNotifications) — lu par
// renderTopNavLinks()/renderBottomTabBar() à chaque (ré)affichage.
let badgeState = { releases: false, community: false };
// Renseigné par computeBadgeState() : détermine si markCurrentSectionSeen()
// prévient aussi le serveur (compte connecté) ou reste uniquement local
// (visiteur anonyme, voir plus bas).
let isLoggedIn = false;
let isAdmin = false;

function availablePages() {
  return PAGES.filter((page) => !page.adminOnly || isAdmin);
}

function currentPage() {
  // "" (racine du site) doit compter comme index.html — sans ce cas
  // particulier, aucun onglet ne serait jamais marqué actif sur "/".
  const path = location.pathname.split('/').pop();
  return path === '' ? 'index.html' : path;
}

/**
 * Compte connecté : /api/notifications/badges compare déjà tout côté
 * serveur (voir src/routes/notifications.js) — le plus fiable, puisque ça
 * suit la personne d'un appareil à l'autre. Si cette requête échoue (pas
 * connecté, ou erreur réseau), on bascule sur une comparaison locale :
 * dernier horodatage public (/api/notifications/latest) contre ce que ce
 * navigateur précis a mémorisé lui-même (localStorage) — moins fiable
 * (ne suit pas d'un appareil à l'autre) mais mieux que rien pour un
 * visiteur sans compte.
 */
async function computeBadgeState() {
  try {
    const res = await fetch('/api/notifications/badges');
    if (res.ok) {
      isLoggedIn = true;
      return await res.json();
    }
  } catch {
    // pas de réseau — on retombe sur le calcul local ci-dessous
  }

  isLoggedIn = false;
  try {
    const res = await fetch('/api/notifications/latest');
    const latest = await res.json();
    return {
      releases: latest.releases > Number(localStorage.getItem(localSeenKey('releases')) || 0),
      community: latest.community > Number(localStorage.getItem(localSeenKey('community')) || 0),
    };
  } catch {
    return { releases: false, community: false };
  }
}

/**
 * Marque la section de la page ACTUELLE comme vue — appelé une fois au
 * chargement, avant le premier rendu de la nav (voir DOMContentLoaded plus
 * bas), pour que le badge de cette section n'apparaisse jamais alors
 * qu'on est justement en train de la regarder.
 */
function markCurrentSectionSeen() {
  const section = NOTIF_SECTIONS[currentPage()];
  if (!section) return;

  badgeState[section] = false;
  localStorage.setItem(localSeenKey(section), String(Date.now()));

  if (isLoggedIn) {
    fetch('/api/notifications/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section }),
    }).catch(() => {}); // best-effort : une erreur ici ne doit pas bloquer l'affichage de la page
  }
}

function badgeDotHtml(href) {
  const section = NOTIF_SECTIONS[href];
  return section && badgeState[section] ? '<span class="nav-badge-dot" aria-label="Nouveau contenu"></span>' : '';
}

function renderTopNavLinks() {
  const container = document.getElementById('hubNavLinks');
  if (!container) return; // page qui n'a pas encore le conteneur (ne devrait pas arriver)

  const here = currentPage();
  container.innerHTML = availablePages().map(
    (p) => `<a href="${p.href}"${p.href === here ? ' class="active"' : ''}>${p.label}${badgeDotHtml(p.href)}</a>`
  ).join('');
}

function renderBottomTabBar() {
  // Idempotent : on retire l'ancienne barre avant d'en recréer une —
  // sans ça, un second appel (ex: mise à jour d'un badge en temps réel)
  // en empilerait une deuxième par-dessus la première au lieu de la
  // remplacer.
  document.getElementById('hubTabBar')?.remove();

  const here = currentPage();
  const tabBar = document.createElement('nav');
  tabBar.className = 'hub-tabbar';
  tabBar.id = 'hubTabBar';
  tabBar.setAttribute('aria-label', 'Navigation principale');

  tabBar.innerHTML = availablePages().map((p) => `
    <a href="${p.href}"${p.href === here ? ' class="active"' : ''}>
      <span class="hub-tabbar-icon-wrap">
        <span class="hub-tabbar-icon" aria-hidden="true">${p.icon}</span>
        ${badgeDotHtml(p.href)}
      </span>
      <span class="hub-tabbar-label">${p.label}</span>
    </a>
  `).join('');

  document.body.appendChild(tabBar);
}

/**
 * Affiche une bannière temporaire en haut de l'écran — le canal "je suis
 * en train d'utiliser le Hub là, maintenant" (l'autre canal, pour quand le
 * Hub n'est pas ouvert, ce sont les notifications push : voir sw.js et
 * js/push-notifications.js). Clic dessus = aller directement à la page
 * concernée ; sinon elle disparaît toute seule après quelques secondes.
 */
function showToast(message, url) {
  const toast = document.createElement('aside');
  toast.className = 'hub-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <a class="hub-toast-link" href="${url}"><span>${message}</span><span class="hub-toast-arrow" aria-hidden="true">→</span></a>
    <button class="hub-toast-close" type="button" aria-label="Fermer la notification">×</button>
    <span class="hub-toast-progress" aria-hidden="true"></span>
  `;
  const removeToast = () => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector('.hub-toast-close').addEventListener('click', removeToast);
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  setTimeout(() => {
    removeToast();
  }, 6000);
}

/**
 * Écoute le flux temps réel déjà ouvert par js/realtime.js (voir
 * l'événement navigateur 'hub-realtime', diffusé sur CHAQUE page qui
 * inclut ce script — pas seulement community.html comme avant). Une
 * nouveauté détectée pendant que quelqu'un utilise le Hub allume le badge
 * immédiatement (sans attendre un rechargement de page) ET affiche une
 * bannière — SAUF si la personne est déjà en train de regarder la page
 * concernée (elle voit déjà l'information directement, pas besoin de la
 * prévenir en plus — community.html gère d'ailleurs déjà son propre
 * bandeau "nouvelle publication" dans ce cas précis, voir community.js).
 */
function initRealtimeNotifications() {
  const currentSection = NOTIF_SECTIONS[currentPage()];
  const EVENT_TO_SECTION = { 'new-release': 'releases', 'new-post': 'community' };

  window.addEventListener('hub-realtime', (e) => {
    const section = EVENT_TO_SECTION[e.detail.type];
    if (!section || section === currentSection) return;

    badgeState[section] = true;
    renderTopNavLinks();
    renderBottomTabBar();

    if (e.detail.type === 'new-release') {
      showToast(`🚀 Nouvelle version : v${e.detail.release.version}`, 'releases.html');
    } else {
      showToast(`💬 Nouvelle publication : "${e.detail.post.title}"`, 'community.html');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Affiche immédiatement le menu horizontal desktop et les onglets publics
  // mobiles. Les requêtes réseau ci-dessous ne doivent pas laisser la nav vide.
  renderTopNavLinks();
  renderBottomTabBar();
  document.body.classList.add('hub-nav-ready');

  const [badges, admin] = await Promise.all([computeBadgeState(), computeAdminState()]);
  badgeState = badges;
  isAdmin = admin;
  markCurrentSectionSeen();
  renderTopNavLinks();
  renderBottomTabBar();
  initSwipeNavigation();
  initRealtimeNotifications();
});

async function computeAdminState() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return false;
    const user = await res.json();
    return user.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Balayer vers la gauche → page suivante, vers la droite → page
 * précédente, dans l'ordre de PAGES (celui de la barre d'onglets).
 * Convention identique à un carrousel de photos : swiper à gauche fait
 * "avancer" (comme si le contenu suivant arrivait par la droite).
 *
 * Ce site n'est pas une SPA (chaque page est un vrai fichier HTML
 * séparé) — un swipe déclenche donc une vraie navigation
 * (location.href), exactement comme un tap sur l'onglet correspondant.
 */
function initSwipeNavigation() {
  const here = currentPage();
  const pages = availablePages();
  const currentIndex = pages.findIndex((p) => p.href === here);
  // Page hors de la liste (ex: admin.html, login.html) : pas de
  // "suivant/précédent" qui aurait un sens, on ne branche rien.
  if (currentIndex === -1) return;

  const MIN_DISTANCE = 70; // px — en dessous, on considère que ce n'est pas un vrai swipe volontaire
  let startX = 0;
  let startY = 0;
  let ignoreThisTouch = false;

  // Un élément a déjà son propre défilement horizontal (ex: le graphique
  // en barres de stats.html) — dans ce cas, on laisse ce défilement
  // natif se produire plutôt que de lui voler le geste pour changer de
  // page. On vérifie l'élément touché ET ses parents, jusqu'à <body>.
  function startsInsideHorizontalScroller(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      el = el.parentElement;
    }
    return false;
  }

  document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    ignoreThisTouch = startsInsideHorizontalScroller(e.target);
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (ignoreThisTouch) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    // Un vrai swipe de navigation doit être largement plus horizontal
    // que vertical — sinon c'est un scroll de page vertical normal, pas
    // une intention de changer d'onglet.
    if (Math.abs(deltaX) < MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY)) return;

    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= pages.length) return; // déjà au premier/dernier onglet

    location.href = pages[nextIndex].href;
  }, { passive: true });
}

})();
