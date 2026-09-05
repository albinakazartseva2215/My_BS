// Свободное время мастера на дату — Booking · 3 и подбор альтернатив на
// экране "Слот занят". Считается на лету по алгоритму из
// docs/db-schema.md, раздел 5 (src/domain/availability.js) — отдельной
// таблицы слотов нет.

import { requireInt, requireDateString, requireIntArray } from '../validation/validate.js';
import { getActiveMasterOrThrow, resolveServicesOrThrow } from '../domain/booking.js';
import { computeAvailableSlots } from '../domain/availability.js';
import { getSalonProfile } from '../db/repositories/salonProfile.js';
import { toIsoUtc, formatLocalIso } from '../time/salonClock.js';

export function registerRoutes(router) {
  router.get('/api/masters/:masterId/availability', async (ctx) => {
    const masterId = requireInt(ctx.params.masterId, 'masterId', { min: 1 });
    const dateStr = requireDateString(ctx.query.date, 'date');
    const serviceIds = requireIntArray(ctx.query.serviceIds, 'serviceIds');

    getActiveMasterOrThrow(masterId);
    const { totalDurationMinutes, totalPriceRub } = resolveServicesOrThrow(serviceIds, masterId);
    const salon = getSalonProfile();

    const { slots, allSlots, reason } = computeAvailableSlots({
      masterId,
      dateStr,
      durationMinutes: totalDurationMinutes,
      salon,
    });

    const toPublicSlot = (slot) => ({
      startUtc: toIsoUtc(slot.startUtc),
      endUtc: toIsoUtc(slot.endUtc),
      startLocal: formatLocalIso(slot.startUtc, salon.timezone),
      endLocal: formatLocalIso(slot.endUtc, salon.timezone),
    });

    return {
      status: 200,
      body: {
        masterId,
        date: dateStr,
        totalDurationMinutes,
        totalPriceRub,
        reason,
        slots: slots.map(toPublicSlot),
        // Все кандидаты сетки на день (свободные/занятые/прошедшие) — для
        // Booking · 3, где занятое время нужно показать видимым и
        // неактивным, а не спрятанным (см. комментарий у
        // computeAvailableSlots в domain/availability.js). `slots` выше не
        // трогали и не убирали — только добавили это поле.
        allSlots: allSlots.map((slot) => ({ ...toPublicSlot(slot), status: slot.status })),
      },
    };
  });
}
