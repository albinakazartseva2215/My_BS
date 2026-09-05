// Booking · 5 · Успех (в прототипе — «Booking · 6 · Успех.dc.html», см.
// объяснение сдвига номеров у BOOKING_SUCCESS_URL в js/routes.js).
//
// Карточка — тот же объект appointmentView, что вернул POST /api/appointments
// на предыдущем экране (docs/ui-map.md, раздел 7): отдельного GET не
// требуется, js/store.js просто передал его сюда (js/booking-4.js:
// setLastAppointment). Строка "Уведомление о записи придёт в личный
// кабинет" из прототипа убрана — в API нет ни хранилища, ни эндпоинта
// уведомлений (docs/ui-map.md, пробел А.6, решение уже принято раньше).
//
// У экрана нет ни шапки визарда, ни степпера — в прототипе (booking-6.dc.html)
// их тоже нет: это самостоятельный конечный экран, а не шаг сценария.

import { getLastAppointment, clearBookingFlow } from './store.js';
import { formatDuration, formatPriceRub, initials } from './format.js';
import { BOOKING_SERVICES_URL, ACCOUNT_URL } from './routes.js';
import { formatDayMonth } from './dates.js';

const appointment = getLastAppointment();
const shell = document.getElementById('successShell');

if (!appointment) {
  // Прямой заход на этот экран без только что оформленной записи —
  // показывать нечего, отправляем начинать сначала, а не рисуем пустую
  // страницу или запись из чужого прошлого визита.
  window.location.replace(BOOKING_SERVICES_URL);
  throw new Error('Booking · 5: нет данных только что оформленной записи, редирект на Booking · 1');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- "Добавить в календарь" — .ics-файл, отдельный эндпоинт не нужен
// (docs/ui-map.md, раздел 7: "обычно реализуется экспортом .ics на
// фронте"). ----

function toIcsDate(iso) {
  // "2026-09-04T10:00:00Z" -> "20260904T100000Z"
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildIcsText() {
  const serviceNames = appointment.services.map((s) => s.name).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Тон//Запись в салон//RU',
    'BEGIN:VEVENT',
    `UID:appointment-${appointment.id}@tone-salon`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(appointment.startUtc)}`,
    `DTEND:${toIcsDate(appointment.endUtc)}`,
    `SUMMARY:Тон — ${serviceNames}`,
    `DESCRIPTION:Мастер: ${appointment.master.name}. Услуги: ${serviceNames}.`,
    'LOCATION:г. Москва\\, ул. Тверская\\, 12',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function addToCalendar() {
  const blob = new Blob([buildIcsText()], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Тон — запись ${appointment.startLocal.slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---- Рендер ----

function render() {
  const dateStr = appointment.startLocal.slice(0, 10);
  const time = appointment.startLocal.slice(11, 16);
  const dateLabel = formatDayMonth(dateStr);

  shell.innerHTML = `
    <div class="success-brand">
      <span class="brand-mark" aria-hidden="true">Т</span>
    </div>

    <div class="success-badge" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,12 10,18 20,6"/></svg>
    </div>

    <h1 class="success-title">Вы записаны</h1>

    <div class="success-card">
      <div class="success-card-datetime">${dateLabel}, ${time}</div>
      <div class="visit-summary-master">
        <span class="avatar-circle" aria-hidden="true">${escapeHtml(initials(appointment.master.name))}</span>
        <div class="visit-summary-master-info"><div class="visit-summary-master-name">${escapeHtml(appointment.master.name)}</div></div>
      </div>
      <div class="visit-summary-services">
        ${appointment.services
          .map(
            (s) => `<div class="visit-summary-service-row"><span>${escapeHtml(s.name)} · ${formatDuration(s.durationMinutes)}</span><span>${formatPriceRub(s.priceRub)}</span></div>`,
          )
          .join('')}
      </div>
      <div class="visit-summary-total"><span>Итого: ${formatDuration(appointment.totalDurationMinutes)}</span><span>${formatPriceRub(appointment.totalPriceRub)}</span></div>
      <div class="visit-summary-note">Оплата в салоне, сумма справочная</div>
      <div class="visit-summary-note">г. Москва, ул. Тверская, 12</div>
    </div>

    <div class="success-actions">
      <a href="${ACCOUNT_URL}" class="btn btn-primary btn-block">В личный кабинет</a>
      <button type="button" class="btn btn-outline btn-block" id="icsBtn">Добавить в календарь</button>
    </div>

    <a href="${BOOKING_SERVICES_URL}" class="success-secondary-link" id="againLink">Записаться ещё раз</a>
  `;

  document.getElementById('icsBtn').addEventListener('click', addToCalendar);
  // Новая запись — новый сценарий: старый выбор услуг/мастера/времени
  // этого визита здесь больше не нужен (docs/ui-map.md, раздел 7,
  // переход "Записаться ещё раз" → Booking · 1).
  document.getElementById('againLink').addEventListener('click', () => clearBookingFlow());
}

render();
