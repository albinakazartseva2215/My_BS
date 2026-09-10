// Общая шапка клиента — единственное место, где описана её разметка.
// Раньше шапка (и мобильное меню) была продублирована в разметке каждой
// страницы (index/login/register/password-reset/account) — при любой
// правке пришлось бы синхронизировать 5 копий вручную, а на account.html
// разметка вообще не подключала нужный CSS (см. ниже) и оставалась
// нестилизованной. Теперь каждая страница просто вызывает initHeader() —
// один источник разметки, стилей и поведения.
//
// Состав — из прототипа (Full style guide DC/export/src/landing.dc.html:
// лого, 4 ссылки раздела, «Войти», «Записаться», бургер для мобильного) и
// из "Карта переходов прототипа.xlsx": лист "Карта переходов", строка 2,
// C2 — «Записаться» (кнопка в шапке); лист "Нерешённые случаи", №1,
// C2 — кнопка «Войти» (шапка). Отдельного листа "глобальная навигация" в
// этом файле нет — в нём всего два листа, оба уже учтены здесь и в
// docs/ui-map.md; больше элементов шапки ни один из источников не называет.
//
// Про аватар и кнопку «Регистрация» источников (ни в прототипе, ни в
// карте) нет — это прямое требование задания ("если клиент не вошёл,
// показывай кнопки входа и регистрации вместо аватара"), которого сама
// карта переходов не касается (в прототипе представления о вошедшем
// клиенте не было вообще).

import { fetchMe, fetchNotifications } from './api.js';
import {
  BOOKING_START_URL,
  LOGIN_URL,
  REGISTER_URL,
  ACCOUNT_URL,
  ACCOUNT_NOTIFICATIONS_URL,
  ADMIN_APPOINTMENTS_URL,
} from './routes.js';
import { initials } from './format.js';
import { wireMobileMenu } from './nav.js';

const NAV_LINKS = [
  { label: 'Услуги', hash: 'services' },
  { label: 'Мастера', hash: 'masters' },
  { label: 'Как это работает', hash: 'how' },
  { label: 'Отзывы', hash: 'reviews' },
];

// На самом лендинге ссылки — обычные "#services" (их подхватывает плавный
// скролл лендинга, js/landing.js:wireSmoothScroll — он ищет именно
// a[href^="#"]); с любой другой страницы тот же раздел — это переход на
// index.html с якорем, плавный скролл тут ни при чём, это переход между
// документами.
function navHref(hash) {
  const onLanding = /\/(index\.html)?$/.test(location.pathname);
  return onLanding ? `#${hash}` : `index.html#${hash}`;
}

function navLinksHtml() {
  return NAV_LINKS.map((l) => `<a href="${navHref(l.hash)}">${escapeHtml(l.label)}</a>`).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function loggedOutIdentityHtml() {
  return `
    <a href="${LOGIN_URL}" class="btn btn-ghost">Войти</a>
    <a href="${REGISTER_URL}" class="btn btn-ghost">Регистрация</a>
  `;
}

function loggedOutMobileHtml() {
  return `<a href="${LOGIN_URL}">Войти</a><a href="${REGISTER_URL}">Регистрация</a>`;
}

// Ссылка на /admin — только у администратора (роль проверяется по списку
// ролей, includes, не равенством — как и на сервере, см. requireRole в
// server/src/middleware/auth.js). Это украшение шапки, а не защита: сам
// раздел /admin закрыт на сервере независимо от того, видна тут ссылка или
// нет (web/server.js — проверка при раздаче страницы; server/src/routes/
// admin.routes.js — проверка на каждом административном эндпоинте).
function isAdmin(user) {
  return Array.isArray(user.roles) && user.roles.includes('admin');
}

// Колокольчик уведомлений — счётчик берёт unreadCount из того же ответа
// GET /api/notifications, которым пользуется и сам экран уведомлений
// (js/account-notifications.js); отдельного запроса ради одного числа нет
// ни здесь, ни на сервере (docs/db-schema.md, раздел 8). unreadCount — уже
// готовое число с сервера (отдельный COUNT по непрочитанным), не
// notifications.length на этой странице.
function bellHtml(unreadCount) {
  const badge = unreadCount > 0
    ? `<span class="header-bell-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`
    : '';
  return `
    <a href="${ACCOUNT_NOTIFICATIONS_URL}" class="header-bell-link" title="Уведомления" aria-label="Уведомления${unreadCount > 0 ? ` (непрочитанных: ${unreadCount})` : ''}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
      ${badge}
    </a>
  `;
}

function loggedInIdentityHtml(user, unreadCount) {
  const adminLink = isAdmin(user)
    ? `<a href="${ADMIN_APPOINTMENTS_URL}" class="btn btn-ghost">Админ-панель</a>`
    : '';
  return `
    ${adminLink}
    ${bellHtml(unreadCount)}
    <a href="${ACCOUNT_URL}" class="header-avatar-link" title="Личный кабинет — ${escapeHtml(user.name)}">
      <span class="header-avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</span>
      <span class="header-avatar-name">${escapeHtml(user.name)}</span>
    </a>
  `;
}

function loggedInMobileHtml(user, unreadCount) {
  const adminLink = isAdmin(user) ? `<a href="${ADMIN_APPOINTMENTS_URL}">Админ-панель</a>` : '';
  const notifLabel = unreadCount > 0 ? `Уведомления (${unreadCount > 99 ? '99+' : unreadCount})` : 'Уведомления';
  return `${adminLink}<a href="${ACCOUNT_NOTIFICATIONS_URL}">${notifLabel}</a><a href="${ACCOUNT_URL}">Личный кабинет · ${escapeHtml(user.name)}</a>`;
}

// Пока не знаем, вошёл ли клиент, — заглушка (тот же приём, что и на
// остальных страницах: не пустое место, а скелетон, docs/frontend-rules.md
// подразумевает это правилом про ошибки/загрузку по всему сайту).
const IDENTITY_SKELETON = '<span class="skeleton-line header-identity-skeleton" aria-hidden="true"></span>';

// Инициализирует шапку внутри #site-header-root и мобильное меню — вызывать
// один раз в самом начале скрипта страницы, до любого кода, который ищет
// элементы шапки (плавный скролл лендинга и т.п.), — вставка синхронная,
// известно, чей клиент, только позже.
export function initHeader() {
  const root = document.getElementById('site-header-root');
  if (!root) return;

  root.innerHTML = `
    <header class="site-header">
      <a class="brand" href="index.html">
        <span class="brand-mark" aria-hidden="true">Т</span>
        <span class="brand-name">Тон</span>
      </a>
      <nav class="nav-links" aria-label="Разделы сайта">${navLinksHtml()}</nav>
      <div class="header-actions">
        <span class="header-identity" id="headerIdentity">${IDENTITY_SKELETON}</span>
        <a href="${BOOKING_START_URL}" class="btn btn-primary">Записаться</a>
        <button type="button" class="burger" id="burgerButton" aria-label="Открыть меню" aria-expanded="false" aria-controls="mobileNav">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        </button>
      </div>
    </header>
    <nav class="mobile-nav" id="mobileNav" aria-label="Разделы сайта (мобильное меню)">
      ${navLinksHtml()}
      <span id="mobileHeaderIdentity"></span>
    </nav>
  `;

  wireMobileMenu();

  fetchMe()
    .then(async (user) => {
      // unreadCount — лучшее усилие: если запрос не удался, шапка всё
      // равно показывает личность клиента, просто без бейджа-числа на
      // колокольчике (0 по умолчанию), а не ломается целиком из-за
      // второстепенного счётчика.
      let unreadCount = 0;
      try {
        ({ unreadCount } = await fetchNotifications());
      } catch {
        // см. комментарий выше
      }
      document.getElementById('headerIdentity').innerHTML = loggedInIdentityHtml(user, unreadCount);
      document.getElementById('mobileHeaderIdentity').innerHTML = loggedInMobileHtml(user, unreadCount);
    })
    .catch(() => {
      // 401 (обычный случай для гостя) или сеть недоступна — в обоих
      // случаях самое честное поведение шапки одно и то же: считать, что
      // клиент не вошёл, и показать кнопки входа/регистрации, а не
      // держать скелетон вечно или падать самой шапкой.
      document.getElementById('headerIdentity').innerHTML = loggedOutIdentityHtml();
      document.getElementById('mobileHeaderIdentity').innerHTML = loggedOutMobileHtml();
    });
}
