-- Таблица сессий входа — источник истины docs/db-schema.md, раздел 3.3а
-- (правки схемы сначала вносятся в документ, эта миграция дословно
-- повторяет DDL оттуда). 001–003 уже применены на боевой базе и не
-- редактируются — это отдельная миграция.
--
-- Раньше сессии были полностью без состояния на сервере (подписанный
-- HMAC-токен, срок действия проверялся по подписи). Требование —
-- ограниченный срок действия токена И хранение его хеша, а не самого
-- токена — вместе физически нельзя выполнить без строки в базе, отсюда
-- и таблица. Токен в ней не хранится вовсе, только его хеш (HMAC-SHA256
-- с ключом SESSION_SECRET, см. docs/db-schema.md, 3.3а — почему не
-- scrypt, как у password_reset_tokens).

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_sessions_token_hash ON sessions(token_hash);
CREATE INDEX ix_sessions_user ON sessions(user_id);
