import db from '../connection.js';

export function findAppointmentById(id) {
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}

export function findAppointmentByHoldToken(holdToken) {
  return db.prepare("SELECT * FROM appointments WHERE hold_token = ? AND status = 'hold'").get(holdToken);
}

export function listAppointmentServices(appointmentId) {
  return db
    .prepare('SELECT * FROM appointment_services WHERE appointment_id = ? ORDER BY service_id ASC')
    .all(appointmentId);
}

export function listAppointmentServicesForMany(appointmentIds) {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM appointment_services WHERE appointment_id IN (${placeholders})`)
    .all(...appointmentIds);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.appointment_id)) map.set(row.appointment_id, []);
    map.get(row.appointment_id).push(row);
  }
  return map;
}


// Единственное место в кодовой базе, где строится INSERT в appointments —
// используется для всех трёх ролей (клиент, администратор; "мастер" не
// логинится и записей не создаёт, см. docs/db-schema.md, 3.6) и для обоих
// статусов, с которыми запись вообще может родиться (`hold`/`confirmed`).
// Раньше здесь было две функции — insertHoldAppointment и
// insertConfirmedAppointment — с двумя разными операторами INSERT; сведены
// в одну по требованию "второго пути вставки записи в базу быть не
// должно". Различия между ролями/сценариями — это только значения
// параметров (status, hold_token/hold_expires_at, overlap_override), не
// отдельный SQL и не отдельная функция. Вызывать эту функцию напрямую
// не следует — единственный вызывающий код — createAppointment в
// domain/booking.js, который сначала прогоняет проверки (см. её заголовок).
export function insertAppointmentRow({
  clientId,
  masterId,
  startSql,
  endSql,
  status,
  holdToken = null,
  holdExpiresAtSql = null,
  comment = null,
  remindEnabled = true,
  totalPriceRub,
  totalDurationMinutes,
  now,
  // Признак осознанного наложения (docs/db-schema.md, 3.11б) — по умолчанию
  // 0. В true его может превратить только вызывающий код в domain/booking.js,
  // и только когда его вызвали из admin.routes.js после requireRole(ctx,'admin').
  overlapOverride = false,
}) {
  const info = db
    .prepare(
      `INSERT INTO appointments
         (client_id, master_id, start_datetime, end_datetime, status, hold_expires_at, hold_token,
          comment, remind_enabled, total_price_rub, total_duration_minutes, created_at, updated_at, overlap_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clientId,
      masterId,
      startSql,
      endSql,
      status,
      holdExpiresAtSql,
      holdToken,
      comment,
      remindEnabled ? 1 : 0,
      totalPriceRub,
      totalDurationMinutes,
      now,
      now,
      overlapOverride ? 1 : 0,
    );
  return findAppointmentById(Number(info.lastInsertRowid));
}

export function insertAppointmentService(appointmentId, service) {
  db.prepare(
    `INSERT INTO appointment_services
       (appointment_id, service_id, service_name_snapshot, price_rub_snapshot, duration_minutes_snapshot)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(appointmentId, service.id, service.name, service.price_rub, service.duration_minutes);
}

export function confirmHoldAppointment({ id, clientId, comment, remindEnabled, now }) {
  db.prepare(
    `UPDATE appointments
     SET status = 'confirmed', client_id = ?, comment = ?, remind_enabled = ?, hold_expires_at = NULL,
         hold_token = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(clientId, comment, remindEnabled ? 1 : 0, now, id);
  return findAppointmentById(id);
}

export function rescheduleAppointment({ id, masterId, startSql, endSql, now }) {
  db.prepare(
    'UPDATE appointments SET master_id = ?, start_datetime = ?, end_datetime = ?, updated_at = ? WHERE id = ?',
  ).run(masterId, startSql, endSql, now, id);
  return findAppointmentById(id);
}

// Журнал переноса (docs/db-schema.md, 3.13) — по одной строке на каждый
// факт переноса, не перезаписываемое поле: запись можно переносить не
// один раз, и второй перенос не должен стирать память о первом. Вызывать
// вместе с rescheduleAppointment выше, в одной транзакции (см.
// domain/booking.js:rescheduleAppointment) — "старое" здесь нужно читать
// ДО UPDATE, эта функция сама ничего не читает из appointments.
export function insertRescheduleLogEntry({
  appointmentId,
  oldStartSql,
  oldMasterId,
  newStartSql,
  newMasterId,
  changedByUserId,
  now,
}) {
  db.prepare(
    `INSERT INTO appointment_reschedule_log
       (appointment_id, old_start_datetime, old_master_id, new_start_datetime, new_master_id, changed_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(appointmentId, oldStartSql, oldMasterId, newStartSql, newMasterId, changedByUserId, now);
}

// Краткая сводка "сколько раз переносили / когда в последний раз" сразу
// для нескольких записей одним запросом — тем же приёмом, что и
// listAppointmentServicesForMany выше, чтобы список записей в админ-панели
// не превращался в N+1 запросов на каждую строку таблицы.
export function listRescheduleSummaryForMany(appointmentIds) {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT appointment_id, COUNT(*) AS reschedule_count, MAX(created_at) AS last_created_at
       FROM appointment_reschedule_log
       WHERE appointment_id IN (${placeholders})
       GROUP BY appointment_id`,
    )
    .all(...appointmentIds);
  const map = new Map();
  for (const row of rows) map.set(row.appointment_id, row);
  return map;
}

// Полная история переноса одной записи, по порядку — используется, только
// если администратору понадобятся подробности одного переноса (не список).
export function listRescheduleLogForAppointment(appointmentId) {
  return db
    .prepare('SELECT * FROM appointment_reschedule_log WHERE appointment_id = ? ORDER BY created_at ASC')
    .all(appointmentId);
}

// cancelledByUserId/reason — кто и почему отменил (docs/db-schema.md,
// 3.11г); оба необязательны на уровне БД (CHECK там же), но
// domain/booking.js всегда передаёт cancelledByUserId — вызывающая
// сторона (routes/appointments.routes.js) уже прошла requireAuth.
export function cancelAppointment({ id, now, cancelledByUserId = null, reason = null }) {
  db.prepare(
    `UPDATE appointments
     SET status = 'cancelled', cancelled_at = ?, cancelled_by_user_id = ?, cancel_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now, cancelledByUserId, reason, now, id);
  return findAppointmentById(id);
}

// Ручное завершение визита администратором (docs/db-schema.md, раздел 6:
// status='completed' "проставляется фоновой задачей ИЛИ админом" — это
// вторая половина того "или"; первая — markPastConfirmedAppointmentsCompletedSql
// ниже). Не ограничено временем — админ может завершить визит раньше
// end_datetime (клиент ушёл пораньше и т.п.), проверка "это точно
// подтверждённая запись" — на уровне domain/booking.js.
export function completeAppointment({ id, now }) {
  db.prepare("UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?").run(now, id);
  return findAppointmentById(id);
}

// Освобождает истёкшие удержания: status hold -> expired. Строки не
// удаляются физически — так же, как остальная история appointments
// (см. docs/db-schema.md, "Спорные решения" п.10) — но перестают занимать
// слот, потому что частичный уникальный индекс действует только на
// hold/confirmed.
export function releaseExpiredHoldsSql(nowSql) {
  const info = db
    .prepare("UPDATE appointments SET status = 'expired', updated_at = ? WHERE status = 'hold' AND hold_expires_at <= ?")
    .run(nowSql, nowSql);
  return info.changes;
}

// Фоновая половина того же "или" (docs/db-schema.md, раздел 6): визит,
// время которого прошло, а статус остался confirmed, переводится в
// completed. Не влияет на расчёт свободного времени (прошедшие слоты и
// так никогда не предлагаются, см. domain/availability.js) — это только
// гигиена данных для админ-панели, чтобы список "текущих" записей не
// зарастал визитами, которые давно состоялись.
export function markPastConfirmedAppointmentsCompletedSql(nowSql) {
  const info = db
    .prepare("UPDATE appointments SET status = 'completed', updated_at = ? WHERE status = 'confirmed' AND end_datetime <= ?")
    .run(nowSql, nowSql);
  return info.changes;
}

export function listAppointmentsForClient(clientId, { status } = {}) {
  const clauses = ['client_id = ?'];
  const params = [clientId];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  return db
    .prepare(`SELECT * FROM appointments WHERE ${clauses.join(' AND ')} ORDER BY start_datetime DESC`)
    .all(...params);
}

export function listAppointmentsForAdmin({ status, masterId, clientId, fromSql, toSql } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (masterId) {
    clauses.push('master_id = ?');
    params.push(masterId);
  }
  if (clientId) {
    clauses.push('client_id = ?');
    params.push(clientId);
  }
  if (fromSql) {
    clauses.push('start_datetime >= ?');
    params.push(fromSql);
  }
  if (toSql) {
    clauses.push('start_datetime < ?');
    params.push(toSql);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM appointments ${where} ORDER BY start_datetime DESC`).all(...params);
}

// Активные (hold/confirmed) записи ТОГО ЖЕ мастера, чьё время пересекается
// с переданным диапазоном — то же условие пересечения, что и у триггеров
// БД (docs/db-schema.md, раздел 3.11а: other.start < NEW.end AND
// other.end > NEW.start). Единственный вызывающий код —
// domain/notifications.js:notifyDoubleBookedOwners, сразу после того как
// createAppointment вставила новую запись с overlapOverride=true (иначе
// вставку остановил бы тот же триггер, до этой функции дело бы не дошло).
export function findAppointmentsOverlapping({ masterId, startSql, endSql, excludeId }) {
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE master_id = ? AND status IN ('hold', 'confirmed') AND id != ?
         AND start_datetime < ? AND end_datetime > ?`,
    )
    .all(masterId, excludeId, endSql, startSql);
}
