import { Router } from 'express';
import { requireApiKey } from '../middleware/requireApiKey.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { sendToUser } from '../realtime.js';
import {
  loadInstances,
  listInstancesForUser,
  upsertHeartbeat,
  updateInstanceConfig,
  updateInstanceEnabled,
  deleteInstance,
  logHeartbeat,
} from '../store/instancesStore.js';
import { getLatestRelease } from '../store/releasesStore.js';
import { autoLinkVerifiedOwner, linkStateOf } from '../store/linkStore.js';
import { isValidOwnerHash } from '../utils/linkToken.js';
import { OFFLINE_AFTER_MS } from '../config.js';
import { broadcastToAdmins } from '../realtime.js';
import { ah } from '../utils/asyncHandler.js';

// Un Router, c'est un "mini app" Express qu'on peut définir dans son
// propre fichier puis brancher sur l'app principale (voir server.js :
// app.use('/api', instancesRouter)). Ça évite d'avoir TOUTES les routes
// du projet dans un seul fichier géant au fur et à mesure qu'on en ajoute
// (versions, comptes, communauté...).
export const instancesRouter = Router();

// Le heartbeat reste authentifié par clé partagée pour les processus bots.
// La consultation et la gestion des instances, elles, sont réservées aux
// comptes admin du Hub (voir les routes GET /instances et POST/DELETE).

// Configuration pilotable à distance (Phase 1d). MÊMES règles que côté bot
// (config/index.js::isValidPrefix) — dupliquées ici parce que ce sont deux
// projets séparés, mais le bot re-valide de toute façon (core/remoteConfig.js)
// et reste l'autorité : cette copie sert seulement à refuser tôt, avec un
// message clair, plutôt que de laisser partir une valeur que le bot rejetterait.
// Pour piloter un nouveau réglage : l'ajouter ici ET dans la liste blanche
// du bot (core/remoteConfig.js::APPLIERS) — les deux sont nécessaires.
const MAX_PREFIX_LENGTH = 5;
const REMOTE_CONFIG_VALIDATORS = {
  prefix: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_PREFIX_LENGTH && !/\s/.test(v),
};

instancesRouter.post('/heartbeat', requireApiKey, ah(async (req, res) => {
  const {
    instanceId, ownerName, botName, version, uptimeSeconds,
    messageCount, commandStats, mode, prefix, nodeVersion,
    reconnectCount, lastDisconnectCode, lastDisconnectAt,
    ytdlpLastRefreshAt, ytdlpLastRefreshOk, ytdlpVersion,
    groupCount, activeFeatures, appliedConfigVersion, ownerHash,
  } = req.body || {};

  if (!instanceId) {
    return res.status(400).json({ error: 'instanceId manquant.' });
  }

  const instance = {
    instanceId,
    ownerName: ownerName || 'Inconnu',
    botName: botName || 'RodrickBOT',
    version: version || '?',
    uptimeSeconds: uptimeSeconds ?? null,
    messageCount: messageCount ?? null,
    commandStats: commandStats || {},
    mode: mode || '?',
    prefix: prefix || '!',
    nodeVersion: nodeVersion || '?',
    lastSeen: Date.now(),
    // Santé de connexion (Phase 1b) — champs optionnels : un bot pas
    // encore mis à jour ne les envoie simplement pas, ce qui se traduit
    // par NULL en base (voir db.js), pas par une erreur.
    reconnectCount: reconnectCount ?? null,
    lastDisconnectCode: lastDisconnectCode ?? null,
    lastDisconnectAt: lastDisconnectAt ?? null,
    // État du binaire yt-dlp (Phase 1b-ii) — mêmes règles : champs
    // optionnels, NULL si le bot ne les envoie pas encore.
    ytdlpLastRefreshAt: ytdlpLastRefreshAt ?? null,
    ytdlpLastRefreshOk: typeof ytdlpLastRefreshOk === 'boolean' ? ytdlpLastRefreshOk : null,
    ytdlpVersion: ytdlpVersion ?? null,
    // Comptes agrégés d'usage (Phase 1c) — champs optionnels, NULL si le
    // bot ne les envoie pas encore. activeFeatures est validé comme objet
    // simple (pas un tableau, pas une chaîne) avant d'être stocké : même
    // authentifié par clé API, ce champ finit sérialisé en texte JSON en
    // base, autant ne jamais y écrire autre chose que la forme attendue.
    groupCount: Number.isInteger(groupCount) && groupCount >= 0 ? groupCount : null,
    activeFeatures:
      activeFeatures && typeof activeFeatures === 'object' && !Array.isArray(activeFeatures)
        ? activeFeatures
        : null,
    // Configuration poussée (Phase 1d) et état activé/désactivé : ces
    // colonnes appartiennent au Hub et ne sont pas modifiées par l'UPSERT
    // du heartbeat. appliedConfigVersion vient du bot (accusé de réception).
    appliedConfigVersion:
      Number.isInteger(appliedConfigVersion) && appliedConfigVersion >= 0 ? appliedConfigVersion : null,
    // Empreinte du propriétaire (voir src/store/linkStore.js) : ignorée si elle
    // n'a pas la forme attendue, jamais un motif de refus du heartbeat.
    ownerHash: isValidOwnerHash(ownerHash) ? ownerHash : null,
  };
  const saved = await upsertHeartbeat(instance);

  // Propriétaire déjà prouvé (un autre de ses bots a été relié) : liaison d'office.
  if (saved.userId == null && saved.ownerHash) {
    const linkedUserId = await autoLinkVerifiedOwner(instanceId, saved.ownerHash);
    if (linkedUserId != null) {
      saved.userId = linkedUserId;
      sendToUser(linkedUserId, { type: 'notification' }).catch(() => {});
    }
  }
  await logHeartbeat(instanceId, messageCount);
  broadcastToAdmins({ type: 'instance-update' });

  // Comparaison simple par égalité de chaîne, pas un tri SemVer : on ne
  // classe jamais les versions entre elles, on détecte juste "la version
  // publiée la plus récente diffère de celle que ce bot vient d'annoncer".
  // getLatestRelease() existe déjà (utilisée par le bandeau de
  // releases.html) — aucune nouvelle table, aucune nouvelle colonne.
  const latestRelease = await getLatestRelease();

  // Configuration en attente : renvoyée tant que le bot n'a pas accusé
  // réception de cette version (ou d'une plus récente). Un bot pas encore
  // à jour n'envoie pas appliedConfigVersion (traité comme 0) : il reçoit
  // la configuration à chaque heartbeat mais l'ignore — sans conséquence.
  const pendingConfig =
    saved.remoteConfig && saved.configVersion > (saved.appliedConfigVersion ?? 0)
      ? { version: saved.configVersion, values: saved.remoteConfig }
      : undefined;

  res.json({
    ok: true,
    enabled: saved.enabled,
    latestVersion: latestRelease?.version || null,
    // Le bot décide seul d'envoyer (ou non) son lien d'invitation WhatsApp.
    link: linkStateOf(saved),
    ...(pendingConfig ? { config: pendingConfig } : {}),
  });
}));

/**
 * Pose une configuration à pousser vers une instance (Phase 1d) — appliquée
 * par le bot au heartbeat suivant (jusqu'à ~5 min), voir
 * core/remoteConfig.js côté RodrickBOT. Même authentification que /toggle.
 * Corps : { "prefix": "?" } — clés inconnues REFUSÉES (400) plutôt
 * qu'ignorées en silence, pour ne pas laisser croire qu'un réglage a été
 * envoyé alors que le bot l'ignorerait.
 */
instancesRouter.post('/instances/:instanceId/config', requireAuth, requireAdmin, ah(async (req, res) => {
  const { instanceId } = req.params;
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const keys = Object.keys(body);

  if (keys.length === 0) {
    return res.status(400).json({ error: `Aucun réglage fourni. Réglages autorisés : ${Object.keys(REMOTE_CONFIG_VALIDATORS).join(', ')}.` });
  }

  for (const key of keys) {
    const validator = Object.hasOwn(REMOTE_CONFIG_VALIDATORS, key) ? REMOTE_CONFIG_VALIDATORS[key] : null;
    if (!validator) {
      return res.status(400).json({ error: `Réglage non autorisé : "${key}". Réglages autorisés : ${Object.keys(REMOTE_CONFIG_VALIDATORS).join(', ')}.` });
    }
    if (!validator(body[key])) {
      return res.status(400).json({ error: `Valeur invalide pour "${key}".` });
    }
  }

  const instance = await updateInstanceConfig(instanceId, body);
  if (!instance) {
    return res.status(404).json({ error: 'Instance inconnue.' });
  }

  broadcastToAdmins({ type: 'instance-update' });

  res.json({ ok: true, instanceId, configVersion: instance.configVersion, remoteConfig: instance.remoteConfig });
}));

instancesRouter.post('/instances/:instanceId/toggle', requireAuth, requireAdmin, ah(async (req, res) => {
  const { instanceId } = req.params;
  const { enabled } = req.body || {};

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" doit être un booléen.' });
  }

  const instance = await updateInstanceEnabled(instanceId, enabled);
  if (!instance) {
    return res.status(404).json({ error: 'Instance inconnue.' });
  }

  broadcastToAdmins({ type: 'instance-update' });

  res.json({ ok: true, instanceId, enabled });
}));

/**
 * Supprime définitivement les infos d'une instance (utile quand une copie
 * est hors ligne de façon permanente et qu'on veut nettoyer le dashboard).
 */
instancesRouter.delete('/instances/:instanceId', requireAuth, requireAdmin, ah(async (req, res) => {
  const { instanceId } = req.params;

  if (!(await deleteInstance(instanceId))) return res.status(404).json({ error: 'Instance inconnue.' });
  broadcastToAdmins({ type: 'instance-deleted' });

  res.json({ ok: true, instanceId, deleted: true });
}));

/**
 * "Mes bots" : uniquement les instances rattachées au compte connecté, avec
 * une liste BLANCHE de champs (pas de commandStats, de configuration à
 * distance ni d'identifiants d'autres instances).
 */
instancesRouter.get('/me/instances', requireAuth, ah(async (req, res) => {
  const now = Date.now();
  const rows = await listInstancesForUser(req.session.userId);

  const instances = rows.map((inst) => ({
    instanceId: inst.instanceId,
    botName: inst.botName,
    ownerName: inst.ownerName,
    version: inst.version,
    enabled: inst.enabled,
    online: now - inst.lastSeen < OFFLINE_AFTER_MS,
    lastSeen: inst.lastSeen,
    uptimeSeconds: inst.uptimeSeconds === null ? null : Number(inst.uptimeSeconds),
  }));

  res.json({ instances, offlineAfterMs: OFFLINE_AFTER_MS });
}));

instancesRouter.get('/instances', requireAuth, requireAdmin, ah(async (req, res) => {
  const instances = await loadInstances();
  const now = Date.now();

  const list = Object.values(instances)
    .map(({ ownerHash, ...inst }) => ({ ...inst, online: now - inst.lastSeen < OFFLINE_AFTER_MS }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  res.json({ instances: list, offlineAfterMs: OFFLINE_AFTER_MS });
}));
