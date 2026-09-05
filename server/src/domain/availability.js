// Расчёт свободного времени мастера на дату — строго по алгоритму из
// docs/db-schema.md, раздел 5. Отдельной таблицы слотов нет и не
// создаётся: всё считается на лету из графика, исключений, записей и
// блокировок.

import {
  localToUtc,
  utcToLocalParts,
  isoWeekdayOfDateStr,
  addDaysToDateStr,
  dateToSql,
} from '../time/salonClock.js';
import { findScheduleExceptionForDate } from '../db/repositories/masters.js';
import db from '../db/connection.js';
import { releaseExpiredHolds } from './holdExpiry.js';

function getWorkingHoursForDate(masterId, dateStr) {
  const exception = findScheduleExceptionForDate(masterId, dateStr);
  if (exception) {
    if (exception.is_day_off === 1) return null;
    return { startTime: exception.start_time, endTime: exception.end_time };
  }
  const weekday = isoWeekdayOfDateStr(dateStr);
  const row = db
    .prepare('SELECT start_time, end_time FROM master_weekly_schedule WHERE master_id = ? AND weekday = ?')
    .get(masterId, weekday);
  if (!row) return null; // нет строки графика на этот день недели = выходной по умолчанию
  return { startTime: row.start_time, endTime: row.end_time };
}

// { salon, dateStr, now } -> { ok: true } | { ok: false, reason }
export function checkDateWithinBookingWindow(salon, dateStr, now) {
  const todayLocal = utcToLocalParts(now, salon.timezone).date;
  if (dateStr < todayLocal) return { ok: false, reason: 'past_date' };
  const horizonEnd = addDaysToDateStr(todayLocal, salon.booking_horizon_days);
  if (dateStr > horizonEnd) return { ok: false, reason: 'beyond_horizon' };
  return { ok: true };
}

// Возвращает { workStartUtc, workEndUtc } | null (мастер не работает в эту дату).
export function getWorkingWindowUtc(masterId, dateStr, timezone) {
  const hours = getWorkingHoursForDate(masterId, dateStr);
  if (!hours) return null;
  return {
    workStartUtc: localToUtc(dateStr, hours.startTime, timezone),
    workEndUtc: localToUtc(dateStr, hours.endTime, timezone),
  };
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0].getTime() - b[0].getTime());
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start.getTime() <= last[1].getTime()) {
      if (end.getTime() > last[1].getTime()) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function toIntervals(rows) {
  return rows.map((r) => [new Date(`${r.start_datetime.replace(' ', 'T')}Z`), new Date(`${r.end_datetime.replace(' ', 'T')}Z`)]);
}

// Разнесены на два отдельных запроса (а не один общий), чтобы
// assertSlotBookable могла с признаком overlap_override (docs/db-schema.md,
// 3.11б) выборочно пропустить только пересечение с другими ЗАПИСЯМИ, но
// не с ручными блокировками времени — админ осознанно бронирует поверх
// занятого клиентом слота, но это не значит, что можно поверх обеда.
function listAppointmentIntervals(masterId, workStartUtc, workEndUtc, excludeAppointmentId) {
  const fromSql = dateToSql(workStartUtc);
  const toSql = dateToSql(workEndUtc);
  const params = [masterId, toSql, fromSql];
  let sql = `SELECT id, start_datetime, end_datetime FROM appointments
             WHERE master_id = ? AND status IN ('hold','confirmed')
               AND start_datetime < ? AND end_datetime > ?`;
  if (excludeAppointmentId !== undefined && excludeAppointmentId !== null) {
    sql += ' AND id != ?';
    params.push(excludeAppointmentId);
  }
  return toIntervals(db.prepare(sql).all(...params));
}

function listTimeBlockIntervals(masterId, workStartUtc, workEndUtc) {
  const fromSql = dateToSql(workStartUtc);
  const toSql = dateToSql(workEndUtc);
  return toIntervals(
    db
      .prepare(
        `SELECT start_datetime, end_datetime FROM time_blocks
         WHERE master_id = ? AND start_datetime < ? AND end_datetime > ?`,
      )
      .all(masterId, toSql, fromSql),
  );
}

function listBusyIntervals(masterId, workStartUtc, workEndUtc, excludeAppointmentId) {
  return mergeIntervals([
    ...listAppointmentIntervals(masterId, workStartUtc, workEndUtc, excludeAppointmentId),
    ...listTimeBlockIntervals(masterId, workStartUtc, workEndUtc),
  ]);
}

// Ядро расчёта: список свободных стартов записи на дату для мастера при
// заданной суммарной длительности выбранных услуг.
//
// Помимо `slots` (только свободные — как было всегда, ради обратной
// совместимости с уже существующими потребителями, см. ниже) считает ещё
// `allSlots` — те же кандидаты старта, но ВСЕ, что вообще попадают в
// рабочее окно (включая занятые и уже прошедшие), с пометкой `status`.
// Понадобилось для Booking · 3 (docs/ui-map.md): экран должен показывать
// занятое время в сетке видимым и неактивным, а не молча его прятать —
// но публичный API до этого отдавал только свободные старты, и фронт не
// мог отличить «мастер занят в это время» от «мастер просто не работает
// в это время» (оба случая выглядели одинаково — отсутствием в списке).
// Без границ рабочего окна и шага сетки на клиенте это не восстановить
// (см. запись в server/README.md рядом с этой функцией про то, что шаг
// сетки не совпадает с длительностью услуги). `slots` при этом продолжает
// содержать ровно то же самое, что и раньше — только свободные, не
// прошедшие старты; `frontend/public/availability.html` как читал
// `data.slots`, так и продолжит.
export function computeAvailableSlots({ masterId, dateStr, durationMinutes, salon, now = new Date() }) {
  releaseExpiredHolds(now);

  const windowCheck = checkDateWithinBookingWindow(salon, dateStr, now);
  if (!windowCheck.ok) return { slots: [], allSlots: [], reason: windowCheck.reason };

  const window = getWorkingWindowUtc(masterId, dateStr, salon.timezone);
  if (!window) return { slots: [], allSlots: [], reason: 'day_off' };
  const { workStartUtc, workEndUtc } = window;

  const busy = listBusyIntervals(masterId, workStartUtc, workEndUtc);

  const stepMs = salon.booking_step_minutes * 60_000;
  const durationMs = durationMinutes * 60_000;
  const slots = [];
  const allSlots = [];
  for (
    let startMs = workStartUtc.getTime();
    startMs + durationMs <= workEndUtc.getTime();
    startMs += stepMs
  ) {
    const slotStart = new Date(startMs);
    const slotEnd = new Date(startMs + durationMs);
    const isPast = startMs <= now.getTime(); // прошедшее и текущее время не предлагаем
    const overlaps = !isPast && busy.some(([bs, be]) => slotStart.getTime() < be.getTime() && slotEnd.getTime() > bs.getTime());
    const status = isPast ? 'past' : overlaps ? 'busy' : 'free';
    allSlots.push({ startUtc: slotStart, endUtc: slotEnd, status });
    if (status === 'free') slots.push({ startUtc: slotStart, endUtc: slotEnd });
  }
  return { slots, allSlots, reason: slots.length ? null : 'fully_booked' };
}

// Проверка на конкретный произвольный интервал (используется при создании
// удержания/записи/переносе — клиент присылает точное время начала, не
// обязательно совпадающее с шагом сетки, поэтому проверяем интервал
// напрямую, а не ищем его в списке слотов).
//
// allowAppointmentOverlap (docs/db-schema.md, 3.11б) — только для
// администратора, создающего запись осознанно поверх занятого времени:
// пропускает пересечение с другими appointments (тем же самым, что и
// БД-триггер trg_appointments_no_overlap_insert при overlap_override=1),
// но НЕ пропускает пересечение с time_blocks — ручная блокировка (обед,
// техническая пауза) не считается "занятым слотом клиента" и этим
// признаком не снимается.
export function assertSlotBookable({
  masterId,
  startUtc,
  endUtc,
  salon,
  now = new Date(),
  excludeAppointmentId,
  allowAppointmentOverlap = false,
}) {
  const dateStr = utcToLocalParts(startUtc, salon.timezone).date;

  const windowCheck = checkDateWithinBookingWindow(salon, dateStr, now);
  if (!windowCheck.ok) return { ok: false, reason: windowCheck.reason };

  if (startUtc.getTime() <= now.getTime()) return { ok: false, reason: 'past_date' };

  const window = getWorkingWindowUtc(masterId, dateStr, salon.timezone);
  if (!window) return { ok: false, reason: 'day_off' };
  if (startUtc.getTime() < window.workStartUtc.getTime() || endUtc.getTime() > window.workEndUtc.getTime()) {
    return { ok: false, reason: 'outside_working_hours' };
  }

  const busy = allowAppointmentOverlap
    ? listTimeBlockIntervals(masterId, window.workStartUtc, window.workEndUtc)
    : listBusyIntervals(masterId, window.workStartUtc, window.workEndUtc, excludeAppointmentId);
  const overlaps = busy.some(([bs, be]) => startUtc.getTime() < be.getTime() && endUtc.getTime() > bs.getTime());
  if (overlaps) return { ok: false, reason: 'slot_taken' };

  return { ok: true };
}

// Ближайшие свободные слоты того же мастера начиная с даты fromDateStr —
// используется, чтобы при отказе 409 ("время занято") сразу предложить
// альтернативы, а не заставлять клиента запрашивать их отдельным вызовом.
// Идёт день за днём вперёд, пока не наберёт `limit` слотов или не упрётся
// в горизонт бронирования (после него computeAvailableSlots всё равно
// вернёт пустой список, дальше сканировать бессмысленно).
export function findNearbySlots({ masterId, durationMinutes, salon, fromDateStr, now = new Date(), limit = 5 }) {
  const todayLocal = utcToLocalParts(now, salon.timezone).date;
  const horizonEnd = addDaysToDateStr(todayLocal, salon.booking_horizon_days);

  const found = [];
  let dateStr = fromDateStr < todayLocal ? todayLocal : fromDateStr;
  while (found.length < limit && dateStr <= horizonEnd) {
    const { slots } = computeAvailableSlots({ masterId, dateStr, durationMinutes, salon, now });
    for (const slot of slots) {
      if (found.length >= limit) break;
      found.push(slot);
    }
    dateStr = addDaysToDateStr(dateStr, 1);
  }
  return found;
}
