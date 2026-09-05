// Личный кабинет — список записей клиента (вкладки "Активные"/"История")
// и пустой кабинет как состояние этого же списка. Экрана-образца в
// прототипе (Full style guide DC) нет вообще — «Нерешённые случаи», №2
// (docs/ui-map.md). Источник вида — компоненты из
// Full style guide DC/Design my B.S..dc.html (страница гайдлайна дизайн-
// системы): секция "06 · Домен" (карточка записи — подтверждена/
// завершена/отменена, приглушение завершённых/отменённых) и секция
// "07 · Обратная связь" (пустое состояние — текст скопирован дословно,
// задание ссылается на неё как "Cabinet 07"). Подробности — в шапке
// css/account.css.

import { fetchMe, fetchAppointments, logout, describeError, ApiRequestError } from './api.js';
import { LOGIN_URL, BOOKING_START_URL, ACCOUNT_APPOINTMENT_URL } from './routes.js';
import { formatPriceRub, initials } from './format.js';
import { relativeDayLabel } from './dates.js';
import { initHeader } from './header.js';

initHeader();

const content = document.getElementById('accountContent');
const errorBox = document.getElementById('accountError');

// 'hold'/'expired' — незавершённые попытки записи (клиент дошёл до шага
// оплаты и передумал/закрыл вкладку), а не настоящие визиты — клиенту их
// в кабинете показывать нечего, это не то, чем можно "управлять".
const STATUS_LABELS = { confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена' };

let activeTab = 'active'; // 'active' | 'history'
let appointments = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatWhen(startLocal) {
  // "Сегодня"/"Завтра" в пределах двух дней, иначе "ДД месяц" — тон
  // сообщений из Design my B.S..dc.html, секция "08 · Документация".
  return `${relativeDayLabel(startLocal.slice(0, 10))}, ${startLocal.slice(11, 16)}`;
}

function renderGreeting(user) {
  const greeting = document.createElement('div');
  greeting.className = 'account-greeting';
  greeting.innerHTML = `
    <div class="account-greeting-identity">
      <div class="account-avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</div>
      <div class="account-greeting-info">
        <div class="account-name">Здравствуйте, ${escapeHtml(user.name)}</div>
        <div class="account-contacts">${escapeHtml(user.email)} · ${escapeHtml(user.phone)}</div>
      </div>
    </div>
    <button type="button" class="btn btn-outline account-logout" id="logoutButton">Выйти</button>
  `;
  return greeting;
}

function appointmentCardHtml(appointment, { isNext = false, muted = false } = {}) {
  const serviceNames = appointment.services.map((s) => s.name).join(', ');
  const statusLabel = STATUS_LABELS[appointment.status] || appointment.status;
  const statusClass = appointment.status === 'confirmed' ? 'is-confirmed' : appointment.status === 'completed' ? 'is-completed' : 'is-cancelled';
  const classes = ['appointment-card'];
  if (muted) classes.push('is-muted');
  if (isNext) classes.push('is-next');
  return `
    <a href="${ACCOUNT_APPOINTMENT_URL}?id=${appointment.id}" class="${classes.join(' ')}">
      ${isNext ? '<div class="appointment-next-chip">Ближайший визит</div>' : ''}
      <div class="appointment-card-head">
        <div class="appointment-when">${escapeHtml(formatWhen(appointment.startLocal))}</div>
        <span class="appointment-status ${statusClass}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="appointment-details">${escapeHtml(appointment.master ? appointment.master.name : '—')} · ${escapeHtml(serviceNames)}</div>
      <div class="appointment-card-foot">
        <span class="appointment-price">${formatPriceRub(appointment.totalPriceRub)}</span>
      </div>
    </a>
  `;
}

function emptyCabinetHtml() {
  // Текст — дословно из Design my B.S..dc.html, секция "07 · Обратная
  // связь", id="empty" (первая карточка).
  return `
    <div class="empty-state">
      <div class="empty-state-blob" aria-hidden="true"></div>
      <div class="empty-state-title">У вас пока нет записей</div>
      <div class="empty-state-text">Выберите мастера и удобное время</div>
      <a href="${BOOKING_START_URL}" class="btn btn-primary">Записаться</a>
    </div>
  `;
}

function renderList() {
  if (appointments.length === 0) {
    content.querySelector('#accountListArea').innerHTML = emptyCabinetHtml();
    return;
  }

  const active = appointments
    .filter((a) => a.status === 'confirmed')
    .sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime());
  const history = appointments
    .filter((a) => a.status === 'completed' || a.status === 'cancelled')
    .sort((a, b) => new Date(b.startUtc).getTime() - new Date(a.startUtc).getTime());

  const tabsHtml = `
    <div class="account-tabs">
      <button type="button" class="account-tab${activeTab === 'active' ? ' is-active' : ''}" data-tab="active">Активные</button>
      <button type="button" class="account-tab${activeTab === 'history' ? ' is-active' : ''}" data-tab="history">История</button>
    </div>
  `;

  let listHtml;
  if (activeTab === 'active') {
    listHtml =
      active.length === 0
        ? '<div class="account-tab-empty">Активных записей нет.</div>'
        : `<div class="appointment-list">${active.map((a, i) => appointmentCardHtml(a, { isNext: i === 0 })).join('')}</div>`;
  } else {
    listHtml =
      history.length === 0
        ? '<div class="account-tab-empty">История пока пуста.</div>'
        : `<div class="appointment-list">${history.map((a) => appointmentCardHtml(a, { muted: true })).join('')}</div>`;
  }

  content.querySelector('#accountListArea').innerHTML = tabsHtml + listHtml;
  content.querySelectorAll('.account-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderList();
    });
  });
}

async function init() {
  let user;
  try {
    user = await fetchMe();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      // Не вошли — сюда попадать не должны, ведём на экран входа, а не
      // показываем пустой кабинет как настоящий.
      window.location.href = LOGIN_URL;
      return;
    }
    errorBox.textContent = describeError(err);
    errorBox.hidden = false;
    return;
  }

  content.innerHTML = '';
  content.appendChild(renderGreeting(user));

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
      await logout();
    } finally {
      window.location.href = 'index.html';
    }
  });

  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'account-section-title';
  sectionTitle.textContent = 'Ваши записи';
  content.appendChild(sectionTitle);

  const listArea = document.createElement('div');
  listArea.id = 'accountListArea';
  listArea.setAttribute('aria-live', 'polite');
  // Заглушка на время загрузки — не пустое место (docs/frontend-rules.md).
  listArea.innerHTML = `
    <div class="skeleton-line" style="height:80px;border-radius:var(--radius-lg);margin-bottom:12px"></div>
    <div class="skeleton-line" style="height:80px;border-radius:var(--radius-lg)"></div>
  `;
  content.appendChild(listArea);

  try {
    appointments = await fetchAppointments();
    renderList();
  } catch (err) {
    const errEl = document.createElement('div');
    errEl.className = 'api-error';
    errEl.textContent = describeError(err);
    listArea.innerHTML = '';
    listArea.appendChild(errEl);
  }
}

init();
