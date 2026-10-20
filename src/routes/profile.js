import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/requireAuth.js';
import { deleteAccountLimiter } from '../middleware/rateLimit.js';
import { updateProfile, findUserById, countAdmins, deleteUser } from '../store/usersStore.js';
import { ah } from '../utils/asyncHandler.js';
import { countPostsByAuthor } from '../store/postsStore.js';

export const profileRouter = Router();

const BIO_MAX_LENGTH = 280;

/** Compteurs de SA page de profil (les bots viennent de GET /api/me/instances). */
profileRouter.get('/profile/stats', requireAuth, ah(async (req, res) => {
  res.json({ posts: await countPostsByAuthor(req.session.userId) });
}));

/**
 * Toujours req.session.userId comme cible — JAMAIS un id pris dans le
 * corps de la requête ou l'URL. Sans cette règle, n'importe quel compte
 * connecté pourrait passer l'id de quelqu'un d'autre et modifier SON
 * profil à lui. requireAuth garantit juste "il y a une session valide" —
 * c'est cette ligne-ci qui garantit "on ne modifie que SON PROPRE compte".
 */
profileRouter.patch('/profile', requireAuth, ah(async (req, res) => {
  const { name, bio, avatarUrl } = req.body || {};

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
  }
  if (bio !== undefined && typeof bio === 'string' && bio.length > BIO_MAX_LENGTH) {
    return res.status(400).json({ error: `La bio ne peut pas dépasser ${BIO_MAX_LENGTH} caractères.` });
  }
  // On fait confiance à l'URL renvoyée par Cloudinary après un upload
  // réussi (voir profile.js côté navigateur), mais on vérifie quand même
  // ici qu'elle pointe bien vers Cloudinary — en défense en profondeur,
  // au cas où quelqu'un appellerait cette route directement (en
  // contournant l'interface) avec une URL arbitraire.
  if (avatarUrl !== undefined && avatarUrl !== null && !String(avatarUrl).startsWith('https://res.cloudinary.com/')) {
    return res.status(400).json({ error: 'URL de photo de profil invalide.' });
  }

  const updated = await updateProfile(req.session.userId, { name, bio, avatarUrl });
  if (!updated) return res.status(404).json({ error: 'Compte introuvable.' });

  res.json({
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      bio: updated.bio,
      avatarUrl: updated.avatarUrl,
      createdAt: updated.createdAt,
    },
  });
}));

/**
 * Suppression du compte, PAR SON PROPRE TITULAIRE — pas de version admin
 * "supprime le compte de quelqu'un d'autre" pour l'instant (ce n'était
 * pas la demande ; ça se rajouterait dans admin.js le cas échéant, avec
 * ses propres règles).
 *
 * Exige le mot de passe en confirmation : une session déjà ouverte (sur
 * un ordinateur partagé, ou volée) ne doit pas suffire à elle seule pour
 * une action aussi définitive — voir la même logique sur /auth/login.
 */
profileRouter.delete('/profile', deleteAccountLimiter, requireAuth, ah(async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Mot de passe requis pour confirmer la suppression.' });
  }

  const user = await findUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }

  // Dernier rempart : si ce compte est le SEUL admin, le supprimer
  // priverait le Hub de tout accès au panel admin, sans personne pour en
  // promouvoir un autre à sa place.
  if (user.role === 'admin') {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return res.status(400).json({
        error: 'Impossible de supprimer le dernier compte administrateur. Promeus un autre compte admin avant de supprimer le tien.',
      });
    }
  }

  await deleteUser(user.id);

  // req.session.destroy() efface la session CÔTÉ SERVEUR (la ligne dans
  // la table "session" — voir server.js) ; le cookie qui reste dans le
  // navigateur ne pointera plus vers rien de valide, exactement comme un
  // logout normal.
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}));
