-- Источник истины — docs/db-schema.md, разделы 3.11г и 3.13 (правки схемы
-- сначала вносятся в документ, эта миграция дословно повторяет DDL
-- оттуда). 001-006 уже применены и не редактируются — это отдельная
-- миграция.
--
-- Админ-панель («Записи») требует знать не только "запись отменена", но
-- кем и почему (3.11г), и не только "запись сейчас в другое время", а
-- откуда, куда и кем её перенесли — причём перенос может случиться не
-- один раз, поэтому это отдельный журнал, а не пара колонок (3.13).

ALTER TABLE appointments
  ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments
  ADD COLUMN cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300);

CREATE TABLE appointment_reschedule_log (
  id                  INTEGER PRIMARY KEY,
  appointment_id      INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  old_start_datetime  TEXT NOT NULL,
  old_master_id       INTEGER NOT NULL REFERENCES masters(id),
  new_start_datetime  TEXT NOT NULL,
  new_master_id       INTEGER NOT NULL REFERENCES masters(id),
  changed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX ix_reschedule_log_appointment ON appointment_reschedule_log(appointment_id);
