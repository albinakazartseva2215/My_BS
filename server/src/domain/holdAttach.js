// Привязка анонимного удержания слота (Booking · 3, hold_token) к клиенту
// после успешного входа/регистрации (Booking · 4) — см. docs/db-schema.md,
// "Спорные решения", п.12.

import { findAppointmentByHoldToken } from '../db/repositories/appointments.js';
import { releaseExpiredHolds } from './holdExpiry.js';
import db from '../db/connection.js';
import { dateToSql } from '../time/salonClock.js';

// Возвращает true, если удержание найдено, ещё активно и было привязано
// к пользователю. Не бросает на "не найдено" — неверный/просроченный
// holdToken не должен ломать вход или регистрацию, только не привяжет бронь.
export function attachClientToHold(holdToken, userId, now = new Date()) {
  releaseExpiredHolds(now);
  const appointment = findAppointmentByHoldToken(holdToken);
  if (!appointment) return false;
  if (appointment.client_id !== null) return appointment.client_id === userId;
  db.prepare('UPDATE appointments SET client_id = ?, updated_at = ? WHERE id = ?').run(
    userId,
    dateToSql(now),
    appointment.id,
  );
  return true;
}
