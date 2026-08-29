import db from '../connection.js';

// salon_profile — одна строка с id=1 (см. docs/db-schema.md, 3.1).
export function getSalonProfile() {
  const row = db.prepare('SELECT * FROM salon_profile WHERE id = 1').get();
  if (!row) {
    throw new Error('salon_profile пуст — выполните "npm run seed" или заполните таблицу вручную');
  }
  return row;
}

export function toPublicSalonProfile(row) {
  return {
    name: row.name,
    address: row.address,
    phone: row.phone,
    workingHoursNote: row.working_hours_note,
    timezone: row.timezone,
    bookingStepMinutes: row.booking_step_minutes,
    bookingHorizonDays: row.booking_horizon_days,
  };
}

// Админу — плюс операционные параметры бронирования, которые публично
// показывать незачем (влияют на расчёт слотов, но не часть контента
// лендинга) и updated_at для аудита.
export function toAdminSalonProfile(row) {
  return {
    ...toPublicSalonProfile(row),
    holdDurationMinutes: row.hold_duration_minutes,
    updatedAt: row.updated_at,
  };
}

export function updateSalonProfile(fields, now) {
  const columns = [];
  const values = [];
  for (const [key, column] of [
    ['name', 'name'],
    ['address', 'address'],
    ['phone', 'phone'],
    ['workingHoursNote', 'working_hours_note'],
    ['timezone', 'timezone'],
    ['bookingStepMinutes', 'booking_step_minutes'],
    ['bookingHorizonDays', 'booking_horizon_days'],
    ['holdDurationMinutes', 'hold_duration_minutes'],
  ]) {
    if (fields[key] === undefined) continue;
    columns.push(`${column} = ?`);
    values.push(fields[key]);
  }
  if (columns.length === 0) return getSalonProfile();
  columns.push('updated_at = ?');
  values.push(now);
  db.prepare(`UPDATE salon_profile SET ${columns.join(', ')} WHERE id = 1`).run(...values);
  return getSalonProfile();
}
