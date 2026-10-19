import webpush from 'web-push';
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL } from './config.js';
import { listSubscriptions, listSubscriptionsForUser, removeSubscriptionByEndpoint } from './store/pushStore.js';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;

  webpush.setVapidDetails(
    `mailto:${VAPID_CONTACT_EMAIL || 'contact@example.com'}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

/**
 * Envoie payload (un objet simple — { title, body, url }) à TOUS les
 * appareils actuellement abonnés. Chaque envoi est indépendant : l'échec
 * d'un abonné ne doit jamais empêcher les autres de recevoir la
 * notification (Promise.allSettled plutôt que Promise.all).
 *
 * Un code 404/410 signifie que cet abonnement n'existe plus côté
 * navigateur (désinstallation, permission révoquée, cache navigateur
 * effacé...) — dans ce cas on le supprime nous-mêmes de la base, sinon on
 * continuerait à essayer de lui envoyer des notifications indéfiniment.
 */
async function deliver(subscriptions, payload) {
  if (!subscriptions.length) return;

  const body = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeSubscriptionByEndpoint(sub.endpoint);
        } else {
          console.error('Échec envoi push à', sub.endpoint, ':', err.statusCode || err.message);
        }
      }
    })
  );
}

export async function sendPushToAll(payload) {
  if (!ensureConfigured()) {
    console.warn('⚠️  VAPID non configuré — notification push ignorée (voir DEPLOY.md).');
    return;
  }
  await deliver(await listSubscriptions(), payload);
}

/** Comme sendPushToAll, mais uniquement vers les appareils abonnés de CE compte (ex: l'un de ses bots est hors ligne). */
export async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) return;
  await deliver(await listSubscriptionsForUser(userId), payload);
}
