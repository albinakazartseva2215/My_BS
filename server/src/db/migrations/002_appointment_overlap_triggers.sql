-- Триггеры БД, запрещающие пересечение записей одного мастера по времени.
-- Источник истины — docs/db-schema.md, раздел 3.11а (правки схемы сначала
-- вносятся в документ, миграция дословно повторяет DDL оттуда).
--
-- Зачем это нужно поверх ux_appt_master_slot_active (раздел 4 документа):
-- тот частичный уникальный индекс ловит только точное совпадение времени
-- СТАРТА двух записей одного мастера. Он не видит случай, когда услуги
-- разной длительности пересекаются при РАЗНЫХ стартах (например, визит
-- 10:00–11:30 и визит 11:00–11:20 у одного мастера) — SQLite не поддерживает
-- range-exclusion ограничения (EXCLUDE, как в PostgreSQL), поэтому раньше
-- этот случай ловился только проверкой в коде приложения (см.
-- src/domain/availability.js, assertSlotBookable) внутри транзакции.
-- Триггеры переносят эту проверку на уровень самой БД — последний и
-- самый надёжный рубеж, который сработает, даже если проверку в коде
-- где-то забудут вызвать или обойдут при прямом доступе к базе.
--
-- Условие пересечения — строго по формуле "начало одного меньше конца
-- другого И конец одного больше начала другого": NEW.start_datetime <
-- other.end_datetime AND NEW.end_datetime > other.start_datetime. Записи
-- впритык (конец одной равен началу другой, например 15:00–16:00 и
-- 16:00–17:00) под это условие не попадают и пересечением не считаются.
--
-- Проверяются только "активные" записи одного мастера — status IN
-- ('hold','confirmed'). Отменённые (cancelled), истёкшие (expired) и уже
-- оказанные (completed) слот не занимают и в проверку не входят — ни как
-- новая строка (WHEN NEW.status IN (...) не даёт триггеру сработать на
-- отмену/истечение), ни как существующая (WHERE status IN (...) в подзапросе).
--
-- Два триггера, а не один: BEFORE INSERT ловит новую запись/удержание,
-- BEFORE UPDATE — перенос записи (смена start_datetime/end_datetime) и
-- смену мастера (смена master_id), включая случай, когда админ переносит
-- запись на другого мастера прямо в занятое у него время.

CREATE TRIGGER trg_appointments_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed')
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

CREATE TRIGGER trg_appointments_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap')
  WHERE EXISTS (
    SELECT 1 FROM appointments
    WHERE master_id = NEW.master_id
      AND status IN ('hold', 'confirmed')
      AND id != NEW.id
      AND NEW.start_datetime < end_datetime
      AND NEW.end_datetime > start_datetime
  );
END;
