// Сборка ответа API для одной записи: время — в UTC (as-is из БД) и
// дополнительно в локальном времени салона для отображения (требование
// задачи — переводить в часовой пояс салона только на выводе).

import { toIsoUtc, formatLocalIso } from '../time/salonClock.js';
import { findMasterById, toPublicMaster } from '../db/repositories/masters.js';
import { findUserWithRolesById, toPublicUser } from '../db/repositories/users.js';
import { listAppointmentServices } from '../db/repositories/appointments.js';

function sqlToDate(sqlText) {
  return new Date(`${sqlText.replace(' ', 'T')}Z`);
}

// includeClient — только для админского просмотра: имя/телефон клиента
// нужны салону, чтобы связаться по записи. Обычному клиенту эти поля
// никогда не передаются (это его же данные и так возвращать незачем).
export function toAppointmentView(appointment, { timezone, includeClient = false, includeHoldToken = false }) {
  const master = findMasterById(appointment.master_id);
  const services = listAppointmentServices(appointment.id).map((s) => ({
    serviceId: s.service_id,
    name: s.service_name_snapshot,
    priceRub: s.price_rub_snapshot,
    durationMinutes: s.duration_minutes_snapshot,
  }));

  const startUtc = sqlToDate(appointment.start_datetime);
  const endUtc = sqlToDate(appointment.end_datetime);

  const view = {
    id: appointment.id,
    status: appointment.status,
    master: master ? toPublicMaster(master) : null,
    startUtc: toIsoUtc(startUtc),
    endUtc: toIsoUtc(endUtc),
    startLocal: formatLocalIso(startUtc, timezone),
    endLocal: formatLocalIso(endUtc, timezone),
    services,
    totalPriceRub: appointment.total_price_rub,
    totalDurationMinutes: appointment.total_duration_minutes,
    comment: appointment.comment,
    remindEnabled: appointment.remind_enabled === 1,
    // Признак осознанного наложения (docs/db-schema.md, 3.11б) — не
    // персональные данные, безопасно показать и клиенту, и админу: это
    // факт о самой записи ("салон забронировал вас поверх другой брони"),
    // а не о ком-то постороннем.
    overlapOverride: appointment.overlap_override === 1,
    createdAt: appointment.created_at,
    cancelledAt: appointment.cancelled_at,
  };

  if (appointment.status === 'hold' && appointment.hold_expires_at) {
    view.holdExpiresAt = toIsoUtc(sqlToDate(appointment.hold_expires_at));
  }
  if (includeHoldToken && appointment.hold_token) {
    view.holdToken = appointment.hold_token;
  }
  if (includeClient) {
    const client = appointment.client_id ? findUserWithRolesById(appointment.client_id) : null;
    view.client = client ? toPublicUser(client) : null;
  }

  return view;
}
