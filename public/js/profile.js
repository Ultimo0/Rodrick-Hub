/**
 * profile.js
 * ------------------------------------------------------------------
 * Deux flux distincts, volontairement séparés :
 *
 *  1. Photo de profil : traitée et envoyée DÈS le choix du fichier (pas
 *     besoin d'appuyer sur "Enregistrer" en plus) — c'est le comportement
 *     attendu sur mobile (Instagram, WhatsApp...), et ça évite de garder
 *     un gros fichier image en attente dans le navigateur.
 *
 *  2. Nom + bio : modifiables librement, envoyés ensemble seulement au
 *     clic sur "Enregistrer les modifications" — pour laisser le temps
 *     de se relire avant que ça parte.
 *
 * L'upload de la photo se fait EN DEUX TEMPS : le navigateur envoie
 * directement le fichier à Cloudinary (jamais à notre serveur — voir
 * uploadAvatar()), puis seulement l'URL renvoyée par Cloudinary est
 * envoyée à notre API pour être enregistrée sur le compte. Notre serveur
 * ne voit donc jamais le poids de l'image elle-même.
 */

const notLoggedInEl = document.getElementById('notLoggedIn');
const profileCardEl = document.getElementById('profileCard');

const avatarImgEl = document.getElementById('avatarImg');
const avatarFallbackEl = document.getElementById('avatarFallback');
const avatarInputEl = document.getElementById('avatarInput');
const avatarStatusEl = document.getElementById('avatarStatus');

const nameInputEl = document.getElementById('nameInput');
const bioInputEl = document.getElementById('bioInput');
const bioCountEl = document.getElementById('bioCount');
const saveStatusEl = document.getElementById('saveStatus');

const pNameEl = document.getElementById('pName');
const bioTextEl = document.getElementById('bioText');
const unreadEl = document.getElementById('pUnread');
const editBtnEl = document.getElementById('editBtn');
const editPanelEl = document.getElementById('editPanel');

// Dernières valeurs ENREGISTRÉES : "Annuler" y revient, et l'en-tête de la
// page les affiche (pas ce qui est en cours de frappe dans le formulaire).
let saved = { name: '', bio: '' };

const AVATAR_SIZE = 512;       // pixels — taille finale carrée envoyée à Cloudinary
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024; // 8 Mo — au-delà, on refuse avant même de traiter l'image

function showStatus(el, message, kind) {
  el.textContent = message;
  el.className = `field-status field-status-${kind}`; // 'success' | 'error' | 'pending'
  el.style.display = 'block';
}

function renderAvatar(user) {
  if (user.avatarUrl) {
    avatarImgEl.src = user.avatarUrl;
    avatarImgEl.style.display = 'block';
    avatarFallbackEl.style.display = 'none';
  } else {
    avatarImgEl.style.display = 'none';
    avatarFallbackEl.style.display = 'flex';
    avatarFallbackEl.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
  }
}

function renderIdentity(user) {
  pNameEl.textContent = saved.name || user?.email || 'Mon profil';

  if (saved.bio) {
    bioTextEl.classList.remove('is-empty');
    window.ProfileView.renderBio(bioTextEl, saved.bio);
  } else {
    // Pas de bio : une invitation qui ouvre directement l'édition.
    bioTextEl.classList.add('is-empty');
    bioTextEl.textContent = 'Ajoute une bio pour te présenter.';
  }
}

function setEditing(on) {
  editPanelEl.hidden = !on;
  editBtnEl.setAttribute('aria-expanded', String(on));
  profileCardEl.classList.toggle('is-editing', on);

  if (on) {
    nameInputEl.focus();
    // Sur mobile le formulaire s'ouvre sous le pli : on l'amène à l'écran.
    editPanelEl.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  } else {
    // Annuler (ou fin d'enregistrement) : le formulaire revient aux valeurs enregistrées.
    nameInputEl.value = saved.name;
    bioInputEl.value = saved.bio;
    bioCountEl.textContent = bioInputEl.value.length;
    saveStatusEl.style.display = 'none';
  }
}

editBtnEl.addEventListener('click', () => setEditing(editPanelEl.hidden));
document.getElementById('cancelEditBtn').addEventListener('click', () => setEditing(false));
bioTextEl.addEventListener('click', () => {
  if (bioTextEl.classList.contains('is-empty')) setEditing(true);
});

// La pastille ouvre la cloche (les notifications y sont déjà détaillées).
unreadEl.addEventListener('click', () => document.querySelector('.hub-bell-btn')?.click());

/** Compteurs "Bots reliés / En ligne / Publications" : un échec laisse "–", jamais un faux 0. */
async function loadStats() {
  try {
    const res = await fetch('/api/me/instances');
    if (res.ok) {
      const { instances } = await res.json();
      document.getElementById('statBots').textContent = instances.length;
      document.getElementById('statOnline').textContent = instances.filter((bot) => bot.online && bot.enabled).length;
    }
  } catch { /* on garde "–" */ }

  try {
    const res = await fetch('/api/profile/stats');
    if (res.ok) document.getElementById('statPosts').textContent = (await res.json()).posts;
  } catch { /* on garde "–" */ }
}

async function loadUnread() {
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const { unread } = await res.json();
    unreadEl.hidden = !(unread > 0);
    if (unread > 0) {
      unreadEl.textContent = window.ProfileView.formatBadge(unread);
      unreadEl.setAttribute('aria-label', `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`);
    }
  } catch { /* pas de pastille */ }
}

async function load() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      notLoggedInEl.style.display = 'block';
      return;
    }

    const user = await res.json();
    profileCardEl.style.display = 'block';

    saved = { name: user.name || '', bio: user.bio || '' };
    renderAvatar(user);
    renderIdentity(user);
    nameInputEl.value = saved.name;
    bioInputEl.value = saved.bio;
    bioCountEl.textContent = bioInputEl.value.length;
    document.getElementById('pRole').textContent = user.role === 'admin' ? 'Administrateur' : 'Membre';
    document.getElementById('pEmail').textContent = user.email;
    document.getElementById('pSince').textContent = new Date(user.createdAt).toLocaleDateString('fr-FR');

    loadStats();
    loadUnread();
  } catch {
    notLoggedInEl.style.display = 'block';
    notLoggedInEl.textContent = 'Impossible de contacter le serveur.';
  }
}

/**
 * Recadre l'image en carré (centré, comme un avatar) et la redimensionne
 * à AVATAR_SIZE — fait entièrement dans le navigateur via <canvas>, avant
 * même l'envoi à Cloudinary. Ça garde le fichier envoyé petit (quelques
 * dizaines de Ko en JPEG) quelle que soit la taille de la photo d'origine
 * (un iPhone récent produit facilement des photos de 5-10 Mo).
 */
function fileToSquareBlob(file, size = AVATAR_SIZE) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fichier image invalide.'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);

        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Échec de la conversion de l\'image.'))),
          'image/jpeg',
          0.85
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Mise en cache : /api/config n'a besoin d'être appelé qu'une fois par
// visite, sa valeur ne change jamais pendant que la page est ouverte.
let cloudinaryConfigPromise = null;
function getCloudinaryConfig() {
  if (!cloudinaryConfigPromise) {
    cloudinaryConfigPromise = fetch('/api/config').then((r) => r.json());
  }
  return cloudinaryConfigPromise;
}

/** Upload "non signé" : va DIRECTEMENT à Cloudinary, jamais via notre serveur. */
async function uploadToCloudinary(blob) {
  const { cloudinaryCloudName, cloudinaryUploadPreset } = await getCloudinaryConfig();
  if (!cloudinaryCloudName || !cloudinaryUploadPreset) {
    throw new Error("Photo de profil non configurée côté serveur — voir DEPLOY.md.");
  }

  const formData = new FormData();
  formData.append('file', blob);
  formData.append('upload_preset', cloudinaryUploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Cloudinary renvoie toujours une raison précise dans le corps de la
    // réponse (ex: "Upload preset must be whitelisted for unsigned
    // uploads", "Invalid cloud_name") — on l'affiche telle quelle plutôt
    // qu'un message générique, pour savoir directement quoi corriger.
    const reason = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudinary a refusé l'envoi : ${reason}`);
  }

  return data.secure_url;
}

document.getElementById('avatarEditBtn').addEventListener('click', () => avatarInputEl.click());

avatarInputEl.addEventListener('change', async () => {
  const file = avatarInputEl.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showStatus(avatarStatusEl, 'Ce fichier n\'est pas une image.', 'error');
    return;
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    showStatus(avatarStatusEl, 'Image trop lourde (8 Mo max).', 'error');
    return;
  }

  showStatus(avatarStatusEl, 'Envoi de la photo…', 'pending');

  try {
    const blob = await fileToSquareBlob(file);
    const avatarUrl = await uploadToCloudinary(blob);

    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarUrl }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Échec de l\'enregistrement.');

    const { user } = await res.json();
    renderAvatar(user);
    showStatus(avatarStatusEl, 'Photo de profil mise à jour.', 'success');
  } catch (err) {
    showStatus(avatarStatusEl, err.message || 'Une erreur est survenue.', 'error');
  } finally {
    avatarInputEl.value = ''; // permet de resélectionner le même fichier plus tard si besoin
  }
});

bioInputEl.addEventListener('input', () => {
  bioCountEl.textContent = bioInputEl.value.length;
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  const name = nameInputEl.value.trim();
  if (!name) {
    showStatus(saveStatusEl, 'Le nom ne peut pas être vide.', 'error');
    return;
  }

  showStatus(saveStatusEl, 'Enregistrement…', 'pending');

  try {
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bio: bioInputEl.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Échec de l\'enregistrement.');

    saved = { name, bio: bioInputEl.value };
    renderIdentity();
    setEditing(false);
    // Le panneau est refermé : la confirmation s'affiche sous l'en-tête.
    showStatus(avatarStatusEl, 'Profil mis à jour.', 'success');
  } catch (err) {
    showStatus(saveStatusEl, err.message || 'Une erreur est survenue.', 'error');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

// ---------- Suppression du compte ----------

const deletePasswordInputEl = document.getElementById('deletePasswordInput');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const deleteStatusEl = document.getElementById('deleteStatus');

deleteAccountBtn.addEventListener('click', async () => {
  const password = deletePasswordInputEl.value;
  if (!password) {
    showStatus(deleteStatusEl, 'Entre ton mot de passe pour confirmer.', 'error');
    return;
  }

  // confirm() natif — même pattern que les suppressions de version/publication
  // ailleurs dans le Hub (voir releases.js, admin-posts.js) : une seconde
  // confirmation explicite avant une action irréversible.
  if (!confirm('Supprimer définitivement ton compte et tes publications ? Cette action est irréversible.')) return;

  deleteAccountBtn.disabled = true;
  showStatus(deleteStatusEl, 'Suppression en cours…', 'pending');

  try {
    const res = await fetch('/api/profile', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Échec de la suppression.');

    window.location.href = 'index.html';
  } catch (err) {
    showStatus(deleteStatusEl, err.message || 'Une erreur est survenue.', 'error');
    deleteAccountBtn.disabled = false;
  }
});

// ---------- Notifications push ----------

const notifToggleBtn = document.getElementById('notifToggleBtn');
const notifStatusEl = document.getElementById('notifStatus');
const notifIosHintEl = document.querySelector('.notif-ios-hint');

// Détecte Safari sur iPhone/iPad spécifiquement — pas pour bloquer quoi
// que ce soit, juste pour afficher l'avertissement "installe d'abord sur
// l'écran d'accueil" uniquement aux personnes concernées par cette limite
// d'Apple (voir la discussion avec l'utilisateur : ça ne marche pas
// autrement sur iOS).
function isLikelyIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

// navigator.standalone : true seulement quand le site est ouvert depuis
// l'icône ajoutée à l'écran d'accueil (pas dans Safari normal) — propre à
// iOS, absent des autres navigateurs (d'où le "?" défensif ci-dessous).
function isInstalledStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function refreshNotifButton() {
  if (!window.RodrickPush) return; // push-notifications.js pas chargé (ne devrait pas arriver sur cette page)

  const status = await window.RodrickPush.getStatus();

  if (status === 'unsupported') {
    notifToggleBtn.disabled = true;
    notifToggleBtn.textContent = 'Notifications non supportées par ce navigateur';
    return;
  }
  if (status === 'denied') {
    notifToggleBtn.disabled = true;
    notifToggleBtn.textContent = 'Notifications bloquées — à réactiver dans les réglages du navigateur';
    return;
  }

  notifToggleBtn.disabled = false;
  notifToggleBtn.textContent = status === 'subscribed' ? 'Désactiver les notifications' : 'Activer les notifications';

  if (isLikelyIos() && !isInstalledStandalone() && status !== 'subscribed') {
    notifIosHintEl.style.display = 'block';
  }
}

notifToggleBtn.addEventListener('click', async () => {
  notifToggleBtn.disabled = true;
  showStatus(notifStatusEl, 'Un instant…', 'pending');

  try {
    await window.RodrickPush.toggle();
    showStatus(notifStatusEl, 'Préférence enregistrée.', 'success');
  } catch (err) {
    showStatus(notifStatusEl, err.message || 'Une erreur est survenue.', 'error');
  } finally {
    refreshNotifButton();
  }
});

refreshNotifButton();

load();
