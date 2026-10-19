import { pool } from '../db.js';
import { createNotification } from './notificationsStore.js';
import {
  LINK_TOKEN_TTL_MS,
  generateToken,
  hashToken,
  isWellFormedToken,
  tokenProblem,
} from '../utils/linkToken.js';

/**
 * linkStore.js
 * ------------------------------------------------------------------
 * Rattachement d'un bot (une instance) au compte de son propriétaire,
 * SANS que celui-ci ait à saisir un numéro ni un code :
 *
 *   1. le bot demande un lien d'invitation (createInvite) et l'envoie par
 *      WhatsApp au propriétaire — le seul à pouvoir le lire ;
 *   2. le propriétaire ouvre le lien, se connecte et confirme (claimToken) ;
 *   3. l'empreinte de son numéro est alors "prouvée" : tous ses autres bots,
 *      présents ou futurs, sont reliés d'office (autoLinkVerifiedOwner).
 *
 * Aucun numéro n'est jamais stocké : le bot envoie seulement une empreinte
 * (voir utils/linkToken.js::isValidOwnerHash).
 * ------------------------------------------------------------------
 */

/** État renvoyé au bot dans la réponse du heartbeat. */
export function linkStateOf(instance) {
  return { linked: instance.userId != null, inviteSent: instance.linkInviteSentAt != null };
}

/**
 * Relie d'office une instance dont le propriétaire a déjà été prouvé.
 * Retourne l'identifiant du compte si elle vient d'être reliée, sinon null.
 * Ne touche jamais une instance déjà reliée (UPDATE ... WHERE "userId" IS NULL).
 */
export async function autoLinkVerifiedOwner(instanceId, ownerHash) {
  if (!ownerHash) return null;

  const { rows } = await pool.query(
    `UPDATE instances SET "userId" = h."userId"
       FROM user_owner_hashes h
      WHERE instances."instanceId" = $1 AND instances."userId" IS NULL AND h."ownerHash" = $2
      RETURNING instances."userId", instances."botName", instances."ownerName"`,
    [instanceId, ownerHash]
  );
  if (!rows[0]) return null;

  await notifyLinked(rows[0].userId, [rows[0]]);
  return rows[0].userId;
}

async function notifyLinked(userId, bots) {
  const names = bots.map((bot) => (bot.ownerName ? `${bot.botName || 'RodrickBOT'} (${bot.ownerName})` : bot.botName || 'RodrickBOT'));
  await createNotification({
    userId,
    type: 'bot-linked',
    title: bots.length > 1 ? 'Bots reliés à ton compte' : 'Bot relié à ton compte',
    body: bots.length > 1 ? `${names.join(', ')} sont maintenant reliés.` : `${names[0]} est maintenant relié.`,
    link: '/index.html',
  });
}

/**
 * Crée le lien d'invitation d'une instance. Remplace tout jeton non utilisé
 * encore en circulation pour cette instance (un seul lien valide à la fois).
 * Retourne { linked: true } si l'instance est déjà reliée.
 */
export async function createInvite({ instanceId, ownerHash }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT "userId" FROM instances WHERE "instanceId" = $1 FOR UPDATE', [instanceId]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return { error: 'unknown-instance' };
    }
    if (rows[0].userId != null) {
      await client.query('ROLLBACK');
      return { linked: true };
    }

    const now = Date.now();
    const token = generateToken();
    await client.query('DELETE FROM link_tokens WHERE "instanceId" = $1 AND "usedAt" IS NULL', [instanceId]);
    await client.query(
      `INSERT INTO link_tokens ("tokenHash", "instanceId", "ownerHash", "createdAt", "expiresAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [hashToken(token), instanceId, ownerHash, now, now + LINK_TOKEN_TTL_MS]
    );
    await client.query('UPDATE instances SET "linkInviteSentAt" = $2, "ownerHash" = $3 WHERE "instanceId" = $1', [instanceId, now, ownerHash]);

    await client.query('COMMIT');
    return { token, expiresAt: now + LINK_TOKEN_TTL_MS };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Ce que la page du lien montre AVANT confirmation (jeton non consommé). */
export async function previewToken(token) {
  if (!isWellFormedToken(token)) return { valid: false, reason: 'invalid' };

  const { rows } = await pool.query(
    `SELECT t."usedAt", t."expiresAt", i."botName", i."ownerName"
       FROM link_tokens t JOIN instances i ON i."instanceId" = t."instanceId"
      WHERE t."tokenHash" = $1`,
    [hashToken(token)]
  );
  const problem = tokenProblem(rows[0]);
  if (problem) return { valid: false, reason: problem };

  return { valid: true, botName: rows[0].botName, ownerName: rows[0].ownerName };
}

/**
 * Confirme le lien pour ce compte, en une seule transaction : jeton consommé,
 * instance reliée, propriétaire prouvé, autres bots du même propriétaire
 * reliés d'office. Retourne { ok: true, bots: [...] } ou { ok: false, reason }.
 */
export async function claimToken(token, userId) {
  if (!isWellFormedToken(token)) return { ok: false, reason: 'invalid' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT "tokenHash", "instanceId", "ownerHash", "usedAt", "expiresAt" FROM link_tokens WHERE "tokenHash" = $1 FOR UPDATE',
      [hashToken(token)]
    );
    const problem = tokenProblem(rows[0]);
    if (problem) {
      await client.query('ROLLBACK');
      return { ok: false, reason: problem };
    }
    const { instanceId, ownerHash } = rows[0];

    // Ce propriétaire est déjà prouvé pour un AUTRE compte : on ne le vole pas.
    const owner = await client.query('SELECT "userId" FROM user_owner_hashes WHERE "ownerHash" = $1', [ownerHash]);
    if (owner.rows[0] && owner.rows[0].userId !== userId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'owner-taken' };
    }

    const instance = await client.query('SELECT "userId" FROM instances WHERE "instanceId" = $1 FOR UPDATE', [instanceId]);
    if (instance.rows[0].userId != null && instance.rows[0].userId !== userId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already-linked' };
    }

    const now = Date.now();
    await client.query(
      `INSERT INTO user_owner_hashes ("ownerHash", "userId", "verifiedAt") VALUES ($1, $2, $3)
       ON CONFLICT ("ownerHash") DO NOTHING`,
      [ownerHash, userId, now]
    );
    await client.query('UPDATE link_tokens SET "usedAt" = $2 WHERE "tokenHash" = $1', [rows[0].tokenHash, now]);

    // L'instance du jeton, puis tous les autres bots du même propriétaire.
    const linked = await client.query(
      `UPDATE instances SET "userId" = $1
        WHERE ("instanceId" = $2 OR "ownerHash" = $3) AND ("userId" IS NULL OR "instanceId" = $2)
        RETURNING "instanceId", "botName", "ownerName"`,
      [userId, instanceId, ownerHash]
    );

    await client.query('COMMIT');

    await notifyLinked(userId, linked.rows).catch(() => {});
    return { ok: true, bots: linked.rows.map((bot) => ({ botName: bot.botName, ownerName: bot.ownerName })) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
