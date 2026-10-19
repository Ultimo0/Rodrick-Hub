import pg from 'pg';
import { DATABASE_URL } from './config.js';

const { Pool, types } = pg;

// Par défaut, pg renvoie les colonnes BIGINT sous forme de CHAÎNES DE
// CARACTÈRES (pas de nombres) — parce qu'un BIGINT peut dépasser la
// limite de précision sûre des nombres JavaScript (Number.MAX_SAFE_INTEGER,
// environ 9 x 10^15). Ici, BIGINT ne sert qu'à stocker des timestamps en
// millisecondes (Date.now()) — bien en dessous de cette limite — donc on
// force pg à les convertir en vrais nombres. Sans ça, des comparaisons
// (a.lastSeen - b.lastSeen) fonctionneraient par coïncidence (JS convertit
// implicitement), mais new Date(row.timestamp) casserait silencieusement
// (une chaîne comme "1699999999999" n'est pas une date ISO valide).
// 20 = OID du type BIGINT dans le catalogue interne de Postgres.
types.setTypeParser(20, (value) => parseInt(value, 10));

/**
 * Un seul Pool, partagé par tout le projet (import { pool } from './db.js'
 * partout où on en a besoin) — le Pool gère lui-même plusieurs connexions
 * simultanées vers Postgres et les réutilise, contrairement à une seule
 * connexion ouverte en permanence comme avec better-sqlite3.
 *
 * ssl: { rejectUnauthorized: false } est la configuration standard
 * recommandée par les fournisseurs de Postgres "serverless" comme Neon —
 * la connexion est bien chiffrée (TLS), on ne vérifie juste pas la chaîne
 * de certificats contre l'autorité racine locale, ce qui évite des erreurs
 * de connexion sur certains environnements sans configuration TLS
 * supplémentaire de leur côté.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * IMPORTANT — Postgres met en minuscules tout identifiant (nom de colonne)
 * qui n'est pas entre guillemets doubles. Comme tout le reste du code
 * utilise des noms de colonnes en camelCase (instanceId, ownerName,
 * createdAt...) et s'attend à les relire tels quels dans les résultats de
 * requête, CHAQUE colonne camelCase est déclarée et référencée entre
 * guillemets doubles ("instanceId") partout dans ce fichier et dans
 * src/store/*.js. Oublier un guillemet quelque part est la source d'erreur
 * la plus probable si tu modifies ce schéma plus tard.
 */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instances (
      "instanceId"    TEXT PRIMARY KEY,
      "ownerName"     TEXT,
      "botName"       TEXT,
      "version"       TEXT,
      "uptimeSeconds" BIGINT,
      "messageCount"  BIGINT,
      "commandStats"  TEXT,    -- objet JS stocké en texte JSON (comme avec SQLite)
      "mode"          TEXT,
      "prefix"        TEXT,
      "nodeVersion"   TEXT,
      "enabled"       INTEGER NOT NULL DEFAULT 1,  -- 0 = false, 1 = true (comme avec SQLite)
      "lastSeen"      BIGINT
    );

    -- Santé de connexion WhatsApp (Phase 1b de la feuille de route),
    -- envoyée par RodrickBOT via core/telemetry.js — voir core/state.js
    -- (recordDisconnect) et core/client.js pour l'origine de ces valeurs.
    -- NULL par défaut : une instance qui n'a jamais eu de coupure depuis
    -- son démarrage (ou un bot pas encore mis à jour vers cette version)
    -- n'a simplement rien à rapporter, ce n'est pas une valeur manquante
    -- anormale.
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "reconnectCount" INTEGER;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "lastDisconnectCode" INTEGER;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "lastDisconnectAt" BIGINT;

    -- État du binaire yt-dlp (Phase 1b-ii), envoyé par RodrickBOT via
    -- core/telemetry.js — voir core/ytdlpStatus.js côté bot.
    -- "ytdlpLastRefreshOk" en INTEGER 0/1/NULL, même convention que
    -- "enabled" plus haut (Postgres n'a pas de vrai booléen ici).
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "ytdlpLastRefreshAt" BIGINT;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "ytdlpLastRefreshOk" INTEGER;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "ytdlpVersion" TEXT;

    -- Comptes agrégés d'usage (Phase 1c), envoyés par RodrickBOT via
    -- core/telemetry.js — voir core/groupSettings.js::getEnabledFeatureCounts
    -- côté bot. "activeFeatures" est un objet JS stocké en texte JSON,
    -- même convention que "commandStats" plus haut : uniquement des
    -- totaux par fonctionnalité (ex: {"antilink":3,"guardian":5}), jamais
    -- de détail par groupe.
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "groupCount" INTEGER;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "activeFeatures" TEXT;

    -- Configuration poussée vers le bot (Phase 1d). "remoteConfig" est la
    -- configuration SOUHAITÉE (objet JS en texte JSON, ex: {"prefix":"?"}),
    -- posée depuis le Hub — distincte de "prefix" plus haut, qui est la
    -- valeur RAPPORTÉE par le bot à chaque heartbeat. "configVersion" est
    -- incrémenté à chaque nouvelle configuration ; "appliedConfigVersion"
    -- est la dernière version traitée par le bot (accusé de réception,
    -- NULL tant qu'un bot pas encore à jour n'en envoie pas).
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "remoteConfig" TEXT;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "configVersion" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "appliedConfigVersion" INTEGER;

    CREATE TABLE IF NOT EXISTS releases (
      id            SERIAL PRIMARY KEY,
      version       TEXT NOT NULL,
      date          TEXT NOT NULL,
      changelog     TEXT,
      "downloadUrl" TEXT
    );

    -- "date" est une date saisie à la main par l'admin (peut être
    -- antidatée) — pas fiable pour détecter "cette version est nouvelle
    -- depuis la dernière visite". "createdAt" est l'horodatage RÉEL de
    -- publication, jamais modifiable, utilisé uniquement pour ça (voir
    -- src/store/releasesStore.js et src/routes/notifications.js).
    ALTER TABLE releases ADD COLUMN IF NOT EXISTS "createdAt" BIGINT;
    -- Rétro-remplissage pour les versions déjà publiées AVANT cette
    -- colonne : on approxime avec leur champ "date" plutôt que de les
    -- laisser à NULL (qui les ferait apparaître comme "infiniment
    -- anciennes", ce qui est le bon comportement ici de toute façon —
    -- mais autant avoir une vraie valeur cohérente avec le tri par date).
    UPDATE releases SET "createdAt" = EXTRACT(EPOCH FROM date::date)::bigint * 1000
      WHERE "createdAt" IS NULL;

    CREATE TABLE IF NOT EXISTS commands (
      name          TEXT PRIMARY KEY,
      aliases       TEXT,   -- tableau JS stocké en texte JSON
      description   TEXT,
      category      TEXT,
      "adminOnly"   INTEGER NOT NULL DEFAULT 0,
      syntax        TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'user',  -- 'user' ou 'admin'
      "createdAt"    BIGINT NOT NULL,
      name           TEXT,
      bio            TEXT,
      "avatarUrl"    TEXT
    );

    -- Migration défensive : sur une base DÉJÀ existante (le Hub tournait
    -- avant l'ajout du profil complet), la table users existe déjà sans
    -- ces deux colonnes — CREATE TABLE IF NOT EXISTS ci-dessus ne les
    -- ajouterait pas puisque la table n'est pas recréée. IF NOT EXISTS
    -- ici rend ces lignes sûres à rejouer à chaque démarrage, y compris
    -- sur une base qui les a déjà (aucune erreur, aucun doublon).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

    -- Pour "mot de passe oublié" (voir src/routes/auth.js) : un jeton à
    -- usage unique et sa date d'expiration. NULL la plupart du temps —
    -- rempli seulement entre une demande de réinitialisation et son
    -- utilisation (ou son expiration).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" BIGINT;

    -- Les emails sont désormais toujours comparés en minuscules côté
    -- application (voir usersStore.js) — cette ligne aligne les comptes
    -- créés AVANT ce changement, pour qu'un compte existant ne se
    -- retrouve pas bloqué par une incohérence de casse. Idempotente :
    -- après le premier passage, plus aucune ligne ne correspond à la
    -- condition, donc plus aucun effet les fois suivantes.
    UPDATE users SET email = lower(email) WHERE email <> lower(email);

    CREATE TABLE IF NOT EXISTS posts (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'publication', -- 'publication' | 'annonce' | 'nouveaute' | 'guide'
      "authorId"  INTEGER NOT NULL REFERENCES users(id),
      "createdAt" BIGINT NOT NULL
    );

    -- Commentaires sur une publication. ON DELETE CASCADE sur "postId" —
    -- supprimer une publication (admin-posts.js) supprime son fil de
    -- discussion, pas de ligne orpheline à nettoyer à la main. Même choix
    -- sur "authorId" que push_subscriptions/user_seen plus bas : supprimer
    -- un compte supprime aussi ce qu'il a écrit ici (cohérent avec la
    -- suppression de compte en libre-service de profile.html).
    CREATE TABLE IF NOT EXISTS post_comments (
      id          SERIAL PRIMARY KEY,
      "postId"    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      "authorId"  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      "createdAt" BIGINT NOT NULL
    );

    -- Une réaction par (publication, compte) — cliquer un émoji déjà posé
    -- le retire, en cliquer un autre le remplace (même principe qu'une
    -- réaction WhatsApp sur un message, pas Slack/Discord où un même
    -- compte peut cumuler plusieurs émojis différents sur un même
    -- message : plus simple à afficher et à raisonner ici). La clé
    -- primaire composite empêche nativement toute deuxième ligne pour la
    -- même personne sur la même publication.
    CREATE TABLE IF NOT EXISTS post_reactions (
      "postId"    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji       TEXT NOT NULL,
      "createdAt" BIGINT NOT NULL,
      PRIMARY KEY ("postId", "userId")
    );

    -- Sans ces deux index, chaque ouverture du fil d'une publication ou
    -- calcul de compteur (postsStore.js::SELECT_BASE) devrait parcourir
    -- TOUTE la table — même raisonnement que posts_author_id_idx plus bas.
    CREATE INDEX IF NOT EXISTS post_comments_post_id_idx ON post_comments ("postId");
    CREATE INDEX IF NOT EXISTS post_reactions_post_id_idx ON post_reactions ("postId");

    -- Contrairement à "instances" (qui ne garde que le DERNIER heartbeat de
    -- chaque instance, écrasé à chaque fois), cette table ajoute une ligne
    -- à CHAQUE heartbeat reçu — un vrai historique, nécessaire pour tracer
    -- une courbe d'activité dans le temps plutôt qu'une simple photo du
    -- moment présent. Purgée périodiquement au-delà de HEARTBEAT_RETENTION_MS
    -- (voir pruneOldHeartbeats plus bas et server.js) pour ne pas grossir
    -- indéfiniment.
    CREATE TABLE IF NOT EXISTS heartbeat_log (
      id             SERIAL PRIMARY KEY,
      "instanceId"   TEXT NOT NULL,
      "messageCount" BIGINT,
      "timestamp"    BIGINT NOT NULL
    );

    -- Sans ces index, chaque requête qui filtre par date (statsStore.js)
    -- ou fait une jointure posts→auteur (postsStore.js) doit parcourir la
    -- table entière ligne par ligne. Sans conséquence au volume actuel,
    -- mais coûterait de plus en plus cher à mesure que ces tables
    -- grossissent — autant les avoir dès maintenant, elles ne coûtent
    -- rien tant que les tables sont petites.
    CREATE INDEX IF NOT EXISTS heartbeat_log_timestamp_idx ON heartbeat_log ("timestamp");
    CREATE INDEX IF NOT EXISTS posts_author_id_idx ON posts ("authorId");

    -- Une ligne par (compte, section) : à quel moment ce compte a-t-il vu
    -- pour la dernière fois "versions" ou "communauté" ? Sert à décider
    -- si le badge de nouveauté doit s'afficher (voir
    -- src/routes/notifications.js) — stocké côté serveur, et non en
    -- localStorage, pour que ça suive la personne d'un appareil à
    -- l'autre, pas seulement sur le navigateur où elle a cliqué.
    CREATE TABLE IF NOT EXISTS user_seen (
      "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      section      TEXT NOT NULL,     -- 'releases' | 'community'
      "lastSeenAt" BIGINT NOT NULL,
      PRIMARY KEY ("userId", section)
    );

    -- Un abonnement par appareil/navigateur (une même personne connectée
    -- sur son téléphone ET son ordinateur a deux lignes ici, une par
    -- "endpoint" — chacun doit recevoir la notification séparément).
    -- endpoint est déjà unique en lui-même (fourni par le navigateur),
    -- UNIQUE évite d'accumuler des doublons si la même personne active la
    -- notification plusieurs fois sur le même appareil.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      "createdAt" BIGINT NOT NULL
    );

    -- Rapports d'erreur anonymisés envoyés par RodrickBOT
    -- (core/telemetry.js::reportError) via POST /api/error-report — voir
    -- src/routes/errorReports.js et src/store/errorReportsStore.js.
    -- UNIQUE (instanceId, errorMessage) : une même erreur sur une même
    -- instance ne crée jamais plus d'une ligne — voir la clause
    -- ON CONFLICT côté errorReportsStore.js (déduplication).
    CREATE TABLE IF NOT EXISTS error_reports (
      id                SERIAL PRIMARY KEY,
      "instanceId"      TEXT NOT NULL,
      "botName"         TEXT,
      "version"         TEXT,
      "nodeVersion"     TEXT,
      "errorMessage"    TEXT NOT NULL,
      "errorStack"      TEXT,
      "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
      "firstSeenAt"     BIGINT NOT NULL,
      "lastSeenAt"      BIGINT NOT NULL,
      UNIQUE ("instanceId", "errorMessage")
    );

    -- Sans cet index, la purge (pruneOldErrorReports) et le tri de
    -- GET /api/error-reports devraient parcourir la table entière — même
    -- raisonnement que heartbeat_log_timestamp_idx ci-dessus.
    CREATE INDEX IF NOT EXISTS error_reports_last_seen_idx ON error_reports ("lastSeenAt");

    -- Rattachement d'une instance (un bot) à un compte du Hub, et dernier
    -- état (online/offline) pour lequel on a déjà prévenu son propriétaire :
    -- c'est ce qui permet de ne notifier QU'UN changement d'état, jamais
    -- chaque minute. NULL = instance pas (encore) liée à un compte.
    -- ON DELETE SET NULL : supprimer un compte détache ses bots, il ne les efface pas.
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "statusNotified" TEXT;
    CREATE INDEX IF NOT EXISTS instances_user_idx ON instances ("userId");

    -- Historique des notifications affichées par la cloche du Hub.
    -- "userId" NULL = notification pour tout le monde (nouvelle version,
    -- nouvelle publication) ; sinon elle ne concerne que ce compte (un de
    -- ses bots passe hors ligne / revient en ligne). Une seule ligne par
    -- événement, pas une par utilisateur : le volume reste minuscule.
    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,   -- 'release' | 'post' | 'bot-online' | 'bot-offline'
      title       TEXT NOT NULL,
      body        TEXT,
      link        TEXT,
      "createdAt" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications ("userId", "createdAt" DESC);

    -- Liaison automatique d'un bot à un compte (voir src/store/linkStore.js).
    -- "ownerHash" : empreinte (HMAC) du numéro du propriétaire, calculée PAR LE
    -- BOT — le Hub ne reçoit ni ne stocke jamais de numéro en clair.
    -- "linkInviteSentAt" : le bot a déjà demandé son lien d'invitation (un seul
    -- envoi automatique par instance ; ensuite c'est la commande !hub).
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "ownerHash" TEXT;
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS "linkInviteSentAt" BIGINT;
    CREATE INDEX IF NOT EXISTS instances_owner_hash_idx ON instances ("ownerHash");

    -- Jetons d'invitation : seul le hash SHA-256 est stocké (une fuite de la
    -- base ne donne aucun lien utilisable). Un jeton = usage unique + expiration.
    CREATE TABLE IF NOT EXISTS link_tokens (
      "tokenHash"  TEXT PRIMARY KEY,
      "instanceId" TEXT NOT NULL REFERENCES instances("instanceId") ON DELETE CASCADE,
      "ownerHash"  TEXT NOT NULL,
      "createdAt"  BIGINT NOT NULL,
      "expiresAt"  BIGINT NOT NULL,
      "usedAt"     BIGINT
    );
    CREATE INDEX IF NOT EXISTS link_tokens_instance_idx ON link_tokens ("instanceId");

    -- Propriétaires déjà PROUVÉS (le jeton reçu sur leur WhatsApp a été utilisé) :
    -- c'est ce qui permet de relier automatiquement leurs autres bots.
    -- Un propriétaire ne peut appartenir qu'à un seul compte (clé primaire).
    CREATE TABLE IF NOT EXISTS user_owner_hashes (
      "ownerHash"  TEXT PRIMARY KEY,
      "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "verifiedAt" BIGINT NOT NULL
    );
  `);
}

/**
 * Supprime les heartbeats plus vieux que HEARTBEAT_RETENTION_MS (90 jours
 * par défaut — voir src/config.js). Pourquoi une purge plutôt qu'une
 * agrégation en résumés quotidiens : aujourd'hui, TOUTES les vues
 * statistiques du Hub (statsStore.js) ne consultent jamais plus de 30
 * jours d'historique — garder 90 jours de détail brut laisse donc une
 * bonne marge sans jamais couper une fenêtre réellement affichée à
 * l'écran, pour un coût d'implémentation et un risque de bug bien
 * moindres qu'un système d'agrégation. Si un jour une vue "sur un an"
 * apparaît, on ajustera ce choix à ce moment-là.
 */
export async function pruneOldHeartbeats(retentionMs) {
  const cutoff = Date.now() - retentionMs;
  const { rowCount } = await pool.query('DELETE FROM heartbeat_log WHERE "timestamp" < $1', [cutoff]);
  return rowCount;
}

/**
 * Supprime les rapports d'erreur dont la DERNIÈRE occurrence
 * ("lastSeenAt") date de plus de retentionMs — une erreur encore active
 * récemment (même ancienne à l'origine) n'est donc jamais supprimée tant
 * qu'elle continue de se reproduire. Voir src/config.js pour
 * ERROR_REPORT_RETENTION_MS (30 jours par défaut) et
 * src/store/errorReportsStore.js pour le détail du stockage.
 */
export async function pruneOldErrorReports(retentionMs) {
  const cutoff = Date.now() - retentionMs;
  const { rowCount } = await pool.query('DELETE FROM error_reports WHERE "lastSeenAt" < $1', [cutoff]);
  return rowCount;
}

await initSchema();
