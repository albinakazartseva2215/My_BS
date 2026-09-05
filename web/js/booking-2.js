// Booking · 2 · Мастер — выбор мастера под уже выбранные на прошлом шаге
// услуги. Данные — GET /api/services (имена и длительности выбранных
// услуг для баннера) и дважды GET /api/masters (js/api.js, правило 3):
//
//   1. с ?serviceIds=… — те, кто выполняет ВЕСЬ набор (сервер уже
//      фильтрует, catalog.routes.js) — задание: "список мастеров
//      запрашивай уже с учётом выбранных услуг";
//   2. без фильтра — весь активный список, чтобы отличить "не подходит"
//      от "вообще не мастер" и показать первых неактивными с пояснением,
//      а не молча убрать из списка (задание: "тех, кто их не делает,
//      показывай неактивными с пояснением"). Ни один существующий
//      эндпоинт не отдаёт эту пару списков одним запросом — двух вызовов
//      к уже готовому /api/masters достаточно, нового не заводим.

import { fetchServices, fetchMasters, describeError } from './api.js';
import { initBookingFlow } from './booking-flow.js';
import { getSelectedServiceIds, getSelectedMaster, setSelectedMaster } from './store.js';
import { formatDuration } from './format.js';
import { BOOKING_SERVICES_URL, BOOKING_DATETIME_URL } from './routes.js';

const banner = document.getElementById('selectedServicesBanner');
const content = document.getElementById('mastersContent');
const errorBox = document.getElementById('mastersError');
const footerRight = document.getElementById('footerRight');

const serviceIds = getSelectedServiceIds();

// Без выбранных услуг этому шагу нечего показывать (GET /api/masters с
// пустым фильтром просто вернул бы "все активные", что не то же самое,
// что "любой, кто выполняет мои услуги") — возвращаем на шаг 1, а не
// падаем и не рисуем пустой экран.
if (serviceIds.length === 0) {
  window.location.replace(BOOKING_SERVICES_URL);
  throw new Error('Booking · 2: нет выбранных услуг, редирект на Booking · 1');
}

let selectedMaster = getSelectedMaster(); // { type: 'any' } | { type: 'master', id } | null

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderSkeleton() {
  banner.hidden = true;
  content.innerHTML = `
    <div class="master-option-list" aria-hidden="true">
      ${['62%', '48%', '55%'].map((w) => `
        <div class="master-option-card" style="cursor:default">
          <div class="skeleton-line" style="width:56px;height:56px;border-radius:var(--radius-full);flex-shrink:0"></div>
          <div style="flex:1;padding-top:4px">
            <div class="skeleton-line" style="width:${w};height:16px;margin-bottom:8px"></div>
            <div class="skeleton-line" style="width:35%;height:12px"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
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
  content.innerHTML = '';
  banner.hidden = true;
}

function renderBanner(selectedServices) {
  const names = selectedServices.map((s) => s.name).join(' + ');
  const totalMinutes = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  banner.hidden = false;
  banner.innerHTML = `
    <div class="selected-services-text">${escapeHtml(names)} · ${formatDuration(totalMinutes)}</div>
    <a href="${BOOKING_SERVICES_URL}" class="selected-services-change">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4.2L15.8 5 19 8.2 8.2 19z"/><line x1="13" y1="7" x2="17" y2="11"/></svg>
      Изменить
    </a>
  `;
}

function anyMasterCardHtml() {
  const isSelected = selectedMaster?.type === 'any';
  return `
    <button type="button" class="master-option-card${isSelected ? ' is-selected' : ''}" data-choice="any" aria-pressed="${isSelected}">
      <span class="master-option-any-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke-linejoin="round"/></svg>
      </span>
      <div class="master-option-body">
        <div class="master-any-title">Любой свободный мастер</div>
        <div class="master-any-subtitle">Больше свободного времени</div>
      </div>
      <span class="master-option-check" aria-hidden="true">✓</span>
    </button>
  `;
}

function masterCardHtml(master, isCapable) {
  const isSelected = !isCapable ? false : selectedMaster?.type === 'master' && selectedMaster.id === master.id;
  const photo = master.photoUrl
    ? `<img class="master-option-avatar" src="${escapeHtml(master.photoUrl)}" alt="">`
    : `<div class="master-option-avatar photo-placeholder" aria-hidden="true">фото</div>`;
  const reason = isCapable
    ? ''
    : '<div class="master-option-reason">Не выполняет все выбранные услуги</div>';

  return `
    <button type="button"
      class="master-option-card${isSelected ? ' is-selected' : ''}${isCapable ? '' : ' is-disabled'}"
      data-choice="${isCapable ? `master:${master.id}` : ''}"
      ${isCapable ? '' : 'disabled aria-disabled="true"'}
      aria-pressed="${isSelected}">
      ${photo}
      <div class="master-option-body">
        <div class="master-option-top">
          <div>
            <div class="master-option-name">${escapeHtml(master.name)}</div>
            <div class="master-option-spec">${escapeHtml(master.specialization || '')}</div>
          </div>
          ${isCapable ? '<span class="master-option-check" aria-hidden="true">✓</span>' : ''}
        </div>
        <div class="master-option-rating">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12,3 14.7,9 21,9.5 16.2,13.7 17.6,20 12,16.6 6.4,20 7.8,13.7 3,9.5 9.3,9"/></svg>
          <span class="master-option-rating-value">${master.ratingAvg != null ? master.ratingAvg.toFixed(1) : '—'}</span>
          <span class="master-option-rating-count">(${master.reviewsCount})</span>
        </div>
        ${reason}
      </div>
    </button>
  `;
}

function emptyStateHtml() {
  return `
    <div class="booking-empty-state">
      <div class="booking-empty-title">Никто не оказывает все выбранные услуги в один визит</div>
      <div class="booking-empty-text">Попробуйте выбрать другой набор услуг — так найдётся мастер, который сделает всё за один визит.</div>
      <a href="${BOOKING_SERVICES_URL}" class="btn btn-outline">Изменить набор услуг</a>
    </div>
  `;
}

function wireCardClicks() {
  content.querySelectorAll('.master-option-card:not(.is-disabled)').forEach((card) => {
    card.addEventListener('click', () => {
      const choice = card.dataset.choice;
      selectedMaster = choice === 'any' ? { type: 'any' } : { type: 'master', id: Number(choice.split(':')[1]) };
      setSelectedMaster(selectedMaster);
      renderMasters(); // перерисовать выделение
      renderFooter();
    });
  });
}

let allMasters = [];
let capableIds = new Set();

function renderMasters() {
  if (capableIds.size === 0) {
    content.innerHTML = emptyStateHtml();
    return;
  }
  const cards = [anyMasterCardHtml(), ...allMasters.map((m) => masterCardHtml(m, capableIds.has(m.id)))];
  content.innerHTML = `<div class="master-option-list">${cards.join('')}</div>`;
  wireCardClicks();
}

function renderFooter() {
  const hasCapableMaster = capableIds.size > 0;
  if (!hasCapableMaster) {
    footerRight.innerHTML = `
      <span class="booking-missing-hint">Никто не подходит под выбранные услуги — измените их набор</span>
      <button type="button" class="btn btn-primary" disabled>Далее</button>
    `;
    return;
  }
  if (!selectedMaster) {
    footerRight.innerHTML = `
      <span class="booking-missing-hint">Выберите мастера, чтобы продолжить</span>
      <button type="button" class="btn btn-primary" disabled>Далее</button>
    `;
    return;
  }
  footerRight.innerHTML = `<a href="${BOOKING_DATETIME_URL}" class="btn btn-primary">Далее</a>`;
}

async function load() {
  errorBox.hidden = true;
  renderSkeleton();
  try {
    const [services, capableMasters, everyoneActive] = await Promise.all([
      fetchServices(),
      fetchMasters(serviceIds),
      fetchMasters(),
    ]);

    const selectedServices = services.filter((s) => serviceIds.includes(s.id));
    renderBanner(selectedServices);

    allMasters = everyoneActive;
    capableIds = new Set(capableMasters.map((m) => m.id));

    // Мастер, выбранный раньше, мог перестать подходить (например, он не
    // входит в список подходящих больше) — тогда сбрасываем выбор, а не
    // показываем "выбрано" у карточки, которую сейчас не выбрать.
    if (selectedMaster?.type === 'master' && !capableIds.has(selectedMaster.id)) {
      selectedMaster = null;
      setSelectedMaster(null);
    }

    renderMasters();
    renderFooter();
  } catch (err) {
    renderApiError(err);
  }
}

initBookingFlow(2);
renderFooter();
load();
