// Уведомления в личном кабинете (docs/db-schema.md, разделы 3.14 и 8).
// Оба маршрута требуют входа — уведомление всегда принадлежит
// конкретному пользователю, чужие не видны и не отмечаются прочитанными.

import { requireInt } from '../validation/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../http/errors.js';
import {
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  toPublicNotification,
} from '../db/repositories/notifications.js';

export function registerRoutes(router) {
  // Список и счётчик непрочитанных — один запрос, не два (задание: "отдельный
  // запрос ради одного числа не создавай"). unreadCount — отдельный COUNT по
  // частичному индексу (db/repositories/notifications.js), а не
  // notifications.filter(...).length: счётчик в шапке кабинета нужен на
  // каждой странице, не только на самом экране уведомлений.
  router.get('/api/notifications', async (ctx) => {
    const user = requireAuth(ctx);
    const notifications = listNotificationsForUser(user.id).map(toPublicNotification);
    const unreadCount = countUnreadNotifications(user.id);
    return { status: 200, body: { notifications, unreadCount } };
  });

  // 404, не 403, на чужой id — см. docs/db-schema.md, раздел 8: 403
  // подтвердил бы существование чужого уведомления, 404 — нет.
  router.post('/api/notifications/:id/read', async (ctx) => {
    const user = requireAuth(ctx);
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const updated = markNotificationRead(id, user.id);
    if (!updated) throw notFound('Уведомление не найдено');
    return { status: 200, body: { id, isRead: true } };
  });
}
