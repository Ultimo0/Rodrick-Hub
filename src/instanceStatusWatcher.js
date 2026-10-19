import { OFFLINE_AFTER_MS } from './config.js';
import { listLinkedInstances, setStatusNotified } from './store/instancesStore.js';
import { createNotification } from './store/notificationsStore.js';
import { sendToUser } from './realtime.js';
import { sendPushToUser } from './push.js';
import { applyStatusCheck } from './utils/instanceStatus.js';

/**
 * instanceStatusWatcher.js
 * ------------------------------------------------------------------
 * Le Hub ne SAIT pas qu'un bot est tombé : il constate seulement qu'il
 * n'a plus de nouvelles (voir OFFLINE_AFTER_MS). "Hors ligne" n'était
 * jusqu'ici calculé qu'au moment d'afficher une liste — aucun événement
 * n'existait donc pour prévenir quelqu'un. Toutes les minutes, ce module
 * compare l'état actuel de chaque bot LIÉ À UN COMPTE au dernier état pour
 * lequel on a déjà prévenu, et ne notifie que lorsqu'il a CHANGÉ (la
 * logique de décision est dans src/utils/instanceStatus.js).
 * ------------------------------------------------------------------
 */

const CHECK_INTERVAL_MS = 60 * 1000;

const defaultDeps = { listLinkedInstances, setStatusNotified, createNotification, sendToUser, sendPushToUser };

export function runStatusCheck({ now = Date.now(), suppressOffline = false, offlineAfterMs = OFFLINE_AFTER_MS, deps = defaultDeps } = {}) {
  return applyStatusCheck({ now, offlineAfterMs, suppressOffline, deps });
}

export function startInstanceStatusWatcher({ intervalMs = CHECK_INTERVAL_MS } = {}) {
  const startedAt = Date.now();

  const tick = () => {
    const suppressOffline = Date.now() - startedAt < OFFLINE_AFTER_MS + intervalMs;
    runStatusCheck({ suppressOffline }).catch((err) => console.error('Échec de la vérification des états :', err));
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
