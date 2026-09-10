// Доменная логика бронирования: создание удержания слота, подтверждение
// записи (с удержанием или напрямую), перенос, отмена.
//
// Защита от двойной записи — три независимых уровня:
//
//  1. Триггеры БД (src/db/migrations/002_appointment_overlap_triggers.sql,
//     trg_appointments_no_overlap_insert/_update) — запрещают пересечение
//     диапазонов на уровне самой таблицы appointments, при INSERT и при
//     UPDATE (перенос, смена мастера). Это авторитетная проверка: она
//     сработает, даже если код приложения её обойдёт или ошибётся.
//  2. Транзакция BEGIN IMMEDIATE (см. runOverlapProtectedInsert ниже) —
//     блокировка на запись берётся сразу в начале транзакции, а не в
//     момент первой вставки.
//  3. Здесь, в приложении: ошибка триггера перехватывается и превращается
//     в 409 с понятным русским текстом и списком ближайших свободных
//     слотов — сырой текст ошибки SQLite клиенту никогда не отдаётся.
//
// Проверка диапазона в коде (assertSlotBookable, src/domain/availability.js)
// выполняется ДО транзакции и остаётся нужна отдельно от триггера: триггер
// видит только таблицу appointments, а assertSlotBookable ещё и график
// работы, исключения и ручные блокировки (time_blocks — не appointments,
// триггер их не проверяет). Так что первым тревогу поднимает обычно код
// приложения (400 — понятная причина: выходной, вне часов работы и т.п.),
// а триггер — молчаливый последний рубеж на случай гонки между этой
// проверкой и вставкой (например, два запроса почти одновременно прошли
// pre-check и оба попали в транзакцию).

import crypto from 'node:crypto';
import db from '../db/connection.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { dateToSql, sqlToDate, toIsoUtc, formatLocalIso, utcToLocalParts } from '../time/salonClock.js';
import { findMasterById, masterCanPerformAllServices } from '../db/repositories/masters.js';
import { findServicesByIds } from '../db/repositories/services.js';
import { getSalonProfile } from '../db/repositories/salonProfile.js';
import { assertSlotBookable, findNearbySlots } from './availability.js';
import { releaseExpiredHolds } from './holdExpiry.js';
import {
  notifyIfAppointmentCancelledByOther,
  notifyIfAppointmentRescheduledByOther,
  notifyDoubleBookedOwners,
} from './notifications.js';
import {
  findAppointmentById,
  findAppointmentByHoldToken,
  listAppointmentServices,
  insertAppointmentRow,
  insertAppointmentService,
  confirmHoldAppointment,
  rescheduleAppointment as rescheduleAppointmentRow,
  insertRescheduleLogEntry,
  cancelAppointment as cancelAppointmentRow,
  completeAppointment as completeAppointmentRow,
} from '../db/repositories/appointments.js';

export function randomHoldToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Загружает и валидирует набор услуг: существуют, активны, и (если указан
// мастер) конкретный мастер выполняет все из них. Бросает ApiError(400).
export function resolveServicesOrThrow(serviceIds, masterId) {
  const services = findServicesByIds(serviceIds);
  if (services.length !== serviceIds.length) {
    throw badRequest('Одна или несколько услуг не найдены');
  }
  const inactive = services.filter((s) => s.is_active !== 1);
  if (inactive.length > 0) {
    throw badRequest('Одна или несколько услуг недоступны для записи', {
      serviceIds: inactive.map((s) => s.id),
    });
  }
  if (masterId !== undefined && !masterCanPerformAllServices(masterId, serviceIds)) {
    throw badRequest('Выбранный мастер не выполняет одну или несколько из выбранных услуг');
  }
  const totalDurationMinutes = services.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalPriceRub = services.reduce((sum, s) => sum + s.price_rub, 0);
  return { services, totalDurationMinutes, totalPriceRub };
}

export function getActiveMasterOrThrow(masterId) {
  const master = findMasterById(masterId);
  if (!master || master.is_active !== 1) throw badRequest('Мастер не найден или недоступен для записи');
  return master;
}

// Сообщение, которое RAISE(ABORT, ...) в триггерах trg_appointments_no_overlap_*
// кладёт в текст ошибки SQLite — см. 002_appointment_overlap_triggers.sql.
const OVERLAP_TRIGGER_MESSAGE = 'appointment_overlap';

function isOverlapConflictError(err) {
  if (typeof err.message !== 'string') return false;
  if (err.message === OVERLAP_TRIGGER_MESSAGE) return true;
  // Частичный уникальный индекс ux_appt_master_slot_active (docs/db-schema.md,
  // раздел 4) — более узкая, но более старая защита (точное совпадение
  // времени старта). node:sqlite не включает имя индекса в сообщение,
  // только список колонок: "UNIQUE constraint failed: appointments.master_id,
  // appointments.start_datetime". Триггер выше срабатывает раньше и ловит
  // этот же случай, но проверка оставлена как подстраховка на будущее.
  return err.message.includes('UNIQUE constraint failed') && err.message.includes('appointments.start_datetime');
}

// Собирает 409-ответ на конфликт слота: понятный текст + список ближайших
// свободных альтернатив у этого же мастера — чтобы клиенту не пришлось
// делать отдельный запрос к /availability после отказа.
function buildSlotTakenConflict({ masterId, startUtc, durationMinutes, salon }) {
  const fromDateStr = utcToLocalParts(startUtc, salon.timezone).date;
  const nearbySlots = findNearbySlots({ masterId, durationMinutes, salon, fromDateStr }).map((slot) => ({
    startUtc: toIsoUtc(slot.startUtc),
    endUtc: toIsoUtc(slot.endUtc),
    startLocal: formatLocalIso(slot.startUtc, salon.timezone),
    endLocal: formatLocalIso(slot.endUtc, salon.timezone),
  }));
  return conflict('Это время уже занято, выберите другое', { nearbySlots });
}

function slotCheckToApiError(reason, context) {
  switch (reason) {
    case 'slot_taken':
      return buildSlotTakenConflict(context);
    case 'outside_working_hours':
      return badRequest('Выбранное время вне рабочих часов мастера');
    case 'day_off':
      return badRequest('У мастера выходной в выбранную дату');
    case 'past_date':
      return badRequest('Нельзя записаться в прошлое');
    case 'beyond_horizon':
      return badRequest('Дата дальше горизонта записи');
    default:
      return badRequest('Выбранное время недоступно для записи');
  }
}

// BEGIN IMMEDIATE, а не обычный BEGIN (= BEGIN DEFERRED в SQLite): обычная
// отложенная транзакция берёт блокировку только на первой инструкции
// чтения/записи, то есть между стартом транзакции и вставкой есть окно,
// где два процесса могут договориться начать писать "одновременно" — при
// апгрейде до RESERVED-блокировки один из них в WAL-режиме может упасть с
// SQLITE_BUSY посреди работы, уже сделав часть проверок. IMMEDIATE берёт
// RESERVED-блокировку на запись сразу в начале транзакции: конкурентная
// попытка записи (из другого процесса/соединения к тому же файлу) либо
// ждёт эту блокировку, либо сразу получает понятный SQLITE_BUSY на самом
// BEGIN — без риска частично выполненной, полу-провалидированной гонки
// внутри уже открытой транзакции. Строгий EXCLUSIVE здесь избыточен: он
// блокировал бы ещё и параллельное чтение (в WAL это не нужно — читатели
// сервиса вроде /availability не должны ждать чужую запись).
function runOverlapProtectedInsert(insertFn, conflictContext) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = insertFn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    if (isOverlapConflictError(err)) {
      throw buildSlotTakenConflict(conflictContext);
    }
    throw err;
  }
}

// Единственная функция, которая создаёт запись — для всех сценариев и
// всех ролей, которые вообще могут её создать:
//   - анонимное/клиентское удержание слота, шаг 3 прототипа (routes/holds.routes.js);
//   - прямое бронирование клиентом без удержания (routes/appointments.routes.js);
//   - бронирование администратором, включая осознанное наложение (routes/admin.routes.js).
// "Мастер" в этом списке не участвует, хотя с docs/db-schema.md, раздел
// 3.2/3.6 роль 'master' в системе теперь есть (пользователь с ролью
// master может быть привязан к профилю в masters) — но эта роль даёт
// только право ВИДЕТЬ записи своего расписания (routes/appointments.routes.js,
// assertCanAccessAppointment), не создавать их. Создание записи мастером
// от себя ли, от лица клиента — отдельная функция, которую никто не
// запрашивал; расширять список ролей здесь молча не стали.
//
// Роль и то, какие поля ей доступны, определяются ДО вызова — в routes/*:
// какой status передать, разрешено ли передать overlapOverride и т.п. Сама
// функция про роли ничего не знает, только про параметры. Единственный
// оператор INSERT в appointments — insertAppointmentRow в
// db/repositories/appointments.js; эта функция — единственное место в
// коде, которое его вызывает.
export function createAppointment({
  masterId,
  startUtc,
  serviceIds,
  clientId = null,
  status,
  comment = null,
  remindEnabled = true,
  overlapOverride = false,
  now = new Date(),
}) {
  if (status !== 'hold' && status !== 'confirmed') {
    // Программная ошибка вызывающего кода, не пользовательский ввод —
    // routes/* всегда передают литерал 'hold' или 'confirmed'.
    throw new Error(`createAppointment: недопустимый status "${status}"`);
  }
  if (status === 'confirmed' && clientId === null) {
    throw new Error('createAppointment: подтверждённая запись требует clientId');
  }

  releaseExpiredHolds(now);
  const salon = getSalonProfile();

  getActiveMasterOrThrow(masterId);
  const { services, totalDurationMinutes, totalPriceRub } = resolveServicesOrThrow(serviceIds, masterId);
  const endUtc = new Date(startUtc.getTime() + totalDurationMinutes * 60_000);

  const conflictContext = { masterId, startUtc, durationMinutes: totalDurationMinutes, salon };
  const check = assertSlotBookable({ masterId, startUtc, endUtc, salon, now, allowAppointmentOverlap: overlapOverride });
  if (!check.ok) throw slotCheckToApiError(check.reason, conflictContext);

  const holdToken = status === 'hold' ? randomHoldToken() : null;
  // Длительность удержания — продуктовая настройка в salon_profile
  // (docs/db-schema.md, раздел 3.1а), не .env: администратор салона
  // должен мочь её поменять тем же способом, что и booking_step_minutes.
  const holdExpiresAt =
    status === 'hold' ? new Date(now.getTime() + salon.hold_duration_minutes * 60_000) : null;
  const nowSql = dateToSql(now);

  // Внутри транзакции сам INSERT — без повторной ручной проверки в JS:
  // если между pre-check выше и этим BEGIN IMMEDIATE слот успел занять
  // кто-то ещё, вставку остановит триггер БД (см. заголовок файла), а
  // catch в runOverlapProtectedInsert превратит это в тот же 409.
  return runOverlapProtectedInsert(() => {
    const row = insertAppointmentRow({
      clientId,
      masterId,
      startSql: dateToSql(startUtc),
      endSql: dateToSql(endUtc),
      status,
      holdToken,
      holdExpiresAtSql: holdExpiresAt ? dateToSql(holdExpiresAt) : null,
      comment,
      remindEnabled,
      overlapOverride,
      totalPriceRub,
      totalDurationMinutes,
      now: nowSql,
    });
    for (const service of services) insertAppointmentService(row.id, service);
    // Уведомление — только когда это реально осознанное наложение
    // администратора (docs/db-schema.md, раздел 3.11б: overlapOverride
    // может стать true только из routes/admin.routes.js); обычная запись
    // клиента сюда не попадает вообще, overlapOverride у неё всегда false.
    if (overlapOverride) {
      notifyDoubleBookedOwners({
        newAppointmentId: row.id,
        masterId,
        startSql: row.start_datetime,
        endSql: row.end_datetime,
        timezone: salon.timezone,
        now,
      });
    }
    return row;
  }, conflictContext);
}

// Шаг 5: подтверждение ранее созданного удержания клиентом, который к
// этому моменту уже вошёл/зарегистрировался (client_id проставляется тут).
// Это UPDATE уже существующей строки, не создание новой — отдельного
// INSERT здесь нет, см. createAppointment выше.
export function confirmHold({ holdToken, clientId, comment, remindEnabled, now = new Date() }) {
  releaseExpiredHolds(now);
  const appointment = findAppointmentByHoldToken(holdToken);
  if (!appointment) throw notFound('Удержание не найдено или уже истекло');
  if (appointment.client_id !== null && appointment.client_id !== clientId) {
    throw conflict('Эта бронь уже привязана к другому аккаунту');
  }
  return confirmHoldAppointment({
    id: appointment.id,
    clientId,
    comment: comment ?? null,
    remindEnabled: remindEnabled ?? true,
    now: dateToSql(now),
  });
}

// changedByUserId — кто выполнил перенос (docs/db-schema.md, 3.13); всегда
// ctx.user.id со стороны маршрута (requireAuth уже прошёл), сюда не
// передаётся ничем, кроме самого вызывающего кода — переносящий не может
// подставить чужой id. Один и тот же вызов обслуживает и клиента (только
// новое время у своего же мастера — смену мастера routes/*.js для
// клиента отклоняет ещё до этой функции), и администратора (новое время
// и/или новый мастер).
export function rescheduleAppointment({ appointmentId, newStartUtc, newMasterId, changedByUserId = null, now = new Date() }) {
  releaseExpiredHolds(now);
  const appointment = findAppointmentById(appointmentId);
  if (!appointment) throw notFound('Запись не найдена');
  if (appointment.status !== 'confirmed') {
    throw conflict('Переносить можно только подтверждённую запись');
  }
  const salon = getSalonProfile();
  const masterId = newMasterId ?? appointment.master_id;
  getActiveMasterOrThrow(masterId);

  // Тот же инвариант, что и при создании записи — resolveServicesOrThrow
  // выше, строка про masterCanPerformAllServices: мастер, которому в
  // итоге принадлежит запись, обязан уметь выполнить ВСЕ её услуги. При
  // переносе с явной сменой мастера (newMasterId) эта проверка раньше не
  // выполнялась вовсе — подтверждённая ручной проверкой находка №1,
  // docs/test-checklist.md. Проверяем всегда, не только при смене
  // мастера, — тем же способом закрывается и соседний случай, когда
  // набор услуг мастера изменили (PUT .../masters/:id/services) уже
  // после того, как запись была создана на него.
  const serviceIds = listAppointmentServices(appointment.id).map((row) => row.service_id);
  if (!masterCanPerformAllServices(masterId, serviceIds)) {
    throw badRequest('Выбранный мастер не выполняет одну или несколько из выбранных услуг');
  }

  const endUtc = new Date(newStartUtc.getTime() + appointment.total_duration_minutes * 60_000);

  const conflictContext = {
    masterId,
    startUtc: newStartUtc,
    durationMinutes: appointment.total_duration_minutes,
    salon,
  };
  const check = assertSlotBookable({
    masterId,
    startUtc: newStartUtc,
    endUtc,
    salon,
    now,
    excludeAppointmentId: appointment.id,
  });
  if (!check.ok) throw slotCheckToApiError(check.reason, conflictContext);

  // "Старое" — из appointment, прочитанного ДО UPDATE выше (переменная
  // из замыкания, не повторный запрос); журнал переноса — в той же
  // транзакции, что и сам UPDATE, чтобы строка appointments и запись о
  // переносе либо появились обе, либо ни одна (откат при конфликте).
  const oldStartSql = appointment.start_datetime;
  const oldMasterId = appointment.master_id;
  const nowSql = dateToSql(now);

  return runOverlapProtectedInsert(() => {
    const updated = rescheduleAppointmentRow({
      id: appointment.id,
      masterId,
      startSql: dateToSql(newStartUtc),
      endSql: dateToSql(endUtc),
      now: nowSql,
    });
    insertRescheduleLogEntry({
      appointmentId: appointment.id,
      oldStartSql,
      oldMasterId,
      newStartSql: dateToSql(newStartUtc),
      newMasterId: masterId,
      changedByUserId,
      now: nowSql,
    });
    notifyIfAppointmentRescheduledByOther({
      appointmentId: appointment.id,
      ownerClientId: appointment.client_id,
      changedByUserId,
      oldStartUtc: sqlToDate(oldStartSql),
      newStartUtc,
      oldMasterId,
      newMasterId: masterId,
      timezone: salon.timezone,
      now,
    });
    return updated;
  }, conflictContext);
}

// cancelledByUserId/reason — кто и почему отменил (docs/db-schema.md,
// 3.11г); тем же принципом, что и changedByUserId выше — всегда
// ctx.user.id вызывающего маршрута, не значение из тела чужого запроса.
export function cancelAppointment({ appointmentId, cancelledByUserId = null, reason = null, now = new Date() }) {
  const appointment = findAppointmentById(appointmentId);
  if (!appointment) throw notFound('Запись не найдена');
  if (!['hold', 'confirmed'].includes(appointment.status)) {
    throw conflict('Эту запись уже нельзя отменить — она не активна');
  }
  const cancelled = cancelAppointmentRow({ id: appointment.id, now: dateToSql(now), cancelledByUserId, reason });
  notifyIfAppointmentCancelledByOther({
    appointment,
    cancelledByUserId,
    timezone: getSalonProfile().timezone,
    now,
  });
  return cancelled;
}

// Ручная половина docs/db-schema.md, раздел 6 ("completed... проставляется
// фоновой задачей или админом") — фоновая часть в domain/completionSweep.js.
// Только админ (проверка роли — в routes/admin.routes.js, до вызова этой
// функции); клиент завершить свою же запись не может — это не отмена.
export function markAppointmentCompleted({ appointmentId, now = new Date() }) {
  const appointment = findAppointmentById(appointmentId);
  if (!appointment) throw notFound('Запись не найдена');
  if (appointment.status !== 'confirmed') {
    throw conflict('Завершить можно только подтверждённую запись');
  }
  return completeAppointmentRow({ id: appointment.id, now: dateToSql(now) });
}
