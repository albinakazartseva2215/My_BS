// Личный кабинет · детали записи — кнопки отмены (через модалку с
// правилами отмены и предупреждением "мало времени") и переноса (ведёт на
// Booking · 3 в режиме переноса). Источники вида — см. шапку css/account.css.
//
// Отмена/перенос требуют входа (requireAuth на сервере) — если сессии нет,
// сюда попадать не должны (кабинет уже отправил бы на login.html), но
// защищаемся и здесь: GET /api/appointments/:id сам вернёт 401.

import { fetchAppointment, cancelAppointmentById, describeError, ApiRequestError } from './api.js';
import { LOGIN_URL, ACCOUNT_URL, BOOKING_DATETIME_URL } from './routes.js';
import { formatDuration, formatPriceRub, initials } from './format.js';
import { formatDayMonth } from './dates.js';
import { initHeader } from './header.js';

initHeader();

const id = Number(new URLSearchParams(location.search).get('id'));
const errorBox = document.getElementById('detailsError');
const content = document.getElementById('detailsContent');
const modalRoot = document.getElementById('modalRoot');

if (!Number.isInteger(id) || id <= 0) {
  window.location.replace(ACCOUNT_URL);
  throw new Error('account-appointment: некорректный id в адресе, редирект в кабинет');
}

const STATUS_LABELS = { confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена' };

let appointment = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function statusClass(status) {
  return status === 'confirmed' ? 'is-confirmed' : status === 'completed' ? 'is-completed' : 'is-cancelled';
}

function renderError(err) {
  content.innerHTML = '';
  errorBox.hidden = false;
  // Правило задания: ответ сервера (в т.ч. отказ — 403/404/...) показываем
  // клиенту текстом целиком, не только в консоли.
  errorBox.textContent = describeError(err);
}

// ---- Карточка записи ----

function detailsHtml() {
  const dateStr = appointment.startLocal.slice(0, 10);
  const time = appointment.startLocal.slice(11, 16);
  const statusLabel = STATUS_LABELS[appointment.status] || appointment.status;
  const canManage = appointment.status === 'confirmed';

  const servicesHtml = appointment.services
    .map(
      (s) => `<div class="visit-summary-service-row"><span>${escapeHtml(s.name)} · ${formatDuration(s.durationMinutes)}</span><span>${formatPriceRub(s.priceRub)}</span></div>`,
    )
    .join('');

  return `
    <div class="visit-summary-card">
      <div class="visit-summary-row-head">
        <div class="visit-summary-datetime">${formatDayMonth(dateStr)}, ${time}</div>
        <span class="appointment-status ${statusClass(appointment.status)}">${escapeHtml(statusLabel)}</span>
      </div>

      <div class="visit-summary-master">
        <span class="avatar-circle" aria-hidden="true">${escapeHtml(initials(appointment.master.name))}</span>
        <div class="visit-summary-master-info"><div class="visit-summary-master-name">${escapeHtml(appointment.master.name)}</div></div>
      </div>

      <div class="visit-summary-title">Услуги</div>
      <div class="visit-summary-services">${servicesHtml}</div>

      <div class="visit-summary-total"><span>Итого: ${formatDuration(appointment.totalDurationMinutes)}</span><span>${formatPriceRub(appointment.totalPriceRub)}</span></div>
      <div class="visit-summary-note">Оплата в салоне, сумма справочная</div>
      <div class="visit-summary-note">г. Москва, ул. Тверская, 12</div>
      ${appointment.comment ? `<div class="visit-summary-note" style="margin-top:var(--space-16)"><strong>Комментарий мастеру:</strong> ${escapeHtml(appointment.comment)}</div>` : ''}
      <div class="visit-summary-note">${appointment.remindEnabled ? 'Напоминание о визите включено' : 'Напоминание о визите отключено'}</div>
    </div>

    ${
      canManage
        ? `
          <div class="success-actions" style="margin-top:var(--space-16)">
            <button type="button" class="btn btn-outline btn-block" id="rescheduleBtn">Перенести</button>
            <button type="button" class="btn btn-danger btn-block" id="cancelBtn">Отменить запись</button>
          </div>
          <div class="confirm-cta-note">Отменить или перенести можно не позднее чем за 2 часа до визита</div>
        `
        : ''
    }
  `;
}

function render() {
  content.innerHTML = detailsHtml();
  if (appointment.status !== 'confirmed') return;
  document.getElementById('cancelBtn').addEventListener('click', openCancelModal);
  document.getElementById('rescheduleBtn').addEventListener('click', () => {
    window.location.href = `${BOOKING_DATETIME_URL}?reschedule=${id}`;
  });
}

// ---- Модалка отмены (задание: "отмена через окно подтверждения, с
// текстом про правила отмены") ----

function closeModal() {
  modalRoot.innerHTML = '';
}

function openCancelModal() {
  const hoursLeft = (new Date(appointment.startUtc).getTime() - Date.now()) / 3_600_000;
  // Тот же порог "2 часа", что уже заявлен клиенту текстом на этом же
  // экране и на Booking · 4/5 ("не позднее чем за 2 часа до визита") —
  // сервер это не проверяет (см. server/src/domain/booking.js:
  // cancelAppointment/rescheduleAppointment), поэтому это предупреждение,
  // а не блокировка: кнопка ниже всё равно рабочая.
  const soon = hoursLeft > 0 && hoursLeft < 2;

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="cancelOverlay">
      <div class="modal-card">
        <div class="modal-title">Отменить запись</div>
        <div class="modal-text">Запись на ${escapeHtml(formatDayMonth(appointment.startLocal.slice(0, 10)))}, ${appointment.startLocal.slice(11, 16)} будет отменена. Время освободится для других клиентов. Это действие нельзя отменить.</div>
        ${soon ? '<div class="inline-alert">До визита осталось меньше 2 часов — обычно в это время отмена уже недоступна.</div>' : ''}
        <div id="cancelModalError"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" id="cancelModalDismiss">Оставить</button>
          <button type="button" class="btn btn-danger" id="cancelModalConfirm">Отменить запись</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('cancelModalDismiss').addEventListener('click', closeModal);
  document.getElementById('cancelOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'cancelOverlay') closeModal();
  });
  document.getElementById('cancelModalConfirm').addEventListener('click', confirmCancel);
}

async function confirmCancel() {
  const btn = document.getElementById('cancelModalConfirm');
  const dismissBtn = document.getElementById('cancelModalDismiss');
  const errSlot = document.getElementById('cancelModalError');
  btn.disabled = true;
  dismissBtn.disabled = true;
  btn.textContent = 'Отменяем…';
  try {
    appointment = await cancelAppointmentById(id);
    closeModal();
    render();
  } catch (err) {
    btn.disabled = false;
    dismissBtn.disabled = false;
    btn.textContent = 'Отменить запись';
    // Правило задания: ответ сервера — текстом клиенту, свой текст не
    // придумываем (тот же принцип, что для конфликта на Booking · 4).
    const message = err instanceof ApiRequestError ? describeError(err) : String(err);
    errSlot.innerHTML = `<div class="api-error" style="margin-bottom:var(--space-16)">${escapeHtml(message)}</div>`;
    if (!(err instanceof ApiRequestError)) throw err;
  }
}

// ---- Инициализация ----

async function init() {
  try {
    appointment = await fetchAppointment(id);
    render();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      window.location.href = LOGIN_URL;
      return;
    }
    renderError(err);
  }
}

init();
