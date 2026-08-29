import db from '../connection.js';

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function insertUser({ name, email, phone, passwordHash, role, termsAcceptedAt, now }) {
  const info = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, role, terms_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(name, email, phone, passwordHash, role, termsAcceptedAt, now, now);
  return findUserById(Number(info.lastInsertRowid));
}

// Восстановление пароля (domain/passwordReset.js) — единственный вызывающий код.
export function updateUserPasswordHash(userId, passwordHash, now) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, userId);
}

// Никогда не отдаётся password_hash или terms_accepted_at (внутренние поля) —
// требование задачи: не возвращать хеши паролей и лишние поля из БД.
export function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}
