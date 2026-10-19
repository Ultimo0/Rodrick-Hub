import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { listPosts, getPost, createPost, updatePost, deletePost } from '../store/postsStore.js';
import { listComments, getComment, createComment, deleteComment, COMMENT_MAX_LENGTH } from '../store/postCommentsStore.js';
import { getReactionsSummary, setReaction, REACTION_EMOJIS } from '../store/postReactionsStore.js';
import { findUserById } from '../store/usersStore.js';
import { broadcast } from '../realtime.js';
import { sendPushToAll } from '../push.js';
import { createNotification } from '../store/notificationsStore.js';
import { ah } from '../utils/asyncHandler.js';
import { commentLimiter, reactionLimiter } from '../middleware/rateLimit.js';

export const postsRouter = Router();

const VALID_CATEGORIES = ['publication', 'annonce', 'nouveaute', 'guide'];

// Public, comme /api/releases et /api/commands : l'espace communauté est
// fait pour être lu par n'importe quel visiteur du Hub.
postsRouter.get('/posts', ah(async (req, res) => {
  const { category } = req.query;
  res.json({ posts: await listPosts(category || null) });
}));

postsRouter.get('/posts/:id', ah(async (req, res) => {
  const post = await getPost(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
  res.json(post);
}));

postsRouter.post('/posts', requireAuth, requireAdmin, ah(async (req, res) => {
  const { title, content, category } = req.body || {};

  if (!title || !content) {
    return res.status(400).json({ error: 'Titre et contenu requis.' });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Catégorie invalide (attendu : ${VALID_CATEGORIES.join(', ')}).` });
  }

  const post = await createPost({ title, content, category, authorId: req.session.userId });
  broadcast({ type: 'new-post', post });
  // Historique de la cloche (voir js/notif-bell.js). Un échec ici ne doit
  // jamais empêcher la publication d'aboutir : elle est déjà enregistrée.
  createNotification({ type: 'post', title: 'Nouvelle publication', body: post.title, link: '/community.html' })
    .catch((err) => console.error('Échec createNotification (post) :', err));
  sendPushToAll({
    title: 'Nouvelle publication sur Rodrick Hub',
    body: post.title,
    url: '/community.html',
  }).catch((err) => console.error('Échec sendPushToAll (post) :', err));

  res.json({ ok: true, post });
}));

postsRouter.patch('/posts/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getPost(id);
  if (!existing) return res.status(404).json({ error: 'Publication introuvable.' });

  const { title, content, category } = req.body || {};
  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Catégorie invalide (attendu : ${VALID_CATEGORIES.join(', ')}).` });
  }

  const post = await updatePost(id, {
    title: title || existing.title,
    content: content || existing.content,
    category: category || existing.category,
  });
  res.json({ ok: true, post });
}));

postsRouter.delete('/posts/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await getPost(id))) return res.status(404).json({ error: 'Publication introuvable.' });

  await deletePost(id);
  res.json({ ok: true, deleted: id });
}));

// --- Commentaires ---------------------------------------------------------

// Public comme le reste de l'espace communauté (GET /posts, GET /posts/:id).
postsRouter.get('/posts/:id/comments', ah(async (req, res) => {
  const postId = Number(req.params.id);
  if (!(await getPost(postId))) return res.status(404).json({ error: 'Publication introuvable.' });

  const limitValue = Number(req.query.limit ?? 50);
  const beforeId = req.query.before === undefined ? null : Number(req.query.before);
  if (
    !Number.isInteger(limitValue) || limitValue < 1 ||
    (beforeId !== null && (!Number.isInteger(beforeId) || beforeId < 1))
  ) {
    return res.status(400).json({ error: 'Paramètres de pagination invalides.' });
  }
  const result = await listComments(postId, { limit: Math.min(limitValue, 50), beforeId });
  res.json(result);
}));

postsRouter.post('/posts/:id/comments', requireAuth, commentLimiter, ah(async (req, res) => {
  const postId = Number(req.params.id);
  if (!(await getPost(postId))) return res.status(404).json({ error: 'Publication introuvable.' });

  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Commentaire vide.' });
  if (content.length > COMMENT_MAX_LENGTH) {
    return res.status(400).json({ error: `Commentaire trop long (max ${COMMENT_MAX_LENGTH} caractères).` });
  }

  const comment = await createComment({ postId, authorId: req.session.userId, content });
  broadcast({ type: 'new-comment', postId, comment });
  res.json({ ok: true, comment });
}));

// Suppression réservée à l'auteur du commentaire ou à un admin (modération),
// même logique que la modération des posts mais sans middleware requireAdmin
// puisque l'auteur seul doit aussi pouvoir se rétracter.
postsRouter.delete('/posts/:id/comments/:commentId', requireAuth, ah(async (req, res) => {
  const comment = await getComment(Number(req.params.commentId));
  if (!comment || comment.postId !== Number(req.params.id)) {
    return res.status(404).json({ error: 'Commentaire introuvable.' });
  }

  if (comment.authorId !== req.session.userId) {
    const user = await findUserById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Vous ne pouvez supprimer que vos propres commentaires." });
    }
  }

  await deleteComment(comment.id);
  broadcast({ type: 'delete-comment', postId: comment.postId, commentId: comment.id });
  res.json({ ok: true, deleted: comment.id });
}));

// --- Réactions -------------------------------------------------------------

postsRouter.get('/posts/:id/reactions', ah(async (req, res) => {
  const postId = Number(req.params.id);
  if (!(await getPost(postId))) return res.status(404).json({ error: 'Publication introuvable.' });

  res.json(await getReactionsSummary(postId, req.session.userId || null));
}));

postsRouter.post('/posts/:id/reactions', requireAuth, reactionLimiter, ah(async (req, res) => {
  const postId = Number(req.params.id);
  if (!(await getPost(postId))) return res.status(404).json({ error: 'Publication introuvable.' });

  const { emoji } = req.body || {};
  if (!REACTION_EMOJIS.includes(emoji)) {
    return res.status(400).json({ error: `Émoji invalide (attendu : ${REACTION_EMOJIS.join(' ')}).` });
  }

  const summary = await setReaction(postId, req.session.userId, emoji);
  broadcast({ type: 'post-reaction', postId, ...summary });
  res.json({ ok: true, ...summary });
}));
