// Страница web/admin/services.html (/admin/services) — список услуг
// (включая отключённые, с пометкой — клиенту их не показываем, см.
// server/src/routes/catalog.routes.js:listActiveServices), добавление,
// редактирование, включение/отключение и удаление. Один и тот же вызов
// updateAdminService используется и для полного редактирования, и для
// быстрого переключения "Отключить"/"Включить" — на сервере это один и тот
// же PATCH, разницы для API нет.
//
// Проверка данных на сервере (название не пустое, цена и длительность
// положительны) — server/src/routes/admin.routes.js; здесь только
// HTML5-атрибуты (required/min) для удобства, финальное решение и текст
// ошибки всегда от сервера (docs/frontend-rules.md, правило 7).

import { initAdminShell } from './admin-shell.js';
import {
  fetchAdminServices,
  fetchAdminCategories,
  createAdminCategory,
  createAdminService,
  updateAdminService,
  deleteAdminService,
  describeError,
  ApiRequestError,
} from './api.js';
import { formatDuration, formatPriceRub } from './format.js';

initAdminShell({ active: 'services' });

const tbody = document.getElementById('servicesTbody');
const pageError = document.getElementById('pageError');
const pageNotice = document.getElementById('pageNotice');
const form = document.getElementById('serviceForm');
const formTitle = document.getElementById('serviceFormTitle');
const formError = document.getElementById('formError');
const submitBtn = document.getElementById('serviceSubmitBtn');
const cancelBtn = document.getElementById('serviceCancelBtn');
const categorySelect = document.getElementById('svcCategory');
const newCategoryToggleBtn = document.getElementById('newCategoryToggleBtn');
const newCategoryRow = document.getElementById('newCategoryRow');
const newCategoryName = document.getElementById('newCategoryName');
const newCategorySaveBtn = document.getElementById('newCategorySaveBtn');
const newCategoryCancelBtn = document.getElementById('newCategoryCancelBtn');

let categories = [];
let services = [];
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

// selectId — какую категорию сделать выбранной после перезагрузки списка
// (например, только что созданную) — без этого выбор всегда сбрасывался
// бы на первую в списке.
async function loadCategories(selectId) {
  categories = await fetchAdminCategories();
  categorySelect.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (selectId !== undefined) categorySelect.value = String(selectId);
}

function renderTable() {
  if (services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Услуг пока нет.</td></tr>';
    return;
  }
  tbody.innerHTML = services
    .map(
      (s) => `
      <tr>
        <td class="admin-cell-wrap">${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.categoryName)}</td>
        <td>${formatDuration(s.durationMinutes)}</td>
        <td>${formatPriceRub(s.priceRub)}</td>
        <td><span class="admin-status-badge ${s.isActive ? 'is-active' : 'is-inactive'}">${s.isActive ? 'Активна' : 'Отключена'}</span></td>
        <td class="admin-row-actions">
          <button type="button" class="btn btn-outline btn-sm" data-edit="${s.id}">Редактировать</button>
          <button type="button" class="btn btn-outline btn-sm" data-toggle="${s.id}">${s.isActive ? 'Отключить' : 'Включить'}</button>
          <button type="button" class="btn btn-outline btn-sm is-danger" data-delete="${s.id}">Удалить</button>
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

async function loadServices() {
  try {
    services = await fetchAdminServices();
    showMessage(pageError, null);
    renderTable();
  } catch (err) {
    showApiError(pageError, err);
    tbody.innerHTML = '<tr><td colspan="6">—</td></tr>';
  }
}

function startEdit(id) {
  const service = services.find((s) => s.id === id);
  if (!service) return;
  editingId = id;
  formTitle.textContent = `Редактировать услугу: ${service.name}`;
  submitBtn.textContent = 'Сохранить';
  cancelBtn.hidden = false;
  form.categoryId.value = String(service.categoryId);
  form.name.value = service.name;
  form.description.value = service.description ?? '';
  form.durationMinutes.value = String(service.durationMinutes);
  form.priceRub.value = String(service.priceRub);
  form.isActive.checked = service.isActive;
  showMessage(formError, null);
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  editingId = null;
  form.reset();
  form.isActive.checked = true;
  formTitle.textContent = 'Добавить услугу';
  submitBtn.textContent = 'Добавить';
  cancelBtn.hidden = true;
  showMessage(formError, null);
}

cancelBtn.addEventListener('click', resetForm);

// ---- Новая категория (POST /api/admin/service-categories) ----
// Без этого на чистой базе (без npm run seed) список категорий пуст, и
// услугу создать нечем — categoryId обязателен (см. комментарий в
// web/admin/services.html у #newCategoryRow).
function showNewCategoryRow() {
  newCategoryRow.hidden = false;
  newCategoryName.value = '';
  newCategoryName.focus();
}

function hideNewCategoryRow() {
  newCategoryRow.hidden = true;
  showMessage(formError, null);
}

newCategoryToggleBtn.addEventListener('click', () => {
  if (newCategoryRow.hidden) showNewCategoryRow();
  else hideNewCategoryRow();
});
newCategoryCancelBtn.addEventListener('click', hideNewCategoryRow);

newCategorySaveBtn.addEventListener('click', async () => {
  const name = newCategoryName.value.trim();
  if (!name) {
    showMessage(formError, 'Введите название категории');
    newCategoryName.focus();
    return;
  }
  try {
    const category = await createAdminCategory({ name });
    await loadCategories(category.id); // сразу выбираем только что созданную
    hideNewCategoryRow();
  } catch (err) {
    if (err instanceof ApiRequestError) showApiError(formError, err);
    else throw err;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(formError, null);

  const fd = new FormData(form);
  const fields = {
    categoryId: Number(fd.get('categoryId')),
    name: fd.get('name'),
    description: fd.get('description') || undefined,
    durationMinutes: Number(fd.get('durationMinutes')),
    priceRub: Number(fd.get('priceRub')),
    isActive: form.isActive.checked,
  };

  try {
    if (editingId === null) {
      await createAdminService(fields);
      showMessage(pageNotice, 'Услуга добавлена.');
    } else {
      await updateAdminService(editingId, fields);
      showMessage(pageNotice, 'Изменения сохранены.');
    }
    resetForm();
    await loadServices();
  } catch (err) {
    if (err instanceof ApiRequestError) showApiError(formError, err);
    else throw err;
  }
});

async function toggleActive(id) {
  const service = services.find((s) => s.id === id);
  if (!service) return;
  try {
    await updateAdminService(id, { isActive: !service.isActive });
    await loadServices();
  } catch (err) {
    showApiError(pageError, err);
  }
}

// ---- Удаление ----
// Разметку модалки вставляет этот код, только пока она открыта — не
// атрибут hidden на статичном узле: .modal-overlay (css/base.css) сама
// задаёт display:flex с той же специфичностью, что и [hidden], поэтому
// статичный скрытый узел так не спрятать (нашлось вживую, тем же способом,
// что и другие находки в проекте — прогоном, не чтением кода). Тот же
// приём уже в js/account-appointment.js.
const deleteModalRoot = document.getElementById('deleteModalRoot');

function askDelete(id) {
  const service = services.find((s) => s.id === id);
  if (!service) return;
  deleteModalRoot.innerHTML = `
    <div class="modal-overlay" id="deleteOverlay">
      <div class="modal-card">
        <div class="modal-title">Удалить услугу?</div>
        <p class="modal-text">«${escapeHtml(service.name)}» — если услуга уже встречается в чьих-то записях, сервер отключит её вместо удаления и объяснит почему.</p>
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
    // (server/src/routes/admin.routes.js, DELETE /api/admin/services/:id) —
    // здесь только показываем, что он решил.
    const result = await deleteAdminService(id);
    showMessage(pageNotice, result.outcome === 'deleted' ? 'Услуга удалена.' : result.message);
    if (editingId === id) resetForm();
    await loadServices();
  } catch (err) {
    showApiError(pageError, err);
  }
}

(async () => {
  try {
    await loadCategories();
  } catch (err) {
    showApiError(pageError, err);
  }
  await loadServices();
})();
