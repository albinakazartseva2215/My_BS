// Публичный каталог: список услуг и список мастеров (Booking · 1 и · 2).
// GET /api/masters принимает необязательный ?serviceIds=1,2,3 — тогда
// отдаёт только тех мастеров, которые выполняют ВЕСЬ набор услуг
// (пересечение master_services, как того требует экран Booking · 2).

import { requireIntArray } from '../validation/validate.js';
import { listActiveServices, toPublicService } from '../db/repositories/services.js';
import { listActiveMasters, listActiveMastersForServiceIds, toPublicMaster } from '../db/repositories/masters.js';

export function registerRoutes(router) {
  router.get('/api/services', async () => {
    const services = listActiveServices().map(toPublicService);
    return { status: 200, body: { services } };
  });

  router.get('/api/masters', async (ctx) => {
    const serviceIds = ctx.query.serviceIds !== undefined ? requireIntArray(ctx.query.serviceIds, 'serviceIds') : [];
    const masters = (serviceIds.length > 0 ? listActiveMastersForServiceIds(serviceIds) : listActiveMasters()).map(
      toPublicMaster,
    );
    return { status: 200, body: { masters } };
  });
}
