import { Router } from 'express';
import { requireApiKey } from '../middleware/requireApiKey.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { loadReleases, addRelease, getLatestRelease, getReleaseById, updateRelease, deleteReleases } from '../store/releasesStore.js';
import { broadcast } from '../realtime.js';
import { sendPushToAll } from '../push.js';
import { createNotification } from '../store/notificationsStore.js';
import { ah } from '../utils/asyncHandler.js';

export const releasesRouter = Router();

// Volontairement PAS de requireApiKey ici : la liste des versions et leur
// changelog sont publics, comme le reste de la page "Gestion des
// versions" du Hub — n'importe quel visiteur doit pouvoir les consulter,
// pas seulement le propriétaire du bot.
releasesRouter.get('/releases', ah(async (req, res) => {
  res.json({ releases: await loadReleases() });
}));

releasesRouter.get('/releases/latest', ah(async (req, res) => {
  const latest = await getLatestRelease();
  if (!latest) {
    return res.status(404).json({ error: 'Aucune release publiée pour le moment.' });
  }
  res.json(latest);
}));

// Ici en revanche, requireApiKey est nécessaire : publier une nouvelle
// version est une action réservée à l'admin (toi), pas à n'importe quel
// visiteur du Hub. Laissé sur la clé API partagée (plutôt que basculé sur
// une session admin comme les deux routes suivantes) au cas où un script
// l'utiliserait pour publier automatiquement — modifier/supprimer une
// version déjà publiée est, elle, clairement une action de panel admin,
// jamais quelque chose qu'un script ferait tout seul.
releasesRouter.post('/releases', requireApiKey, ah(async (req, res) => {
  const { version, date, changelog, downloadUrl } = req.body || {};

  if (!version || !date) {
    return res.status(400).json({ error: '"version" et "date" sont obligatoires.' });
  }

  const release = await addRelease({
    version,
    date,
    changelog: changelog || '',
    downloadUrl: downloadUrl || null,
  });

  // Diffusion en temps réel (bannière + badge, voir js/nav.js) à tous les
  // navigateurs actuellement ouverts sur le Hub, PUIS notification push
  // (voir src/push.js) pour celles et ceux qui ont activé les
  // notifications et n'ont pas le Hub ouvert en ce moment — les deux
  // canaux sont indépendants, l'un ne remplace pas l'autre.
  broadcast({ type: 'new-release', release });
  createNotification({ type: 'release', title: 'Nouvelle version de RodrickBOT', body: `v${release.version} est disponible.`, link: '/releases.html' })
    .catch((err) => console.error('Échec createNotification (release) :', err));
  sendPushToAll({
    title: 'Nouvelle version de RodrickBOT',
    body: `v${release.version} est disponible.`,
    url: '/releases.html',
  }).catch((err) => console.error('Échec sendPushToAll (release) :', err));

  res.json({ ok: true, version });
}));

releasesRouter.patch('/releases/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const { version, date, changelog, downloadUrl } = req.body || {};

  if (version !== undefined && !version) {
    return res.status(400).json({ error: 'La version ne peut pas être vide.' });
  }
  if (date !== undefined && !date) {
    return res.status(400).json({ error: 'La date ne peut pas être vide.' });
  }

  const updated = await updateRelease(id, { version, date, changelog, downloadUrl });
  if (!updated) return res.status(404).json({ error: 'Version introuvable.' });

  res.json({ ok: true, release: updated });
}));

/**
 * Une seule route pour supprimer 1 ou plusieurs versions à la fois — le
 * corps attend { ids: [1, 2, 3] } dans les deux cas (même un id unique
 * s'envoie comme un tableau à un élément), plutôt qu'une route
 * DELETE /releases/:id séparée en plus de celle-ci.
 */
releasesRouter.delete('/releases', requireAuth, requireAdmin, ah(async (req, res) => {
  const { ids } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: '"ids" doit être un tableau de nombres entiers non vide.' });
  }

  const deleted = await deleteReleases(ids);
  res.json({ ok: true, deleted });
}));
