// Общий каркас административного раздела (/admin) — шапка и меню разделов,
// один источник разметки для всех страниц web/admin/*.html, тем же приёмом,
// что и js/header.js для клиентской шапки (см. комментарий там же: раньше
// разметка дублировалась по страницам, теперь только initHeader()/
// initAdminShell()).
//
// Реальная защита раздела — не здесь: страницы web/admin/*.html вообще не
// доходят до браузера без роли admin (web/server.js проверяет это до
// раздачи файла и при отказе отдаёт 403), а каждый административный
// эндпоинт отдельно проверяется на сервере (server/src/routes/
// admin.routes.js, requireRole(ctx, 'admin') — см. также
// server/src/middleware/auth.js). Проверка ниже, в конце initAdminShell, —
// это НЕ единственная защита, а подстраховка на случай, если сессия
// истекла уже после того, как каркас страницы был отдан браузеру (задание:
// "не используй это как единственную защиту").

import { fetchMe, logout } from './api.js';
import { ADMIN_APPOINTMENTS_URL, ADMIN_SERVICES_URL, ADMIN_MASTERS_URL } from './routes.js';

// Абсолютный путь, не routes.js:LOGIN_URL ("login.html") — та же причина,
// что и у адресов меню (см. комментарий в routes.js): страницы /admin/* не
// на одной "видимой" глубине URL, поэтому относительная ссылка вела бы на
// разные, местами несуществующие адреса (со страницы /admin/services она
// бы резолвилась в /admin/login.html, а не в /login.html, — так и нашлось
// при проверке выхода из системы).
const LOGIN_URL = '/login.html';

const MENU_ITEMS = [
  { key: 'appointments', label: 'Записи', href: ADMIN_APPOINTMENTS_URL },
  { key: 'services', label: 'Услуги', href: ADMIN_SERVICES_URL },
  { key: 'masters', label: 'Мастера', href: ADMIN_MASTERS_URL },
];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function menuHtml(active) {
  return MENU_ITEMS.map((item) => {
    const isActive = item.key === active;
    const cls = isActive ? 'admin-menu-link is-active' : 'admin-menu-link';
    const current = isActive ? ' aria-current="page"' : '';
    return `<a href="${item.href}" class="${cls}"${current}>${escapeHtml(item.label)}</a>`;
  }).join('');
}

const IDENTITY_SKELETON = '<span class="skeleton-line header-identity-skeleton" aria-hidden="true"></span>';

// active — какой пункт меню подсветить: 'appointments' | 'services' | 'masters'.
export function initAdminShell({ active }) {
  const root = document.getElementById('admin-shell-root');
  if (!root) return;

  root.innerHTML = `
    <header class="site-header admin-header">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true">Т</span>
        <span class="brand-name">Тон</span>
      </a>
      <div class="header-actions">
        <span class="header-identity" id="adminIdentity">${IDENTITY_SKELETON}</span>
      </div>
    </header>
    <nav class="admin-menu" aria-label="Разделы админ-панели">${menuHtml(active)}</nav>
  `;

  const identityEl = document.getElementById('adminIdentity');

  fetchMe()
    .then((user) => {
      // Список ролей, а не одна роль — includes, не равенство (см. шапку
      // файла и server/src/middleware/auth.js:requireRole).
      if (!Array.isArray(user.roles) || !user.roles.includes('admin')) {
        window.location.href = LOGIN_URL;
        return;
      }
      identityEl.innerHTML = `
        <span class="admin-identity-name">${escapeHtml(user.name)}</span>
        <button type="button" class="btn btn-outline" id="adminLogoutButton">Выйти</button>
      `;
      document.getElementById('adminLogoutButton').addEventListener('click', async () => {
        await logout();
        window.location.href = LOGIN_URL;
      });
    })
    .catch(() => {
      // 401 (сессия истекла/не было) или сеть недоступна — в обоих случаях
      // на административном разделе честно только одно: не показывать
      // каркас без подтверждённой личности, увести на вход.
      window.location.href = LOGIN_URL;
    });
}
