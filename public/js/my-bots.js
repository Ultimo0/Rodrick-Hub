/**
 * my-bots.js
 * ------------------------------------------------------------------
 * Section "Mes bots" de l'accueil : pour un compte connecté, l'état en
 * direct (en ligne / hors ligne) de CHACUN de ses bots, sous forme de
 * cartes à défiler, avec un anneau vert quand le bot répond et gris quand
 * il ne répond plus. Les données viennent de GET /api/me/instances, qui ne
 * renvoie que les bots rattachés à ce compte.
 *
 * La liste est relue toutes les 30 s et dès qu'une notification arrive par
 * le flux temps réel (un bot qui change d'état en déclenche une, voir
 * src/instanceStatusWatcher.js). dom-patch.js ne touche qu'à ce qui a
 * changé : l'anneau d'un bot inchangé ne clignote pas à chaque relecture.
 * ------------------------------------------------------------------
 */
import { patchHtml } from './dom-patch.js';

const REFRESH_MS = 30 * 1000;

const ROBOT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3.5" r="1"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/></svg>';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function lastSeenLabel(timestamp, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(timestamp)) / 60000));
  if (!timestamp) return 'jamais vu';
  if (minutes < 1) return 'à l\u2019instant';
  if (minutes < 60) return `vu il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vu il y a ${hours} h`;
  return `vu il y a ${Math.floor(hours / 24)} j`;
}

export function botState(bot) {
  if (!bot.enabled) return 'disabled';
  return bot.online ? 'online' : 'offline';
}

export function botCardHtml(bot, now = Date.now()) {
  const state = botState(bot);
  const status = {
    online: 'En ligne',
    offline: `Hors ligne · ${lastSeenLabel(bot.lastSeen, now)}`,
    disabled: 'Désactivé',
  }[state];

  const details = [bot.ownerName, bot.version ? `v${bot.version}` : null].filter(Boolean).map(escapeHtml).join(' · ');

  return `
    <article class="mybot is-${state}" data-instance-id="${escapeHtml(bot.instanceId)}">
      <div class="mybot-ring"><span class="mybot-avatar">${ROBOT_ICON}</span><span class="mybot-dot" aria-hidden="true"></span></div>
      <div class="mybot-info">
        <strong class="mybot-name">${escapeHtml(bot.botName || 'RodrickBOT')}</strong>
        <span class="mybot-status">${escapeHtml(status)}</span>
        <span class="mybot-meta">${details}</span>
      </div>
    </article>`;
}

export function summaryLabel(bots) {
  const online = bots.filter((bot) => botState(bot) === 'online').length;
  return `${online} sur ${bots.length} en ligne`;
}

async function start() {
  const section = document.getElementById('myBots');
  if (!section) return;

  const list = section.querySelector('.mybots-list');
  const summary = section.querySelector('.mybots-summary');
  const empty = section.querySelector('.mybots-empty');

  async function refresh() {
    try {
      const res = await fetch('/api/me/instances');
      if (res.status === 401) { section.hidden = true; return; } // visiteur non connecté
      if (!res.ok) return;

      const { instances } = await res.json();
      section.hidden = false;
      empty.hidden = instances.length > 0;
      summary.hidden = instances.length === 0;
      summary.textContent = summaryLabel(instances);
      patchHtml(list, instances.map((bot) => botCardHtml(bot)).join(''));
    } catch {
      // Réseau coupé : on garde l'affichage précédent plutôt que de le vider.
    }
  }

  await refresh();
  setInterval(refresh, REFRESH_MS);
  window.addEventListener('hub-realtime', (event) => {
    if (event.detail?.type === 'notification') refresh();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
