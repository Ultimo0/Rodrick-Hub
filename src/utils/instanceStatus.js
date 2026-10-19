/**
 * instanceStatus.js
 * ------------------------------------------------------------------
 * Logique PURE de la surveillance d'état des bots (aucun accès base ni
 * réseau : tout ce dont elle a besoin lui est passé en paramètre). Séparée
 * de src/instanceStatusWatcher.js — qui, lui, branche la base, le temps
 * réel et le push — pour pouvoir être testée sans base de données.
 * ------------------------------------------------------------------
 */

export function instanceStatus(lastSeen, now, offlineAfterMs) {
  return now - Number(lastSeen) < offlineAfterMs ? 'online' : 'offline';
}

/**
 * Décide quoi faire pour chaque instance liée à un compte. Retourne
 * [{ instance, status, notify }] — uniquement les instances dont l'état a
 * CHANGÉ depuis le dernier état enregistré (statusNotified).
 *
 * Deux garde-fous contre les fausses alertes :
 *  - première observation (statusNotified = NULL) : l'état est enregistré
 *    SANS prévenir (sinon lier un bot déclencherait une alerte sans objet) ;
 *  - suppressOffline : après un (re)démarrage du Hub, on retient les alertes
 *    "hors ligne" le temps que les bots aient pu renvoyer un heartbeat. Si
 *    le Hub vient de dormir ou de perdre sa base, TOUS les bots paraîtraient
 *    hors ligne d'un coup alors que ce n'est pas leur faute.
 */
export function computeStatusTransitions(instances, now, offlineAfterMs, { suppressOffline = false } = {}) {
  const transitions = [];

  for (const instance of instances) {
    const status = instanceStatus(instance.lastSeen, now, offlineAfterMs);
    if (instance.statusNotified === status) continue;
    if (status === 'offline' && suppressOffline) continue;

    transitions.push({ instance, status, notify: instance.statusNotified != null });
  }

  return transitions;
}

export function describeTransition(instance, status) {
  const label = instance.ownerName ? `${instance.botName || 'Ton bot'} (${instance.ownerName})` : (instance.botName || 'Ton bot');

  if (status === 'offline') {
    return { type: 'bot-offline', title: 'Bot hors ligne', body: `${label} ne répond plus.`, link: '/index.html' };
  }
  return { type: 'bot-online', title: 'Bot de retour en ligne', body: `${label} est de nouveau en ligne.`, link: '/index.html' };
}

/**
 * Applique les changements d'état : enregistre, crée la notification, puis
 * la diffuse. `deps` = { listLinkedInstances, setStatusNotified,
 * createNotification, sendToUser, sendPushToUser }. Retourne le nombre
 * d'instances dont l'état a changé.
 */
export async function applyStatusCheck({ now, offlineAfterMs, suppressOffline = false, deps }) {
  const instances = await deps.listLinkedInstances();
  const transitions = computeStatusTransitions(instances, now, offlineAfterMs, { suppressOffline });

  for (const { instance, status, notify } of transitions) {
    try {
      // L'état est enregistré D'ABORD : si la suite échoue, on ne renverra
      // pas la même alerte toutes les minutes.
      await deps.setStatusNotified(instance.instanceId, status);
      if (!notify) continue;

      const content = describeTransition(instance, status);
      const notification = await deps.createNotification({ userId: instance.userId, ...content });
      await deps.sendToUser(instance.userId, { type: 'notification', notification });
      await deps.sendPushToUser(instance.userId, { title: content.title, body: content.body, url: content.link });
    } catch (err) {
      console.error(`Échec notification d'état (${instance.instanceId}) :`, err);
    }
  }

  return transitions.length;
}
