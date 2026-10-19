import rateLimit from 'express-rate-limit';

/**
 * Trois limiteurs séparés plutôt qu'un seul générique : chaque route a un
 * profil d'abus différent (deviner un mot de passe se fait en beaucoup de
 * tentatives rapides ; spammer des inscriptions ou des emails est plus
 * lent mais coûte cher — un email de reset envoyé à la volée, un compte
 * créé en base à chaque fois).
 *
 * standardHeaders: renvoie les en-têtes RateLimit-* (norme actuelle) pour
 * que le navigateur/l'appelant sache combien de tentatives il lui reste.
 * legacyHeaders: false désactive les anciens en-têtes X-RateLimit-*,
 * redondants avec les nouveaux.
 */

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives par IP sur la fenêtre — large pour un usage normal (fautes de frappe), serré pour du brute force
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessaie dans quelques minutes.' },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de comptes créés depuis cette adresse. Réessaie plus tard.' },
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de réinitialisation. Réessaie dans quelques minutes.' },
});

// Même profil d'abus que loginLimiter : cette route vérifie un mot de
// passe (voir DELETE /profile dans src/routes/profile.js), donc quelqu'un
// qui aurait volé une session pourrait sinon essayer de le deviner en
// boucle pour supprimer le compte de quelqu'un d'autre.
export const deleteAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

export const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de commentaires publiés. Réessaie dans quelques minutes.' },
});

export const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de réactions envoyées. Réessaie dans une minute.' },
});

// Page de liaison d'un bot (aperçu + confirmation) : un jeton fait 256 bits et
// ne se devine pas, ce plafond sert surtout à décourager quelqu'un qui
// martèlerait la route avec de faux jetons.
export const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});
