-- Признак осознанного наложения записи ("админ бронирует поверх занятого
-- времени") + правка триггера вставки, чтобы он пропускал такие записи.
-- Источник истины — docs/db-schema.md, раздел 3.11б (правки схемы сначала
-- вносятся в документ). 001_init.sql и 002_...sql уже применены на боевой
-- базе и не редактируются — это отдельная миграция.

-- SQLite умеет добавлять колонку с DEFAULT/NOT NULL/CHECK через ALTER TABLE
-- ADD COLUMN (проверено отдельно на node:sqlite) — не нужна пересборка таблицы.
ALTER TABLE appointments
  ADD COLUMN overlap_override INTEGER NOT NULL DEFAULT 0 CHECK (overlap_override IN (0, 1));

-- SQLite не поддерживает ALTER TRIGGER — меняем через DROP + CREATE.
-- Меняется только триггер на INSERT: он получает признак осознанного
-- наложения от НОВОЙ строки и решает, проверять её или нет.
DROP TRIGGER trg_appointments_no_overlap_insert;

CREATE TRIGGER trg_appointments_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed') AND NEW.overlap_override = 0
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap')
  WHERE EXISTS (
    SELECT 1 FROM appointments
    WHERE master_id = NEW.master_id
      AND status IN ('hold', 'confirmed')
      AND NEW.start_datetime < end_datetime
      AND NEW.end_datetime > start_datetime
  );
END;

-- trg_appointments_no_overlap_update НЕ меняется и признак НЕ учитывает —
-- сознательное решение, см. docs/db-schema.md, "Спорные решения" п.13:
-- наложение прощается только в момент создания записи админом, а любое
-- дальнейшее изменение этой же записи (перенос, смена мастера) проверяется
-- как у обычной записи, без исключений.

-- Частичный уникальный индекс ux_appt_master_slot_active (001_init.sql,
-- раздел 4 документа схемы) — та же проблема, что и с триггером: он не
-- знает про overlap_override и блокирует ИМЕННО самый частый случай
-- наложения, который и нужен админу, — совпадение времени СТАРТА с уже
-- существующей активной записью. Без правки индекса признак работал бы
-- только для пересечений при разных стартах, а не для "поверх той же
-- самой брони". SQLite не поддерживает ALTER INDEX — пересоздаём.
DROP INDEX ux_appt_master_slot_active;

CREATE UNIQUE INDEX ux_appt_master_slot_active
  ON appointments(master_id, start_datetime)
  WHERE status IN ('hold', 'confirmed') AND overlap_override = 0;
