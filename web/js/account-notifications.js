// Экран уведомлений (/account-notifications.html) — спроектирован заново
// (см. комментарий у ACCOUNT_NOTIFICATIONS_URL, js/routes.js): ни в
// прототипе, ни в docs/ui-map.md готового образца нет. Вёрстка и токены —
// тем же способом, что и личный кабинет (css/account.css), список карточек
// по образцу appointment-card оттуда же, чтобы выглядеть частью того же
// раздела, а не отдельным островом.
//
// Список и счётчик непрочитанных — один и тот же вызов GET /api/notifications
// (docs/db-schema.md, раздел 8) — здесь используется notifications[],
// шапка (js/header.js) тем же ответом берёт только unreadCount.

import { fetchMe, fetchNotifications, markNotificationRead, describeError, ApiRequestError } from './api.js';
import { LOGIN_URL, ACCOUNT_APPOINTMENT_URL } from './routes.js';
import { initHeader } from './header.js';

initHeader();

const errorBox = document.getElementById('notificationsError');
const area = document.getElementById('notificationsArea');

const TYPE_LABELS = {
  appointment_cancelled: 'Отмена записи',
  appointment_rescheduled: 'Перенос записи',
  appointment_double_booked: 'Изменение в расписании',
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// createdAt — сырой UTC-текст из БД ('YYYY-MM-DD HH:MM:SS', без суффикса
// зоны, docs/db-schema.md, раздел 2) — тем же способом, что и
// server/src/time/salonClock.js:sqlToDate, только здесь, в браузере: "T" и
// "Z", чтобы new Date() понял это как UTC, а не как местное время браузера.
// Момент создания уведомления — не время визита (оно уже есть в самом
// тексте сообщения) — здесь достаточно локального времени браузера
// получателя, как в большинстве почтовых клиентов, курс на часовой пояс
// салона (docs/frontend-rules.md) — про время самой записи, не про это.
function formatCreatedAt(sqlText) {
  const date = new Date(sqlText.replace(' ', 'T') + 'Z');
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function notificationCardHtml(n) {
  const classes = ['notification-card'];
  if (!n.isRead) classes.push('is-unread');
  return `
    <a href="${ACCOUNT_APPOINTMENT_URL}?id=${n.appointmentId}" class="${classes.join(' ')}" data-id="${n.id}" data-unread="${!n.isRead}">
      ${!n.isRead ? '<span class="notification-dot" aria-hidden="true"></span>' : ''}
      <div class="notification-body">
        <div class="notification-type">${escapeHtml(TYPE_LABELS[n.type] || 'Уведомление')}</div>
        <div class="notification-message">${escapeHtml(n.message)}</div>
        <div class="notification-meta">${escapeHtml(formatCreatedAt(n.createdAt))} · Перейти к записи →</div>
      </div>
    </a>
  `;
}

function emptyStateHtml() {
  return `
    <div class="empty-state">
      <div class="empty-state-blob" aria-hidden="true"></div>
      <div class="empty-state-title">Уведомлений пока нет</div>
      <div class="empty-state-text">Здесь появятся изменения в ваших записях, которые внёс администратор — например, перенос или отмена.</div>
    </div>
  `;
}

function renderList(notifications) {
  if (notifications.length === 0) {
    area.innerHTML = emptyStateHtml();
    return;
  }
  area.innerHTML = `<div class="notification-list">${notifications.map(notificationCardHtml).join('')}</div>`;

  // Клик по карточке — переход по обычной ссылке (работает и Ctrl/Cmd-клик,
  // и открытие в новой вкладке); отметка "прочитано" — попутно, без
  // ожидания ответа и без блокировки самого перехода.
  area.querySelectorAll('.notification-card[data-unread="true"]').forEach((card) => {
    card.addEventListener('click', () => {
      markNotificationRead(Number(card.dataset.id)).catch(() => {
        // Не удалось отметить прочитанным — не мешаем переходу к записи,
        // это второстепенный побочный эффект клика, не он был целью.
      });
    });
  });
}

async function init() {
  try {
    await fetchMe();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      window.location.href = LOGIN_URL;
      return;
    }
    errorBox.textContent = describeError(err);
    errorBox.hidden = false;
    return;
  }

  try {
    const { notifications } = await fetchNotifications();
    renderList(notifications);
  } catch (err) {
    area.innerHTML = '';
    errorBox.textContent = describeError(err);
    errorBox.hidden = false;
  }
}

init();
