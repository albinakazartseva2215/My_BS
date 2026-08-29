// Мастер видит записи из своего расписания (требование 4). Только чтение —
// список и (через общий GET /api/appointments/:id, см. appointments.routes.js
// и assertCanAccessAppointment там) детали одной записи. Переносить/отменять
// записи роль master не может — этого не просили, молча такое право не
// выдаём.

import { requireRole } from '../middleware/auth.js';
import { forbidden } from '../http/errors.js';
import { requireOneOf } from '../validation/validate.js';
import { findMasterByUserId } from '../db/repositories/masters.js';
import { listAppointmentsForAdmin } from '../db/repositories/appointments.js';
import { toAppointmentView } from '../domain/appointmentView.js';
import { getSalonProfile } from '../db/repositories/salonProfile.js';

const APPOINTMENT_STATUSES = ['hold', 'confirmed', 'completed', 'cancelled', 'expired'];

export function registerRoutes(router) {
  router.get('/api/master/appointments', async (ctx) => {
    // Проверка 1 (авторизован?) и проверка 2 (есть роль master?) — requireRole.
    const user = requireRole(ctx, 'master');

    // Проверка 3 (принадлежность): "своё расписание" значит расписание
    // ТОГО master-профиля, что привязан именно к этому user_id — не любого.
    // Если роль master выдана, а привязки к профилю ещё нет (админ не
    // довёл до конца), человек не должен внезапно увидеть чьё-то чужое
    // расписание "по умолчанию" — это 403, а не пустой список молча.
    const master = findMasterByUserId(user.id);
    if (!master) {
      throw forbidden('Для этой учётной записи не привязан профиль мастера — обратитесь к администратору салона');
    }

    const status = ctx.query.status !== undefined ? requireOneOf(ctx.query.status, 'status', APPOINTMENT_STATUSES) : undefined;
    const salon = getSalonProfile();
    const appointments = listAppointmentsForAdmin({ status, masterId: master.id }).map((a) =>
      toAppointmentView(a, { timezone: salon.timezone, includeClient: true }),
    );
    return { status: 200, body: { appointments } };
  });
}
