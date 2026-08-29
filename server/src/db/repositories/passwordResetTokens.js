// password_reset_tokens — таблица заведена в схеме заранее (см.
// docs/db-schema.md, 3.3), но до сих пор не использовалась: логики
// выпуска/проверки токена не было. Реализовано в domain/passwordReset.js,
// этот файл — только SQL.

import db from '../connection.js';

export function findTokenById(id) {
  return db.prepare('SELECT * FROM password_reset_tokens WHERE id = ?').get(id);
}

// У пользователя может быть только один ДЕЙСТВУЮЩИЙ токен одновременно —
// новый запрос инвалидирует все предыдущие неиспользованные (см.
// docs/db-schema.md, раздел 4: "инвалидация старых при выпуске нового").
// Использованные токены (used_at IS NOT NULL) не трогаем — это история.
export function invalidateActiveTokensForUser(userId) {
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
}

export function insertToken({ userId, tokenHash, expiresAtSql, now }) {
  const info = db
    .prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(userId, tokenHash, expiresAtSql, now);
  return findTokenById(Number(info.lastInsertRowid));
}

// Токен хранится хешированным (docs/db-schema.md, 3.3) — искать по
// значению самого токена напрямую нельзя (scrypt-хеш с солью не
// детерминирован), поэтому ищем действующий токен по пользователю и
// сверяем предъявленный токен с найденным хешем через verifyPassword
// (security/passwords.js) — тем же способом, что и обычный пароль.
export function findActiveTokenForUser(userId, nowSql) {
  return db
    .prepare(
      `SELECT * FROM password_reset_tokens
       WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, nowSql);
}

export function markTokenUsed(id, now) {
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, id);
}
