import { createHash, randomBytes } from 'node:crypto';

/**
 * linkToken.js
 * ------------------------------------------------------------------
 * Fonctions PURES (aucune base, aucun réseau) du lien d'invitation qui
 * rattache un bot à un compte. Le jeton voyage en clair une seule fois :
 * dans le message WhatsApp que le bot envoie à son propriétaire. Le Hub
 * n'en garde que l'empreinte SHA-256 — une fuite de la base ne donne donc
 * aucun lien utilisable.
 * ------------------------------------------------------------------
 */

/** Durée de validité d'un lien : assez pour qu'on le touche dans la semaine, pas plus. */
export const LINK_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 octets aléatoires → 43 caractères (alphabet URL-safe, pas besoin d'encoder le lien). */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Un jeton valide a la forme que generateToken() produit — rien d'autre n'atteint la base. */
export function isWellFormedToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Empreinte du propriétaire envoyée par le bot : un HMAC-SHA256 en hexadécimal (64 caractères). */
export function isValidOwnerHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Pourquoi un jeton n'est pas utilisable (null = utilisable). Les trois
 * raisons n'apprennent rien de sensible à celui qui tient le lien.
 */
export function tokenProblem(row, now = Date.now()) {
  if (!row) return 'invalid';
  if (row.usedAt) return 'used';
  if (Number(row.expiresAt) <= now) return 'expired';
  return null;
}

export function buildLinkUrl(appUrl, token) {
  return `${String(appUrl).replace(/\/+$/, '')}/link.html?token=${token}`;
}
