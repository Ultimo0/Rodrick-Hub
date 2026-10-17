import {
  activeFeatureCounts,
  filterInstances,
  formatDateTime,
  ytDlpRefreshLabel,
} from './ui-utils.js';
import { patchHtml, patchKeyedList } from './dom-patch.js';

const accessGate = document.getElementById('instanceAccessGate');
const adminContent = document.getElementById('instanceAdminContent');
const grid = document.getElementById('grid');
const summary = document.getElementById('summary');
const emptyEl = document.getElementById('empty');
const noResultsEl = document.getElementById('noResults');
const errorEl = document.getElementById('error');
const feedbackEl = document.getElementById('actionFeedback');
const toolbar = document.getElementById('instanceToolbar');
const searchInput = document.getElementById('instanceSearch');
const filterBar = document.getElementById('instanceFilters');
const resultCountEl = document.getElementById('instanceResultCount');
const detailsDialog = document.getElementById('instanceDetailsDialog');
const detailsContent = document.getElementById('instanceDetailsContent');

let allInstances = [];
let activeFilter = 'all';
let feedbackTimer;
let selectedInstanceId = null;
let detailsOpener = null;
let isAdminSession = false;
let knownOnlineStates = new Map();

// L’ancienne interface stockait la clé technique partagée avec les bots
// dans localStorage. Les pages admin utilisent maintenant la session Hub.
try { localStorage.removeItem('rodrick_hub_api_key'); } catch {}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + 'j');
  if (h) parts.push(h + 'h');
  parts.push(m + 'min');
  return parts.join(' ');
}

function timeAgo(ts) {
  if (ts == null || !Number.isFinite(Number(ts))) return 'inconnu';
  const diff = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (diff < 60) return `il y a ${diff}s`;
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)}j`;
}

function showFeedback(message, isError = false) {
  clearTimeout(feedbackTimer);
  feedbackEl.textContent = message;
  feedbackEl.classList.toggle('is-error', isError);
  feedbackEl.hidden = false;
  feedbackTimer = setTimeout(() => { feedbackEl.hidden = true; }, 4500);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function topCommandsHtml(commandStats) {
  const entries = Object.entries(commandStats || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) {
    return '<div class="top-commands"><div class="k">Top commandes</div><div class="muted-small">Aucune donnée pour le moment</div></div>';
  }
  const rows = entries
    .map(([name, count]) => `<div class="cmd-row"><span>!${escapeHtml(name)}</span><span>${count}</span></div>`)
    .join('');
  return `<div class="top-commands"><div class="k">Top commandes</div>${rows}</div>`;
}

// Mêmes règles que le bot (config/index.js::isValidPrefix) et que la route
// POST /api/instances/:id/config : 1 à 5 caractères, sans espace. Ici pour
// refuser tôt avec un message clair — le serveur ET le bot re-valident.
function isValidPrefix(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 5 && !/\s/.test(value);
}

// Préfixe poussé depuis le Hub mais pas encore appliqué par le bot (le bot
// l'applique au heartbeat suivant, voir core/remoteConfig.js côté
// RodrickBOT). null si rien n'est en attente. Une valeur identique au
// préfixe déjà en place n'est pas "en attente" : rien de visible à attendre.
function pendingRemotePrefix(inst) {
  const wanted = inst.remoteConfig?.prefix;
  if (!wanted) return null;
  if ((inst.configVersion ?? 0) <= (inst.appliedConfigVersion ?? 0)) return null;
  if (wanted === inst.prefix) return null;
  return wanted;
}

// Codes de l'énum DisconnectReason de @whiskeysockets/baileys, affichés en
// clair pour ne pas obliger à connaître le paquet par cœur — un code non
// listé ici s'affiche simplement tel quel ("code 123"), jamais masqué.
const DISCONNECT_REASON_LABELS = {
  401: 'session fermée',
  403: 'interdit',
  408: 'connexion perdue',
  411: 'version multi-appareils incompatible',
  428: 'connexion fermée',
  440: 'remplacée par une autre session',
  500: 'session corrompue',
  515: 'redémarrage requis',
};

// Santé de connexion (Phase 1b) — reconnectCount/lastDisconnectAt sont NULL
// pour une copie pas encore mise à jour (RodrickBOT < 1.79.0, voir
// core/state.js côté bot) : dans ce cas on n'affiche rien plutôt qu'une
// ligne à moitié vide.
function connectionHealthHtml(inst) {
  if (inst.reconnectCount == null && inst.lastDisconnectAt == null) return '';

  const reason = inst.lastDisconnectCode != null
    ? (DISCONNECT_REASON_LABELS[inst.lastDisconnectCode] || `code ${inst.lastDisconnectCode}`)
    : null;

  return `
    <div class="info-row"><span class="k">Reconnexions</span><span>${inst.reconnectCount ?? '—'}</span></div>
    ${inst.lastDisconnectAt != null
      ? `<div class="info-row"><span class="k">Dernière coupure</span><span title="${escapeHtml(formatDateTime(inst.lastDisconnectAt))}">${timeAgo(inst.lastDisconnectAt)}${reason ? ` (${escapeHtml(reason)})` : ''}</span></div>`
      : ''}
  `;
}

function instanceCardHtml(inst, index = 0) {
  const enabled = inst.enabled !== false;
  const online = inst.online === true;
  const previousOnline = knownOnlineStates.get(inst.instanceId);
  const statusChange = previousOnline === undefined || previousOnline === online
    ? ''
    : online ? 'has-come-online' : 'has-gone-offline';
  // Le bouton 🗑️ n'apparaît que pour les copies hors ligne : pensé pour
  // nettoyer le dashboard des instances mortes en permanence, pas pour
  // supprimer une copie active par erreur.
  const deleteBtn = !online
    ? `<button class="delete-btn" type="button" data-id="${escapeHtml(inst.instanceId)}" aria-label="Supprimer l’instance ${escapeHtml(inst.instanceId)}" title="Supprimer définitivement cette instance">🗑️</button>`
    : '';

  return `
    <article class="instance-card ${enabled ? '' : 'disabled-card'} ${statusChange}" data-instance-id="${escapeHtml(inst.instanceId)}" style="--card-index:${index}">
      <div class="top">
        <div>
          <div class="owner">${escapeHtml(inst.ownerName)}</div>
          <div class="instance-id">${escapeHtml(inst.instanceId)}</div>
        </div>
        <div class="instance-status">
          <span class="badge ${online ? 'online' : 'offline'}"><span class="status-dot" aria-hidden="true"></span>${online ? 'En ligne' : 'Hors ligne'}</span>
          ${enabled ? '' : '<span class="badge disabled-badge">Désactivée</span>'}
        </div>
      </div>
      <div class="info-row"><span class="k">Bot</span><span>${escapeHtml(inst.botName)} v${escapeHtml(inst.version)}</span></div>
      <div class="info-row"><span class="k">Uptime</span><span>${formatUptime(inst.uptimeSeconds)}</span></div>
      <div class="info-row"><span class="k">Dernier contact</span><span>${timeAgo(inst.lastSeen)}</span></div>
      <div class="actions">
        <button class="details-btn" type="button" data-action="details" data-id="${escapeHtml(inst.instanceId)}" aria-haspopup="dialog">Détails</button>
        <button class="toggle-btn ${enabled ? 'is-on' : 'is-off'}" type="button" data-id="${escapeHtml(inst.instanceId)}" data-enabled="${enabled}">
          ${enabled ? 'Désactiver cette instance' : 'Réactiver cette instance'}
        </button>
        ${deleteBtn}
      </div>
    </article>
  `;
}

function detailRowHtml(label, value) {
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function detailSectionHtml(title, contents) {
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${contents}</section>`;
}

function formatCount(value) {
  return value == null || !Number.isFinite(Number(value))
    ? 'Non communiqué par cette version'
    : new Intl.NumberFormat('fr-FR').format(Number(value));
}

function activeFeaturesHtml(inst) {
  const features = activeFeatureCounts(inst.activeFeatures);
  if (features === null) {
    return '<p class="detail-empty">Les fonctionnalités par groupe ne sont pas encore communiquées par cette version du bot.</p>';
  }
  if (features.length === 0) {
    return '<p class="detail-empty">Aucune de ces fonctionnalités n’est actuellement activée dans les groupes suivis.</p>';
  }
  return `<ul class="feature-count-list">${features.map((feature) => `
    <li><span>${escapeHtml(feature.label)}</span><strong>${feature.count} groupe${feature.count > 1 ? 's' : ''}</strong></li>
  `).join('')}</ul>`;
}

function instanceDetailsHtml(inst) {
  const enabled = inst.enabled !== false;
  const online = inst.online === true;
  const canPushConfig = inst.appliedConfigVersion != null;
  const pendingPrefix = pendingRemotePrefix(inst);
  const configIsPending = Number(inst.configVersion || 0) > Number(inst.appliedConfigVersion || 0);
  const prefixButton = `<button class="prefix-btn" type="button" data-details-action="edit-prefix"
    data-id="${escapeHtml(inst.instanceId)}" data-prefix="${escapeHtml(inst.prefix)}"
    aria-label="Changer le préfixe de ${escapeHtml(inst.instanceId)}" ${canPushConfig ? '' : 'disabled'}
    title="${canPushConfig ? 'Changer le préfixe à distance' : 'Cette copie doit d’abord être mise à jour vers RodrickBOT 1.82.0 ou plus.'}">Modifier</button>`;
  const prefixValue = `${escapeHtml(inst.prefix)} ${prefixButton}`;
  const configStatus = canPushConfig
    ? configIsPending
      ? `En attente d’application · configuration v${formatCount(inst.configVersion)}`
      : `Synchronisée · v${formatCount(inst.appliedConfigVersion)}`
    : 'Accusé de réception indisponible — mise à jour du bot requise';
  const mediaStatus = ytDlpRefreshLabel(inst.ytdlpLastRefreshOk);
  const features = activeFeaturesHtml(inst);
  const lastSeenDate = formatDateTime(inst.lastSeen);
  const reconnectData = inst.reconnectCount == null && inst.lastDisconnectAt == null
    ? '<p class="detail-empty">Aucune donnée de connexion détaillée reçue.</p>'
    : `<div class="detail-rows">${connectionHealthHtml(inst)}</div>`;

  return `
    <header class="drawer-header">
      <div class="drawer-title-group">
        <p class="drawer-eyebrow">SUPERVISION ADMIN</p>
        <h2 id="instanceDetailsTitle">${escapeHtml(inst.botName || 'RodrickBOT')}</h2>
        <p class="drawer-instance-id">${escapeHtml(inst.instanceId)}</p>
      </div>
      <button class="drawer-close" type="button" data-details-action="close" aria-label="Fermer les détails">×</button>
    </header>
    <div class="drawer-scroll">
      <div class="drawer-state-card">
        <div class="instance-status">
          <span class="badge ${online ? 'online' : 'offline'}"><span class="status-dot" aria-hidden="true"></span>${online ? 'En ligne' : 'Hors ligne'}</span>
          <span class="badge ${enabled ? 'enabled-badge' : 'disabled-badge'}">${enabled ? 'Activée' : 'Désactivée'}</span>
        </div>
        <p>Propriétaire : <strong>${escapeHtml(inst.ownerName || 'Inconnu')}</strong></p>
        <p>Dernier contact : <strong title="${escapeHtml(lastSeenDate)}">${timeAgo(inst.lastSeen)}</strong></p>
      </div>

      ${detailSectionHtml('Vue d’ensemble', `
        <div class="drawer-metrics">
          <div><span>Groupes suivis</span><strong>${formatCount(inst.groupCount)}</strong></div>
          <div><span>Messages traités</span><strong>${formatCount(inst.messageCount)}</strong></div>
          <div><span>Temps de fonctionnement</span><strong>${formatUptime(inst.uptimeSeconds)}</strong></div>
        </div>
      `)}

      ${detailSectionHtml('Configuration et environnement', `
        <div class="detail-rows">
          ${detailRowHtml('Version du bot', `v${escapeHtml(inst.version || '?')}`)}
          ${detailRowHtml('Version de Node.js', escapeHtml(inst.nodeVersion || 'Non communiquée'))}
          ${detailRowHtml('Mode', escapeHtml(inst.mode || 'Non communiqué'))}
          ${detailRowHtml('Préfixe', prefixValue)}
          ${detailRowHtml('Configuration distante', `<span class="${configIsPending ? 'detail-pending' : ''}">${escapeHtml(configStatus)}</span>`)}
        </div>
        ${pendingPrefix ? `<p class="config-pending">⏳ Le préfixe « ${escapeHtml(pendingPrefix)} » sera appliqué au prochain contact du bot.</p>` : ''}
      `)}

      ${detailSectionHtml('Santé de connexion', `
        ${detailRowHtml('État actuel', online ? 'Connectée' : 'Hors ligne')}
        ${detailRowHtml('Dernier signal reçu', `<span title="${escapeHtml(lastSeenDate)}">${timeAgo(inst.lastSeen)}</span>`)}
        ${reconnectData}
      `)}

      ${detailSectionHtml('Téléchargement média', `
        <div class="detail-rows">
          ${detailRowHtml('État de yt-dlp', `<span class="${inst.ytdlpLastRefreshOk === false ? 'detail-error' : inst.ytdlpLastRefreshOk === true ? 'detail-success' : ''}">${escapeHtml(mediaStatus)}</span>`)}
          ${detailRowHtml('Version installée', escapeHtml(inst.ytdlpVersion || 'Non communiquée'))}
          ${detailRowHtml('Dernière actualisation', escapeHtml(formatDateTime(inst.ytdlpLastRefreshAt)))}
        </div>
      `)}

      ${detailSectionHtml('Fonctionnalités actives par groupe', features)}
      ${detailSectionHtml('Commandes les plus utilisées', topCommandsHtml(inst.commandStats))}
    </div>
  `;
}

function openInstanceDetails(instanceId, opener) {
  selectedInstanceId = instanceId;
  detailsOpener = opener;
  renderInstanceDetails();
  if (!detailsDialog.open) detailsDialog.showModal();
}

function renderInstanceDetails() {
  if (!selectedInstanceId) return;
  const instance = allInstances.find((item) => item.instanceId === selectedInstanceId);
  if (!instance) {
    if (detailsDialog.open) detailsDialog.close();
    return;
  }
  patchHtml(detailsContent, instanceDetailsHtml(instance));
}

function renderAccessGate(title, message, action) {
  const heading = document.createElement('strong');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = message;
  accessGate.replaceChildren(heading, description);

  if (action) {
    const link = document.createElement('a');
    link.href = action.href;
    link.textContent = action.label;
    accessGate.append(link);
  }
  accessGate.hidden = false;
}

async function initializeDashboard() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) {
        renderAccessGate(
          'Connexion administrateur requise',
          'Connecte-toi avec un compte administrateur pour consulter et gérer les instances.',
          { href: 'login.html', label: 'Se connecter' }
        );
      } else {
        renderAccessGate('Vérification impossible', 'Le Hub n’a pas pu confirmer ton accès. Réessaie dans un instant.');
      }
      return;
    }

    const user = await response.json();
    if (user.role !== 'admin') {
      renderAccessGate(
        'Espace réservé aux administrateurs',
        'Le compte connecté ne dispose pas des droits nécessaires pour accéder à la supervision des instances.'
      );
      return;
    }

    isAdminSession = true;
    accessGate.hidden = true;
    adminContent.hidden = false;
    await refresh(true);
  } catch {
    renderAccessGate('Vérification impossible', 'Impossible de contacter le Hub pour vérifier les droits administrateur.');
  }
}

function animateSummaryValue(element, from, target) {
  const formatter = new Intl.NumberFormat('fr-FR');
  // Un nouveau changement pendant une animation reprend la main : sinon deux
  // animations écriraient en même temps dans le même élément.
  const token = (element._summaryToken = (element._summaryToken || 0) + 1);

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = formatter.format(target);
    return;
  }

  const startedAt = performance.now();
  const duration = 460;
  const tick = (now) => {
    if (element._summaryToken !== token) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    // Décélération progressive : le chiffre ne s'arrête pas brutalement.
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatter.format(Math.round(from + (target - from) * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const SUMMARY_STATS = [
  { tone: 'total', label: 'Instances' },
  { tone: 'online', label: 'En ligne' },
  { tone: 'offline', label: 'Hors ligne' },
  { tone: 'disabled', label: 'Désactivées' },
];

// Les quatre tuiles sont créées une seule fois ; ensuite on ne touche qu'à un
// chiffre qui a réellement changé, en l'animant depuis sa valeur précédente
// (avant : tout repartait de 0 à chaque heartbeat de n'importe quelle instance).
function renderSummary() {
  const onlineCount = allInstances.filter((instance) => instance.online === true).length;
  const disabledCount = allInstances.filter((instance) => instance.enabled === false).length;
  const values = {
    total: allInstances.length,
    online: onlineCount,
    offline: allInstances.length - onlineCount,
    disabled: disabledCount,
  };

  if (summary.children.length !== SUMMARY_STATS.length) {
    summary.innerHTML = SUMMARY_STATS.map(({ tone, label }) => `
      <div class="stat" data-tone="${tone}"><div class="value" data-count="0">0</div><div class="label">${label}</div></div>
    `).join('');
  }

  for (const { tone } of SUMMARY_STATS) {
    const element = summary.querySelector(`[data-tone="${tone}"] .value`);
    const from = Number(element.dataset.count);
    const target = values[tone];
    if (from === target) continue;
    element.dataset.count = String(target);
    animateSummaryValue(element, from, target);
  }
}

function updateFilterButtons() {
  filterBar.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === activeFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderInstances() {
  const visible = filterInstances(allInstances, {
    query: searchInput.value,
    status: activeFilter,
  });

  resultCountEl.textContent = `${visible.length} sur ${allInstances.length} instance${allInstances.length === 1 ? '' : 's'}`;
  emptyEl.hidden = allInstances.length > 0;
  noResultsEl.hidden = allInstances.length === 0 || visible.length > 0;
  patchKeyedList(grid, visible, {
    keyOf: (instance) => instance.instanceId,
    htmlOf: instanceCardHtml,
    keyAttr: 'data-instance-id',
  });
  knownOnlineStates = new Map(allInstances.map((instance) => [instance.instanceId, instance.online === true]));
}

async function refresh(showSuccess = false) {
  if (!isAdminSession) return;
  errorEl.style.display = 'none';
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/instances', { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        isAdminSession = false;
        adminContent.hidden = true;
        if (detailsDialog.open) detailsDialog.close();
        renderAccessGate(
          res.status === 401 ? 'Connexion administrateur requise' : 'Espace réservé aux administrateurs',
          res.status === 401
            ? 'Ta session a expiré. Reconnecte-toi pour accéder à la supervision.'
            : 'Le compte connecté ne dispose plus des droits administrateur.',
          res.status === 401 ? { href: 'login.html', label: 'Se reconnecter' } : null
        );
        return;
      }
      errorEl.textContent = data.error || `Erreur serveur (${res.status})`;
      errorEl.style.display = 'block';
      grid.innerHTML = '';
      summary.innerHTML = '';
      toolbar.hidden = true;
      emptyEl.hidden = true;
      noResultsEl.hidden = true;
      if (detailsDialog.open) detailsDialog.close();
      showFeedback(errorEl.textContent, true);
      return;
    }

    const { instances } = await res.json();
    allInstances = Array.isArray(instances) ? instances : [];
    toolbar.hidden = false;
    renderSummary();
    renderInstances();
    if (detailsDialog.open) renderInstanceDetails();
    if (showSuccess) showFeedback('Connexion réussie : tes instances sont chargées.');
  } catch (err) {
    errorEl.textContent = 'Impossible de contacter le serveur.';
    errorEl.style.display = 'block';
    showFeedback('La connexion au dashboard a échoué. Vérifie le réseau et ta session administrateur.', true);
  }
}

async function toggleInstance(instanceId, enabled, button) {
  const originalText = button.textContent;
  let succeeded = false;
  button.disabled = true;
  button.textContent = 'Mise à jour…';
  try {
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/toggle`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showFeedback(data.error || 'Impossible de changer le statut. Vérifie ta session administrateur.', true);
      return;
    }
    succeeded = true;
    showFeedback(enabled ? 'Instance réactivée.' : 'Instance désactivée.');
    await refresh();
  } catch {
    showFeedback('Impossible de contacter le serveur pour modifier cette instance.', true);
  } finally {
    // En cas de succès, refresh() a déjà mis à jour ce même bouton (nouveau
    // libellé, plus de "disabled") : y remettre l'ancien texte serait faux.
    if (button.isConnected && !succeeded) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

// Un prompt() natif plutôt qu'un <input> dans la carte : dom-patch.js ne
// gère pas la valeur saisie dans un <input> (elle n'est pas un attribut), et
// un champ intégré à la carte pourrait être écrasé en pleine frappe par un
// heartbeat. prompt() vit hors du DOM de la grille, et reste cohérent avec
// les confirm() déjà utilisés ici.
async function changeRemotePrefix(instanceId, currentPrefix) {
  const answer = prompt(
    `Nouveau préfixe pour "${instanceId}" (actuel : "${currentPrefix}").\n` +
    `1 à 5 caractères, sans espace.\n\n` +
    `Il sera appliqué au prochain contact du bot (jusqu'à 5 min, ou à son retour s'il est hors ligne).`,
    currentPrefix
  );
  if (answer === null) return; // annulé

  const prefix = answer.trim();
  if (!isValidPrefix(prefix)) { showFeedback('Préfixe invalide : 1 à 5 caractères, sans espace.', true); return; }
  if (prefix === currentPrefix) { showFeedback('C’est déjà le préfixe actuel de cette copie.'); return; }

  try {
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/config`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showFeedback(data.error || 'Impossible de changer le préfixe. Vérifie ta session administrateur.', true);
      return;
    }
    showFeedback(`Préfixe « ${prefix} » envoyé. Il sera appliqué au prochain contact du bot.`);
    await refresh();
  } catch { showFeedback('Impossible de contacter le serveur pour changer le préfixe.', true); }
}

async function deleteInstance(instanceId) {
  const confirmed = confirm(
    `Supprimer définitivement les infos de "${instanceId}" ?\nCette action est irréversible — utile uniquement si la copie est hors ligne pour de bon.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) { showFeedback('Impossible de supprimer cette instance. Vérifie ta session administrateur.', true); return; }
    showFeedback('Instance supprimée du tableau de bord.');
    await refresh();
  } catch { showFeedback('Impossible de contacter le serveur pour supprimer cette instance.', true); }
}

searchInput.addEventListener('input', renderInstances);
filterBar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  activeFilter = button.dataset.filter;
  updateFilterButtons();
  renderInstances();
});

grid.addEventListener('click', (event) => {
  const detailsButton = event.target.closest('[data-action="details"]');
  if (detailsButton) {
    openInstanceDetails(detailsButton.dataset.id, detailsButton);
    return;
  }

  const toggleButton = event.target.closest('.toggle-btn');
  if (toggleButton) {
    toggleInstance(toggleButton.dataset.id, toggleButton.dataset.enabled !== 'true', toggleButton);
    return;
  }

  const deleteButton = event.target.closest('.delete-btn');
  if (deleteButton) {
    deleteInstance(deleteButton.dataset.id);
    return;
  }

  const prefixButton = event.target.closest('.prefix-btn');
  if (prefixButton) changeRemotePrefix(prefixButton.dataset.id, prefixButton.dataset.prefix);
});

detailsDialog.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-details-action]');
  if (actionButton?.dataset.detailsAction === 'close') {
    detailsDialog.close();
    return;
  }
  if (actionButton?.dataset.detailsAction === 'edit-prefix') {
    changeRemotePrefix(actionButton.dataset.id, actionButton.dataset.prefix);
    return;
  }
  if (event.target === detailsDialog) detailsDialog.close();
});

detailsDialog.addEventListener('close', () => {
  selectedInstanceId = null;
  if (detailsOpener?.isConnected) detailsOpener.focus();
  detailsOpener = null;
});

initializeDashboard();

// Avant le temps réel, on redemandait "y a-t-il du nouveau ?" toutes les
// 10s, que ça ait changé ou non (setInterval(refresh, 10000)). Maintenant,
// le serveur PRÉVIENT lui-même dès qu'une instance se met à jour — on
// n'a plus qu'à réagir à l'événement, sans jamais interroger pour rien.
window.addEventListener('hub-realtime', (e) => {
  if (e.detail.type === 'instance-update' || e.detail.type === 'instance-deleted') {
    refresh();
  }
});
