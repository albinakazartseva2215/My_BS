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
