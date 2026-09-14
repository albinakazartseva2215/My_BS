// Страница web/admin/masters.html (/admin/masters) — список мастеров
// (включая отключённых, с пометкой — клиенту их не показываем, см.
// server/src/db/repositories/masters.js:listActiveMasters/
// listActiveMastersForServiceIds), добавление, редактирование, включение/
// отключение, удаление и — отдельным блоком — какие услуги мастер
// выполняет (master_services). Именно эта связь уже используется на
// клиентском выборе мастера (web/js/booking-2.js вызывает
// fetchMasters(serviceIds), а сервер — listActiveMastersForServiceIds —
// отдаёт только тех, кто умеет ВСЕ выбранные услуги); здесь её просто
// можно редактировать, а не заново изобретать фильтрацию.

import { initAdminShell } from './admin-shell.js';
import {
  fetchAdminMasters,
  fetchAdminMaster,
  fetchAdminServices,
  createAdminMaster,
  updateAdminMaster,
  deleteAdminMaster,
  replaceAdminMasterServices,
  replaceAdminMasterSchedule,
  describeError,
  ApiRequestError,
} from './api.js';

initAdminShell({ active: 'masters' });

const tbody = document.getElementById('mastersTbody');
const pageError = document.getElementById('pageError');
const pageNotice = document.getElementById('pageNotice');
const form = document.getElementById('masterForm');
const formTitle = document.getElementById('masterFormTitle');
const formError = document.getElementById('formError');
const submitBtn = document.getElementById('masterSubmitBtn');
const cancelBtn = document.getElementById('masterCancelBtn');

const servicesSection = document.getElementById('masterServicesSection');
const servicesNameEl = document.getElementById('masterServicesName');
const servicesGrid = document.getElementById('masterServicesGrid');
const servicesError = document.getElementById('masterServicesError');
const servicesNotice = document.getElementById('masterServicesNotice');
const saveServicesBtn = document.getElementById('saveMasterServicesBtn');

const scheduleSection = document.getElementById('masterScheduleSection');
const scheduleNameEl = document.getElementById('masterScheduleName');
const scheduleGrid = document.getElementById('masterScheduleGrid');
const scheduleError = document.getElementById('masterScheduleError');
const scheduleNotice = document.getElementById('masterScheduleNotice');
const saveScheduleBtn = document.getElementById('saveMasterScheduleBtn');

// 1..7 = Пн..Вс — то же соответствие, что и в БД (master_weekly_schedule.weekday,
// CHECK BETWEEN 1 AND 7) и в server/src/time/salonClock.js.
const WEEKDAY_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

let masters = [];
let allServices = []; // включая отключённые — та же логика "админ видит всё"
let editingId = null; // null — форма в режиме "добавить"

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
  showMessage(el, describeError(err));
}

function renderTable() {
  if (masters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">Мастеров пока нет.</td></tr>';
    return;
  }
  tbody.innerHTML = masters
    .map(
      (m) => `
      <tr>
        <td class="admin-cell-wrap">${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.specialization || '—')}</td>
        <td>${m.serviceIds.length}</td>
        <td><span class="admin-status-badge ${m.isActive ? 'is-active' : 'is-inactive'}">${m.isActive ? 'Активен' : 'Отключён'}</span></td>
        <td class="admin-row-actions">
          <button type="button" class="btn btn-outline btn-sm" data-edit="${m.id}">Редактировать</button>
          <button type="button" class="btn btn-outline btn-sm" data-toggle="${m.id}">${m.isActive ? 'Отключить' : 'Включить'}</button>
          <button type="button" class="btn btn-outline btn-sm is-danger" data-delete="${m.id}">Удалить</button>
        </td>
      </tr>`,
    )
    .join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => startEdit(Number(btn.dataset.edit)));
  });
  tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleActive(Number(btn.dataset.toggle)));
  });
  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => askDelete(Number(btn.dataset.delete)));
  });
}

async function loadMasters() {
  try {
    masters = await fetchAdminMasters();
    showMessage(pageError, null);
    renderTable();
    // Карточка услуг открыта на мастере, которого мог задеть обновлённый
    // список (например, поменялось имя) — перерисуем её тоже, тем же
    // состоянием serviceIds, что уже загружено.
    if (editingId !== null) {
      const current = masters.find((m) => m.id === editingId);
      if (current) openServicesSection(current);
    }
  } catch (err) {
    showApiError(pageError, err);
    tbody.innerHTML = '<tr><td colspan="5">—</td></tr>';
  }
}

async function startEdit(id) {
  const master = masters.find((m) => m.id === id);
  if (!master) return;
  editingId = id;
  formTitle.textContent = `Редактировать мастера: ${master.name}`;
  submitBtn.textContent = 'Сохранить';
  cancelBtn.hidden = false;
  form.name.value = master.name;
  form.specialization.value = master.specialization ?? '';
  form.photoUrl.value = master.photoUrl ?? '';
  form.isActive.checked = master.isActive;
  showMessage(formError, null);
  openServicesSection(master);
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Недельный график — не в списке мастеров (fetchAdminMasters), только в
  // карточке одного мастера, отдельным запросом (см. комментарий у
  // fetchAdminMaster в web/js/api.js). Секцию показываем сразу (с
  // заглушкой вместо строк), чтобы ошибку загрузки тоже было куда вывести.
  scheduleSection.hidden = false;
  scheduleNameEl.textContent = master.name;
  showMessage(scheduleError, null);
  showMessage(scheduleNotice, null);
  scheduleGrid.innerHTML = '<p class="admin-checkbox-inactive-note">Загрузка графика…</p>';
  try {
    const detail = await fetchAdminMaster(id);
    if (editingId === id) renderScheduleGrid(detail.weeklySchedule);
  } catch (err) {
    if (editingId === id) showApiError(scheduleError, err);
  }
}

function resetForm() {
  editingId = null;
  form.reset();
  form.isActive.checked = true;
  formTitle.textContent = 'Добавить мастера';
  submitBtn.textContent = 'Добавить';
  cancelBtn.hidden = true;
  showMessage(formError, null);
  closeServicesSection();
  closeScheduleSection();
}

cancelBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(formError, null);

  const fd = new FormData(form);
  const fields = {
    name: fd.get('name'),
    specialization: fd.get('specialization') || undefined,
    photoUrl: fd.get('photoUrl') || undefined,
    isActive: form.isActive.checked,
  };

  try {
    if (editingId === null) {
      const created = await createAdminMaster(fields);
      showMessage(pageNotice, 'Мастер добавлен. Отметьте ниже, какие услуги он выполняет.');
      await loadMasters();
      // Сразу переходим в режим редактирования свежесозданного мастера —
      // иначе отметить его услуги можно было бы только отдельным кликом
      // "Редактировать" в таблице, а задание прямо просит показать отметки
      // на странице мастера, а не только после лишнего шага.
      startEdit(created.id);
      return;
    }
    await updateAdminMaster(editingId, fields);
    showMessage(pageNotice, 'Изменения сохранены.');
    resetForm();
    await loadMasters();
  } catch (err) {
    if (err instanceof ApiRequestError) showApiError(formError, err);
    else throw err;
  }
});

async function toggleActive(id) {
  const master = masters.find((m) => m.id === id);
  if (!master) return;
  try {
    await updateAdminMaster(id, { isActive: !master.isActive });
    await loadMasters();
  } catch (err) {
    showApiError(pageError, err);
  }
}

// ---- Какие услуги выполняет мастер (master_services) ----

function openServicesSection(master) {
  servicesSection.hidden = false;
  servicesNameEl.textContent = master.name;
  showMessage(servicesError, null);
  showMessage(servicesNotice, null);
  const checked = new Set(master.serviceIds);
  if (allServices.length === 0) {
    servicesGrid.innerHTML = '<p class="admin-checkbox-inactive-note">Услуг пока нет — сначала добавьте их на странице «Услуги».</p>';
    return;
  }
  servicesGrid.innerHTML = allServices
    .map((s) => {
      const inactiveNote = s.isActive ? '' : ' <span class="admin-checkbox-inactive-note">(отключена)</span>';
      return `
        <label>
          <input type="checkbox" value="${s.id}" ${checked.has(s.id) ? 'checked' : ''}>
          <span>${escapeHtml(s.name)}${inactiveNote}</span>
        </label>`;
    })
    .join('');
}

function closeServicesSection() {
  servicesSection.hidden = true;
  servicesGrid.innerHTML = '';
}

saveServicesBtn.addEventListener('click', async () => {
  if (editingId === null) return;
  showMessage(servicesError, null);
  showMessage(servicesNotice, null);
  const serviceIds = [...servicesGrid.querySelectorAll('input[type=checkbox]:checked')].map((el) => Number(el.value));
  try {
    await replaceAdminMasterServices(editingId, serviceIds);
    showMessage(servicesNotice, 'Набор услуг сохранён.');
    await loadMasters();
  } catch (err) {
    showApiError(servicesError, err);
  }
});

// ---- График работы мастера (master_weekly_schedule) ----
// Без него у мастера нет ни одной строки в этой таблице, а
// server/src/domain/availability.js трактует отсутствие строки на
// конкретный weekday как выходной — то есть свободных слотов не будет
// вообще ни на одну дату, пока график не сохранён хотя бы раз (см.
// комментарий у fetchAdminMaster в web/js/api.js).

function renderScheduleGrid(weeklySchedule) {
  const byWeekday = new Map(weeklySchedule.map((entry) => [entry.weekday, entry]));
  scheduleGrid.innerHTML = WEEKDAY_LABELS.map((label, i) => {
    const weekday = i + 1;
    const entry = byWeekday.get(weekday);
    const isWorking = entry !== undefined;
    return `
      <div class="admin-schedule-row" data-weekday="${weekday}">
        <label class="admin-schedule-day">
          <input type="checkbox" class="schedule-day-toggle" ${isWorking ? 'checked' : ''}>
          <span>${label}</span>
        </label>
        <div class="admin-schedule-times">
          <input type="time" class="form-input schedule-start" value="${entry ? entry.startTime : '10:00'}" ${isWorking ? '' : 'disabled'}>
          <span>—</span>
          <input type="time" class="form-input schedule-end" value="${entry ? entry.endTime : '20:00'}" ${isWorking ? '' : 'disabled'}>
        </div>
      </div>`;
  }).join('');

  scheduleGrid.querySelectorAll('.schedule-day-toggle').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const row = checkbox.closest('.admin-schedule-row');
      row.querySelectorAll('input[type=time]').forEach((input) => {
        input.disabled = !checkbox.checked;
      });
    });
  });
}

function closeScheduleSection() {
  scheduleSection.hidden = true;
  scheduleGrid.innerHTML = '';
}

saveScheduleBtn.addEventListener('click', async () => {
  if (editingId === null) return;
  showMessage(scheduleError, null);
  showMessage(scheduleNotice, null);

  const schedule = [];
  let hasInvalidRange = false;
  scheduleGrid.querySelectorAll('.admin-schedule-row').forEach((row) => {
    if (!row.querySelector('.schedule-day-toggle').checked) return;
    const weekday = Number(row.dataset.weekday);
    const startTime = row.querySelector('.schedule-start').value;
    const endTime = row.querySelector('.schedule-end').value;
    if (!startTime || !endTime || endTime <= startTime) {
      hasInvalidRange = true;
      return;
    }
    schedule.push({ weekday, startTime, endTime });
  });
  if (hasInvalidRange) {
    showMessage(scheduleError, 'Время окончания должно быть позже времени начала — проверьте отмеченные дни.');
    return;
  }

  try {
    await replaceAdminMasterSchedule(editingId, schedule);
    showMessage(scheduleNotice, 'График сохранён.');
  } catch (err) {
    showApiError(scheduleError, err);
  }
});

// ---- Удаление ----
// Разметку модалки вставляет этот код, только пока она открыта — не
// атрибут hidden на статичном узле, см. подробное пояснение в
// web/js/admin-services.js (тот же приём, что уже в
// js/account-appointment.js).
const deleteModalRoot = document.getElementById('deleteModalRoot');

function askDelete(id) {
  const master = masters.find((m) => m.id === id);
  if (!master) return;
  deleteModalRoot.innerHTML = `
    <div class="modal-overlay" id="deleteOverlay">
      <div class="modal-card">
        <div class="modal-title">Удалить мастера?</div>
        <p class="modal-text">«${escapeHtml(master.name)}» — если у мастера уже есть записи, сервер отключит его вместо удаления и объяснит почему.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" id="deleteCancelBtn">Отмена</button>
          <button type="button" class="btn btn-danger" id="deleteConfirmBtn">Удалить</button>
        </div>
      </div>
    </div>`;
  document.getElementById('deleteOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deleteOverlay') closeDeleteModal();
  });
  document.getElementById('deleteCancelBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteConfirmBtn').addEventListener('click', () => confirmDelete(id));
}

function closeDeleteModal() {
  deleteModalRoot.innerHTML = '';
}

async function confirmDelete(id) {
  closeDeleteModal();
  try {
    // Решение "удалить физически или отключить" принимает сервер
    // (server/src/routes/admin.routes.js, DELETE /api/admin/masters/:id).
    const result = await deleteAdminMaster(id);
    showMessage(pageNotice, result.outcome === 'deleted' ? 'Мастер удалён.' : result.message);
    if (editingId === id) resetForm();
    await loadMasters();
  } catch (err) {
    showApiError(pageError, err);
  }
}

(async () => {
  try {
    allServices = await fetchAdminServices();
  } catch (err) {
    showApiError(pageError, err);
  }
  await loadMasters();
})();
