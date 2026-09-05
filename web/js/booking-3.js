// Booking · 3 · Дата и время — календарь месяца + сетка слотов на
// выбранный день. Данные — GET /api/services, GET /api/masters и
// GET /api/masters/:id/availability (js/api.js, правило 3).
//
// РЕЖИМ ПЕРЕНОСА (?reschedule=<id записи>) — задание "личный кабинет",
// пункт 4: кнопка «Перенести» с экрана деталей записи ведёт сюда же, а не
// на отдельный экран. В этом режиме мастер и услуги зафиксированы (берутся
// из самой переносимой записи, GET /api/appointments/:id, а не из
// js/store.js — это состояние визарда новой записи, перенос существующей
// записи с ним никак не связан и не должен его трогать), календарь и
// сетка слотов — те же самые компоненты, что и в обычном режиме, а
// старое время показывается отдельной строкой в баннере и кольцом на
// нужном дне календаря (см. renderRescheduleBanner/renderCalendar) — не
// подменяет собой обычную подсветку "выбрано". Отправка — не
// POST /api/appointments (это создание новой записи), а
// PATCH /api/appointments/:id/reschedule (js/api.js:rescheduleAppointmentById).
//
// Календарь строится тем же приёмом, что уже описан как решение пробела
// А.3 в docs/ui-map.md: отдельного эндпоинта "статус каждого дня месяца"
// нет, поэтому на каждый видимый день месяца — свой вызов availability
// (до ~31 за раз, все параллельно). "Занятое время видно, а не спрятано"
// (задание) стало возможно только после того, как availability.routes.js
// начал отдавать `allSlots` — все кандидаты сетки на день со статусом
// free/busy/past, а не только свободные (см. комментарий у
// computeAvailableSlots в server/src/domain/availability.js: старого
// эндпоинта для этого не хватало — ни границ рабочего окна, ни шага сетки
// наружу не было, восстановить самим было нечем).
//
// "Любой свободный мастер" (выбор с Booking · 2) здесь разрешается в
// конкретного: среди мастеров, которые выполняют все услуги, ищем того,
// у кого раньше всех находится свободное окно (день за днём вперёд, той
// же техникой, что и "ближайшее свободное время" ниже), и молча
// подставляем как обычный выбор мастера — Booking · 4/5 работают только с
// конкретным мастером, "любой" дальше по сценарию не тащим (см. js/store.js).

import { fetchServices, fetchMasters, fetchAvailability, fetchAppointment, rescheduleAppointmentById, describeError, ApiRequestError } from './api.js';
import { initBookingFlow } from './booking-flow.js';
import { getSelectedServiceIds, getSelectedMaster, setSelectedMaster, getSelectedSlot, setSelectedSlot } from './store.js';
import { formatDuration } from './format.js';
import { BOOKING_SERVICES_URL, BOOKING_MASTER_URL, BOOKING_CONFIRM_URL, ACCOUNT_APPOINTMENT_URL } from './routes.js';
import {
  MONTH_NOMINATIVE,
  MONTH_GENITIVE,
  todayYmd,
  todayStr,
  addDaysToStr,
  daysInMonth,
  leadBlanksForMonth,
  nextMonthYM,
  prevMonthYM,
  formatDayMonth,
  relativeDayLabel,
  ymdToStr,
} from './dates.js';

const rescheduleParam = new URLSearchParams(location.search).get('reschedule');
const rescheduleId = rescheduleParam ? Number(rescheduleParam) : null;
const isReschedule = Number.isInteger(rescheduleId) && rescheduleId > 0;
let oldAppointment = null; // только в режиме переноса — сама переносимая запись

let serviceIds = [];
let masterChoice = null;

if (!isReschedule) {
  serviceIds = getSelectedServiceIds();
  masterChoice = getSelectedMaster();

  if (serviceIds.length === 0) {
    window.location.replace(BOOKING_SERVICES_URL);
    throw new Error('Booking · 3: нет выбранных услуг, редирект на Booking · 1');
  }
  if (!masterChoice) {
    window.location.replace(BOOKING_MASTER_URL);
    throw new Error('Booking · 3: не выбран мастер, редирект на Booking · 2');
  }
}

const errorBox = document.getElementById('datetimeError');
const banner = document.getElementById('reminderBanner');
const calPrev = document.getElementById('calPrev');
const calNext = document.getElementById('calNext');
const calMonthLabel = document.getElementById('calMonthLabel');
const calHorizonNote = document.getElementById('calHorizonNote');
const calGrid = document.getElementById('calGrid');
const slotsSection = document.getElementById('slotsSection');
const footerRight = document.getElementById('footerRight');

let masterId = null;
let masterName = '';
let totalDurationMinutes = 0;

let viewYear;
let viewMonth; // 0-индексированный, как в Date
let selectedDateStr = null;
let selectedSlot = null; // { masterId, startUtc, endUtc, startLocal, endLocal }
let nextMonthDisabled = false;

const dayCache = new Map(); // dateStr -> тело ответа availability

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- Поиск ближайшего свободного времени (день за днём вперёд) ----
// Та же техника, что docs/ui-map.md предлагает для пробела А.2/А.3—
// последовательные вызовы уже существующей ручки, без нового эндпоинта.
// Последовательно (не параллельно): останавливаемся на первом же
// найденном дне, дальше сканировать незачем; maxDays — защитный предел на
// случай, если сервер почему-то не пришлёт reason:'beyond_horizon'.
async function findEarliestForMaster(masterIdToCheck, fromDateStr, maxDays = 180) {
  let dateStr = fromDateStr;
  for (let i = 0; i < maxDays; i += 1) {
    const data = await fetchAvailability({ masterId: masterIdToCheck, date: dateStr, serviceIds });
    if (data.reason === 'beyond_horizon') return null;
    if (data.slots.length > 0) return { dateStr, slot: data.slots[0] };
    dateStr = addDaysToStr(dateStr, 1);
  }
  return null;
}

async function resolveAnyMaster(mastersList, fromDateStr) {
  const results = await Promise.all(
    mastersList.map(async (m) => {
      const found = await findEarliestForMaster(m.id, fromDateStr);
      return found ? { masterId: m.id, masterName: m.name, ...found } : null;
    }),
  );
  const viable = results.filter(Boolean);
  if (viable.length === 0) return null;
  viable.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return a.dateStr < b.dateStr ? -1 : 1;
    return new Date(a.slot.startUtc).getTime() - new Date(b.slot.startUtc).getTime();
  });
  return viable[0];
}

// ---- Рендер: ошибка API ----

function renderApiError(err) {
  errorBox.hidden = false;
  errorBox.innerHTML = '';
  errorBox.textContent = describeError(err) + ' ';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-outline';
  retryBtn.textContent = 'Обновить страницу';
  retryBtn.addEventListener('click', () => window.location.reload());
  errorBox.appendChild(retryBtn);
}

// ---- Рендер: календарь ----

function renderCalendarSkeleton() {
  calMonthLabel.textContent = `${MONTH_NOMINATIVE[viewMonth]} ${viewYear}`;
  calHorizonNote.hidden = true;
  calPrev.disabled = true;
  calNext.disabled = true;
  const blanks = leadBlanksForMonth(viewYear, viewMonth);
  const numDays = daysInMonth(viewYear, viewMonth);
  let html = '';
  for (let i = 0; i < blanks; i += 1) html += '<div></div>';
  for (let d = 1; d <= numDays; d += 1) {
    html += '<div class="skeleton-line" style="aspect-ratio:1;min-height:38px;border-radius:var(--radius-sm)" aria-hidden="true"></div>';
  }
  calGrid.innerHTML = html;
}

function classifyDay(data) {
  if (data.reason === 'past_date') return 'past';
  if (data.reason === 'day_off') return 'closed';
  if (data.reason === 'beyond_horizon') return 'beyond';
  return data.slots.length > 0 ? 'free' : 'none';
}

function renderCalendar(dateStrs, blanks) {
  calMonthLabel.textContent = `${MONTH_NOMINATIVE[viewMonth]} ${viewYear}`;
  const today = todayStr();

  let html = '';
  for (let i = 0; i < blanks; i += 1) html += '<div></div>';
  for (const dateStr of dateStrs) {
    const day = Number(dateStr.slice(8, 10));
    const data = dayCache.get(dateStr);
    const type = classifyDay(data);
    const disabled = type !== 'free';
    const classes = ['dt-day', `is-${type}`];
    if (dateStr === today) classes.push('is-today');
    if (dateStr === selectedDateStr) classes.push('is-selected');
    const isOldTimeDay = isReschedule && oldAppointment && dateStr === oldAppointment.startLocal.slice(0, 10);
    if (isOldTimeDay) classes.push('is-old-time');
    const marker = type === 'free' ? '●' : type === 'closed' ? '×' : '';
    const statusLabel =
      (type === 'free' ? ', есть окно' : type === 'none' ? ', окон нет' : type === 'closed' ? ', выходной' : ', недоступно') +
      (isOldTimeDay ? ', текущее время записи' : '');
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${dateStr}" ${disabled ? 'disabled' : ''} aria-label="${day} ${MONTH_GENITIVE[viewMonth]}${statusLabel}">
        <span aria-hidden="true">${day}</span>
        <span class="dt-day-marker" aria-hidden="true">${marker}</span>
      </button>
    `;
  }
  calGrid.innerHTML = html;
  calGrid.querySelectorAll('.dt-day:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => selectDay(btn.dataset.date));
  });

  calHorizonNote.hidden = !nextMonthDisabled;
  if (nextMonthDisabled) calHorizonNote.textContent = 'Это последний доступный месяц для записи';

  const isCurrentMonth = viewYear === todayYmd().y && viewMonth === todayYmd().m;
  calPrev.disabled = isCurrentMonth;
  calNext.disabled = nextMonthDisabled;
}

async function loadMonth() {
  renderCalendarSkeleton();
  renderSlotsLoading();

  const blanks = leadBlanksForMonth(viewYear, viewMonth);
  const numDays = daysInMonth(viewYear, viewMonth);
  const dateStrs = [];
  for (let d = 1; d <= numDays; d += 1) dateStrs.push(ymdToStr(viewYear, viewMonth, d));

  await Promise.all(
    dateStrs.map(async (dateStr) => {
      if (dayCache.has(dateStr)) return;
      dayCache.set(dateStr, await fetchAvailability({ masterId, date: dateStr, serviceIds }));
    }),
  );

  const anyBeyond = dateStrs.some((ds) => dayCache.get(ds).reason === 'beyond_horizon');
  if (anyBeyond) {
    nextMonthDisabled = true;
  } else {
    const [ny, nm] = nextMonthYM(viewYear, viewMonth);
    const nextFirstDay = ymdToStr(ny, nm, 1);
    if (!dayCache.has(nextFirstDay)) {
      dayCache.set(nextFirstDay, await fetchAvailability({ masterId, date: nextFirstDay, serviceIds }));
    }
    nextMonthDisabled = dayCache.get(nextFirstDay).reason === 'beyond_horizon';
  }

  renderCalendar(dateStrs, blanks);

  if (selectedDateStr && dateStrs.includes(selectedDateStr)) {
    renderSlotsForSelectedDay();
  } else {
    selectedDateStr = null;
    selectedSlot = null;
    renderSlotsPrompt();
  }
  renderFooter();
}

async function selectDay(dateStr) {
  selectedDateStr = dateStr;
  selectedSlot = null;
  calGrid.querySelectorAll('.dt-day').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.date === dateStr);
  });
  if (!dayCache.has(dateStr)) {
    dayCache.set(dateStr, await fetchAvailability({ masterId, date: dateStr, serviceIds }));
  }
  renderSlotsForSelectedDay();
  renderFooter();
}

// ---- Рендер: сетка слотов на выбранный день ----

function renderSlotsLoading() {
  const pillsRow = (n) =>
    `<div class="slots-grid">${Array.from({ length: n })
      .map(() => '<div class="skeleton-line slots-skeleton-pill" aria-hidden="true"></div>')
      .join('')}</div>`;
  slotsSection.innerHTML = `
    <div class="slots-group-label">Загрузка свободного времени</div>
    ${pillsRow(5)}
    ${pillsRow(4)}
  `;
}

function renderSlotsPrompt() {
  slotsSection.innerHTML = `<div class="slots-note" style="text-align:center;margin-top:var(--space-16)">Выберите день в календаре, чтобы увидеть свободное время</div>`;
}

function slotGroupOf(startLocal) {
  const hour = Number(startLocal.slice(11, 13));
  if (hour < 12) return 'morning';
  if (hour < 18) return 'day';
  return 'evening';
}

function slotBtnHtml(slot) {
  const isSelected = Boolean(selectedSlot && selectedSlot.startUtc === slot.startUtc);
  const cls = isSelected ? 'is-selected' : `is-${slot.status}`;
  const disabled = slot.status !== 'free' && !isSelected;
  return `<button type="button" class="slot-btn ${cls}" data-start-utc="${slot.startUtc}" ${disabled ? 'disabled' : ''} aria-pressed="${isSelected}">${slot.startLocal.slice(11, 16)}</button>`;
}

function renderSlotsForSelectedDay() {
  const data = dayCache.get(selectedDateStr);

  if (!data || data.slots.length === 0) {
    renderNoSlotsState(data);
    return;
  }

  const groups = { morning: [], day: [], evening: [] };
  for (const slot of data.allSlots) groups[slotGroupOf(slot.startLocal)].push(slot);

  const groupHtml = (label, list) =>
    list.length === 0
      ? ''
      : `
        <div class="slots-group-label">${label}</div>
        <div class="slots-grid">${list.map(slotBtnHtml).join('')}</div>
      `;

  slotsSection.innerHTML = `
    ${groupHtml('Утро', groups.morning)}
    ${groupHtml('День', groups.day)}
    ${groupHtml('Вечер', groups.evening)}
    <div class="slots-note">Визит займёт ${formatDuration(totalDurationMinutes)}, показываем только подходящие окна</div>
    <div class="visit-end-note" id="visitEndNote" hidden></div>
    <div class="slots-hold-note" id="holdNote" hidden>Мы придержим это время, пока вы оформляете запись</div>
  `;

  slotsSection.querySelectorAll('.slot-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => selectSlot(btn.dataset.startUtc));
  });

  renderVisitEndNote();
}

function renderVisitEndNote() {
  const endEl = document.getElementById('visitEndNote');
  const holdEl = document.getElementById('holdNote');
  if (!endEl || !holdEl) return;
  if (selectedSlot) {
    endEl.hidden = false;
    endEl.textContent = `Приём закончится в ${selectedSlot.endLocal.slice(11, 16)}`;
    holdEl.hidden = false;
  } else {
    endEl.hidden = true;
    holdEl.hidden = true;
  }
}

function selectSlot(startUtc) {
  const data = dayCache.get(selectedDateStr);
  const slot = data && data.allSlots.find((s) => s.startUtc === startUtc);
  if (!slot || slot.status !== 'free') return; // на disabled-кнопку клик и так не попадёт — подстраховка
  selectedSlot =
    selectedSlot && selectedSlot.startUtc === startUtc
      ? null
      : { masterId, startUtc: slot.startUtc, endUtc: slot.endUtc, startLocal: slot.startLocal, endLocal: slot.endLocal };
  // В режиме переноса это состояние экрана, а не шаг визарда новой записи —
  // js/store.js трогать незачем (см. комментарий в начале файла).
  if (!isReschedule) setSelectedSlot(selectedSlot);
  renderSlotsForSelectedDay();
  renderFooter();
}

// ---- Рендер: "окон нет в этот день" (Booking 03a — состояние этого экрана) ----

function renderNoSlotsState(data) {
  const reason = data ? data.reason : null;
  // "У мастера «Имя»", а не "У {masterName}" — имя приходит из API в
  // именительном падеже (как в карточке на Booking · 2), склонять его
  // на фронте не на чем; такая формулировка верна при любом имени.
  const title =
    reason === 'day_off'
      ? `У мастера «${masterName}» выходной в этот день`
      : `Нужно ${formatDuration(totalDurationMinutes)} подряд — у мастера «${masterName}» в этот день свободных окон нет`;

  // В режиме переноса мастер зафиксирован (задание, пункт 4) — предлагать
  // сменить его на этом экране нельзя, ссылки здесь нет.
  const otherMasterLink = isReschedule ? '' : `<a href="${BOOKING_MASTER_URL}" class="btn btn-outline">Показать других мастеров</a>`;

  slotsSection.innerHTML = `
    <div class="slots-empty-state">
      <div class="slots-empty-icon" aria-hidden="true">◐</div>
      <div class="slots-empty-title">${escapeHtml(title)}</div>
      <div id="nearestSlotBox"></div>
      <div class="slots-empty-actions">
        ${otherMasterLink}
      </div>
    </div>
  `;
  loadNearestSlot();
}

async function loadNearestSlot() {
  const requestedForDate = selectedDateStr;
  const box = document.getElementById('nearestSlotBox');
  if (!box) return;
  box.innerHTML = '<div class="skeleton-line" style="height:20px;width:240px;margin:0 auto var(--space-16);border-radius:var(--radius-sm)" aria-hidden="true"></div>';

  const nearest = await findEarliestForMaster(masterId, addDaysToStr(selectedDateStr, 1));

  // Пока искали, могли уже выбрать другой день — этот результат больше не про экран.
  if (selectedDateStr !== requestedForDate) return;
  const freshBox = document.getElementById('nearestSlotBox');
  if (!freshBox) return;

  if (!nearest) {
    freshBox.innerHTML = `<div class="slots-empty-nearest">В ближайшее время свободных окон не нашлось — попробуйте другого мастера.</div>`;
    return;
  }

  freshBox.innerHTML = `
    <div class="slots-empty-nearest">Ближайшее свободное время: <strong>${escapeHtml(formatDayMonth(nearest.dateStr))}, ${nearest.slot.startLocal.slice(11, 16)}</strong></div>
    <button type="button" class="btn btn-outline" id="jumpToNearestBtn" style="margin-bottom:var(--space-8)">Показать этот день</button>
  `;
  document.getElementById('jumpToNearestBtn').addEventListener('click', async () => {
    const [y, m] = nearest.dateStr.split('-').map(Number);
    const sameMonth = y === viewYear && m - 1 === viewMonth;
    if (sameMonth) {
      await selectDay(nearest.dateStr);
    } else {
      viewYear = y;
      viewMonth = m - 1;
      selectedDateStr = nearest.dateStr;
      await loadMonth();
    }
  });
}

// ---- Рендер: подвал "Назад/Далее" (или "Перенести" в режиме переноса) ----

function renderFooter() {
  const primaryLabel = isReschedule ? 'Перенести' : 'Далее';

  if (!selectedSlot) {
    footerRight.innerHTML = `
      <span class="booking-missing-hint">Выберите дату и время, чтобы продолжить</span>
      <button type="button" class="btn btn-primary" disabled>${primaryLabel}</button>
    `;
    return;
  }

  if (!isReschedule) {
    footerRight.innerHTML = `<a href="${BOOKING_CONFIRM_URL}" class="btn btn-primary">Далее</a>`;
    return;
  }

  // Выбрали ровно то же время, что и сейчас — переносить некуда.
  if (oldAppointment && selectedSlot.startUtc === oldAppointment.startUtc) {
    footerRight.innerHTML = `
      <span class="booking-missing-hint">Это то же время, что и сейчас</span>
      <button type="button" class="btn btn-primary" disabled>Перенести</button>
    `;
    return;
  }

  footerRight.innerHTML = `<button type="button" class="btn btn-primary" id="rescheduleSubmitBtn">Перенести на это время</button>`;
  document.getElementById('rescheduleSubmitBtn').addEventListener('click', doReschedule);
}

// ---- Режим переноса: отправка и обработка конфликта ----

function renderRescheduleBanner() {
  banner.hidden = false;
  const serviceNames = oldAppointment.services.map((s) => s.name).join(' + ');
  banner.innerHTML = `
    <div>${escapeHtml(oldAppointment.master.name)} · ${escapeHtml(serviceNames)} · ${formatDuration(oldAppointment.totalDurationMinutes)}</div>
    <div class="reschedule-old-time">Сейчас: ${escapeHtml(formatDayMonth(oldAppointment.startLocal.slice(0, 10)))}, ${oldAppointment.startLocal.slice(11, 16)}–${oldAppointment.endLocal.slice(11, 16)}</div>
  `;
}

// Мини-шапка для режима переноса — не шаг визарда новой записи, поэтому
// не initBookingFlow() (ни степпера, ни его 4 узлов здесь нет), крестик
// ведёт назад к записи, а не на лендинг.
function renderRescheduleHeader() {
  const root = document.getElementById('booking-flow-root');
  if (!root) return;
  const backHref = `${ACCOUNT_APPOINTMENT_URL}?id=${rescheduleId}`;
  root.innerHTML = `
    <div class="flow-header">
      <a class="brand" href="${backHref}">
        <span class="brand-mark" aria-hidden="true">Т</span>
        <span class="brand-name">Тон</span>
      </a>
      <a class="flow-close" href="${backHref}" aria-label="Отменить перенос и вернуться к записи">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </a>
    </div>
  `;
}

// Конфликт при переносе — тот же смысл, что "Booking 04b" на экране
// подтверждения (js/booking-4.js): текст сервера как есть, ближайшие
// варианты — из ответа сервера, а не свои. Выбор варианта здесь не
// перекидывает на другой экран — сразу прыгает на нужный день/слот этого
// же календаря, раз мастер и услуги и так зафиксированы.
function renderRescheduleConflict(err) {
  // Слот, который только что не прошёл, больше не "выбран" — иначе подвал
  // показал бы рабочую кнопку "Перенести на это время" поверх сообщения о
  // конфликте на то же самое время.
  selectedSlot = null;
  const nearbySlots = (err.details && err.details.nearbySlots) || [];
  const altHtml = nearbySlots
    .map(
      (s) => `
        <button type="button" class="btn btn-outline btn-block conflict-alt-btn"
          data-start-utc="${s.startUtc}" data-end-utc="${s.endUtc}"
          data-start-local="${s.startLocal}" data-end-local="${s.endLocal}">
          ${escapeHtml(relativeDayLabel(s.startLocal.slice(0, 10)))}, ${s.startLocal.slice(11, 16)}
        </button>
      `,
    )
    .join('');

  slotsSection.innerHTML = `
    <div class="conflict-panel">
      <div class="conflict-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
      </div>
      <div class="conflict-title">Это время только что заняли</div>
      <div class="conflict-text">${escapeHtml(err.message)}</div>
      ${altHtml ? `<div class="conflict-alt-slots">${altHtml}</div>` : ''}
    </div>
  `;

  slotsSection.querySelectorAll('.conflict-alt-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { startUtc, startLocal } = btn.dataset;
      const dateStr = startLocal.slice(0, 10);
      const [y, m] = dateStr.split('-').map(Number);
      const sameMonth = y === viewYear && m - 1 === viewMonth;
      selectedDateStr = dateStr;
      if (sameMonth) {
        await selectDay(dateStr);
      } else {
        viewYear = y;
        viewMonth = m - 1;
        await loadMonth();
      }
      selectSlot(startUtc);
    });
  });

  renderFooter();
}

async function doReschedule() {
  const btn = document.getElementById('rescheduleSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Переносим…';
  try {
    await rescheduleAppointmentById(rescheduleId, selectedSlot.startUtc);
    window.location.href = `${ACCOUNT_APPOINTMENT_URL}?id=${rescheduleId}`;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) {
      renderRescheduleConflict(err);
    } else {
      // Любой другой ответ сервера (в т.ч. отказ) — текстом клиенту, а не
      // только в консоль (задание).
      btn.disabled = false;
      btn.textContent = 'Перенести на это время';
      renderApiError(err);
    }
  }
}

// ---- Разрешение "любого свободного мастера" ----

function renderResolvingAny() {
  slotsSection.innerHTML = `<div class="slots-note" style="text-align:center;margin-top:var(--space-16)">Подбираем мастера посвободнее…</div>`;
  footerRight.innerHTML = `<button type="button" class="btn btn-primary" disabled>Далее</button>`;
}

function renderNoMasterAvailable() {
  slotsSection.innerHTML = `
    <div class="slots-empty-state">
      <div class="slots-empty-icon" aria-hidden="true">◐</div>
      <div class="slots-empty-title">Ни у одного мастера нет свободного времени в обозримом будущем</div>
      <div class="slots-empty-actions">
        <a href="${BOOKING_MASTER_URL}" class="btn btn-outline">Выбрать мастера вручную</a>
      </div>
    </div>
  `;
  footerRight.innerHTML = `<button type="button" class="btn btn-primary" disabled>Далее</button>`;
}

// ---- Инициализация ----

function wireCalendarNav() {
  calPrev.addEventListener('click', async () => {
    [viewYear, viewMonth] = prevMonthYM(viewYear, viewMonth);
    await loadMonth();
  });
  calNext.addEventListener('click', async () => {
    [viewYear, viewMonth] = nextMonthYM(viewYear, viewMonth);
    await loadMonth();
  });
}

async function initReschedule() {
  oldAppointment = await fetchAppointment(rescheduleId);
  serviceIds = oldAppointment.services.map((s) => s.serviceId);
  totalDurationMinutes = oldAppointment.totalDurationMinutes;
  masterId = oldAppointment.master.id;
  masterName = oldAppointment.master.name;

  renderRescheduleBanner();

  selectedDateStr = todayStr();
  const t = todayYmd();
  viewYear = t.y;
  viewMonth = t.m;

  wireCalendarNav();
  await loadMonth();
}

async function initNewBooking() {
  const [services, masters] = await Promise.all([fetchServices(), fetchMasters(serviceIds)]);
  const selectedServices = services.filter((s) => serviceIds.includes(s.id));
  totalDurationMinutes = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const serviceNames = selectedServices.map((s) => s.name).join(' + ');

  if (masterChoice.type === 'master') {
    const found = masters.find((m) => m.id === masterChoice.id);
    if (!found) {
      window.location.replace(BOOKING_MASTER_URL);
      return;
    }
    masterId = found.id;
    masterName = found.name;
  } else {
    renderResolvingAny();
    const resolved = await resolveAnyMaster(masters, todayStr());
    if (!resolved) {
      renderNoMasterAvailable();
      return;
    }
    masterId = resolved.masterId;
    masterName = resolved.masterName;
    setSelectedMaster({ type: 'master', id: masterId });
  }

  banner.hidden = false;
  banner.textContent = `${masterName} · ${serviceNames} · ${formatDuration(totalDurationMinutes)}`;

  // Возвращались назад и снова вперёд с уже выбранным слотом у того же
  // мастера — открываем сразу тот день, а не начинаем сначала.
  const savedSlot = getSelectedSlot();
  if (savedSlot && savedSlot.masterId === masterId) {
    selectedSlot = savedSlot;
    selectedDateStr = savedSlot.startLocal.slice(0, 10);
    viewYear = Number(selectedDateStr.slice(0, 4));
    viewMonth = Number(selectedDateStr.slice(5, 7)) - 1;
  } else {
    selectedDateStr = todayStr();
    const t = todayYmd();
    viewYear = t.y;
    viewMonth = t.m;
  }

  wireCalendarNav();
  await loadMonth();
}

async function init() {
  try {
    if (isReschedule) {
      await initReschedule();
    } else {
      await initNewBooking();
    }
  } catch (err) {
    renderApiError(err);
  }
}

// Шапка визарда — только для обычной записи; в режиме переноса своя,
// минимальная (без степпера).
if (isReschedule) {
  // Заголовок/крестик/ссылка "Назад" не зависят от загрузки самой записи —
  // рисуем сразу, чтобы шапка не была пустой ту секунду, пока грузится
  // GET /api/appointments/:id (initReschedule() внутри init() ниже).
  document.getElementById('pageTitle').textContent = 'Выберите новое время';
  document.getElementById('backLink').href = `${ACCOUNT_APPOINTMENT_URL}?id=${rescheduleId}`;
  renderRescheduleHeader();
} else {
  initBookingFlow(3);
}

// Скелетон сразу, до первого await — иначе календарь и сетка слотов
// секунду-другую выглядят пустыми, пока грузятся услуги/мастера (задание:
// пустая сетка и "нет свободного времени" — разные вещи, не путать одно
// с другим). init() ниже сам перерисует всё поверх, когда данные придут —
// в т.ч. если сохранённый слот окажется в другом месяце.
{
  const t = todayYmd();
  viewYear = t.y;
  viewMonth = t.m;
  renderCalendarSkeleton();
  renderSlotsLoading();
  renderFooter();
}

init();
