import { pool } from '../db.js';

export async function addSubscription(userId, { endpoint, keys }) {
  // ON CONFLICT plutôt qu'un DELETE+INSERT séparé : si cette personne
  // s'était déjà abonnée depuis cet appareil (endpoint déjà connu), on
  // met juste à jour ses clés au lieu d'échouer sur la contrainte UNIQUE
  // — un navigateur peut renouveler les clés d'un abonnement existant
  // sans changer d'endpoint.
  await pool.query(
    `INSERT INTO push_subscriptions ("userId", endpoint, p256dh, auth, "createdAt")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = $3, auth = $4, "userId" = $1`,
    [userId, endpoint, keys.p256dh, keys.auth, Date.now()]
  );
}

export async function removeSubscriptionByEndpoint(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function removeUserSubscription(userId, endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE "userId" = $1 AND endpoint = $2', [userId, endpoint]);
}

export async function listSubscriptions() {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions');
  return rows;
}

export async function listSubscriptionsForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE "userId" = $1', [userId]);
  return rows;
}

export async function hasSubscription(userId, endpoint) {
  const { rows } = await pool.query(
    'SELECT 1 FROM push_subscriptions WHERE "userId" = $1 AND endpoint = $2',
    [userId, endpoint]
  );
  return rows.length > 0;
}
