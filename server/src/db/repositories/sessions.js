// sessions — см. docs/db-schema.md, раздел 3.3а. Только SQL; хеширование
// токена и решение о том, когда сессию создавать/отзывать — в
// domain/session.js.

import db from '../connection.js';

export function insertSession({ userId, tokenHash, expiresAtSql, now }) {
  const info = db
    .prepare('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, tokenHash, expiresAtSql, now);
  return findSessionById(Number(info.lastInsertRowid));
}

export function findSessionById(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

// Действующая сессия по хешу токена — не отозвана и не истекла. Один
// запрос: и поиск, и проверка "активна ли" в одном WHERE, а не отдельным
// вызовом на каждый признак — это горячий путь (каждый
// аутентифицированный запрос к API).
export function findActiveSessionByTokenHash(tokenHash, nowSql) {
  return db
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .get(tokenHash, nowSql);
}

// Отзыв конкретной сессии (logout) — не удаляет строку, только помечает
// (см. docs/db-schema.md, 3.3а: та же логика, что у status='cancelled'
// у appointments и used_at у password_reset_tokens — история входов не
// обязана исчезать сразу же, как перестаёт быть действующей).
export function revokeSessionByTokenHash(tokenHash, now) {
  const info = db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now, tokenHash);
  return info.changes > 0;
}
