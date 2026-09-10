// Создание уведомлений — ровно для трёх событий (docs/db-schema.md,
// раздел 8, «Когда создаётся уведомление»): администратор отменил чужую
// запись, администратор перенёс чужую запись, администратор создал новую
// запись поверх уже занятого времени. Единственный вызывающий код —
// domain/booking.js (cancelAppointment/rescheduleAppointment/createAppointment),
// там же, где уже известны и actor (кто выполнил действие), и owner
// (appointments.client_id) — эти три функции сравнивают их напрямую, не
// обращаясь к ролям: "actor id ≠ owner id" — и есть "не по инициативе
// самого пользователя".
//
// Текст — готовая строка на момент события (см. обоснование в
// docs/db-schema.md, раздел 7, п.18) — конкретные день недели и время, не
// общая фраза вроде "Ваша запись изменена".

import { insertNotification } from '../db/repositories/notifications.js';
import { sqlToDate, utcToLocalParts, dateToSql } from '../time/salonClock.js';
import { findAppointmentsOverlapping } from '../db/repositories/appointments.js';

// Винительный падеж дня недели — так же, как в примере из самой задачи:
// "Запись на четверг, 14:00 перенесена на пятницу, 11:00" (четверг у
// неодушевлённых существительных мужского рода совпадает с именительным,
// пятница/суббота/среда — нет, поэтому это не тот же массив, что мог бы
// использоваться для "сегодня — пятница"). Индекс — ISO-номер дня недели
// (1 = понедельник … 7 = воскресенье, см. time/salonClock.js:utcToLocalParts).
const WEEKDAY_ACCUSATIVE = [
  null,
  'понедельник',
  'вторник',
  'среду',
  'четверг',
  'пятницу',
  'субботу',
  'воскресенье',
];

function formatDayTime(utcDate, timezone) {
  const { time, weekdayIso } = utcToLocalParts(utcDate, timezone);
  return `${WEEKDAY_ACCUSATIVE[weekdayIso]}, ${time.slice(0, 5)}`;
}

// actor может действовать не от своего имени (админ), только если он не
// владелец записи — единственная проверка, общая для отмены и переноса.
function isForeignAction(actorUserId, ownerClientId) {
  return actorUserId !== null && actorUserId !== undefined && ownerClientId !== null && actorUserId !== ownerClientId;
}

// Вызывать ПОСЛЕ того, как cancelAppointment уже применил UPDATE — appointment
// здесь передаётся ДО отмены (со старым client_id, он не меняется отменой,
// но так явнее, откуда берётся получатель) вместе с cancelledByUserId,
// который знает только вызывающий код (domain/booking.js), не эта функция.
export function notifyIfAppointmentCancelledByOther({ appointment, cancelledByUserId, timezone, now }) {
  if (!isForeignAction(cancelledByUserId, appointment.client_id)) return;
  const when = formatDayTime(sqlToDate(appointment.start_datetime), timezone);
  insertNotification({
    userId: appointment.client_id,
    type: 'appointment_cancelled',
    message: `Запись на ${when} отменена администратором.`,
    appointmentId: appointment.id,
    now: dateToSql(now),
  });
}

// oldStartUtc/newStartUtc — оба явно переданы вызывающим кодом
// (domain/booking.js:rescheduleAppointment уже держит оба значения на
// момент вызова: старое — из строки, прочитанной до UPDATE, новое — из
// аргумента newStartUtc), эта функция сама ничего не пересчитывает.
export function notifyIfAppointmentRescheduledByOther({
  appointmentId,
  ownerClientId,
  changedByUserId,
  oldStartUtc,
  newStartUtc,
  timezone,
  now,
}) {
  if (!isForeignAction(changedByUserId, ownerClientId)) return;
  const fromWhen = formatDayTime(oldStartUtc, timezone);
  const toWhen = formatDayTime(newStartUtc, timezone);
  insertNotification({
    userId: ownerClientId,
    type: 'appointment_rescheduled',
    message: `Запись на ${fromWhen} перенесена на ${toWhen}.`,
    appointmentId,
    now: dateToSql(now),
  });
}

// Вызывать только когда createAppointment реально создала запись с
// overlapOverride=true (routes/admin.routes.js — единственное место,
// откуда это поле вообще может стать true, см. docs/db-schema.md,
// раздел 3.11б). Ищет все чужие активные записи этого же мастера,
// пересекающиеся по времени с новой (тем же условием, что и триггер БД,
// docs/db-schema.md, раздел 3.11а), и уведомляет владельца каждой —
// не владельца новой записи: это его же собственное, только что явно
// подтверждённое действие, уведомлять не о чем.
export function notifyDoubleBookedOwners({ newAppointmentId, masterId, startSql, endSql, timezone, now }) {
  const overlapping = findAppointmentsOverlapping({ masterId, startSql, endSql, excludeId: newAppointmentId });
  for (const other of overlapping) {
    if (!other.client_id) continue; // анонимное удержание — уведомлять некого
    const when = formatDayTime(sqlToDate(other.start_datetime), timezone);
    insertNotification({
      userId: other.client_id,
      type: 'appointment_double_booked',
      message: `На ваше время записи (${when}) администратор записал ещё одного клиента.`,
      appointmentId: other.id,
      now: dateToSql(now),
    });
  }
}
