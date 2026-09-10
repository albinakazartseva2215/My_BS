-- Источник истины — docs/db-schema.md, раздел 3.14 (правки схемы сначала
-- вносятся в документ, эта миграция дословно повторяет DDL оттуда).
-- 001-007 уже применены и не редактируются — это отдельная миграция.
--
-- Уведомления в личном кабинете клиента — раньше не было ни хранилища,
-- ни одного эндпоинта под события уведомлений (docs/db-schema.md, раздел 7,
-- «Что на стороне экрана решить нельзя»). Ровно три события — см. раздел 8
-- документа схемы, «Когда создаётся уведомление».

CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('appointment_cancelled', 'appointment_rescheduled', 'appointment_double_booked')),
  message         TEXT NOT NULL,
  appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  is_read         INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX ix_notifications_user_unread ON notifications(user_id) WHERE is_read = 0;
