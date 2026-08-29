import db from '../connection.js';

export function listActiveMasters() {
  return db.prepare('SELECT * FROM masters WHERE is_active = 1 ORDER BY name ASC').all();
}

export function listAllMastersForAdmin() {
  return db.prepare('SELECT * FROM masters ORDER BY name ASC').all();
}

export function findMasterById(id) {
  return db.prepare('SELECT * FROM masters WHERE id = ?').get(id);
}

// Мастера, которые могут выполнить ВСЕ переданные услуги за один визит
// (Booking · 2 — пересечение master_services по нескольким выбранным услугам).
export function listActiveMastersForServiceIds(serviceIds) {
  if (serviceIds.length === 0) return listActiveMasters();
  const placeholders = serviceIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT m.* FROM masters m
       WHERE m.is_active = 1
         AND (
           SELECT COUNT(DISTINCT ms.service_id) FROM master_services ms
           WHERE ms.master_id = m.id AND ms.service_id IN (${placeholders})
         ) = ?
       ORDER BY m.name ASC`,
    )
    .all(...serviceIds, serviceIds.length);
}

export function masterCanPerformAllServices(masterId, serviceIds) {
  if (serviceIds.length === 0) return true;
  const placeholders = serviceIds.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT service_id) AS cnt FROM master_services
       WHERE master_id = ? AND service_id IN (${placeholders})`,
    )
    .get(masterId, ...serviceIds);
  return row.cnt === serviceIds.length;
}

export function insertMaster({ name, specialization, ratingAvg, reviewsCount, photoUrl, isActive, now }) {
  const info = db
    .prepare(
      `INSERT INTO masters (name, specialization, rating_avg, reviews_count, photo_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(name, specialization, ratingAvg, reviewsCount ?? 0, photoUrl, isActive ? 1 : 0, now, now);
  return findMasterById(Number(info.lastInsertRowid));
}

export function updateMaster(id, fields, now) {
  const columns = [];
  const values = [];
  for (const [key, column] of [
    ['name', 'name'],
    ['specialization', 'specialization'],
    ['ratingAvg', 'rating_avg'],
    ['reviewsCount', 'reviews_count'],
    ['photoUrl', 'photo_url'],
    ['isActive', 'is_active'],
  ]) {
    if (fields[key] === undefined) continue;
    columns.push(`${column} = ?`);
    values.push(key === 'isActive' ? (fields[key] ? 1 : 0) : fields[key]);
  }
  if (columns.length === 0) return findMasterById(id);
  columns.push('updated_at = ?');
  values.push(now, id);
  db.prepare(`UPDATE masters SET ${columns.join(', ')} WHERE id = ?`).run(...values);
  return findMasterById(id);
}

export function listServiceIdsForMaster(masterId) {
  return db
    .prepare('SELECT service_id FROM master_services WHERE master_id = ?')
    .all(masterId)
    .map((r) => r.service_id);
}

// Полная замена набора услуг мастера — проще и предсказуемее, чем
// частичные add/remove, для админ-формы "какие услуги делает мастер".
export function replaceMasterServices(masterId, serviceIds) {
  db.prepare('DELETE FROM master_services WHERE master_id = ?').run(masterId);
  const insert = db.prepare('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)');
  for (const serviceId of serviceIds) insert.run(masterId, serviceId);
}

export function listWeeklyScheduleForMaster(masterId) {
  return db
    .prepare('SELECT weekday, start_time, end_time FROM master_weekly_schedule WHERE master_id = ? ORDER BY weekday ASC')
    .all(masterId);
}

// Полная замена недельного графика — та же логика, что и для услуг.
export function replaceWeeklySchedule(masterId, entries) {
  db.prepare('DELETE FROM master_weekly_schedule WHERE master_id = ?').run(masterId);
  const insert = db.prepare(
    'INSERT INTO master_weekly_schedule (master_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)',
  );
  for (const entry of entries) insert.run(masterId, entry.weekday, entry.startTime, entry.endTime);
}

export function findScheduleExceptionForDate(masterId, date) {
  return db.prepare('SELECT * FROM schedule_exceptions WHERE master_id = ? AND date = ?').get(masterId, date);
}

export function listScheduleExceptionsForMaster(masterId) {
  return db
    .prepare('SELECT * FROM schedule_exceptions WHERE master_id = ? ORDER BY date ASC')
    .all(masterId);
}

export function upsertScheduleException({ masterId, date, isDayOff, startTime, endTime, reason, now }) {
  db.prepare(
    `INSERT INTO schedule_exceptions (master_id, date, is_day_off, start_time, end_time, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(master_id, date) DO UPDATE SET
       is_day_off = excluded.is_day_off,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       reason = excluded.reason`,
  ).run(masterId, date, isDayOff ? 1 : 0, startTime, endTime, reason, now);
  return findScheduleExceptionForDate(masterId, date);
}

export function deleteScheduleException(masterId, exceptionId) {
  const info = db.prepare('DELETE FROM schedule_exceptions WHERE id = ? AND master_id = ?').run(exceptionId, masterId);
  return info.changes > 0;
}

export function listTimeBlocksForMaster(masterId, { from, to } = {}) {
  const clauses = ['master_id = ?'];
  const params = [masterId];
  if (from) {
    clauses.push('end_datetime > ?');
    params.push(from);
  }
  if (to) {
    clauses.push('start_datetime < ?');
    params.push(to);
  }
  return db
    .prepare(`SELECT * FROM time_blocks WHERE ${clauses.join(' AND ')} ORDER BY start_datetime ASC`)
    .all(...params);
}

export function findTimeBlockById(id) {
  return db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(id);
}

export function insertTimeBlock({ masterId, startDatetime, endDatetime, reason, createdByUserId, now }) {
  const info = db
    .prepare(
      `INSERT INTO time_blocks (master_id, start_datetime, end_datetime, reason, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(masterId, startDatetime, endDatetime, reason, createdByUserId, now);
  return findTimeBlockById(Number(info.lastInsertRowid));
}

export function deleteTimeBlock(masterId, blockId) {
  const info = db.prepare('DELETE FROM time_blocks WHERE id = ? AND master_id = ?').run(blockId, masterId);
  return info.changes > 0;
}

export function toPublicMaster(row) {
  return {
    id: row.id,
    name: row.name,
    specialization: row.specialization,
    ratingAvg: row.rating_avg,
    reviewsCount: row.reviews_count,
    photoUrl: row.photo_url,
  };
}

export function toAdminMaster(row) {
  return {
    ...toPublicMaster(row),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicTimeBlock(row) {
  return {
    id: row.id,
    masterId: row.master_id,
    startDatetime: row.start_datetime,
    endDatetime: row.end_datetime,
    reason: row.reason,
  };
}

export function toPublicScheduleException(row) {
  return {
    id: row.id,
    masterId: row.master_id,
    date: row.date,
    isDayOff: row.is_day_off === 1,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
  };
}
