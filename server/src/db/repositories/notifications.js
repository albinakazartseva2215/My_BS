// Уведомления в личном кабинете (docs/db-schema.md, раздел 3.14). Пишет
// сюда только domain/notifications.js — три события, перечисленные в
// разделе 8 того же документа; напрямую эту таблицу больше никто не трогает.

import db from '../connection.js';

export function insertNotification({ userId, type, message, appointmentId, now }) {
  db.prepare(
    `INSERT INTO notifications (user_id, type, message, appointment_id, is_read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(userId, type, message, appointmentId, now);
}

// limit — на будущее (пагинация), сейчас не запрашивается ни одним
// маршрутом сверх дефолта: личный кабинет одного клиента не накопит
// тысяч уведомлений в разумные сроки, а более старые ему и не так важны.
export function listNotificationsForUser(userId, { limit = 100 } = {}) {
  return db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit);
}

// Отдельный COUNT по частичному индексу ix_notifications_user_unread
// (docs/db-schema.md, раздел 3.14) — не notifications.filter(...).length
// после уже загруженного списка: счётчик в шапке нужен на каждой странице
// кабинета, а не только на самом экране уведомлений (раздел 8 документа
// схемы, «Список уведомлений и счётчик — один запрос»).
export function countUnreadNotifications(userId) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return row.cnt;
}

// WHERE id=? AND user_id=? в одном запросе, а не отдельная проверка
// владельца до UPDATE — чужой id тихо не даёт изменений (info.changes===0),
// маршрут превращает это в 404, не 403 (см. docs/db-schema.md, раздел 8:
// 403 подтвердил бы чужому пользователю, что такое уведомление вообще есть).
export function markNotificationRead(id, userId) {
  const info = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  return info.changes > 0;
}

export function toPublicNotification(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    appointmentId: row.appointment_id,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}
