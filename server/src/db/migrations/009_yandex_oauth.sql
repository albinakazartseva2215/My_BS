-- Источник истины — docs/db-schema.md, раздел 3.2 (правки схемы сначала
-- вносятся в документ, эта миграция дословно повторяет DDL оттуда).
-- 001-008 уже применены и не редактируются — это отдельная миграция.
--
-- Вход через Яндекс в один клик, без пароля: (1) password_hash становится
-- необязательным — у аккаунта, пришедшего только через Яндекс, пароля в
-- системе нет; (2) появляются provider/provider_id — какой внешний сервис
-- подтвердил личность и его внутренний id (не email, тот на стороне
-- Яндекса может смениться). У обычных аккаунтов (email+пароль) оба новых
-- поля остаются NULL — постоянное, а не временное состояние.
--
-- SQLite не поддерживает ALTER TABLE ... ALTER COLUMN (снять NOT NULL
-- иначе нельзя) — единственный способ перестроить таблицу: создать новую
-- с нужной схемой, перенести данные с сохранением id, удалить старую,
-- переименовать новую в старое имя. Официальная рекомендация SQLite —
-- на время такой перестройки выключать PRAGMA foreign_keys, но раннер
-- миграций (db/migrate.js) сам оборачивает содержимое файла в
-- BEGIN/COMMIT, а смена этой прагмы внутри уже открытой транзакции —
-- no-op, выключить её здесь физически негде. Для ЭТОЙ миграции это не
-- проблема: DROP TABLE родителя сам по себе не проверяется внешними
-- ключами (проверяются только INSERT/UPDATE/DELETE на дочерней стороне,
-- которых между DROP и RENAME ниже не происходит), а id не меняются —
-- ссылки из sessions/user_roles/masters/password_reset_tokens/
-- appointments/notifications/appointment_reschedule_log полностью
-- восстанавливаются, как только таблица получает обратно имя "users".
-- Подробный разбор компромисса — docs/db-schema.md, «Спорные решения», п.19.

CREATE TABLE users_new (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,
  password_hash      TEXT,
  provider           TEXT,
  provider_id        TEXT,
  terms_accepted_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

INSERT INTO users_new (id, name, email, phone, password_hash, provider, provider_id, terms_accepted_at, created_at, updated_at)
SELECT id, name, email, phone, password_hash, NULL, NULL, terms_accepted_at, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX ux_users_email ON users(email);
-- Один и тот же аккаунт во внешнем сервисе не может быть привязан к двум
-- нашим — тот же смысл, что и у ux_users_email, только со стороны Яндекса.
CREATE UNIQUE INDEX ux_users_provider_id ON users(provider, provider_id) WHERE provider IS NOT NULL;
