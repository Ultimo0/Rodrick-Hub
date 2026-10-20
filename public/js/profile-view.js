/**
 * profile-view.js
 * ------------------------------------------------------------------
 * Deux petites fonctions d'affichage de la page Profil, séparées de
 * profile.js pour pouvoir être testées seules :
 *   - formatBadge(n)    : "9+" au-delà de 9, comme sur la cloche ;
 *   - renderBio(el, t)  : écrit la bio dans `el` en rendant cliquables les
 *                         adresses http(s), SANS jamais interpréter le texte
 *                         comme du HTML (la bio est saisie par l'utilisateur).
 * ------------------------------------------------------------------
 */
(function exposeProfileView() {
  'use strict';

  function formatBadge(count) {
    return count > 9 ? '9+' : String(count);
  }

  // Ponctuation de fin de phrase : "voir https://x.fr." ne doit pas inclure le point.
  const TRAILING = /[.,;:!?)\]]+$/;

  function renderBio(element, text) {
    element.replaceChildren();
    const value = String(text || '');
    const pattern = /https?:\/\/[^\s<>"']+/g;

    let last = 0;
    for (const match of value.matchAll(pattern)) {
      let url = match[0];
      const trailing = url.match(TRAILING);
      if (trailing) url = url.slice(0, -trailing[0].length);

      let valid = null;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') valid = parsed.href;
      } catch { /* pas une adresse : on la laisse en texte */ }
      if (!valid) continue;

      if (match.index > last) element.append(document.createTextNode(value.slice(last, match.index)));

      const link = document.createElement('a');
      link.href = valid;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow ugc';
      element.append(link);

      last = match.index + url.length;
    }

    if (last < value.length) element.append(document.createTextNode(value.slice(last)));
  }

  window.ProfileView = { formatBadge, renderBio };
})();
