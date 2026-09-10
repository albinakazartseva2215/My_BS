// Страница web/admin/index.html (/admin) — «Записи»: список записей на
// выбранный день с переключением дат и фильтром по мастеру, отмена (с
// указанием причины — состояние и автор отмены сохраняются на сервере,
// docs/db-schema.md, 3.11г), перенос (та же запись, без отмены+пересоздания,
// история — docs/db-schema.md, 3.13), ручное создание записи (включая
// поверх занятого времени, с подтверждением) и блокировка времени мастера
// (перерыв/выходной/отпуск).
//
// Источник состава экрана — docs/ui-map.md, раздел «Административные
// экраны», раздел 9 («Все записи») — там же оговорено, что образец не
// дизайн-прототип, а черновой тестовый фронт: здесь свой макет на тех же
// данных/эндпоинтах, не копия его вёрстки.
//
// Время везде — локальное, в часовом поясе салона, не как оно хранится в
// БД (задание): для показа сервер уже отдаёт готовые startLocal/endLocal
// (server/src/domain/appointmentView.js), для ввода — web/js/dates.js:
// localDateTimeToUtcIso() переводит то, что ввёл администратор, обратно в
// UTC перед отправкой на сервер.
//
// Проверка данных на сервере — server/src/routes/admin.routes.js и
// appointments.routes.js; здесь только HTML5-атрибуты для удобства
// (docs/frontend-rules.md, правило 7 — финальный текст ошибки всегда от
// сервера).

import { initAdminShell } from './admin-shell.js';
import {
  fetchAdminSalonProfile,
  fetchAdminMasters,
  fetchServices,
  fetchAdminAppointments,
  createAdminAppointment,
  completeAdminAppointment,
  cancelAppointmentById,
  rescheduleAdminAppointmentById,
  createAdminTimeBlock,
  createAdminScheduleException,
  describeError,
  ApiRequestError,
} from './api.js';
import { formatPriceRub } from './format.js';
import { addDaysToStr, localDateTimeToUtcIso } from './dates.js';

initAdminShell({ active: 'appointments' });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showMessage(el, text) {
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function showApiError(el, err) {
  showMessage(el, err instanceof ApiRequestError ? describeError(err) : describeError(err));
}

// "Сегодня" в часовом поясе салона, не в часовом поясе браузера — обычно
// совпадает (админ и салон в одном городе), но должно быть верно и когда
// нет: locale en-CA форматирует дату как YYYY-MM-DD напрямую.
function salonTodayStr(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const STATUS_LABELS = { hold: 'Удержание', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена', expired: 'Истекла' };
const STATUS_CLASSES = { hold: 'is-active', confirmed: 'is-active', completed: '', cancelled: 'is-inactive', expired: 'is-inactive' };

// ---- Состояние страницы ----
let salon = null; // { timezone, ... }
let allMasters = []; // включая отключённых — фильтр и формы должны видеть всех
let publicServices = []; // только активные (задание: клиенту недоступные услуги не показываем — тем же принципом и здесь, форма создания не должна предлагать то, что нельзя выбрать по-настоящему)
let dayAppointments = [];

const pageError = document.getElementById('pageError');
const pageNotice = document.getElementById('pageNotice');
const dateInput = document.getElementById('apptDateInput');
const masterFilter = document.getElementById('apptMasterFilter');
const tbody = document.getElementById('apptTbody');
const modalRoot = document.getElementById('modalRoot');

function closeModal() {
  modalRoot.innerHTML = '';
}

// ---- Загрузка списка на выбранный день ----

async function loadAppointments() {
  tbody.innerHTML = '<tr><td colspan="7">Загрузка…</td></tr>';
  showMessage(pageError, null);
  const selectedDate = dateInput.value;
  const masterId = masterFilter.value ? Number(masterFilter.value) : undefined;
  try {
    // from/to шире, чем один день, — только чтобы не тащить с сервера всю
    // историю; литеральное сравнение дат как UTC-границ (admin.routes.js)
    // не совпадает с местными сутками салона, поэтому точный отбор — здесь,
    // по уже готовому startLocal (см. комментарий в web/js/api.js).
    const rows = await fetchAdminAppointments({
      from: addDaysToStr(selectedDate, -1),
      to: addDaysToStr(selectedDate, 2),
      masterId,
    });
    dayAppointments = rows
      .filter((a) => a.startLocal.slice(0, 10) === selectedDate)
      .sort((a, b) => (a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0));
    renderTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7">—</td></tr>';
    showApiError(pageError, err);
  }
}

// Наложение — две активные (hold/confirmed) записи одного мастера с
// пересекающимся временем на этот день. Помечаем все участвующие строки,
// не только ту, что явно создана с overlapOverride (задание: "отметь в
// списке, что на это время назначено два визита" — это про факт наложения
// в расписании, а не только про то, какая из двух записей его вызвала).
function computeOverlapIds(appointments) {
  const overlapping = new Set();
  const byMaster = new Map();
  for (const a of appointments) {
    if (a.status !== 'hold' && a.status !== 'confirmed') continue;
    if (!byMaster.has(a.master.id)) byMaster.set(a.master.id, []);
    byMaster.get(a.master.id).push(a);
  }
  for (const group of byMaster.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const x = group[i];
        const y = group[j];
        if (x.startUtc < y.endUtc && y.startUtc < x.endUtc) {
          overlapping.add(x.id);
          overlapping.add(y.id);
        }
      }
    }
  }
  return overlapping;
}

function statusBadgeHtml(a) {
  const cls = STATUS_CLASSES[a.status] || '';
  let html = `<span class="admin-status-badge ${cls}">${escapeHtml(STATUS_LABELS[a.status] || a.status)}</span>`;
  if (a.status === 'cancelled') {
    const who = a.cancelledBy ? escapeHtml(a.cancelledBy.name) : 'неизвестно';
    const why = a.cancelReason ? escapeHtml(a.cancelReason) : 'без указания причины';
    html += `<div class="admin-row-note" title="${why}">Отменил(а): ${who}</div>`;
  }
  if (a.rescheduledCount) {
    html += `<div class="admin-row-note">Перенесена (${a.rescheduledCount})</div>`;
  }
  return html;
}

function rowActionsHtml(a) {
  const buttons = [];
  if (a.status === 'confirmed') {
    buttons.push(`<button type="button" class="btn btn-outline btn-sm" data-reschedule="${a.id}">Перенести</button>`);
  }
  if (a.status === 'hold' || a.status === 'confirmed') {
    buttons.push(`<button type="button" class="btn btn-outline btn-sm is-danger" data-cancel="${a.id}">Отменить</button>`);
  }
  if (a.status === 'confirmed') {
    buttons.push(`<button type="button" class="btn btn-outline btn-sm" data-complete="${a.id}">Завершить</button>`);
  }
  return buttons.join('');
}

function renderTable() {
  if (dayAppointments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">На этот день записей нет.</td></tr>';
    return;
  }
  const overlapIds = computeOverlapIds(dayAppointments);
  tbody.innerHTML = dayAppointments
    .map((a) => {
      const services = a.services.map((s) => s.name).join(', ');
      const client = a.client ? `${escapeHtml(a.client.name)}` : '<span class="admin-row-note">без клиента (анонимное удержание)</span>';
      const overlapBadge = overlapIds.has(a.id)
        ? '<div class="admin-status-badge is-inactive" title="На это время у мастера назначено больше одного визита">⚠ Два визита</div>'
        : '';
      return `
        <tr>
          <td>${a.startLocal.slice(11, 16)}–${a.endLocal.slice(11, 16)}</td>
          <td class="admin-cell-wrap">${client}</td>
          <td class="admin-cell-wrap">${escapeHtml(a.master.name)}</td>
          <td class="admin-cell-wrap">${escapeHtml(services)}</td>
          <td>${formatPriceRub(a.totalPriceRub)}</td>
          <td>${statusBadgeHtml(a)}${overlapBadge}</td>
          <td class="admin-row-actions">${rowActionsHtml(a)}</td>
        </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => openCancelModal(Number(btn.dataset.cancel)));
  });
  tbody.querySelectorAll('[data-reschedule]').forEach((btn) => {
    btn.addEventListener('click', () => openRescheduleModal(Number(btn.dataset.reschedule)));
  });
  tbody.querySelectorAll('[data-complete]').forEach((btn) => {
    btn.addEventListener('click', () => completeRow(Number(btn.dataset.complete)));
  });
}

async function completeRow(id) {
  try {
    await completeAdminAppointment(id);
    showMessage(pageNotice, `Запись №${id} отмечена завершённой.`);
    await loadAppointments();
  } catch (err) {
    showApiError(pageError, err);
  }
}

// ---- Отмена (модалка с необязательной причиной) ----

function openCancelModal(id) {
  const appointment = dayAppointments.find((a) => a.id === id);
  if (!appointment) return;
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="cancelOverlay">
      <div class="modal-card">
        <div class="modal-title">Отменить запись?</div>
        <p class="modal-text">${escapeHtml(appointment.client ? appointment.client.name : 'Клиент')} · ${appointment.startLocal.slice(11, 16)} · ${escapeHtml(appointment.master.name)}. Запись останется в списке с пометкой «Отменена», время освободится.</p>
        <div class="form-field">
          <label class="form-label" for="cancelReasonInput">Причина (необязательно, видна клиенту)</label>
          <textarea class="form-input" id="cancelReasonInput" rows="2" maxlength="300"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" id="cancelModalBack">Не отменять</button>
          <button type="button" class="btn btn-danger" id="cancelModalConfirm">Отменить запись</button>
        </div>
      </div>
    </div>`;
  document.getElementById('cancelOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'cancelOverlay') closeModal();
  });
  document.getElementById('cancelModalBack').addEventListener('click', closeModal);
  document.getElementById('cancelModalConfirm').addEventListener('click', async () => {
    const reason = document.getElementById('cancelReasonInput').value.trim() || undefined;
    closeModal();
    try {
      await cancelAppointmentById(id, reason);
      showMessage(pageNotice, `Запись №${id} отменена.`);
      await loadAppointments();
    } catch (err) {
      showApiError(pageError, err);
    }
  });
}

// ---- Перенос (та же запись — новое время и, опционально, новый мастер) ----

function openRescheduleModal(id) {
  const appointment = dayAppointments.find((a) => a.id === id);
  if (!appointment) return;
  const masterOptions = allMasters
    .map((m) => `<option value="${m.id}" ${m.id === appointment.master.id ? 'selected' : ''}>${escapeHtml(m.name)}${m.isActive ? '' : ' (отключён)'}</option>`)
    .join('');
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="rescheduleOverlay">
      <div class="modal-card">
        <div class="modal-title">Перенести запись</div>
        <p class="modal-text">${escapeHtml(appointment.client ? appointment.client.name : 'Клиент')} — это та же запись, новая не создаётся, клиент не получит второе уведомление.</p>
        <div class="admin-form-row">
          <div class="form-field">
            <label class="form-label" for="rescheduleDate">Дата</label>
            <input class="form-input" type="date" id="rescheduleDate" value="${appointment.startLocal.slice(0, 10)}">
          </div>
          <div class="form-field">
            <label class="form-label" for="rescheduleTime">Время</label>
            <input class="form-input" type="time" id="rescheduleTime" value="${appointment.startLocal.slice(11, 16)}">
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="rescheduleMaster">Мастер</label>
          <select class="form-input" id="rescheduleMaster">${masterOptions}</select>
        </div>
        <div id="rescheduleError" class="api-error" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" id="rescheduleBack">Отмена</button>
          <button type="button" class="btn btn-primary" id="rescheduleConfirm">Перенести</button>
        </div>
      </div>
    </div>`;
  document.getElementById('rescheduleOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'rescheduleOverlay') closeModal();
  });
  document.getElementById('rescheduleBack').addEventListener('click', closeModal);
  document.getElementById('rescheduleConfirm').addEventListener('click', async () => {
    const date = document.getElementById('rescheduleDate').value;
    const time = document.getElementById('rescheduleTime').value;
    const masterId = Number(document.getElementById('rescheduleMaster').value);
    const errEl = document.getElementById('rescheduleError');
    if (!date || !time) {
      showMessage(errEl, 'Укажите дату и время.');
      return;
    }
    const startDatetime = localDateTimeToUtcIso(date, time, salon.timezone);
    try {
      await rescheduleAdminAppointmentById(id, {
        startDatetime,
        masterId: masterId !== appointment.master.id ? masterId : undefined,
      });
      closeModal();
      showMessage(pageNotice, `Запись №${id} перенесена.`);
      await loadAppointments();
    } catch (err) {
      showApiError(errEl, err);
    }
  });
}

// ---- Создать запись (включая поверх занятого времени) ----

const createForm = document.getElementById('apptCreateForm');
const createError = document.getElementById('apptCreateError');

// masterId — фильтрует publicServices до тех, что мастер реально
// выполняет (allMasters[i].serviceIds — уже загружен вместе со списком
// мастеров, GET /api/admin/masters отдаёт его сразу, см. web/js/api.js —
// отдельный запрос не нужен). Раньше чекбоксы строились без этого
// параметра, из всего каталога, независимо от выбранного мастера —
// находка ручной проверки, docs/test-checklist.md, №4.
function servicesCheckboxesHtml(masterId) {
  const master = allMasters.find((m) => m.id === masterId);
  const services = master ? publicServices.filter((s) => master.serviceIds.includes(s.id)) : publicServices;
  if (services.length === 0) {
    return '<p class="admin-form-hint">Этот мастер не выполняет ни одной активной услуги.</p>';
  }
  return services
    .map(
      (s) => `
      <label>
        <input type="checkbox" name="createService" value="${s.id}">
        ${escapeHtml(s.name)} — ${formatPriceRub(s.priceRub)}
      </label>`,
    )
    .join('');
}

// Перерисовывает чекбоксы под текущий выбор мастера — вызывается и при
// инициализации страницы, и по смене мастера в этой же форме.
function renderCreateServiceCheckboxes() {
  const masterId = Number(document.getElementById('apptCreateMaster').value);
  document.getElementById('apptCreateServices').innerHTML = servicesCheckboxesHtml(masterId);
}
document.getElementById('apptCreateMaster').addEventListener('change', renderCreateServiceCheckboxes);

async function submitCreateAppointment(overlapOverride) {
  const fd = new FormData(createForm);
  const clientId = Number(document.getElementById('apptCreateClientId').value);
  const masterId = Number(document.getElementById('apptCreateMaster').value);
  const serviceIds = fd.getAll('createService').map(Number);
  const date = document.getElementById('apptCreateDate').value;
  const time = document.getElementById('apptCreateTime').value;
  const comment = document.getElementById('apptCreateComment').value.trim() || undefined;
  const remindEnabled = document.getElementById('apptCreateRemind').checked;

  if (serviceIds.length === 0) {
    showMessage(createError, 'Выберите хотя бы одну услугу.');
    return;
  }
  if (!date || !time) {
    showMessage(createError, 'Укажите дату и время.');
    return;
  }
  const startDatetime = localDateTimeToUtcIso(date, time, salon.timezone);

  try {
    await createAdminAppointment({ clientId, masterId, serviceIds, startDatetime, comment, remindEnabled, overlapOverride });
    showMessage(createError, null);
    createForm.reset();
    document.getElementById('apptCreateRemind').checked = true;
    showMessage(pageNotice, overlapOverride ? 'Запись создана поверх занятого времени — на это время назначено два визита.' : 'Запись создана.');
    await loadAppointments();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409 && !overlapOverride) {
      // Проверка занятости сработала на сервере (docs/db-schema.md,
      // раздел 4) — не отключаем её, а спрашиваем подтверждение и, если
      // администратор согласен, повторяем тот же запрос с overlapOverride.
      openOverlapConfirmModal(() => submitCreateAppointment(true));
      return;
    }
    showApiError(createError, err);
  }
}

createForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitCreateAppointment(false);
});

function openOverlapConfirmModal(onConfirm) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="overlapOverlay">
      <div class="modal-card">
        <div class="modal-title">Это время уже занято</div>
        <p class="modal-text">У выбранного мастера на это время уже есть активная запись. Создать запись поверх занятого времени? В списке это будет отмечено как «Два визита».</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" id="overlapBack">Не создавать</button>
          <button type="button" class="btn btn-danger" id="overlapConfirm">Создать поверх занятого</button>
        </div>
      </div>
    </div>`;
  document.getElementById('overlapOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlapOverlay') closeModal();
  });
  document.getElementById('overlapBack').addEventListener('click', closeModal);
  document.getElementById('overlapConfirm').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

// ---- Заблокировать время мастера (перерыв / выходной / отпуск) ----

const blockForm = document.getElementById('blockForm');
const blockError = document.getElementById('blockError');
const blockNotice = document.getElementById('blockNotice');
const blockType = document.getElementById('blockType');
const blockFieldsBreak = document.getElementById('blockFieldsBreak');
const blockFieldsDayoff = document.getElementById('blockFieldsDayoff');
const blockFieldsVacation = document.getElementById('blockFieldsVacation');

function updateBlockFieldsVisibility() {
  blockFieldsBreak.hidden = blockType.value !== 'break';
  blockFieldsDayoff.hidden = blockType.value !== 'dayoff';
  blockFieldsVacation.hidden = blockType.value !== 'vacation';
}
blockType.addEventListener('change', updateBlockFieldsVisibility);
updateBlockFieldsVisibility();

// Отпуск — несколько дневных исключений подряд, не один многодневный
// time_block (см. комментарий у createAdminScheduleException в
// web/js/api.js). Ограничение диапазона — не столько защита, сколько
// страховка от опечатки в годе (например, "с 2026-01-01 по 2027-01-01"),
// которая иначе тихо отправит несколько сотен запросов подряд.
const MAX_VACATION_DAYS = 60;

async function submitBlock(event) {
  event.preventDefault();
  showMessage(blockError, null);
  showMessage(blockNotice, null);

  const masterId = Number(document.getElementById('blockMaster').value);
  const reason = document.getElementById('blockReason').value.trim() || undefined;
  const type = blockType.value;

  try {
    if (type === 'break') {
      const date = document.getElementById('blockBreakDate').value;
      const start = document.getElementById('blockBreakStart').value;
      const end = document.getElementById('blockBreakEnd').value;
      if (!date || !start || !end) {
        showMessage(blockError, 'Укажите дату и время перерыва.');
        return;
      }
      const startDatetime = localDateTimeToUtcIso(date, start, salon.timezone);
      const endDatetime = localDateTimeToUtcIso(date, end, salon.timezone);
      await createAdminTimeBlock(masterId, { startDatetime, endDatetime, reason: reason ?? 'Перерыв' });
      showMessage(blockNotice, 'Перерыв добавлен — это время больше не будет предлагаться клиентам.');
    } else if (type === 'dayoff') {
      const date = document.getElementById('blockDayoffDate').value;
      if (!date) {
        showMessage(blockError, 'Укажите дату выходного.');
        return;
      }
      await createAdminScheduleException(masterId, { date, isDayOff: true, reason: reason ?? 'Выходной' });
      showMessage(blockNotice, 'Выходной добавлен.');
    } else {
      const from = document.getElementById('blockVacationFrom').value;
      const to = document.getElementById('blockVacationTo').value;
      if (!from || !to || to < from) {
        showMessage(blockError, 'Укажите корректный диапазон дат (дата «по» не раньше даты «с»).');
        return;
      }
      const dates = [];
      for (let d = from; d <= to; d = addDaysToStr(d, 1)) {
        dates.push(d);
        if (dates.length > MAX_VACATION_DAYS) {
          showMessage(blockError, `Слишком длинный диапазон (больше ${MAX_VACATION_DAYS} дней) — проверьте даты.`);
          return;
        }
      }
      // Последовательно, не Promise.all — так первая же ошибка (например,
      // сервер недоступен на полпути) понятно указывает, на какой день
      // список дней отпуска остановился, а не превращается в частично
      // непонятный результат гонки параллельных запросов.
      for (const date of dates) {
        await createAdminScheduleException(masterId, { date, isDayOff: true, reason: reason ?? 'Отпуск' });
      }
      showMessage(blockNotice, `Отпуск добавлен: ${dates.length} дн. (${from} — ${to}).`);
    }
    blockForm.reset();
    updateBlockFieldsVisibility();
    document.getElementById('blockBreakStart').value = '13:00';
    document.getElementById('blockBreakEnd').value = '14:00';
  } catch (err) {
    showApiError(blockError, err);
  }
}
blockForm.addEventListener('submit', submitBlock);

// ---- Переключение дня и фильтр по мастеру ----

dateInput.addEventListener('change', loadAppointments);
masterFilter.addEventListener('change', loadAppointments);
document.getElementById('apptPrevDay').addEventListener('click', () => {
  dateInput.value = addDaysToStr(dateInput.value, -1);
  loadAppointments();
});
document.getElementById('apptNextDay').addEventListener('click', () => {
  dateInput.value = addDaysToStr(dateInput.value, 1);
  loadAppointments();
});

// ---- Инициализация ----

(async () => {
  try {
    [salon, allMasters, publicServices] = await Promise.all([
      fetchAdminSalonProfile(),
      fetchAdminMasters(),
      fetchServices(),
    ]);
  } catch (err) {
    showApiError(pageError, err);
    tbody.innerHTML = '<tr><td colspan="7">—</td></tr>';
    return;
  }

  document.getElementById('apptTodayBtn').addEventListener('click', () => {
    dateInput.value = salonTodayStr(salon.timezone);
    loadAppointments();
  });
  dateInput.value = salonTodayStr(salon.timezone);

  const masterOptionsHtml = allMasters
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}${m.isActive ? '' : ' (отключён)'}</option>`)
    .join('');
  masterFilter.innerHTML = '<option value="">Все мастера</option>' + masterOptionsHtml;
  document.getElementById('apptCreateMaster').innerHTML = masterOptionsHtml;
  document.getElementById('blockMaster').innerHTML = masterOptionsHtml;
  renderCreateServiceCheckboxes();

  await loadAppointments();
})();
