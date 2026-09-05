// Booking · 1 · Услуги — мультивыбор услуг, сумма и длительность внизу.
// Данные — GET /api/services (js/api.js, правило 3: обращения к серверу
// только оттуда). Выбор сохраняется в js/store.js, чтобы дожить до
// Booking · 2 (и следующих шагов) — страницы обычные, без роутинга,
// у каждой свой полный перезаход.
//
// Сумма цен и общая длительность внизу — задание: "считай их не сам, а
// бери из ответа сервера". Дословно отдельного эндпоинта "посчитай сумму
// для набора id услуг" в API нет: единственное место, где бэкенд считает
// totalDurationMinutes/totalPriceRub — resolveServicesOrThrow
// (server/src/domain/booking.js) — используется только внутри
// GET /masters/:id/availability и POST /appointments, а оба требуют уже
// выбранного мастера и даты, которых на этом шаге ещё нет. Это тот же
// класс пробела, что уже описан в docs/ui-map.md (А.2, А.3) — решаем тем
// же способом: складываем priceRub/durationMinutes из объектов услуг,
// которые пришли из GET /api/services как есть, а не изобретаем свою
// формулу и не запрашиваем сервер за тем, чего он не считает без мастера.

import { fetchServices, describeError } from './api.js';
import { initBookingFlow } from './booking-flow.js';
import { getSelectedServiceIds, setSelectedServiceIds } from './store.js';
import { formatDuration, formatPriceRub, pluralRu } from './format.js';
import { BOOKING_MASTER_URL } from './routes.js';

const grid = document.getElementById('serviceGrid');
const tabsEl = document.getElementById('categoryTabs');
const errorBox = document.getElementById('servicesError');
const footerRight = document.getElementById('footerRight');

let allServices = [];
let categories = []; // [{ id, name }] — в порядке первого появления (сервер уже сортирует по category.sort_order)
let activeCategoryId = null;
const selectedIds = new Set(getSelectedServiceIds());

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderSkeletonGrid() {
  grid.innerHTML = '';
  for (let i = 0; i < 4; i += 1) {
    const card = document.createElement('div');
    card.className = 'service-select-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<div class="skeleton-line" style="height:96px;border-radius:var(--radius-md)"></div>';
    grid.appendChild(card);
  }
}

function renderApiError(err) {
  errorBox.hidden = false;
  errorBox.innerHTML = '';
  errorBox.textContent = describeError(err) + ' ';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-outline';
  retryBtn.textContent = 'Повторить';
  retryBtn.addEventListener('click', load);
  errorBox.appendChild(retryBtn);
  tabsEl.hidden = true;
  grid.innerHTML = '';
}

function buildCategories(services) {
  const seen = new Map();
  for (const s of services) {
    if (!seen.has(s.categoryId)) seen.set(s.categoryId, s.categoryName);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function renderTabs() {
  if (categories.length <= 1) {
    tabsEl.hidden = true;
    return;
  }
  tabsEl.hidden = false;
  tabsEl.innerHTML = categories
    .map(
      (c) =>
        `<button type="button" class="category-tab${c.id === activeCategoryId ? ' is-active' : ''}" data-category-id="${c.id}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
  tabsEl.querySelectorAll('.category-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategoryId = Number(btn.dataset.categoryId);
      renderTabs();
      renderGrid();
    });
  });
}

function serviceCardHtml(service) {
  const isSelected = selectedIds.has(service.id);
  return `
    <button type="button" class="service-select-card${isSelected ? ' is-selected' : ''}" data-service-id="${service.id}" aria-pressed="${isSelected}">
      <div class="service-select-head">
        <div class="service-select-name">${escapeHtml(service.name)}</div>
        <span class="service-select-check" aria-hidden="true">✓</span>
      </div>
      <div class="service-select-description">${escapeHtml(service.description || '')}</div>
      <div class="service-select-meta">
        <span class="service-select-duration">${formatDuration(service.durationMinutes)}</span>
        <span class="service-select-price">${formatPriceRub(service.priceRub)}</span>
      </div>
    </button>
  `;
}

function renderGrid() {
  const visible = allServices.filter((s) => s.categoryId === activeCategoryId);
  if (visible.length === 0) {
    grid.innerHTML = '<div class="api-error">В этой категории пока нет услуг.</div>';
    return;
  }
  grid.innerHTML = visible.map(serviceCardHtml).join('');
  grid.querySelectorAll('.service-select-card').forEach((card) => {
    card.addEventListener('click', () => toggleService(Number(card.dataset.serviceId)));
  });
}

function toggleService(serviceId) {
  if (selectedIds.has(serviceId)) selectedIds.delete(serviceId);
  else selectedIds.add(serviceId);
  setSelectedServiceIds([...selectedIds]);
  renderGrid();
  renderFooter();
}

// ---- Нижняя панель: сумма/длительность или подсказка, чего не хватает ----
function renderFooter() {
  const selected = allServices.filter((s) => selectedIds.has(s.id));

  if (selected.length === 0) {
    footerRight.innerHTML = `
      <span class="booking-missing-hint">Выберите хотя бы одну услугу, чтобы продолжить</span>
      <button type="button" class="btn btn-primary" disabled>Далее</button>
    `;
    return;
  }

  const totalDurationMinutes = selected.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPriceRub = selected.reduce((sum, s) => sum + s.priceRub, 0);
  const countLabel = `${selected.length} ${pluralRu(selected.length, 'услуга', 'услуги', 'услуг')}`;

  footerRight.innerHTML = `
    <div class="booking-summary-text">
      <div class="booking-summary-count">${countLabel}</div>
      <div class="booking-summary-total">${formatDuration(totalDurationMinutes)} · ${formatPriceRub(totalPriceRub)}</div>
    </div>
    <a href="${BOOKING_MASTER_URL}" class="btn btn-primary">Далее</a>
  `;
}

async function load() {
  errorBox.hidden = true;
  renderSkeletonGrid();
  try {
    allServices = await fetchServices();
    if (allServices.length === 0) {
      grid.innerHTML = '<div class="api-error">Пока нет доступных услуг для записи.</div>';
      tabsEl.hidden = true;
      renderFooter();
      return;
    }
    categories = buildCategories(allServices);
    // Открываем категорию, где уже что-то выбрано (вернулись назад с
    // Booking · 2 через "Изменить") — иначе первую по порядку.
    const preselectedCategory = allServices.find((s) => selectedIds.has(s.id));
    activeCategoryId = preselectedCategory ? preselectedCategory.categoryId : categories[0].id;
    renderTabs();
    renderGrid();
    renderFooter();
  } catch (err) {
    renderApiError(err);
  }
}

initBookingFlow(1);
renderFooter();
load();
