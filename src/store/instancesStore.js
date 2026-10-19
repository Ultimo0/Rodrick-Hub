import { pool } from '../db.js';

// Postgres n'a pas de type "objet" ni de vrai booléen : commandStats est
// stocké en texte JSON, enabled en 0/1. rowToInstance() reconstruit la
// forme JS habituelle à la lecture, pour que le reste du code (les
// routes) ne voie jamais la différence.
function rowToInstance(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    commandStats: row.commandStats ? JSON.parse(row.commandStats) : {},
    // NULL = jamais tenté depuis le démarrage du bot — distinct de false
    // (dernière tentative échouée) ou true (réussie), donc pas un simple
    // Boolean() comme pour "enabled" qui, lui, n'est jamais NULL.
    ytdlpLastRefreshOk: row.ytdlpLastRefreshOk === null ? null : Boolean(row.ytdlpLastRefreshOk),
    activeFeatures: row.activeFeatures ? JSON.parse(row.activeFeatures) : null,
    remoteConfig: row.remoteConfig ? JSON.parse(row.remoteConfig) : null,
  };
}

/** Renvoie un objet { instanceId: instance }, exactement comme avant. */
export async function loadInstances() {
  const { rows } = await pool.query('SELECT * FROM instances');
  const instances = {};
  for (const row of rows) instances[row.instanceId] = rowToInstance(row);
  return instances;
}

/** Enregistre les seuls champs provenant du bot, sans écraser les champs Hub. */
export async function upsertHeartbeat(inst) {
  const { rows } = await pool.query(
    `INSERT INTO instances
       ("instanceId", "ownerName", "botName", "version", "uptimeSeconds", "messageCount",
        "commandStats", "mode", "prefix", "nodeVersion", "lastSeen",
        "reconnectCount", "lastDisconnectCode", "lastDisconnectAt",
        "ytdlpLastRefreshAt", "ytdlpLastRefreshOk", "ytdlpVersion",
        "groupCount", "activeFeatures", "appliedConfigVersion", "ownerHash")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT ("instanceId") DO UPDATE SET
       "ownerName" = EXCLUDED."ownerName",
       "botName" = EXCLUDED."botName",
       "version" = EXCLUDED."version",
       "uptimeSeconds" = EXCLUDED."uptimeSeconds",
       "messageCount" = EXCLUDED."messageCount",
       "commandStats" = EXCLUDED."commandStats",
       "mode" = EXCLUDED."mode",
       "prefix" = EXCLUDED."prefix",
       "nodeVersion" = EXCLUDED."nodeVersion",
       "lastSeen" = EXCLUDED."lastSeen",
       "reconnectCount" = EXCLUDED."reconnectCount",
       "lastDisconnectCode" = EXCLUDED."lastDisconnectCode",
       "lastDisconnectAt" = EXCLUDED."lastDisconnectAt",
       "ytdlpLastRefreshAt" = EXCLUDED."ytdlpLastRefreshAt",
       "ytdlpLastRefreshOk" = EXCLUDED."ytdlpLastRefreshOk",
       "ytdlpVersion" = EXCLUDED."ytdlpVersion",
       "groupCount" = EXCLUDED."groupCount",
       "activeFeatures" = EXCLUDED."activeFeatures",
       "appliedConfigVersion" = EXCLUDED."appliedConfigVersion",
       -- Un bot pas encore mis à jour n'envoie pas d'empreinte : on garde l'ancienne.
       "ownerHash" = COALESCE(EXCLUDED."ownerHash", instances."ownerHash")
     RETURNING *`,
    [
      inst.instanceId, inst.ownerName, inst.botName, inst.version,
      inst.uptimeSeconds, inst.messageCount, JSON.stringify(inst.commandStats || {}),
      inst.mode, inst.prefix, inst.nodeVersion, inst.lastSeen,
      inst.reconnectCount, inst.lastDisconnectCode, inst.lastDisconnectAt,
      inst.ytdlpLastRefreshAt,
      inst.ytdlpLastRefreshOk === null || inst.ytdlpLastRefreshOk === undefined
        ? null
        : (inst.ytdlpLastRefreshOk ? 1 : 0),
      inst.ytdlpVersion, inst.groupCount,
      inst.activeFeatures ? JSON.stringify(inst.activeFeatures) : null,
      inst.appliedConfigVersion,
      inst.ownerHash ?? null,
    ]
  );
  return rowToInstance(rows[0]);
}

export async function updateInstanceConfig(instanceId, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      'SELECT "remoteConfig", "configVersion" FROM instances WHERE "instanceId" = $1 FOR UPDATE',
      [instanceId]
    );
    if (!currentRows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentConfig = currentRows[0].remoteConfig ? JSON.parse(currentRows[0].remoteConfig) : {};
    const mergedConfig = { ...currentConfig, ...values };
    const { rows } = await client.query(
      `UPDATE instances
       SET "remoteConfig" = $1, "configVersion" = "configVersion" + 1
       WHERE "instanceId" = $2
       RETURNING *`,
      [JSON.stringify(mergedConfig), instanceId]
    );

    await client.query('COMMIT');
    return rowToInstance(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateInstanceEnabled(instanceId, enabled) {
  const { rows } = await pool.query(
    'UPDATE instances SET "enabled" = $1 WHERE "instanceId" = $2 RETURNING *',
    [enabled ? 1 : 0, instanceId]
  );
  return rows[0] ? rowToInstance(rows[0]) : null;
}

export async function deleteInstance(instanceId) {
  const { rows } = await pool.query(
    'DELETE FROM instances WHERE "instanceId" = $1 RETURNING "instanceId"',
    [instanceId]
  );
  return rows.length > 0;
}

/**
 * Ceci AJOUTE une ligne à chaque appel — c'est cet historique qui permet
 * de tracer une vraie courbe d'activité dans le temps (voir statsStore.js),
 * plutôt qu'une simple photo de l'instant présent.
 */
export async function logHeartbeat(instanceId, messageCount) {
  await pool.query(
    `INSERT INTO heartbeat_log ("instanceId", "messageCount", "timestamp") VALUES ($1, $2, $3)`,
    [instanceId, messageCount ?? null, Date.now()]
  );
}

/** Les bots rattachés à ce compte — uniquement les champs utiles à son propre tableau de bord. */
export async function listInstancesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT "instanceId", "botName", "ownerName", "version", "lastSeen", "uptimeSeconds", "enabled"
       FROM instances WHERE "userId" = $1
      ORDER BY "botName", "instanceId"`,
    [userId]
  );
  return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled), lastSeen: Number(row.lastSeen) || 0 }));
}

/** Toutes les instances rattachées à un compte (pour la surveillance des changements d'état). */
export async function listLinkedInstances() {
  const { rows } = await pool.query(
    `SELECT "instanceId", "userId", "botName", "ownerName", "lastSeen", "statusNotified"
       FROM instances WHERE "userId" IS NOT NULL`
  );
  return rows;
}

export async function setStatusNotified(instanceId, status) {
  await pool.query('UPDATE instances SET "statusNotified" = $2 WHERE "instanceId" = $1', [instanceId, status]);
}
