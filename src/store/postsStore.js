import { pool } from '../db.js';

// La jointure (JOIN) récupère le nom de l'auteur en même temps que le
// post, en une seule requête — plutôt que de faire une requête séparée
// "trouve l'auteur du post X" pour chaque post affiché.
// commentCount/reactionCount sont calculés via des sous-requêtes
// (plutôt qu'un JOIN + GROUP BY) pour rester simple et éviter les
// doublons de lignes lorsqu'un post a plusieurs commentaires/réactions.
const SELECT_BASE = `
  SELECT posts.*, users.name AS "authorName",
    (SELECT COUNT(*)::int FROM post_comments WHERE post_comments."postId" = posts.id) AS "commentCount",
    (SELECT COUNT(*)::int FROM post_reactions WHERE post_reactions."postId" = posts.id) AS "reactionCount"
  FROM posts
  JOIN users ON users.id = posts."authorId"
`;

export async function listPosts(category) {
  const { rows } = category
    ? await pool.query(`${SELECT_BASE} WHERE posts.category = $1 ORDER BY posts."createdAt" DESC`, [category])
    : await pool.query(`${SELECT_BASE} ORDER BY posts."createdAt" DESC`);
  return rows;
}

export async function getPost(id) {
  const { rows } = await pool.query(`${SELECT_BASE} WHERE posts.id = $1`, [id]);
  return rows[0] || null;
}

export async function createPost({ title, content, category, authorId }) {
  const { rows } = await pool.query(
    `INSERT INTO posts (title, content, category, "authorId", "createdAt")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [title, content, category, authorId, Date.now()]
  );
  return getPost(rows[0].id);
}

export async function updatePost(id, { title, content, category }) {
  await pool.query(
    'UPDATE posts SET title = $1, content = $2, category = $3 WHERE id = $4',
    [title, content, category, id]
  );
  return getPost(id);
}

export async function deletePost(id) {
  await pool.query('DELETE FROM posts WHERE id = $1', [id]);
}

/** Utilisé pour les badges de nouveauté (voir src/routes/notifications.js). */
export async function getLatestTimestamp() {
  const { rows } = await pool.query('SELECT MAX("createdAt")::bigint AS latest FROM posts');
  return rows[0].latest || 0;
}

/** Nombre de publications écrites par ce compte (compteur du profil). */
export async function countPostsByAuthor(userId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM posts WHERE "authorId" = $1', [userId]);
  return rows[0].count;
}
