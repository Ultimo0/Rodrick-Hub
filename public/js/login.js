// Icônes en SVG "trait" (stroke), même esprit dessiné à la main que
// nav.js — pas d'émoticône. currentColor : la couleur suit celle du
// bouton (voir .field-toggle dans style.css), donc s'adapte aux 2 thèmes
// sans variante à maintenir.
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.6 9.6 0 0 1 12 4c7 0 10.5 7 10.5 7a13.4 13.4 0 0 1-1.67 2.53M6.6 6.6C3.4 8.6 1.5 12 1.5 12s3.5 7 10.5 7a9.7 9.7 0 0 0 4.02-.84"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

/** Bouton œil dans un champ mot de passe : bascule text/password, icône et libellé accessible en phase. */
function wirePasswordToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;

  toggle.innerHTML = EYE_ICON; // état initial : mot de passe masqué, l'icône propose de le révéler

  toggle.addEventListener('click', () => {
    const willShow = input.type === 'password';
    input.type = willShow ? 'text' : 'password';
    toggle.innerHTML = willShow ? EYE_OFF_ICON : EYE_ICON;
    toggle.setAttribute('aria-pressed', String(willShow));
    toggle.setAttribute('aria-label', willShow ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    document.dispatchEvent(new CustomEvent('auth:password-visibility', { detail: { visible: willShow } }));
  });
}

wirePasswordToggle('fPassword', 'togglePassword');

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('formError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  errorEl.textContent = '';

  const email = document.getElementById('fEmail').value.trim();
  const password = document.getElementById('fPassword').value;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Une erreur est survenue.';
      errorEl.style.display = 'block';
      window.authAssistant?.error(errorEl.textContent);
      return;
    }

    window.authAssistant?.success();
    // Arrivé ici depuis le lien d'un bot (voir js/link.js) : on y retourne
    // pour confirmer la liaison, au lieu d'aller sur le profil.
    let pendingLink = null;
    try { pendingLink = sessionStorage.getItem('hubPendingLink'); } catch { /* stockage indisponible */ }
    window.location.href = pendingLink ? 'link.html' : 'profile.html';
  } catch {
    errorEl.textContent = 'Impossible de contacter le serveur.';
    errorEl.style.display = 'block';
    window.authAssistant?.error(errorEl.textContent);
  }
});
