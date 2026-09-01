// Личный кабинет — минимальная заглушка (см. css/account.css). Все
// обращения к серверу — только через js/api.js (правило 3).

import { fetchMe, fetchAppointments, logout, ApiRequestError, describeError } from './api.js';
import { LOGIN_URL, BOOKING_START_URL } from './routes.js';
import { formatDuration, formatPriceRub, initials } from './format.js';
import { initHeader } from './header.js';

initHeader();

const content = document.getElementById('accountContent');
const errorBox = document.getElementById('accountError');

const APPOINTMENT_STATUS_LABELS = {
  confirmed: 'Подтверждена',
  completed: 'Завершена',
  cancelled: 'Отменена',
  no_show: 'Не пришёл',
};

function statusClass(status) {
  if (status === 'confirmed' || status === 'completed') return 'is-confirmed';
  if (status === 'cancelled' || status === 'no_show') return 'is-cancelled';
  return '';
}

function renderGreeting(user) {
  const greeting = document.createElement('div');
  greeting.className = 'account-greeting';
  greeting.innerHTML = `
    <div class="account-avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</div>
    <div>
      <div class="account-name">Здравствуйте, ${escapeHtml(user.name)}</div>
      <div class="account-contacts">${escapeHtml(user.email)} · ${escapeHtml(user.phone)}</div>
    </div>
    <button type="button" class="btn btn-outline account-logout" id="logoutButton">Выйти</button>
  `;
  return greeting;
}

function renderAppointmentCard(appointment) {
  const card = document.createElement('div');
  card.className = 'appointment-card';
  const serviceNames = appointment.services.map((s) => s.name).join(', ');
  const when = new Date(appointment.startLocal).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const statusLabel = APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status;
  card.innerHTML = `
    <div>
      <div class="appointment-when">${escapeHtml(when)}</div>
      <div class="appointment-details">${escapeHtml(appointment.master ? appointment.master.name : '')} · ${escapeHtml(serviceNames)} · ${formatDuration(appointment.totalDurationMinutes)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:var(--space-12)">
      <div class="appointment-price">${formatPriceRub(appointment.totalPriceRub)}</div>
      <div class="appointment-status ${statusClass(appointment.status)}">${escapeHtml(statusLabel)}</div>
    </div>
  `;
  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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

  const list = document.createElement('div');
  list.className = 'appointment-list';
  list.setAttribute('aria-live', 'polite');
  content.appendChild(list);

  // Заглушка на время загрузки списка записей.
  for (let i = 0; i < 2; i += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-line';
    skeleton.style.height = '80px';
    skeleton.style.borderRadius = 'var(--radius-lg)';
    skeleton.setAttribute('aria-hidden', 'true');
    list.appendChild(skeleton);
  }

  try {
    const appointments = await fetchAppointments();
    list.innerHTML = '';
    if (appointments.length === 0) {
      // Ровно тот "пустой кабинет" из задания — новый аккаунт после
      // регистрации просто не успел ни на что записаться.
      const empty = document.createElement('div');
      empty.className = 'account-empty';
      empty.innerHTML = `
        У вас пока нет записей.
        <br><a href="${BOOKING_START_URL}" class="btn btn-primary">Записаться</a>
      `;
      list.replaceWith(empty);
    } else {
      appointments.forEach((appointment) => list.appendChild(renderAppointmentCard(appointment)));
    }
  } catch (err) {
    list.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.className = 'api-error';
    errEl.textContent = describeError(err);
    list.replaceWith(errEl);
  }
}

init();
