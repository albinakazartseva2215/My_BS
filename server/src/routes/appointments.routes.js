// Создание записи (из удержания или напрямую), просмотр своих записей,
// детали записи, перенос, отмена. Все требуют входа — запись всегда
// принадлежит конкретному клиенту.

import {
  requireInt,
  requireIntArray,
  requireUtcDateTime,
  optionalString,
  optionalBoolean,
  requireOneOf,
} from '../validation/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import {
  confirmHold,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from '../domain/booking.js';
import { toAppointmentView } from '../domain/appointmentView.js';
import { getSalonProfile } from '../db/repositories/salonProfile.js';
import { findAppointmentById, listAppointmentsForClient } from '../db/repositories/appointments.js';

const APPOINTMENT_STATUSES = ['hold', 'confirmed', 'completed', 'cancelled', 'expired'];

function assertOwnerOrAdmin(user, appointment) {
  if (user.role === 'admin') return;
  if (appointment.client_id !== user.id) throw forbidden('Это не ваша запись');
}

export function registerRoutes(router) {
  router.post('/api/appointments', async (ctx) => {
    const user = requireAuth(ctx);
    const body = ctx.body;
    const comment = optionalString(body.comment, 'comment', { max: 200 });
    const remindEnabled = optionalBoolean(body.remindEnabled, 'remindEnabled', true);

    let appointment;
    if (body.holdToken !== undefined && body.holdToken !== null) {
      const holdToken = optionalString(body.holdToken, 'holdToken', { max: 100 });
      appointment = confirmHold({ holdToken, clientId: user.id, comment, remindEnabled });
    } else {
      const masterId = requireInt(body.masterId, 'masterId', { min: 1 });
      const startUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
      const serviceIds = requireIntArray(body.serviceIds, 'serviceIds');
      // status: 'confirmed' — клиентский маршрут никогда не передаёт
      // overlapOverride (его здесь просто нет в аргументах), поэтому в
      // createAppointment для этого вызова он всегда остаётся default false.
      appointment = createAppointment({
        masterId,
        startUtc,
        serviceIds,
        clientId: user.id,
        status: 'confirmed',
        comment,
        remindEnabled,
      });
    }

    const salon = getSalonProfile();
    return { status: 201, body: toAppointmentView(appointment, { timezone: salon.timezone }) };
  });

  router.get('/api/appointments', async (ctx) => {
    const user = requireAuth(ctx);
    const status = ctx.query.status !== undefined ? requireOneOf(ctx.query.status, 'status', APPOINTMENT_STATUSES) : undefined;
    const salon = getSalonProfile();
    const appointments = listAppointmentsForClient(user.id, { status }).map((a) =>
      toAppointmentView(a, { timezone: salon.timezone }),
    );
    return { status: 200, body: { appointments } };
  });

  router.get('/api/appointments/:id', async (ctx) => {
    const user = requireAuth(ctx);
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const appointment = findAppointmentById(id);
    if (!appointment) throw notFound('Запись не найдена');
    assertOwnerOrAdmin(user, appointment);
    const salon = getSalonProfile();
    return {
      status: 200,
      body: toAppointmentView(appointment, { timezone: salon.timezone, includeClient: user.role === 'admin' }),
    };
  });

  router.patch('/api/appointments/:id/reschedule', async (ctx) => {
    const user = requireAuth(ctx);
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const existing = findAppointmentById(id);
    if (!existing) throw notFound('Запись не найдена');
    assertOwnerOrAdmin(user, existing);

    const body = ctx.body;
    const newStartUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
    const newMasterId = body.masterId !== undefined ? requireInt(body.masterId, 'masterId', { min: 1 }) : undefined;
    if (newMasterId !== undefined && user.role !== 'admin') {
      throw badRequest('Смену мастера при переносе может выполнить только администратор');
    }

    const appointment = rescheduleAppointment({ appointmentId: id, newStartUtc, newMasterId });
    const salon = getSalonProfile();
    return { status: 200, body: toAppointmentView(appointment, { timezone: salon.timezone }) };
  });

  router.post('/api/appointments/:id/cancel', async (ctx) => {
    const user = requireAuth(ctx);
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const existing = findAppointmentById(id);
    if (!existing) throw notFound('Запись не найдена');
    assertOwnerOrAdmin(user, existing);

    const appointment = cancelAppointment({ appointmentId: id });
    const salon = getSalonProfile();
    return { status: 200, body: toAppointmentView(appointment, { timezone: salon.timezone }) };
  });
}
