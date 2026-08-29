// Удержание слота на время оформления (Booking · 3). Создаётся анонимно —
// клиент ещё не вошёл на этом шаге (см. docs/db-schema.md, "Спорные
// решения", п.12) — либо сразу привязывается к текущему пользователю,
// если сессия уже есть (повторная запись из личного кабинета).

import { requireInt, requireIntArray, requireUtcDateTime } from '../validation/validate.js';
import { createAppointment } from '../domain/booking.js';
import { toAppointmentView } from '../domain/appointmentView.js';
import { getSalonProfile } from '../db/repositories/salonProfile.js';
import { findAppointmentByHoldToken, cancelAppointment as cancelRow } from '../db/repositories/appointments.js';
import { notFound } from '../http/errors.js';
import { dateToSql } from '../time/salonClock.js';

export function registerRoutes(router) {
  router.post('/api/holds', async (ctx) => {
    const body = ctx.body;
    const masterId = requireInt(body.masterId, 'masterId', { min: 1 });
    const startUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
    const serviceIds = requireIntArray(body.serviceIds, 'serviceIds');

    const appointment = createAppointment({
      masterId,
      startUtc,
      serviceIds,
      clientId: ctx.user ? ctx.user.id : null,
      status: 'hold',
    });

    const salon = getSalonProfile();
    return {
      status: 201,
      body: toAppointmentView(appointment, { timezone: salon.timezone, includeHoldToken: true }),
    };
  });

  // Явный отказ от удержания — например, клиент вернулся и выбрал другое
  // время. Не обязателен для истечения (оно сработает само), но не
  // заставляет ждать таймер, если человек передумал раньше.
  router.delete('/api/holds/:holdToken', async (ctx) => {
    const holdToken = ctx.params.holdToken;
    const appointment = findAppointmentByHoldToken(holdToken);
    if (!appointment) throw notFound('Удержание не найдено или уже истекло');
    if (appointment.client_id !== null && (!ctx.user || ctx.user.id !== appointment.client_id)) {
      throw notFound('Удержание не найдено или уже истекло');
    }
    cancelRow({ id: appointment.id, now: dateToSql(new Date()) });
    return { status: 204, body: null };
  });
}
