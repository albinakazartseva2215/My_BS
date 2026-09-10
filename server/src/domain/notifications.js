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
import { findMasterById } from '../db/repositories/masters.js';

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

const MONTH_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// Как formatDayTime выше, но с числом и месяцем — только день недели без
// даты не различает два разных дня, случайно совпавших по дню недели и
// времени (например, перенос на ту же комбинацию "день недели + время"
// через неделю). Отдельная функция, не правка formatDayTime — та
// используется для отмены и наложения (notifyIfAppointmentCancelledByOther,
// notifyDoubleBookedOwners), у которых этой неоднозначности нет (там
// сравнивать не с чем, показывается только один момент, не два), их формат
// не трогаем. Находка ручной проверки, docs/test-checklist.md, №2.
function formatDayDateTime(utcDate, timezone) {
  const { date, time, weekdayIso } = utcToLocalParts(utcDate, timezone);
  const [, month, day] = date.split('-').map(Number);
  return `${WEEKDAY_ACCUSATIVE[weekdayIso]}, ${day} ${MONTH_GENITIVE[month - 1]}, ${time.slice(0, 5)}`;
}

function masterNameOrFallback(masterId) {
  return findMasterById(masterId)?.name ?? `мастер №${masterId}`;
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
// oldMasterId/newMasterId — тем же способом: вызывающий код уже держит
// оба (они же идут в журнал переноса, insertRescheduleLogEntry, двумя
// строками выше в booking.js) — раньше сюда просто не передавались.
//
// Текст собирается по тому, что РЕАЛЬНО изменилось, а не всегда одной и
// той же фразой "было X, стало Y": если поменялось только время — текст
// как раньше, только с полной датой, а не только днём недели (иначе
// перенос на ту же комбинацию "день недели + время" через неделю выглядел
// бы как "перенесена на то же самое"); если поменялся только мастер —
// отдельная фраза про мастера, а не "перенесена на среду, 12:00, стало
// среда, 12:00", что выглядело бы как отсутствие изменений. Найдено
// ручной проверкой, docs/test-checklist.md, находка №2.
export function notifyIfAppointmentRescheduledByOther({
  appointmentId,
  ownerClientId,
  changedByUserId,
  oldStartUtc,
  newStartUtc,
  oldMasterId,
  newMasterId,
  timezone,
  now,
}) {
  if (!isForeignAction(changedByUserId, ownerClientId)) return;

  const timeChanged = oldStartUtc.getTime() !== newStartUtc.getTime();
  const masterChanged = oldMasterId !== newMasterId;
  const masterChangeClause = () =>
    `${masterNameOrFallback(oldMasterId)} → ${masterNameOrFallback(newMasterId)}`;

  let message;
  if (timeChanged) {
    const fromWhen = formatDayDateTime(oldStartUtc, timezone);
    const toWhen = formatDayDateTime(newStartUtc, timezone);
    message = `Запись на ${fromWhen} перенесена на ${toWhen}.`;
    if (masterChanged) message += ` Мастер изменён: ${masterChangeClause()}.`;
  } else if (masterChanged) {
    const when = formatDayDateTime(newStartUtc, timezone);
    message = `Мастер записи на ${when} изменён: ${masterChangeClause()}.`;
  } else {
    // Практически недостижимо через API (перенос всегда требует новое
    // startDatetime) — но не молчим и не показываем испорченный текст,
    // если это всё же произойдёт.
    message = `Запись на ${formatDayDateTime(newStartUtc, timezone)} обновлена администратором.`;
  }

  insertNotification({
    userId: ownerClientId,
    type: 'appointment_rescheduled',
    message,
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
