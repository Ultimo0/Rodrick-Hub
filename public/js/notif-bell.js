/**
 * notif-bell.js
 * ------------------------------------------------------------------
 * La cloche de notifications, injectée dans la barre du haut de CHAQUE
 * page (à côté de l'avatar, dans #hubNav) pour les comptes connectés :
 *   - un badge avec le nombre de notifications non lues ;
 *   - un panneau avec les 3 dernières notifications (nouvelle version,
 *     nouvelle publication, un de MES bots passe hors ligne / revient) ;
 *   - un interrupteur pour activer ou désactiver les notifications push
 *     sur cet appareil (la même logique que la page Profil : voir
 *     js/push-notifications.js, chargé ici au besoin).
 *
 * Le contenu vient de GET /api/notifications. Ouvrir le panneau marque
 * tout comme lu (POST /api/notifications/seen, section "inbox"). Une
 * nouveauté pendant que le Hub est ouvert arrive par le flux temps réel
 * (événement navigateur 'hub-realtime', voir js/realtime.js) : on relit
 * alors simplement la liste, plutôt que de la reconstruire à la main.
 * ------------------------------------------------------------------
 */
(function initNotificationBell() {
  'use strict';

  const BELL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  const TYPE_ICONS = {
    release: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16V8"/><path d="M8.5 11.5L12 8l3.5 3.5"/></svg>',
    post: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'bot-online': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.2" r="0.8"/></svg>',
    'bot-linked': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
    'bot-offline': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M5 12.5a10 10 0 0 1 3-2"/><path d="M12.5 8.3a10 10 0 0 1 6.5 4.2"/><path d="M8.5 16a5 5 0 0 1 7 0"/></svg>',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** "à l'instant", "il y a 5 min", "il y a 3 h", "il y a 2 j". */
  function timeAgo(timestamp, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - Number(timestamp)) / 1000));
    if (seconds < 60) return 'à l\u2019instant';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  }

  /** N'autorise que les liens internes du Hub (le contenu vient de la base, jamais de confiance aveugle). */
  function safeLink(link) {
    return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '/index.html';
  }

  function itemHtml(notification, isNew) {
    const type = TYPE_ICONS[notification.type] ? notification.type : 'post';
    return `
      <li>
        <a class="hub-bell-item${isNew ? ' is-new' : ''}" href="${escapeHtml(safeLink(notification.link))}">
          <span class="hub-bell-item-icon hub-bell-item-icon-${type}">${TYPE_ICONS[type]}</span>
          <span class="hub-bell-item-text">
            <span class="hub-bell-item-title">${escapeHtml(notification.title)}</span>
            ${notification.body ? `<span class="hub-bell-item-body">${escapeHtml(notification.body)}</span>` : ''}
            <span class="hub-bell-item-time">${timeAgo(notification.createdAt)}</span>
          </span>
        </a>
      </li>`;
  }

  async function loadPushScript() {
    if (window.RodrickPush) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/push-notifications.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  let started = false;

  async function start() {
    // Garde posée AVANT le premier await : deux démarrages rapprochés (script
    // inclus deux fois, événement déclenché en double) injecteraient sinon
    // deux cloches avant que la première réponse du serveur n'arrive.
    if (started) return;
    const nav = document.getElementById('hubNav');
    if (!nav || document.getElementById('hubBell')) return;
    started = true;

    let me;
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return; // visiteur non connecté : pas de cloche
      me = await res.json();
    } catch {
      return;
    }
    if (!me) return;

    const root = document.createElement('div');
    root.className = 'hub-bell';
    root.id = 'hubBell';
    root.innerHTML = `
      <button class="hub-bell-btn" type="button" aria-label="Notifications" aria-haspopup="dialog" aria-expanded="false" aria-controls="hubBellPanel">
        ${BELL_ICON}
        <span class="hub-bell-badge" hidden></span>
      </button>
      <div class="hub-bell-panel" id="hubBellPanel" role="dialog" aria-label="Notifications" hidden>
        <div class="hub-bell-head">
          <strong>Notifications</strong>
          <label class="hub-switch">
            <span class="hub-switch-label">Alertes sur cet appareil</span>
            <input type="checkbox" role="switch" class="hub-switch-input" />
            <span class="hub-switch-track" aria-hidden="true"></span>
          </label>
        </div>
        <p class="hub-bell-hint" role="status" hidden></p>
        <ul class="hub-bell-list"></ul>
        <p class="hub-bell-empty" hidden>Rien de nouveau pour le moment.</p>
      </div>`;

    const authStatus = document.getElementById('authStatus');
    if (authStatus) authStatus.before(root);
    else nav.append(root);

    const button = root.querySelector('.hub-bell-btn');
    const badge = root.querySelector('.hub-bell-badge');
    const panel = root.querySelector('.hub-bell-panel');
    const list = root.querySelector('.hub-bell-list');
    const empty = root.querySelector('.hub-bell-empty');
    const hint = root.querySelector('.hub-bell-hint');
    const toggle = root.querySelector('.hub-switch-input');

    let unread = 0;
    let latest = [];

    function renderBadge() {
      badge.hidden = unread <= 0;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      button.setAttribute('aria-label', unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications');
    }

    function renderList() {
      // Les `unread` plus récentes sont celles qu'on n'avait pas encore vues.
      list.innerHTML = latest.map((n, index) => itemHtml(n, index < unread)).join('');
      empty.hidden = latest.length > 0;
    }

    async function refresh() {
      try {
        const res = await fetch('/api/notifications');
        if (!res.ok) return;
        const data = await res.json();
        latest = data.notifications || [];
        // Panneau ouvert : ce qui arrive est vu tout de suite, on ne rallume pas le badge.
        unread = panel.hidden ? data.unread || 0 : 0;
        renderBadge();
        renderList();
        if (!panel.hidden && (data.unread || 0) > 0) markSeen();
      } catch {
        // Réseau coupé : on garde l'affichage précédent.
      }
    }

    function markSeen() {
      fetch('/api/notifications/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'inbox' }),
      }).catch(() => {});
    }

    function setHint(message) {
      hint.hidden = !message;
      hint.textContent = message || '';
    }

    async function syncToggle() {
      try {
        await loadPushScript();
        const status = await window.RodrickPush.getStatus();
        toggle.checked = status === 'subscribed';
        toggle.disabled = status === 'unsupported' || status === 'denied';

        if (status === 'denied') setHint('Les notifications sont bloquées dans ton navigateur : autorise-les dans ses réglages pour les activer.');
        else if (status === 'unsupported') setHint(isIos()
          ? 'Sur iPhone, installe d\u2019abord le Hub sur ton écran d\u2019accueil pour activer les alertes.'
          : 'Ce navigateur ne gère pas les notifications push.');
        else setHint('');
      } catch {
        toggle.disabled = true;
        setHint('Les alertes sont indisponibles pour le moment.');
      }
    }

    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      setHint('');
      try {
        await window.RodrickPush.toggle();
      } catch (err) {
        setHint(err?.message || 'Impossible de modifier les alertes.');
      }
      await syncToggle();
    });

    function open() {
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      syncToggle();
      if (unread > 0) markSeen();
      // Le badge s'éteint, mais les nouvelles restent surlignées le temps de cette ouverture.
      badge.hidden = true;
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      unread = 0;
      renderBadge();
      renderList();
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (panel.hidden) open();
      else close();
    });
    panel.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        close();
        button.focus();
      }
    });

    // Nouveauté pendant que le Hub est ouvert : on relit la liste (anti-rebond :
    // une version et une publication peuvent arriver presque en même temps).
    let refreshTimer = null;
    window.addEventListener('hub-realtime', (event) => {
      if (!['notification', 'new-release', 'new-post'].includes(event.detail?.type)) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 400);
    });

    // Les "il y a 5 min" vieillissent : on les réécrit sans rien recharger.
    setInterval(() => { if (!panel.hidden) renderList(); }, 60 * 1000);

    await refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Exposé pour les tests (jsdom) — aucune autre page n'en dépend.
  window.__hubBellInternals = { timeAgo, safeLink, itemHtml };
})();
