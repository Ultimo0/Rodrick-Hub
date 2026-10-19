import { pool } from '../db.js';

export const SECTIONS = ['releases', 'community', 'inbox'];

/** Renvoie { releases, community, inbox } (timestamp ou 0) pour ce compte. */
export async function getSeenMap(userId) {
  const { rows } = await pool.query('SELECT section, "lastSeenAt" FROM user_seen WHERE "userId" = $1', [userId]);

  const map = { releases: 0, community: 0, inbox: 0 };
  for (const row of rows) map[row.section] = row.lastSeenAt;
  return map;
}

export async function markSeen(userId, section) {
  if (!SECTIONS.includes(section)) throw new Error(`Section inconnue : ${section}`);

  await pool.query(
    `INSERT INTO user_seen ("userId", section, "lastSeenAt")
     VALUES ($1, $2, $3)
     ON CONFLICT ("userId", section) DO UPDATE SET "lastSeenAt" = $3`,
    [userId, section, Date.now()]
  );
}

// ---------------------------------------------------------------------
// Historique de la cloche (table "notifications", voir src/db.js)
// ---------------------------------------------------------------------

/** Nombre de notifications montrées dans le panneau de la cloche. */
export const BELL_LIMIT = 3;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Enregistre une notification. userId = null → pour tout le monde.
 * Les entrées de plus de 30 jours sont purgées au passage (au plus une
 * fois par appel, sur un index) : pas besoin d'une tâche planifiée de plus.
 */
export async function createNotification({ userId = null, type, title, body = null, link = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications ("userId", type, title, body, link, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, "userId", type, title, body, link, "createdAt"`,
    [userId, type, title, body, link, Date.now()]
  );
  pool.query('DELETE FROM notifications WHERE "createdAt" < $1', [Date.now() - RETENTION_MS]).catch(() => {});
  return rows[0];
}

/** Les `limit` dernières notifications visibles par ce compte (les siennes + celles pour tout le monde). */
export async function listLatestNotifications(userId, limit = BELL_LIMIT) {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, link, "createdAt"
       FROM notifications
      WHERE "userId" = $1 OR "userId" IS NULL
      ORDER BY "createdAt" DESC, id DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows.map((row) => ({ ...row, createdAt: Number(row.createdAt) }));
}

/** Notifications plus récentes que la dernière ouverture de la cloche par ce compte. */
export async function countUnreadNotifications(userId) {
  const { inbox } = await getSeenMap(userId);

  // Jamais ouvert la cloche : on compte à partir de la création du compte,
  // sinon un tout nouveau compte verrait d'emblée un badge pour des
  // notifications publiées des semaines avant son inscription.
  let since = inbox;
  if (!since) {
    const { rows: users } = await pool.query('SELECT "createdAt" FROM users WHERE id = $1', [userId]);
    since = Number(users[0]?.createdAt) || 0;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM notifications
      WHERE ("userId" = $1 OR "userId" IS NULL) AND "createdAt" > $2`,
    [userId, since]
  );
  return rows[0].count;
}
