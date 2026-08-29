// "completed... проставляется фоновой задачей или админом" (docs/db-schema.md,
// раздел 6). Ручная часть — POST /api/admin/appointments/:id/complete
// (см. domain/booking.js, markAppointmentCompleted). Эта функция — фоновая:
// вызывается по тому же принципу, что и releaseExpiredHolds
// (domain/holdExpiry.js) — лениво перед админ-листингом записей и
// дополнительно по таймеру в index.js, чтобы список не зарастал
// состоявшимися визитами со статусом confirmed.

import { markPastConfirmedAppointmentsCompletedSql } from '../db/repositories/appointments.js';
import { dateToSql } from '../time/salonClock.js';

export function completePastAppointments(now = new Date()) {
  return markPastConfirmedAppointmentsCompletedSql(dateToSql(now));
}
