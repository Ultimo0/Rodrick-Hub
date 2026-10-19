import { WebSocketServer } from 'ws';
import { findUserById } from './store/usersStore.js';
import { sessionIdFromCookieHeader } from './utils/sessionCookie.js';

/**
 * realtime.js
 * ------------------------------------------------------------------
 * Une connexion WebSocket, contrairement à une requête HTTP classique,
 * reste OUVERTE : le serveur peut envoyer des messages au navigateur à
 * tout moment, sans que celui-ci ait besoin de redemander quoi que ce
 * soit. C'est exactement l'inverse du principe utilisé partout ailleurs
 * dans ce projet jusqu'ici (fetch() = le navigateur demande, le serveur
 * répond une fois, puis la connexion se referme).
 *
 * On garde ici la liste de tous les navigateurs actuellement connectés,
 * pour pouvoir leur envoyer un message à tous en même temps (broadcast()).
 * ------------------------------------------------------------------
 */

let wss = null;
let adminSessionContext = null;

function getStoredSession(sessionStore, sessionId) {
  return new Promise((resolve, reject) => {
    sessionStore.get(sessionId, (error, storedSession) => {
      if (error) reject(error);
      else resolve(storedSession || null);
    });
  });
}

/** À appeler une seule fois, avec le serveur HTTP et le store de sessions. */
export function initRealtime(httpServer, { sessionStore, sessionSecret }) {
  adminSessionContext = { sessionStore, sessionSecret };
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket, request) => {
    socket.on('error', () => {}); // évite qu'une erreur de socket fasse planter le process

    const sessionId = sessionIdFromCookieHeader(request.headers.cookie, sessionSecret);
    if (!sessionId || !sessionStore) return;

    sessionStore.get(sessionId, (error, storedSession) => {
      if (error || !storedSession?.userId) return;
      socket.sessionId = sessionId;
      socket.sessionUserId = storedSession.userId;
    });
  });
}

/**
 * Envoie un événement à TOUS les navigateurs connectés en même temps.
 * `event` doit être un objet simple (converti en JSON) — ex:
 * broadcast({ type: 'new-post', post }).
 */
export function broadcast(event) {
  if (!wss) return; // initRealtime() pas encore appelé (ne devrait pas arriver, sécurité par défaut)

  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    // readyState 1 = OPEN — inutile d'essayer d'envoyer à une connexion
    // en train de se fermer ou déjà fermée.
    if (client.readyState === 1) client.send(payload);
  }
}

/**
 * Diffuse un signal aux sessions admin encore valides au moment de l'envoi.
 * La session et le rôle sont relus à chaque signal : une déconnexion ou une
 * rétrogradation prend ainsi effet sans attendre la fermeture du WebSocket.
 */
export async function broadcastToAdmins(event) {
  if (!wss || !adminSessionContext?.sessionStore) return;

  const payload = JSON.stringify(event);
  await Promise.all([...wss.clients].map(async (client) => {
    if (client.readyState !== 1 || !client.sessionId || !client.sessionUserId) return;

    try {
      const storedSession = await getStoredSession(adminSessionContext.sessionStore, client.sessionId);
      if (!storedSession || String(storedSession.userId) !== String(client.sessionUserId)) return;

      const user = await findUserById(client.sessionUserId);
      if (user?.role === 'admin' && client.readyState === 1) client.send(payload);
    } catch {
      // Une panne de session ou de base ne doit ni faire échouer le heartbeat,
      // ni envoyer un événement privé sans avoir pu revalider les droits.
    }
  }));
}

/**
 * Envoie un événement uniquement aux onglets ouverts par ce compte.
 * Comme broadcastToAdmins, la session est relue au moment de l'envoi : une
 * déconnexion prend effet sans attendre la fermeture du WebSocket.
 */
export async function sendToUser(userId, event) {
  if (!wss || !adminSessionContext?.sessionStore) return;

  const payload = JSON.stringify(event);
  await Promise.all([...wss.clients].map(async (client) => {
    if (client.readyState !== 1 || !client.sessionId) return;
    if (String(client.sessionUserId) !== String(userId)) return;

    try {
      const storedSession = await getStoredSession(adminSessionContext.sessionStore, client.sessionId);
      if (!storedSession || String(storedSession.userId) !== String(userId)) return;
      if (client.readyState === 1) client.send(payload);
    } catch {
      // Une panne de session ne doit jamais empêcher le reste du traitement.
    }
  }));
}
