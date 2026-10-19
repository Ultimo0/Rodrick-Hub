# Changelog

## 0.11.0

### Liaison automatique des bots aux comptes
- **Plus de numéro ni de code à saisir.** Le bot (1.82.36 ou plus) envoie lui-même, dans le chat « Vous » de son propriétaire, un lien personnel valable 7 jours et à usage unique. Le propriétaire le touche, se connecte ou crée son compte, confirme d'un appui, et le bot apparaît dans « Mes bots ».
- **Ses autres bots sont reliés d'office**, présents ou futurs : une fois le propriétaire prouvé, chaque bot qui envoie un heartbeat avec la même empreinte est rattaché au compte, avec une notification « Bot relié ».
- **Confidentialité :** le Hub ne reçoit ni ne stocke jamais de numéro, seulement une empreinte (HMAC) calculée par le bot. Les jetons ne sont stockés que sous forme d'empreinte SHA-256 ; la liste admin des instances n'expose pas l'empreinte.
- **Garde-fous :** un lien invalide, utilisé ou expiré est expliqué à l'écran ; un propriétaire déjà prouvé pour un compte ne peut pas être réclamé par un autre ; un nouveau lien annule le précédent ; la confirmation est toujours explicite (un lien piégé ouvert par quelqu'un de connecté ne lui ajoute pas de bot étranger).
- **Page `link.html`** (aperçu du bot, connexion ou inscription puis retour automatique, confirmation). `login.js` et `register.js` ramènent à cette page quand la personne vient d'un lien.
- **Serveur :** `POST /api/link/invite` (clé API, appelée par le bot), `GET /api/link/preview`, `POST /api/link/claim` ; le heartbeat accepte `ownerHash` et répond `link: { linked, inviteSent }`. Nouvelles tables `link_tokens` et `user_owner_hashes`, colonnes `ownerHash` et `linkInviteSentAt`, créées au démarrage.
- **Tests :** jetons, page du lien (jsdom), et un test de bout en bout sur Postgres (32 vérifications) couvrant aussi le contrat avec le module du bot.

### Pas encore fait
- Pas de bouton pour détacher un bot de son compte.
- La page Communauté en flux vertical.

## 0.10.0

### Nouvelle interface (première étape)
- **Cloche de notifications** dans la barre du haut de chaque page, pour les comptes connectés : badge des non lues, panneau avec les 3 dernières notifications (nouvelle version, nouvelle publication, un de tes bots passe hors ligne ou revient) et interrupteur pour activer ou désactiver les alertes push sur l'appareil. Le bouton du profil reste, et agit sur le même réglage.
- **« Mes bots »** sur l'accueil : état en direct (en ligne, hors ligne, désactivé) de chacun des bots rattachés au compte.
- **Nouveau style** inspiré des applis vidéo mobiles : fond noir ou blanc franc, un seul accent, barre d'onglets plus lisible, avatar seul en haut sur mobile. Le thème clair ou sombre suit automatiquement l'appareil. Tout le style est dans `public/css/hub-shell.css` : retirer ce fichier des pages rétablit l'ancien rendu.

### Serveur
- Table `notifications` (historique, purgé à 30 jours) et colonnes `userId` / `statusNotified` sur `instances`, créées automatiquement au démarrage.
- `GET /api/notifications` (3 dernières + non lues), `GET /api/me/instances` (uniquement les bots du compte, liste blanche de champs).
- Surveillance des bots rattachés à un compte (`src/instanceStatusWatcher.js`) : une alerte à chaque **changement** d'état seulement, jamais répétée ; la première observation d'un bot n'alerte pas, et les alertes « hors ligne » sont retenues juste après un redémarrage du Hub pour éviter une fausse alerte générale.
- Notification par compte en temps réel (`sendToUser`) et push ciblé (`sendPushToUser`).

### Corrections
- Les titres des cartes de la page Communauté prenaient le noir par défaut du navigateur (illisibles sur fond noir).

### Pas encore fait
- Le rattachement automatique des bots aux comptes (message WhatsApp envoyé par le bot) arrive à l'étape suivante : d'ici là « Mes bots » reste vide, sauf rattachement manuel (voir LISEZ-MOI).
- La page Communauté en flux vertical.

## 0.9.14

### Dashboard des instances
- **Mise à jour ciblée au lieu d'une reconstruction complète :** à chaque heartbeat, seules les cartes (et les textes) qui ont réellement changé sont modifiées. Le pouls animé des cartes ne repart plus de zéro, le focus clavier et le survol sont conservés, et le panneau de détails ne remonte plus en haut de son défilement.
- **Compteurs du résumé :** ils ne repassent plus par 0 à chaque mise à jour ; un chiffre n'est animé que s'il change, depuis sa valeur précédente.
- **Bouton Désactiver/Réactiver :** son libellé reflète toujours le nouvel état après l'action.
- **Technique :** nouveau module `public/js/dom-patch.js` (sans dépendance) et test `test/dom-patch.test.js` (nécessite `jsdom` en devDependency, ignoré s'il est absent).

## 0.9.13

### Interface comptes
- **Connexion et inscription repensées :** les deux formulaires conservent le fond quadrillé, les cartes crème, les champs beiges, les boutons cuivrés et la navigation Rodrick Hub, dans une disposition plus lisible sur ordinateur et mobile.
- **Assistant robot animé :** un robot SVG local flotte, cligne des yeux, regarde autour de lui, anime ses bras et adapte son expression aux champs, à l'adresse email, aux erreurs et à la réussite. Lorsqu'un mot de passe est affiché, il détourne volontairement le regard.
- **Retours de formulaire :** validation visuelle des champs, messages d'erreur accessibles, état de soumission et messages contextuels de l'assistant. L'inscription affiche une jauge de robustesse du mot de passe.
- **Passage fluide :** les liens Connexion/Inscription déclenchent une courte animation de sortie, avec prise en charge de `prefers-reduced-motion`.
- **Tests :** ajout de contrôles automatisés pour la structure des deux formulaires, l'assistant, les transitions, les réactions au mot de passe et la robustesse.

## 0.9.12

### Accueil
- **Bouton « S’inscrire » ajouté** dans l’action principale de la page d’accueil, visible uniquement aux visiteurs non connectés.

## 0.9.11

### Correction
- **Navigation de secours dans le HTML** : les liens restent disponibles sur ordinateur et mobile même si le script de navigation ne se charge pas; sur mobile, ils prennent la forme d’une barre fixe en bas de l’écran.

## 0.9.10

### Correction
- **Barre de navigation restaurée** : le script de navigation est isolé des autres scripts de page; cela évite le conflit de déclaration `isAdmin` qui empêchait les menus desktop et mobile de se charger sur Versions.

## 0.9.9

### Correction
- **Navigation toujours visible** : le menu horizontal desktop et la barre mobile s’affichent dès l’ouverture d’une page, sans attendre les vérifications réseau des notifications et du rôle admin.

## 0.9.8

### Interface admin
- **Panneau de détails des instances** : regroupe l’environnement, la configuration distante, la santé de connexion, les statistiques d’usage, l’état de yt-dlp et les fonctionnalités actives par groupe.
- **Cartes d’instance allégées** : les données de diagnostic détaillées s’ouvrent dans un panneau latéral accessible au clavier et adapté au mobile.
- **Accès strictement réservé aux comptes admin** : les routes de consultation et de gestion vérifient la session et le rôle; la clé partagée reste réservée aux heartbeats des bots.
- **Navigation admin masquée aux autres comptes** et flux temps réel des instances limité aux sessions admin, sans données d’instance dans les événements publics.
- Le panneau réutilise les informations déjà remontées par le bot; aucune nouvelle donnée ni route n’est nécessaire.

## 0.9.7

### Interface
- **Tableau des instances clarifié** : indicateurs lisibles, recherche par identifiant/propriétaire/bot, filtres par état et messages de résultat adaptés.
- **Catalogue des commandes enrichi** : favoris mémorisés sur l’appareil, recherche accentuée et préfixée tolérante, compteur de résultats et copie directe de l’usage.
- **Retours d’action visibles** après la connexion au dashboard, le changement de configuration, l’activation ou la suppression d’une instance.
- **Vérifications automatisées ajoutées** pour les filtres du dashboard/catalogue et le formatage des usages.

## 0.9.6

### Sécurité
- **Dépendances corrigées** : mise à jour d’Express et de ses dépendances transitives `proxy-addr` et `qs` vers des versions corrigées des vulnérabilités signalées par `npm audit`.
- **Verrouillage des dépendances synchronisé** avec `package.json`, notamment pour `express-rate-limit`, `helmet` et `web-push` déjà déclarés par le projet.
- **Audit npm sans vulnérabilité connue** après mise à jour.

## 0.9.5

### Présentation
- **Nouvelle page d’accueil Rodrick Hub** : présente clairement les instances, les commandes, les versions et la communauté avec des accès directs, une mise en page responsive et un aperçu visuel des rubriques.
- **Tableau des instances conservé dans `dashboard.html`** : toutes ses fonctions restent disponibles depuis la navigation « Instances ».
- **Navigation mise à jour** : ajoute les entrées Accueil et Instances sur ordinateur et mobile; le manifeste PWA décrit maintenant l’espace central Rodrick Hub.

## 0.9.4

### Correctifs
- **Création du premier compte admin sérialisée** : deux inscriptions simultanées ne peuvent plus toutes deux recevoir le rôle administrateur ; les collisions d'email renvoient une réponse `409`.
- **Écritures d'instances ciblées et atomiques** : les heartbeats n'écrasent plus les configurations ou activations concurrentes du dashboard, et les changements de configuration fusionnent sous verrou de ligne.
- **Réactions sérialisées par utilisateur et publication** : les clics simultanés respectent le comportement de bascule et ne provoquent plus de conflit de clé primaire.
- **Fil de commentaires borné** : chargement paginé par lots de 50 et limitation des nouvelles publications (10 commentaires/10 minutes, 60 réactions/minute).

## 0.9.3

### Ajouté
- **Commentaires et réactions sur les publications** (`community.html`,
  `community.js`) : enrichit le système `posts` déjà existant
  (annonces/nouveautés/guides) sans toucher à son fonctionnement actuel.
  - Deux nouvelles tables (`src/db.js`) : `post_comments` (un commentaire =
    une ligne, cascade à la suppression du post ou de l'auteur) et
    `post_reactions` (une seule réaction par personne et par post — clé
    primaire composite `postId`/`userId`, pas de table de comptage séparée
    à maintenir à la main). Deux nouveaux stores dédiés
    (`postCommentsStore.js`, `postReactionsStore.js`), même convention
    qu'un store par domaine déjà en place pour `posts`/`users`.
  - `postsStore.js` : `SELECT_BASE` récupère maintenant `commentCount`/
    `reactionCount` via sous-requêtes, affichés directement sur les cartes
    de la liste (`💬`/`❤️`) sans requête supplémentaire par post.
  - Nouvelles routes sur `posts.js` : `GET/POST /posts/:id/comments`,
    `DELETE /posts/:id/comments/:commentId` (réservé à l'auteur du
    commentaire ou à un admin — modération), `GET/POST
    /posts/:id/reactions` (bascule : cliquer deux fois le même émoji
    retire la réaction). Diffusion en temps réel via `broadcast()`
    (`new-comment`, `delete-comment`, `post-reaction`), déjà utilisé pour
    `new-post`.
  - Lecteur de publication (`#reader`) : barre de 6 émojis (👍❤️😂😮😢🙏,
    liste fermée) avec mise en évidence de sa propre réaction, fil de
    commentaires avec avatar/nom/date, formulaire de publication pour les
    personnes connectées et lien de connexion pour les autres (même
    convention que `/api/auth/me` déjà utilisée par `auth-nav.js`). Se
    met à jour discrètement via les événements temps réel plutôt qu'un
    rechargement de toute la liste.

## 0.9.2

### Ajouté
- **Affichage de la santé de connexion WhatsApp sur le dashboard**
  (`public/js/app.js`) : les champs `reconnectCount`/`lastDisconnectCode`/
  `lastDisconnectAt`, déjà acceptés par `POST /api/heartbeat` et stockés en
  base depuis une version antérieure (Phase 1b — voir `src/db.js` et
  `src/routes/instances.js`), n'étaient jamais rendus nulle part dans
  l'interface alors qu'ils étaient bien reçus et sauvegardés. Nouvelle
  fonction `connectionHealthHtml()` : ajoute deux lignes ("Reconnexions",
  "Dernière coupure") à la carte de chaque instance, avec le code de
  déconnexion traduit en clair via une table de correspondance vers l'énum
  `DisconnectReason` de `@whiskeysockets/baileys` (401, 403, 408, 411, 428,
  440, 500, 515 — un code absent de cette liste s'affiche tel quel, jamais
  masqué). N'affiche rien du tout pour une copie qui tourne encore sous
  RodrickBOT < 1.79.0 (champs `null`), plutôt qu'une ligne à moitié vide.

## 0.9.1

### Ajouté
- **Refonte visuelle des pages Connexion et Inscription** (`login.html`,
  `register.html`) : toujours les mêmes classes `.auth-form`/`.auth-switch`
  et les mêmes variables de couleur du thème (aucune couleur nouvelle),
  mais dans l'esprit "pupitre d'exploitant" du reste du Hub plutôt qu'un
  formulaire nu — liseré cuivré en tête de plaque (même langage que
  `.stat::before`), halo de signal animé derrière l'icône de marque,
  légère entrée en fondu de la carte, bouton d'action en dégradé avec
  lueur au survol (même traitement que le bouton de `#keyBar`). Scopé à la
  nouvelle classe `.auth-page` (posée sur ces deux pages uniquement) pour
  ne rien changer sur `forgot-password.html`/`reset-password.html`, qui
  réutilisent les mêmes classes de base. Respecte
  `prefers-reduced-motion`.
- **Bouton "œil" pour afficher/masquer le mot de passe**, sur les deux
  pages — icône SVG en trait dessinée à la main (même esprit que les
  icônes de `nav.js`), jamais d'émoticône. Chaque champ (nom, email, mot
  de passe) a désormais une icône de contexte à gauche ; le champ mot de
  passe a en plus le bouton bascule à droite (`type="text"`/`"password"`,
  libellé et `aria-pressed` mis à jour en phase pour les lecteurs
  d'écran). Logique dupliquée dans `login.js` et `register.js` plutôt que
  factorisée dans un utilitaire partagé, à l'image de `escapeHtml()` déjà
  dupliquée entre plusieurs scripts de pages du Hub.

## 0.9.0

### Ajouté
- **Changer le préfixe d'une copie depuis le dashboard** (Phase 1d-ii —
  interface de la route `POST /api/instances/:id/config` ajoutée en 0.8.0).
  - `public/js/app.js` : un bouton ✏️ dans la ligne « Préfixe » de chaque
    carte ouvre une saisie (`prompt()`), valide (1 à 5 caractères, sans
    espace — mêmes règles que le bot et la route), puis appelle la route.
    Une mention « ⏳ En attente : « x » » s'affiche tant que le bot n'a pas
    appliqué la valeur (`configVersion` > `appliedConfigVersion`).
  - Bouton désactivé, avec explication au survol, pour une copie dont
    `appliedConfigVersion` vaut `null` : elle n'a jamais envoyé d'accusé de
    réception, donc tourne sous RodrickBOT < 1.82.0 et n'appliquerait rien —
    la mention « en attente » resterait affichée indéfiniment.
  - `prompt()` plutôt qu'un champ intégré à la carte : `refresh()`
    reconstruit toute la grille (`grid.innerHTML`) à chaque heartbeat de
    n'importe quelle instance, un champ de saisie serait vidé en pleine
    frappe.
  - `public/css/style.css` : styles `.prefix-btn` et `.config-pending`
    (variables existantes uniquement, aucune nouvelle couleur).

## 0.8.0

### Ajouté
- **Configuration poussée vers le bot — préfixe à distance** (Phase 1d-i de
  la feuille de route Rodrick Ecosystem ; l'interface du dashboard suivra en
  1d-ii, en attendant la route s'utilise avec `curl`).
  - Nouvelle route `POST /api/instances/:instanceId/config`
    (`src/routes/instances.js`), même authentification que `/toggle`
    (`requireApiKey`). Corps : `{ "prefix": "?" }`. Réglages inconnus
    refusés en 400 (plutôt qu'ignorés en silence), valeur re-validée
    (1 à 5 caractères, sans espace — mêmes règles que le bot).
  - Nouvelles colonnes sur `instances` (`src/db.js`) : `remoteConfig`
    (configuration souhaitée, JSON), `configVersion` (incrémenté à chaque
    poussée, 0 par défaut), `appliedConfigVersion` (accusé de réception
    envoyé par le bot). `remoteConfig` est distinct de `prefix`, qui reste
    la valeur RAPPORTÉE par le bot.
  - La réponse de `POST /api/heartbeat` contient un bloc
    `config: { version, values }` tant que le bot n'a pas accusé réception
    de cette version.
  - `remoteConfig` et `configVersion` sont recopiés de l'état précédent à
    chaque heartbeat (comme `enabled`) : la route heartbeat reconstruit
    l'objet instance de zéro, sans cette recopie la configuration poussée
    serait effacée au heartbeat suivant.
  - `saveInstances()`/`rowToInstance()` étendus (`src/store/instancesStore.js`).
- **Limite connue** : comme `/toggle`, la route lit puis réécrit toutes les
  instances (`saveInstances` supprime et réinsère tout). Une poussée arrivant
  exactement pendant le traitement d'un heartbeat peut être perdue (fenêtre
  de quelques millisecondes) — vérifier `configVersion` dans la réponse, puis
  `appliedConfigVersion` via `GET /api/instances`.

## 0.7.0

### Ajouté
- **Comptes agrégés d'usage dans le heartbeat** (Phase 1c de la feuille de
  route Rodrick Ecosystem) : `POST /api/heartbeat` accepte désormais 2
  champs optionnels — `groupCount` (nombre de groupes où le bot est
  membre) et `activeFeatures` (nombre de groupes où chaque fonctionnalité
  par groupe est activée : antilink, guardian, antispam...) — envoyés par
  RodrickBOT (à partir de la version 1.81.0). Uniquement des totaux,
  jamais un détail par groupe (aucun nom ni JID de groupe). Nouvelles
  colonnes sur `instances` (`src/db.js`) : `groupCount` INTEGER,
  `activeFeatures` TEXT (JSON, même convention que `commandStats`).
  Validation défensive dans `src/routes/instances.js` :
  `activeFeatures` doit être un objet simple (ni tableau ni chaîne),
  `groupCount` un entier positif — sinon stocké comme `NULL`.
  `activeFeatures` vaut `null` (et non `{}` comme `commandStats`) quand
  absent, pour distinguer "bot pas encore à jour" de "zéro groupe avec
  cette fonctionnalité activée", deux situations différentes à l'affichage.
  `saveInstances()` de nouveau étendu (sa liste de colonnes reste figée
  par construction, voir 0.5.0).

## 0.6.0

### Ajouté
- **État du binaire yt-dlp dans le heartbeat** (Phase 1b-ii de la feuille
  de route Rodrick Ecosystem) : `POST /api/heartbeat` accepte désormais 3
  champs optionnels — `ytdlpLastRefreshAt`, `ytdlpLastRefreshOk`,
  `ytdlpVersion` — envoyés par RodrickBOT (`core/ytdlpStatus.js`, à partir
  de la version 1.80.0), alimentés à la fois par `boot.mjs` (au démarrage)
  et par le rafraîchissement périodique (`core/ytdlpAutoUpdater.js`).
  Nouvelles colonnes sur `instances` (`src/db.js`,
  `ALTER TABLE ADD COLUMN IF NOT EXISTS`). `ytdlpLastRefreshOk` distingue
  NULL (jamais tenté) de `false` (dernière tentative échouée) — traité
  différemment de `enabled` dans `rowToInstance()`
  (`src/store/instancesStore.js`), qui lui n'est jamais NULL.
  `saveInstances()` de nouveau étendu (sa liste de colonnes reste figée
  par construction, voir 0.5.0).

## 0.5.0

### Ajouté
- **Santé de connexion WhatsApp dans le heartbeat** (Phase 1b-i de la
  feuille de route Rodrick Ecosystem) : `POST /api/heartbeat`
  (`src/routes/instances.js`) accepte désormais 3 champs optionnels —
  `reconnectCount`, `lastDisconnectCode`, `lastDisconnectAt` — envoyés par
  RodrickBOT (`core/state.js::recordDisconnect`, à partir de la version
  1.79.0). Nouvelles colonnes sur `instances` (`src/db.js`,
  `ALTER TABLE ADD COLUMN IF NOT EXISTS`, NULL par défaut pour les bots pas
  encore mis à jour). `src/store/instancesStore.js::saveInstances()` a dû
  être étendu : sa liste de colonnes était figée en dur (`DELETE` +
  ré-insertion complète à chaque heartbeat) — un champ non ajouté ici
  aurait été reçu par la route puis silencieusement perdu à l'écriture.

## 0.4.0

### Ajouté
- **Indicateur de nouvelle version dans la réponse du heartbeat** (Phase 1a
  de la feuille de route Rodrick Ecosystem) : `POST /api/heartbeat`
  (`src/routes/instances.js`) renvoie désormais un champ `latestVersion`
  en plus de `ok`/`enabled`, calculé via `getLatestRelease()`
  (`src/store/releasesStore.js`, déjà utilisée pour le bandeau de
  `releases.html` — aucune nouvelle table, aucune nouvelle colonne).
  RodrickBOT (`core/telemetry.js`, à partir de la version 1.78.0) compare
  ce champ à sa propre version et prévient une seule fois son propriétaire
  dans le chat "Vous" quand une nouvelle version est disponible.

## 0.3.0

### Ajouté
- **Réception effective des rapports d'erreur envoyés par RodrickBOT** :
  `core/telemetry.js::reportError` (côté bot) appelait déjà
  `POST /api/error-report` depuis plusieurs versions, mais aucune route
  ne l'attendait côté Hub — chaque appel recevait un 404 silencieusement
  absorbé. Cette version comble ce manque.
  - Nouvelle route `POST /api/error-report` (`src/routes/errorReports.js`),
    protégée par `requireApiKey` (même authentification que
    `POST /api/heartbeat` — même acteur automatisé). Validation stricte
    du type des champs reçus (rejet 400 si un champ attendu comme chaîne
    ne l'est pas) ; troncature défensive de leur longueur côté store
    (`src/store/errorReportsStore.js`) plutôt que rejet, pour ne jamais
    perdre un rapport à cause d'une stack un peu longue.
  - Nouvelle table `error_reports` (`src/db.js`), avec contrainte
    `UNIQUE ("instanceId", "errorMessage")` : une même erreur sur une même
    instance ne crée jamais plus d'une ligne — chaque nouvelle occurrence
    incrémente `occurrenceCount` et met à jour `lastSeenAt`
    (`ON CONFLICT ... DO UPDATE`), au lieu de faire grossir la table sans
    limite en cas de boucle d'erreur côté bot.
  - Nouvelle route `GET /api/error-reports`, protégée par `requireAuth` +
    `requireAdmin` — **jamais publique ni accessible via la clé API
    partagée**, contrairement à `GET /api/releases` : une stack trace peut
    révéler des détails d'implémentation internes.
  - Purge automatique après 30 jours **sans nouvelle occurrence**
    (`pruneOldErrorReports`, `src/db.js`), déclenchée au démarrage puis
    toutes les 24h — même mécanisme que la purge existante de
    `heartbeat_log`, avec sa propre constante `ERROR_REPORT_RETENTION_MS`
    (`src/config.js`).
  - Nouvelle page d'administration `public/errors.html` +
    `public/js/errors.js` : liste des erreurs triée par dernière
    occurrence, stack trace repliée par défaut (accordéon), réservée aux
    comptes admin (le serveur renvoie 401/403 aux autres, la page l'affiche
    clairement plutôt que d'essayer de le masquer côté client).

### Documentation
- `scripts/migrate-json-to-sqlite.js` : ajout d'un en-tête documentant son
  obsolescence (le script importe `DATA_FILE`/`RELEASES_FILE` depuis
  `src/config.js`, deux constantes qui n'existent plus depuis le passage
  à Postgres — il ne peut plus s'exécuter). Conservé tel quel, logique
  inchangée, à la demande explicite du propriétaire du projet.

## 0.2.0

### Ajouté
- **Suppression de compte en libre-service** : n'importe quel compte
  connecté (admin ou non) peut désormais supprimer définitivement son
  propre compte depuis `profile.html`, sans intervention d'un
  administrateur.
  - Nouvelle route `DELETE /api/profile` (`src/routes/profile.js`) :
    exige le mot de passe en confirmation (bcrypt), protège contre le
    brute-force via un nouveau `deleteAccountLimiter`
    (`src/middleware/rateLimit.js`), et bloque la suppression du
    **dernier** compte admin restant pour ne jamais laisser le Hub sans
    accès au panel admin.
  - `deleteUser()` et `countAdmins()` ajoutés à `src/store/usersStore.js`.
    La suppression tourne dans une transaction : les publications de la
    Communauté rédigées par ce compte (`posts."authorId"`, `NOT NULL`
    et sans `ON DELETE CASCADE`/`SET NULL` en base) sont supprimées avec
    lui, pour ne jamais laisser de ligne orpheline qui ferait planter le
    `INNER JOIN` de `postsStore.js`. `user_seen` et `push_subscriptions`
    n'ont rien à faire ici : ils ont déjà `ON DELETE CASCADE`.
  - Nouvelle section "Supprimer mon compte" dans `profile.html`/`profile.js`
    (mot de passe + double confirmation via `confirm()`, même pattern que
    les suppressions de version/publication ailleurs dans le Hub) et son
    style `.danger-zone`/`.btn-danger` dans `style.css`.

## 0.1.1

### Corrigé
- **Bug critique** : `adminRouter` était monté sur `/api` (comme tous les
  autres routers), et son `router.use(requireAuth, requireAdmin)` sans
  chemin interceptait donc **toute** requête sous `/api/*` — y compris
  `GET /api/posts`, `GET /api/stats`, les routes de `profile`,
  `notifications` et `push`, montées après lui. Un utilisateur connecté
  mais non-admin recevait un 403 ("Réservé aux administrateurs.") sur ces
  routes pourtant publiques, avant même qu'elles ne soient atteintes.
  Un admin ne voyait rien d'anormal puisque `requireAdmin` le laissait
  passer.
  - `adminRouter` est maintenant monté sur son propre préfixe
    `/api/admin` (`server.js`), et ses routes internes n'ont plus besoin
    du préfixe `/admin` (`src/routes/admin.js`) — les URLs finales
    (`/api/admin/users`, `/api/admin/users/:id/role`) restent identiques,
    aucun changement côté frontend.
