/**
 * link.js
 * ------------------------------------------------------------------
 * Page ouverte depuis le lien que le bot envoie par WhatsApp à son
 * propriétaire. Trois étapes, toutes visibles à l'écran :
 *   1. on vérifie le lien (GET /api/link/preview) et on montre QUEL bot ;
 *   2. si la personne n'est pas connectée : connexion ou inscription, puis
 *      retour ici (le jeton attend dans sessionStorage, pas dans l'URL) ;
 *   3. une confirmation explicite (POST /api/link/claim). Elle n'est jamais
 *      automatique : sans elle, un lien piégé ouvert par quelqu'un de connecté
 *      lui glisserait un bot étranger dans son compte.
 * Aucune donnée venant du serveur n'est insérée en HTML : tout passe par
 * textContent.
 * ------------------------------------------------------------------
 */
(function initLinkPage() {
  'use strict';

  const STORAGE_KEY = 'hubPendingLink';

  const title = document.getElementById('linkTitle');
  const text = document.getElementById('linkText');
  const actions = document.getElementById('linkActions');
  if (!title || !text || !actions) return;

  function readStored() {
    try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
  }
  function store(token) {
    try { sessionStorage.setItem(STORAGE_KEY, token); } catch { /* navigation privée : on continue sans */ }
  }
  function forget() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* idem */ }
  }

  function show(heading, body) {
    title.textContent = heading;
    text.textContent = body || '';
    actions.replaceChildren();
  }

  function addAction(label, { href, onClick, primary = true } = {}) {
    const el = document.createElement(href ? 'a' : 'button');
    el.className = `link-action${primary ? ' link-action-primary' : ''}`;
    el.textContent = label;
    if (href) el.href = href;
    else { el.type = 'button'; el.addEventListener('click', onClick); }
    actions.append(el);
    return el;
  }

  const REASONS = {
    invalid: ['Lien invalide', 'Ce lien n\u2019est pas valide. Tape !hub dans WhatsApp pour en recevoir un nouveau.'],
    used: ['Lien déjà utilisé', 'Ce lien a déjà servi. Si ton bot n\u2019apparaît pas dans « Mes bots », tape !hub dans WhatsApp.'],
    expired: ['Lien expiré', 'Ce lien a expiré. Tape !hub dans WhatsApp pour en recevoir un nouveau.'],
    'owner-taken': ['Bot déjà relié', 'Ce bot appartient déjà à un autre compte du Hub.'],
    'already-linked': ['Bot déjà relié', 'Ce bot est déjà relié à un autre compte.'],
  };

  function showProblem(reason) {
    const [heading, body] = REASONS[reason] || REASONS.invalid;
    forget();
    show(heading, body);
    addAction('Retour à l\u2019accueil', { href: 'index.html', primary: false });
  }

  async function start() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || readStored();

    // Le jeton ne reste pas dans la barre d'adresse (historique, copier-coller).
    if (params.has('token')) window.history.replaceState(null, '', window.location.pathname);

    if (!token) return showProblem('invalid');

    let preview;
    try {
      const res = await fetch(`/api/link/preview?token=${encodeURIComponent(token)}`);
      preview = await res.json();
    } catch {
      show('Connexion impossible', 'Impossible de joindre le serveur. Réessaie dans un instant.');
      addAction('Réessayer', { onClick: () => window.location.reload() });
      return;
    }
    if (!preview.valid) return showProblem(preview.reason);

    const label = preview.ownerName ? `${preview.botName} (${preview.ownerName})` : preview.botName;

    let loggedIn = false;
    try { loggedIn = (await fetch('/api/auth/me')).ok; } catch { /* considéré non connecté */ }

    if (!loggedIn) {
      show('Relier ton bot', `${label} peut être relié à ton espace Rodrick Hub. Connecte-toi ou crée un compte pour continuer.`);
      const remember = () => store(token);
      addAction('Se connecter', { href: 'login.html' }).addEventListener('click', remember);
      addAction('Créer un compte', { href: 'register.html', primary: false }).addEventListener('click', remember);
      return;
    }

    show('Relier ce bot à ton compte ?', `${label} apparaîtra dans « Mes bots » : tu verras s\u2019il est en ligne et tu seras prévenu s\u2019il s\u2019arrête. Tes autres bots seront reliés automatiquement.`);
    const confirm = addAction('Relier ce bot', {
      onClick: async () => {
        confirm.disabled = true;
        confirm.textContent = 'Liaison…';
        try {
          const res = await fetch('/api/link/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return showProblem(data.reason || 'invalid');

          forget();
          const names = (data.bots || []).map((bot) => bot.botName).filter(Boolean);
          show('Bot relié ✓', names.length > 1
            ? `${names.length} bots sont maintenant reliés à ton compte.`
            : 'Ton bot est maintenant relié à ton compte.');
          addAction('Voir mes bots', { href: 'index.html' });
        } catch {
          confirm.disabled = false;
          confirm.textContent = 'Relier ce bot';
          text.textContent = 'Impossible de joindre le serveur. Réessaie.';
        }
      },
    });
  }

  start();
})();
