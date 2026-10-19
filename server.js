import 'dotenv/config';
import http from 'http';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { PORT, PUBLIC_DIR, SESSION_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, VAPID_PUBLIC_KEY, HEARTBEAT_RETENTION_MS, ERROR_REPORT_RETENTION_MS, warnIfMisconfigured } from './src/config.js';
import { pool, pruneOldHeartbeats, pruneOldErrorReports } from './src/db.js';
import { instancesRouter } from './src/routes/instances.js';
import { errorReportsRouter } from './src/routes/errorReports.js';
import { releasesRouter } from './src/routes/releases.js';
import { commandsRouter } from './src/routes/commands.js';
import { authRouter } from './src/routes/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { postsRouter } from './src/routes/posts.js';
import { statsRouter } from './src/routes/stats.js';
import { profileRouter } from './src/routes/profile.js';
import { notificationsRouter } from './src/routes/notifications.js';
import { linkRouter } from './src/routes/link.js';
import { pushRouter } from './src/routes/push.js';
import { initRealtime } from './src/realtime.js';
import { startInstanceStatusWatcher } from './src/instanceStatusWatcher.js';

warnIfMisconfigured();

const app = express();

// Nécessaire derrière un reverse proxy qui termine le HTTPS (Render,
// Railway, Fly.io...) : sans ça, Express voit toujours la requête en HTTP
// "en interne" (le proxy la lui transmet ainsi), et ne peut donc jamais
// savoir que la connexion d'origine était bien chiffrée — ce qui casse
// silencieusement cookie.secure ci-dessous (le cookie ne serait alors
// jamais envoyé au navigateur).
app.set('trust proxy', 1);

// helmet ajoute d'un coup un ensemble d'en-têtes de sécurité HTTP
// standards (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
// HSTS...) et retire X-Powered-By (qui annonçait "Express" à quiconque
// inspectait les en-têtes, une information interne inutile à exposer).
// contentSecurityPolicy: false — DÉSACTIVÉ pour l'instant : la CSP par
// défaut de helmet bloquerait le petit script inline utilisé dans le
// <head> de chaque page (Cloudinary/nav.js ont besoin d'appeler des
// domaines externes, et certaines pages exécutent un court script inline
// avant affichage). L'activer correctement demanderait de passer ces
// pages par un moteur de rendu côté serveur (pour générer un nonce
// différent à chaque requête) — un changement d'architecture plus large
// que ce correctif.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json());

const PgSession = connectPgSimple(session);
const sessionSecret = SESSION_SECRET || 'valeur-par-defaut-non-securisee-a-changer';
const sessionStore = new PgSession({ pool, createTableIfMissing: true, tableName: 'session' });

// express-session doit être branché AVANT les routes qui en ont besoin
// (req.session n'existe que grâce à ce middleware). "resave: false" et
// "saveUninitialized: false" sont les réglages recommandés par défaut :
// ils évitent de sauvegarder des sessions vides ou inchangées à chaque
// requête.
//
// store: les sessions vivent dans Postgres (table "session", créée
// automatiquement au démarrage grâce à createTableIfMissing) plutôt qu'en
// mémoire du process — sans ça (MemoryStore, le défaut d'express-session),
// tout le monde serait déconnecté à chaque redémarrage du service, et la
// mémoire grossirait indéfiniment tant que le process tourne.
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours avant déconnexion automatique
    // secure: seulement en production (Render définit NODE_ENV=production
    // automatiquement) — jamais en local, où le serveur tourne en http://
    // simple sans TLS, et où un cookie "secure" ne serait jamais envoyé
    // par le navigateur (rendant la connexion impossible en dev).
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // déjà la valeur par défaut d'express-session, explicité pour que ce soit visible sans avoir à vérifier la doc
    sameSite: 'lax',
  },
}));

app.use(express.static(PUBLIC_DIR));

// Toutes les routes de src/routes/instances.js deviennent accessibles sous
// /api/... (ex: /api/heartbeat, /api/instances).
app.use('/api', instancesRouter);
app.use('/api', releasesRouter);
app.use('/api', commandsRouter);
app.use('/api', authRouter);
// Monté sur son propre préfixe '/api/admin' (pas '/api' comme les autres
// routers) — voir le commentaire dans src/routes/admin.js pour la raison :
// sinon requireAuth/requireAdmin (branchés via router.use() dans ce
// fichier) intercepteraient AUSSI les requêtes destinées à postsRouter,
// statsRouter, etc., montés juste après.
app.use('/api/admin', adminRouter);
app.use('/api', postsRouter);
app.use('/api', statsRouter);
app.use('/api', profileRouter);
app.use('/api', notificationsRouter);
app.use('/api', linkRouter);
app.use('/api', pushRouter);
app.use('/api', errorReportsRouter);

// Publique et volontairement sans authentification : ces valeurs ne sont
// pas des secrets (voir les commentaires sur CLOUDINARY_CLOUD_NAME et
// VAPID_PUBLIC_KEY dans src/config.js) — le navigateur en a besoin pour
// uploader une photo de profil directement vers Cloudinary, et pour
// s'abonner aux notifications push, dans les deux cas sans jamais passer
// par une clé secrète côté client.
app.get('/api/config', (req, res) => {
  res.json({
    cloudinaryCloudName: CLOUDINARY_CLOUD_NAME,
    cloudinaryUploadPreset: CLOUDINARY_UPLOAD_PRESET,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });
});

// Middleware d'erreur global — reçoit tout ce que ah() (src/utils/asyncHandler.js)
// redirige avec next(err), typiquement une requête Postgres qui échoue
// (connexion perdue, contrainte violée...). DOIT être déclaré après toutes
// les routes : Express reconnaît un middleware d'erreur au fait qu'il a
// 4 paramètres (err, req, res, next), peu importe où il est dans le fichier,
// mais il ne s'applique qu'aux routes déclarées AVANT lui.
app.use((err, req, res, next) => {
  console.error('Erreur non gérée sur une route :', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// On crée le serveur HTTP nous-mêmes (au lieu du simple app.listen()
// habituel) pour pouvoir y attacher le serveur WebSocket EN PLUS
// d'Express — les deux partagent le même port, distingués automatiquement
// par le protocole de la requête (http:// classique vs ws://).
const httpServer = http.createServer(app);
initRealtime(httpServer, { sessionStore, sessionSecret });

httpServer.listen(PORT, () => {
  console.log(`Rodrick Hub en écoute sur le port ${PORT} (HTTP + WebSocket)`);
});

// Purge des heartbeats trop anciens (voir pruneOldHeartbeats dans
// src/db.js pour le raisonnement complet). Une fois au démarrage — utile
// si le service reste éteint plusieurs jours puis redémarre — puis toutes
// les 24h tant que le process tourne. Une simple erreur ici (ex: base de
// données momentanément injoignable) ne doit jamais faire planter le
// serveur : elle est seulement loguée, la prochaine tentative aura lieu
// au prochain intervalle.
async function runHeartbeatCleanup() {
  try {
    const deleted = await pruneOldHeartbeats(HEARTBEAT_RETENTION_MS);
    if (deleted > 0) console.log(`🧹 ${deleted} entrées de heartbeat_log de plus de 90 jours supprimées.`);
  } catch (err) {
    console.error('Échec de la purge de heartbeat_log :', err);
  }
}

runHeartbeatCleanup();
setInterval(runHeartbeatCleanup, 24 * 60 * 60 * 1000);

// Même principe que runHeartbeatCleanup ci-dessus : purge non bloquante,
// une erreur ici (base momentanément injoignable) ne doit jamais faire
// planter le serveur — seulement loguée, prochaine tentative au prochain
// intervalle.
async function runErrorReportCleanup() {
  try {
    const deleted = await pruneOldErrorReports(ERROR_REPORT_RETENTION_MS);
    if (deleted > 0) console.log(`🧹 ${deleted} rapport(s) d'erreur de plus de 30 jours supprimé(s).`);
  } catch (err) {
    console.error('Échec de la purge de error_reports :', err);
  }
}

runErrorReportCleanup();
setInterval(runErrorReportCleanup, 24 * 60 * 60 * 1000);

// Prévient les propriétaires (cloche + push) quand l'un de leurs bots passe
// hors ligne ou revient — voir src/instanceStatusWatcher.js.
startInstanceStatusWatcher();
