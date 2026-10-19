import { Router } from 'express';
import { requireApiKey } from '../middleware/requireApiKey.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { linkLimiter } from '../middleware/rateLimit.js';
import { APP_URL } from '../config.js';
import { createInvite, previewToken, claimToken } from '../store/linkStore.js';
import { sendToUser } from '../realtime.js';
import { buildLinkUrl, isValidOwnerHash } from '../utils/linkToken.js';

export const linkRouter = Router();

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Appelée PAR LE BOT (clé API partagée) : il demande son lien d'invitation
 * pour l'envoyer par WhatsApp à son propriétaire — automatiquement au premier
 * heartbeat, puis à chaque !hub.
 */
linkRouter.post('/link/invite', requireApiKey, ah(async (req, res) => {
  const { instanceId, ownerHash } = req.body || {};
  if (!instanceId || typeof instanceId !== 'string') {
    return res.status(400).json({ error: 'instanceId manquant.' });
  }
  if (!isValidOwnerHash(ownerHash)) {
    return res.status(400).json({ error: 'ownerHash invalide (HMAC-SHA256 hexadécimal attendu).' });
  }

  const invite = await createInvite({ instanceId, ownerHash });
  if (invite.error) return res.status(404).json({ error: 'Instance inconnue : le bot doit d\u2019abord envoyer un heartbeat.' });
  if (invite.linked) return res.json({ linked: true });

  res.json({ linked: false, url: buildLinkUrl(APP_URL, invite.token), expiresAt: invite.expiresAt });
}));

/** Page du lien, avant confirmation : montre à quel bot on est sur le point de se relier. */
linkRouter.get('/link/preview', linkLimiter, ah(async (req, res) => {
  res.json(await previewToken(String(req.query.token || '')));
}));

/** Confirmation, par un compte connecté. */
linkRouter.post('/link/claim', linkLimiter, requireAuth, ah(async (req, res) => {
  const result = await claimToken(String(req.body?.token || ''), req.session.userId);

  if (!result.ok) {
    const messages = {
      invalid: 'Ce lien n\u2019est pas valide.',
      used: 'Ce lien a déjà été utilisé.',
      expired: 'Ce lien a expiré. Tape !hub sur WhatsApp pour en recevoir un nouveau.',
      'owner-taken': 'Ce bot appartient déjà à un autre compte du Hub.',
      'already-linked': 'Ce bot est déjà relié à un autre compte.',
    };
    return res.status(result.reason === 'invalid' ? 404 : 409).json({ ok: false, reason: result.reason, error: messages[result.reason] });
  }

  // Les onglets déjà ouverts de ce compte actualisent "Mes bots" et la cloche.
  sendToUser(req.session.userId, { type: 'notification' }).catch(() => {});
  res.json({ ok: true, bots: result.bots });
}));
