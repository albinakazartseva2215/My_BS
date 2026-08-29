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
import { findMasterByUserId } from '../db/repositories/masters.js';

const APPOINTMENT_STATUSES = ['hold', 'confirmed', 'completed', 'cancelled', 'expired'];

// Требование 4: на каждом эндпоинте — авторизован ли пользователь (это уже
// проверил requireAuth ДО вызова этой функции), есть ли у него роль,
// которая вообще может видеть такие объекты, и принадлежит ли ему именно
// ЭТОТ объект. Роль и принадлежность здесь идут парой, потому что у
// каждой роли своё определение "принадлежит": клиенту — записи, где он
// клиент; мастеру — записи в его собственном расписании; админу
// принадлежит (в смысле доступа) вообще всё, отдельной проверки не нужно.
function assertCanAccessAppointment(user, appointment) {
  if (user.roles.includes('admin')) return; // роль admin — доступ ко всем записям, доп. проверка не нужна
  if (user.roles.includes('client') && appointment.client_id === user.id) return; // роль client + принадлежность
  if (user.roles.includes('master')) {
    const master = findMasterByUserId(user.id); // роль master + принадлежность своему расписанию
    if (master && appointment.master_id === master.id) return;
  }
  throw forbidden('Это не ваша запись');
}

// Изменение (перенос/отмена) — только владелец-клиент или админ. Мастер,
// в отличие от чтения выше, сюда намеренно не допущен: требование 4
// говорит, что мастер "видит" записи своего расписания, но не даёт ему
// права их менять — расширять это молча, без отдельного запроса, не стали.
function assertCanModifyAppointment(user, appointment) {
  if (user.roles.includes('admin')) return;
  if (user.roles.includes('client') && appointment.client_id === user.id) return;
  throw forbidden('Это не ваша запись');
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
    assertCanAccessAppointment(user, appointment);
    const salon = getSalonProfile();
    // includeClient — и админу, и мастеру: обоим нужно знать, кто придёт
    // и по какому поводу; обычному клиенту (это его собственная запись) — нет.
    const includeClient = user.roles.includes('admin') || user.roles.includes('master');
    return {
      status: 200,
      body: toAppointmentView(appointment, { timezone: salon.timezone, includeClient }),
    };
  });

  router.patch('/api/appointments/:id/reschedule', async (ctx) => {
    const user = requireAuth(ctx);
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const existing = findAppointmentById(id);
    if (!existing) throw notFound('Запись не найдена');
    assertCanModifyAppointment(user, existing);

    const body = ctx.body;
    const newStartUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
    const newMasterId = body.masterId !== undefined ? requireInt(body.masterId, 'masterId', { min: 1 }) : undefined;
    if (newMasterId !== undefined && !user.roles.includes('admin')) {
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
    assertCanModifyAppointment(user, existing);

    const appointment = cancelAppointment({ appointmentId: id });
    const salon = getSalonProfile();
    return { status: 200, body: toAppointmentView(appointment, { timezone: salon.timezone }) };
  });
}
