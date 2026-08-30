// Логика админ-панели (admin.html) — вынесена в отдельный файл, потому
// что страница большая. Каждая секция независима: свой fetch, свой
// error/ok-блок, ничего общего кроме apiFetch/escapeHtml.

import { apiFetch, showError, showOk } from './api.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) { return `${n} ₽`; }

// Пусто -> не отправлять поле вообще (частичный PATCH); иначе — привести к числу.
function optNum(fd, name) {
  const v = fd.get(name);
  if (v === null || v === '') return undefined;
  return Number(v);
}
function optStr(fd, name) {
  const v = fd.get(name);
  if (v === null || v === '') return undefined;
  return v;
}
// select с "" / "true" / "false" -> undefined / true / false
function optTriBool(fd, name) {
  const v = fd.get(name);
  if (v === '' || v === null) return undefined;
  return v === 'true';
}
function parseIds(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Error(`"${s}" — не целое число`);
    return n;
  });
}

async function checkAuth() {
  const box = document.getElementById('auth-warning');
  try {
    const data = await apiFetch('/auth/me');
    if (!data.user.roles.includes('admin')) {
      box.hidden = false;
      box.textContent = `Вы вошли как ${data.user.email}, но без роли admin — все запросы ниже вернут 403. Войдите как admin@ton-salon.test.`;
    } else {
      box.hidden = true;
    }
  } catch {
    box.hidden = false;
    box.innerHTML = `Вы не вошли — все запросы ниже вернут 401. <a href="login.html?next=admin.html">Войти</a>`;
  }
}

// ---------------------------------------------------------------- ЗАПИСИ
const apptFilterForm = document.getElementById('appt-filter-form');
const apptError = document.getElementById('appt-error');
const apptTbody = document.getElementById('appt-tbody');

async function loadAppointments() {
  const fd = new FormData(apptFilterForm);
  const qs = new URLSearchParams();
  for (const key of ['status', 'masterId', 'clientId', 'from', 'to']) {
    const v = fd.get(key);
    if (v) qs.set(key, v);
  }
  try {
    const data = await apiFetch('/admin/appointments' + (qs.toString() ? `?${qs}` : ''));
    showError(apptError, null);
    if (data.appointments.length === 0) {
      apptTbody.innerHTML = '<tr><td colspan="7">Записей нет</td></tr>';
      return;
    }
    apptTbody.innerHTML = data.appointments.map((a) => `
      <tr>
        <td>${a.id}</td>
        <td><span class="status-badge status-${a.status}">${a.status}</span></td>
        <td>${a.client ? escapeHtml(a.client.name) + ' #' + a.client.id : '—'}</td>
        <td>${escapeHtml(a.master?.name ?? '—')}</td>
        <td>${a.startLocal}</td>
        <td>${money(a.totalPriceRub)}</td>
        <td><a href="account.html?id=${a.id}">Подробнее →</a></td>
      </tr>
    `).join('');
  } catch (err) {
    showError(apptError, err);
    apptTbody.innerHTML = '<tr><td colspan="7">—</td></tr>';
  }
}
apptFilterForm.addEventListener('submit', (e) => { e.preventDefault(); loadAppointments(); });

const completeForm = document.getElementById('complete-form');
const completeError = document.getElementById('complete-error');
const completeOk = document.getElementById('complete-ok');
completeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(completeError, null); showOk(completeOk, null);
  const id = new FormData(completeForm).get('id');
  try {
    const a = await apiFetch(`/admin/appointments/${id}/complete`, { method: 'POST' });
    showOk(completeOk, `Запись №${a.id} переведена в статус ${a.status}.`);
    loadAppointments();
  } catch (err) { showError(completeError, err); }
});

const adminCreateForm = document.getElementById('admin-create-form');
const adminCreateError = document.getElementById('admin-create-error');
const adminCreateOk = document.getElementById('admin-create-ok');
adminCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(adminCreateError, null); showOk(adminCreateOk, null);
  const fd = new FormData(adminCreateForm);
  let serviceIds;
  try { serviceIds = parseIds(fd.get('serviceIds')); }
  catch (err) { showError(adminCreateError, { message: 'ID услуг: ' + err.message }); return; }
  const body = {
    clientId: Number(fd.get('clientId')),
    masterId: Number(fd.get('masterId')),
    startDatetime: fd.get('startDatetime'),
    serviceIds,
    comment: fd.get('comment') || undefined,
    remindEnabled: fd.get('remindEnabled') === 'on',
    overlapOverride: fd.get('overlapOverride') === 'on',
  };
  try {
    const a = await apiFetch('/admin/appointments', { method: 'POST', body });
    showOk(adminCreateOk, `Создана запись №${a.id}, статус ${a.status}.`);
    adminCreateForm.reset();
    loadAppointments();
  } catch (err) { showError(adminCreateError, err); }
});

// ---------------------------------------------------------------- САЛОН
const salonForm = document.getElementById('salon-form');
const salonError = document.getElementById('salon-error');
const salonOk = document.getElementById('salon-ok');

async function loadSalon() {
  try {
    const p = await apiFetch('/admin/salon-profile');
    showError(salonError, null);
    salonForm.name.value = p.name ?? '';
    salonForm.address.value = p.address ?? '';
    salonForm.phone.value = p.phone ?? '';
    salonForm.workingHoursNote.value = p.workingHoursNote ?? '';
    salonForm.timezone.value = p.timezone ?? '';
    salonForm.bookingStepMinutes.value = p.bookingStepMinutes ?? '';
    salonForm.bookingHorizonDays.value = p.bookingHorizonDays ?? '';
    salonForm.holdDurationMinutes.value = p.holdDurationMinutes ?? '';
  } catch (err) { showError(salonError, err); }
}
salonForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(salonError, null); showOk(salonOk, null);
  const fd = new FormData(salonForm);
  const body = {
    name: optStr(fd, 'name'),
    address: optStr(fd, 'address'),
    phone: optStr(fd, 'phone'),
    workingHoursNote: optStr(fd, 'workingHoursNote'),
    timezone: optStr(fd, 'timezone'),
    bookingStepMinutes: optNum(fd, 'bookingStepMinutes'),
    bookingHorizonDays: optNum(fd, 'bookingHorizonDays'),
    holdDurationMinutes: optNum(fd, 'holdDurationMinutes'),
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  try {
    await apiFetch('/admin/salon-profile', { method: 'PATCH', body });
    showOk(salonOk, 'Профиль салона сохранён.');
    loadSalon();
  } catch (err) { showError(salonError, err); }
});

// ---------------------------------------------------------------- КАТЕГОРИИ
const catError = document.getElementById('cat-error');
const catTbody = document.getElementById('cat-tbody');
async function loadCategories() {
  try {
    const data = await apiFetch('/admin/service-categories');
    showError(catError, null);
    catTbody.innerHTML = data.categories.length
      ? data.categories.map((c) => `<tr><td>${c.id}</td><td>${escapeHtml(c.name)}</td><td>${c.sortOrder}</td></tr>`).join('')
      : '<tr><td colspan="3">Категорий нет</td></tr>';
  } catch (err) { showError(catError, err); catTbody.innerHTML = '<tr><td colspan="3">—</td></tr>'; }
}

const catCreateForm = document.getElementById('cat-create-form');
const catCreateError = document.getElementById('cat-create-error');
catCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(catCreateError, null);
  const fd = new FormData(catCreateForm);
  try {
    await apiFetch('/admin/service-categories', { method: 'POST', body: { name: fd.get('name'), sortOrder: Number(fd.get('sortOrder') || 0) } });
    catCreateForm.reset();
    loadCategories();
  } catch (err) { showError(catCreateError, err); }
});

const catEditForm = document.getElementById('cat-edit-form');
const catEditError = document.getElementById('cat-edit-error');
const catEditOk = document.getElementById('cat-edit-ok');
catEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(catEditError, null); showOk(catEditOk, null);
  const fd = new FormData(catEditForm);
  const id = fd.get('id');
  const body = { name: optStr(fd, 'name'), sortOrder: optNum(fd, 'sortOrder') };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  try {
    const c = await apiFetch(`/admin/service-categories/${id}`, { method: 'PATCH', body });
    showOk(catEditOk, `Категория №${c.id} сохранена: ${c.name}.`);
    loadCategories();
  } catch (err) { showError(catEditError, err); }
});

// ---------------------------------------------------------------- УСЛУГИ
const svcError = document.getElementById('svc-error');
const svcTbody = document.getElementById('svc-tbody');
async function loadServices() {
  try {
    const data = await apiFetch('/admin/services');
    showError(svcError, null);
    svcTbody.innerHTML = data.services.length
      ? data.services.map((s) => `
          <tr>
            <td>${s.id}</td><td>${escapeHtml(s.categoryName)}</td><td>${escapeHtml(s.name)}</td>
            <td>${s.durationMinutes} мин</td><td>${money(s.priceRub)}</td><td>${s.isActive ? 'да' : 'нет'}</td>
          </tr>`).join('')
      : '<tr><td colspan="6">Услуг нет</td></tr>';
  } catch (err) { showError(svcError, err); svcTbody.innerHTML = '<tr><td colspan="6">—</td></tr>'; }
}

const svcCreateForm = document.getElementById('svc-create-form');
const svcCreateError = document.getElementById('svc-create-error');
svcCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(svcCreateError, null);
  const fd = new FormData(svcCreateForm);
  const body = {
    categoryId: Number(fd.get('categoryId')),
    name: fd.get('name'),
    description: fd.get('description') || undefined,
    durationMinutes: Number(fd.get('durationMinutes')),
    priceRub: Number(fd.get('priceRub')),
    isActive: fd.get('isActive') === 'on',
  };
  try {
    await apiFetch('/admin/services', { method: 'POST', body });
    svcCreateForm.reset();
    loadServices();
  } catch (err) { showError(svcCreateError, err); }
});

const svcEditForm = document.getElementById('svc-edit-form');
const svcEditError = document.getElementById('svc-edit-error');
const svcEditOk = document.getElementById('svc-edit-ok');
svcEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(svcEditError, null); showOk(svcEditOk, null);
  const fd = new FormData(svcEditForm);
  const id = fd.get('id');
  const body = {
    categoryId: optNum(fd, 'categoryId'),
    name: optStr(fd, 'name'),
    description: optStr(fd, 'description'),
    durationMinutes: optNum(fd, 'durationMinutes'),
    priceRub: optNum(fd, 'priceRub'),
    isActive: optTriBool(fd, 'isActive'),
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  try {
    const s = await apiFetch(`/admin/services/${id}`, { method: 'PATCH', body });
    showOk(svcEditOk, `Услуга №${s.id} сохранена: ${s.name}.`);
    loadServices();
  } catch (err) { showError(svcEditError, err); }
});

// ---------------------------------------------------------------- МАСТЕРА (список)
const masterError = document.getElementById('master-error');
const masterTbody = document.getElementById('master-tbody');
async function loadMastersAdmin() {
  try {
    const data = await apiFetch('/admin/masters');
    showError(masterError, null);
    masterTbody.innerHTML = data.masters.length
      ? data.masters.map((m) => `
          <tr>
            <td>${m.id}</td><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.specialization || '—')}</td>
            <td>${m.isActive ? 'да' : 'нет'}</td><td>${m.userId ?? '—'}</td>
            <td><button type="button" class="small" data-load-master="${m.id}">Загрузить карточку ↓</button></td>
          </tr>`).join('')
      : '<tr><td colspan="6">Мастеров нет</td></tr>';
    masterTbody.querySelectorAll('[data-load-master]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('master-load-form').id.value = btn.dataset.loadMaster;
        loadMasterCard(Number(btn.dataset.loadMaster));
        document.getElementById('master-load-form').scrollIntoView({ behavior: 'smooth' });
      });
    });
  } catch (err) { showError(masterError, err); masterTbody.innerHTML = '<tr><td colspan="6">—</td></tr>'; }
}

const masterCreateForm = document.getElementById('master-create-form');
const masterCreateError = document.getElementById('master-create-error');
masterCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(masterCreateError, null);
  const fd = new FormData(masterCreateForm);
  const body = {
    name: fd.get('name'),
    specialization: fd.get('specialization') || undefined,
    photoUrl: fd.get('photoUrl') || undefined,
    isActive: fd.get('isActive') === 'on',
  };
  try {
    await apiFetch('/admin/masters', { method: 'POST', body });
    masterCreateForm.reset();
    loadMastersAdmin();
  } catch (err) { showError(masterCreateError, err); }
});

const masterEditForm = document.getElementById('master-edit-form');
const masterEditError = document.getElementById('master-edit-error');
const masterEditOk = document.getElementById('master-edit-ok');
masterEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(masterEditError, null); showOk(masterEditOk, null);
  const fd = new FormData(masterEditForm);
  const id = fd.get('id');
  const body = {
    name: optStr(fd, 'name'),
    specialization: optStr(fd, 'specialization'),
    photoUrl: optStr(fd, 'photoUrl'),
    isActive: optTriBool(fd, 'isActive'),
  };
  const userIdRaw = fd.get('userId');
  if (userIdRaw !== null && userIdRaw.trim() !== '') {
    body.userId = userIdRaw.trim() === 'null' ? null : Number(userIdRaw.trim());
  }
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  try {
    const m = await apiFetch(`/admin/masters/${id}`, { method: 'PATCH', body });
    showOk(masterEditOk, `Мастер №${m.id} сохранён: ${m.name}, userId=${m.userId ?? '—'}.`);
    loadMastersAdmin();
  } catch (err) { showError(masterEditError, err); }
});

// ---------------------------------------------------------------- КАРТОЧКА МАСТЕРА
let workbenchMasterId = null;
const masterLoadForm = document.getElementById('master-load-form');
const masterDetailError = document.getElementById('master-detail-error');
const masterDetailEl = document.getElementById('master-detail');
const scheduleTbody = document.getElementById('schedule-tbody');
const WEEKDAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Вс']];

async function loadMasterCard(id) {
  workbenchMasterId = id;
  showError(masterDetailError, null);
  masterDetailEl.textContent = 'Загрузка…';
  try {
    const m = await apiFetch(`/admin/masters/${id}`);
    masterDetailEl.innerHTML = `
      <table>
        <tr><th>Имя</th><td>${escapeHtml(m.name)}</td></tr>
        <tr><th>Активен</th><td>${m.isActive ? 'да' : 'нет'}</td></tr>
        <tr><th>userId</th><td>${m.userId ?? '—'}</td></tr>
        <tr><th>Услуги (id)</th><td>${m.serviceIds.join(', ') || '—'}</td></tr>
      </table>`;
    document.getElementById('master-services-form').serviceIds.value = m.serviceIds.join(',');

    const byWeekday = Object.fromEntries(m.weeklySchedule.map((r) => [r.weekday, r]));
    scheduleTbody.innerHTML = WEEKDAYS.map(([num, label]) => {
      const row = byWeekday[num];
      return `
        <tr>
          <td><input type="checkbox" data-weekday="${num}" ${row ? 'checked' : ''}></td>
          <td>${label}</td>
          <td><input type="time" data-start="${num}" value="${row ? row.startTime : '10:00'}"></td>
          <td><input type="time" data-end="${num}" value="${row ? row.endTime : '19:00'}"></td>
        </tr>`;
    }).join('');

    const excList = m.scheduleExceptions.length
      ? '<ul>' + m.scheduleExceptions.map((ex) =>
          `<li>#${ex.id} — ${ex.date}: ${ex.isDayOff ? 'выходной' : `${ex.startTime}–${ex.endTime}`}${ex.reason ? ' (' + escapeHtml(ex.reason) + ')' : ''}</li>`
        ).join('') + '</ul>'
      : '<p class="hint">Исключений нет.</p>';
    masterDetailEl.innerHTML += `<h4>Исключения графика</h4>${excList}`;
  } catch (err) {
    masterDetailEl.textContent = '';
    showError(masterDetailError, err);
  }
}
masterLoadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadMasterCard(Number(new FormData(masterLoadForm).get('id')));
});

function requireWorkbenchMaster(errEl) {
  if (workbenchMasterId === null) {
    showError(errEl, { message: 'Сначала загрузите карточку мастера выше ("Загрузить").' });
    return null;
  }
  return workbenchMasterId;
}

const masterServicesForm = document.getElementById('master-services-form');
const masterServicesError = document.getElementById('master-services-error');
const masterServicesOk = document.getElementById('master-services-ok');
masterServicesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(masterServicesError, null); showOk(masterServicesOk, null);
  const id = requireWorkbenchMaster(masterServicesError);
  if (id === null) return;
  let serviceIds;
  try { serviceIds = parseIds(new FormData(masterServicesForm).get('serviceIds')); }
  catch (err) { showError(masterServicesError, { message: err.message }); return; }
  try {
    const data = await apiFetch(`/admin/masters/${id}/services`, { method: 'PUT', body: { serviceIds } });
    showOk(masterServicesOk, `Сохранено: ${data.serviceIds.join(', ') || 'нет услуг'}.`);
  } catch (err) { showError(masterServicesError, err); }
});

const scheduleError = document.getElementById('schedule-error');
const scheduleOk = document.getElementById('schedule-ok');
document.getElementById('save-schedule-btn').addEventListener('click', async () => {
  showError(scheduleError, null); showOk(scheduleOk, null);
  const id = requireWorkbenchMaster(scheduleError);
  if (id === null) return;
  const entries = [];
  scheduleTbody.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    if (!cb.checked) return;
    const wd = cb.dataset.weekday;
    const startTime = scheduleTbody.querySelector(`input[data-start="${wd}"]`).value;
    const endTime = scheduleTbody.querySelector(`input[data-end="${wd}"]`).value;
    entries.push({ weekday: Number(wd), startTime, endTime });
  });
  try {
    await apiFetch(`/admin/masters/${id}/schedule`, { method: 'PUT', body: { schedule: entries } });
    showOk(scheduleOk, `График сохранён, рабочих дней: ${entries.length}.`);
  } catch (err) { showError(scheduleError, err); }
});

const exceptionCreateForm = document.getElementById('exception-create-form');
const exceptionError = document.getElementById('exception-error');
exceptionCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(exceptionError, null);
  const id = requireWorkbenchMaster(exceptionError);
  if (id === null) return;
  const fd = new FormData(exceptionCreateForm);
  const isDayOff = fd.get('isDayOff') === 'on';
  const body = { date: fd.get('date'), isDayOff };
  if (!isDayOff) { body.startTime = fd.get('startTime'); body.endTime = fd.get('endTime'); }
  if (fd.get('reason')) body.reason = fd.get('reason');
  try {
    await apiFetch(`/admin/masters/${id}/schedule-exceptions`, { method: 'POST', body });
    exceptionCreateForm.reset();
    loadMasterCard(id);
  } catch (err) { showError(exceptionError, err); }
});

const exceptionDeleteForm = document.getElementById('exception-delete-form');
exceptionDeleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(exceptionError, null);
  const id = requireWorkbenchMaster(exceptionError);
  if (id === null) return;
  const exceptionId = new FormData(exceptionDeleteForm).get('exceptionId');
  try {
    await apiFetch(`/admin/masters/${id}/schedule-exceptions/${exceptionId}`, { method: 'DELETE' });
    exceptionDeleteForm.reset();
    loadMasterCard(id);
  } catch (err) { showError(exceptionError, err); }
});

const blocksTbody = document.getElementById('blocks-tbody');
const blockError = document.getElementById('block-error');
document.getElementById('load-blocks-btn').addEventListener('click', async () => {
  showError(blockError, null);
  const id = requireWorkbenchMaster(blockError);
  if (id === null) return;
  try {
    const data = await apiFetch(`/admin/masters/${id}/time-blocks`);
    blocksTbody.innerHTML = data.timeBlocks.length
      ? data.timeBlocks.map((b) => `<tr><td>${b.id}</td><td>${b.startDatetime}</td><td>${b.endDatetime}</td><td>${escapeHtml(b.reason || '—')}</td></tr>`).join('')
      : '<tr><td colspan="4">Блокировок нет</td></tr>';
  } catch (err) { showError(blockError, err); blocksTbody.innerHTML = '<tr><td colspan="4">—</td></tr>'; }
});

const blockCreateForm = document.getElementById('block-create-form');
blockCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(blockError, null);
  const id = requireWorkbenchMaster(blockError);
  if (id === null) return;
  const fd = new FormData(blockCreateForm);
  try {
    await apiFetch(`/admin/masters/${id}/time-blocks`, {
      method: 'POST',
      body: { startDatetime: fd.get('startDatetime'), endDatetime: fd.get('endDatetime'), reason: fd.get('reason') || undefined },
    });
    blockCreateForm.reset();
    document.getElementById('load-blocks-btn').click();
  } catch (err) { showError(blockError, err); }
});

const blockDeleteForm = document.getElementById('block-delete-form');
blockDeleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(blockError, null);
  const id = requireWorkbenchMaster(blockError);
  if (id === null) return;
  const blockId = new FormData(blockDeleteForm).get('blockId');
  try {
    await apiFetch(`/admin/masters/${id}/time-blocks/${blockId}`, { method: 'DELETE' });
    blockDeleteForm.reset();
    document.getElementById('load-blocks-btn').click();
  } catch (err) { showError(blockError, err); }
});

// ---------------------------------------------------------------- ПОЛЬЗОВАТЕЛИ И РОЛИ
const userLookupForm = document.getElementById('user-lookup-form');
const userError = document.getElementById('user-error');
const userDetailEl = document.getElementById('user-detail');
userLookupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(userError, null);
  const id = new FormData(userLookupForm).get('id');
  try {
    const u = await apiFetch(`/admin/users/${id}`);
    userDetailEl.innerHTML = `
      <table>
        <tr><th>ID</th><td>${u.id}</td></tr>
        <tr><th>Имя</th><td>${escapeHtml(u.name)}</td></tr>
        <tr><th>E-mail</th><td>${escapeHtml(u.email)}</td></tr>
        <tr><th>Телефон</th><td>${escapeHtml(u.phone)}</td></tr>
        <tr><th>Роли</th><td>${u.roles.map((r) => `<code>${escapeHtml(r)}</code>`).join(' ') || '—'}</td></tr>
      </table>`;
  } catch (err) { userDetailEl.innerHTML = ''; showError(userError, err); }
});

const roleGrantForm = document.getElementById('role-grant-form');
const roleRevokeForm = document.getElementById('role-revoke-form');
const roleError = document.getElementById('role-error');
const roleOk = document.getElementById('role-ok');

roleGrantForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(roleError, null); showOk(roleOk, null);
  const fd = new FormData(roleGrantForm);
  try {
    const data = await apiFetch(`/admin/users/${fd.get('id')}/roles`, { method: 'POST', body: { role: fd.get('role') } });
    showOk(roleOk, `Роли пользователя №${data.userId}: ${data.roles.join(', ')}.`);
  } catch (err) { showError(roleError, err); }
});

roleRevokeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(roleError, null); showOk(roleOk, null);
  const fd = new FormData(roleRevokeForm);
  try {
    const data = await apiFetch(`/admin/users/${fd.get('id')}/roles/${fd.get('role')}`, { method: 'DELETE' });
    showOk(roleOk, `Роли пользователя №${data.userId}: ${data.roles.join(', ')}.`);
  } catch (err) { showError(roleError, err); }
});

// ---------------------------------------------------------------- ИНИЦИАЛИЗАЦИЯ
checkAuth();
loadAppointments();
loadSalon();
loadCategories();
loadServices();
loadMastersAdmin();
