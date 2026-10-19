import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getSeenMap,
  markSeen,
  SECTIONS,
  listLatestNotifications,
  countUnreadNotifications,
} from '../store/notificationsStore.js';
import { getLatestTimestamp as getLatestReleaseTimestamp } from '../store/releasesStore.js';
import { getLatestTimestamp as getLatestPostTimestamp } from '../store/postsStore.js';
import { ah } from '../utils/asyncHandler.js';

export const notificationsRouter = Router();

/**
 * Public et sans authentification : sert au calcul du badge pour un
 * visiteur NON connecté, qui n'a pas de ligne dans user_seen (rien à lire
 * côté serveur pour lui) — voir js/nav.js, qui compare ces deux valeurs à
 * ce qu'il a lui-même mémorisé en local (localStorage). Ne révèle que
 * deux horodatages, jamais le contenu — sans risque à exposer largement.
 */
notificationsRouter.get('/notifications/latest', ah(async (req, res) => {
  const [releases, community] = await Promise.all([getLatestReleaseTimestamp(), getLatestPostTimestamp()]);
  res.json({ releases, community });
}));

/** Version "compte connecté" : compare direct côté serveur, pas besoin que le navigateur fasse le calcul lui-même. */
notificationsRouter.get('/notifications/badges', requireAuth, ah(async (req, res) => {
  const [seen, latestReleases, latestCommunity] = await Promise.all([
    getSeenMap(req.session.userId),
    getLatestReleaseTimestamp(),
    getLatestPostTimestamp(),
  ]);

  res.json({
    releases: latestReleases > seen.releases,
    community: latestCommunity > seen.community,
  });
}));

notificationsRouter.post('/notifications/seen', requireAuth, ah(async (req, res) => {
  const { section } = req.body || {};
  if (!SECTIONS.includes(section)) {
    return res.status(400).json({ error: `"section" doit être l'une de : ${SECTIONS.join(', ')}.` });
  }

  await markSeen(req.session.userId, section);
  res.json({ ok: true });
}));

/**
 * Contenu de la cloche : les 3 dernières notifications visibles par ce
 * compte et le nombre de non lues (depuis la dernière ouverture du
 * panneau — voir POST /notifications/seen avec section "inbox").
 */
notificationsRouter.get('/notifications', requireAuth, ah(async (req, res) => {
  const [notifications, unread] = await Promise.all([
    listLatestNotifications(req.session.userId),
    countUnreadNotifications(req.session.userId),
  ]);
  res.json({ notifications, unread });
}));
