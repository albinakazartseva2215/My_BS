// Booking · 4 · Подтверждение (+ вход) — см. подробное объяснение решения
// смёржить прототиповские «Booking · 4 · Вход» и «Booking · 5 ·
// Подтверждение» в один экран в комментарии у BOOKING_CONFIRM_URL
// (js/routes.js): подтвердить удержание в запись может только уже вошедший
// клиент (requireAuth на POST /api/appointments), поэтому вход — часть
// этого же экрана, а не отдельный шаг с отдельным переходом.
//
// Порядок действий на этом экране:
//   1. POST /api/holds — удерживаем выбранный на Booking · 3 слот, как
//      только зашли сюда (задание). Удержание переживает перезагрузку
//      страницы — токен и время истечения лежат в js/store.js, повторный
//      заход не создаёт второе (оно бы тут же конфликтовало само с собой
//      как то же самое время у того же мастера).
//   2. Таймер считает остаток от РЕАЛЬНОГО holdExpiresAt сервера, не сам
//      придумывает секунды.
//   3. «Подтвердить запись»: если клиент ещё не вошёл — сперва
//      POST /api/auth/login или /register с holdToken (сервер сам привяжет
//      удержание к вошедшему), затем в любом случае POST /api/appointments
//      с тем же holdToken — это и есть подтверждение.
//   4. 409 (слот заняли) на любом из двух шагов — состояние "Booking 04b"
//      этого же экрана: сообщение из ответа сервера как есть, кнопки
//      ближайших слотов из ответа сервера, ссылка на выбор другого времени.

import {
  fetchServices,
  fetchMasters,
  fetchMe,
  login,
  register,
  createHold,
  releaseHold,
  confirmAppointment,
  ApiRequestError,
  describeError,
} from './api.js';
import { initBookingFlow } from './booking-flow.js';
import { getSelectedServiceIds, getSelectedMaster, getSelectedSlot, getHold, setHold, clearHold, setSelectedSlot, setLastAppointment } from './store.js';
import { formatDuration, formatPriceRub, initials } from './format.js';
import { BOOKING_SERVICES_URL, BOOKING_MASTER_URL, BOOKING_DATETIME_URL, BOOKING_SUCCESS_URL, PASSWORD_RESET_URL } from './routes.js';
import { relativeDayLabel, formatDayMonth } from './dates.js';
import {
  validateRequired,
  validateEmail,
  validatePhone,
  validatePassword,
  runClientValidation,
  showServerError,
  hideAlert,
  wirePasswordToggle,
  setSubmitting,
} from './forms.js';

const serviceIds = getSelectedServiceIds();
const masterChoice = getSelectedMaster();
let selectedSlot = getSelectedSlot();

if (serviceIds.length === 0) {
  window.location.replace(BOOKING_SERVICES_URL);
  throw new Error('Booking · 4: нет выбранных услуг, редирект на Booking · 1');
}
if (!masterChoice) {
  window.location.replace(BOOKING_MASTER_URL);
  throw new Error('Booking · 4: не выбран мастер, редирект на Booking · 2');
}
if (!selectedSlot) {
  window.location.replace(BOOKING_DATETIME_URL);
  throw new Error('Booking · 4: не выбран слот, редирект на Booking · 3');
}

const errorBox = document.getElementById('confirmError');
const screen = document.getElementById('confirmScreen');

let selectedServices = [];
let masterName = '—';
let totalDurationMinutes = 0;
let totalPriceRub = 0;
let currentUser = null;
let identityTab = 'login';
let hold = null;
let countdownTimer = null;
let commentValue = '';
let remindEnabled = true;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- Скелетон / общая ошибка ----

function renderSkeleton() {
  errorBox.hidden = true;
  screen.innerHTML = `
    <div class="hold-banner"><div class="skeleton-line" style="width:180px;height:18px;border-radius:var(--radius-sm)"></div><div class="skeleton-line" style="width:56px;height:18px;border-radius:var(--radius-sm)"></div></div>
    <div class="confirm-layout">
      <div class="identity-panel"><div class="skeleton-line" style="height:240px;border-radius:var(--radius-md)"></div></div>
      <div class="visit-summary-card"><div class="skeleton-line" style="height:240px;border-radius:var(--radius-md)"></div></div>
    </div>
  `;
}

function renderGenericError(err) {
  screen.innerHTML = '';
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

// ---- Удержание слота ----

async function ensureHold() {
  const existing = getHold();
  if (existing && existing.masterId === selectedSlot.masterId && existing.startUtc === selectedSlot.startUtc) {
    if (new Date(existing.holdExpiresAt).getTime() > Date.now()) return existing;
  } else if (existing) {
    // Удержание от другого слота/мастера (вернулись назад и выбрали другое
    // время) — вежливо отпускаем, а не оставляем висеть до истечения таймера.
    releaseHold(existing.holdToken).catch(() => {});
  }
  const created = await createHold({
    masterId: selectedSlot.masterId,
    startDatetime: selectedSlot.startUtc,
    serviceIds,
  });
  const freshHold = {
    holdToken: created.holdToken,
    holdExpiresAt: created.holdExpiresAt,
    masterId: selectedSlot.masterId,
    startUtc: selectedSlot.startUtc,
  };
  setHold(freshHold);
  return freshHold;
}

// ---- Booking 04b: время заняли (409 — на удержании или на подтверждении) ----

function renderConflict(err) {
  errorBox.hidden = true;
  if (countdownTimer) clearInterval(countdownTimer);

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

  screen.innerHTML = `
    <div class="conflict-panel">
      <div class="conflict-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
      </div>
      <div class="conflict-title">Это время только что заняли</div>
      <div class="conflict-text">${escapeHtml(err.message)}</div>
      ${altHtml ? `<div class="conflict-alt-slots">${altHtml}</div>` : ''}
      <div class="conflict-actions">
        <a href="${BOOKING_DATETIME_URL}" class="btn btn-outline btn-block">Выбрать другое время</a>
      </div>
      <div class="conflict-note">Ваши услуги сохранены: ${escapeHtml(selectedServices.map((s) => s.name).join(' + '))}, ${formatDuration(totalDurationMinutes)}</div>
    </div>
  `;

  screen.querySelectorAll('.conflict-alt-btn').forEach((btn) => {
    btn.addEventListener('click', () => retryWithAlternative(btn.dataset));
  });
}

async function retryWithAlternative({ startUtc, endUtc, startLocal, endLocal }) {
  selectedSlot = { masterId: selectedSlot.masterId, startUtc, endUtc, startLocal, endLocal };
  setSelectedSlot(selectedSlot);
  await init();
}

// ---- Время удержания истекло (не ошибка сервера — свой таймер дошёл до нуля) ----

function onHoldExpired() {
  clearInterval(countdownTimer);
  clearHold();
  const bannerEl = document.getElementById('holdBanner');
  const mainContent = document.getElementById('mainContent');
  if (bannerEl) bannerEl.hidden = true;
  if (mainContent) mainContent.hidden = true;

  const expiredPanel = document.getElementById('expiredPanel');
  if (!expiredPanel) return;
  expiredPanel.hidden = false;
  expiredPanel.innerHTML = `
    <div class="conflict-panel">
      <div class="conflict-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
      </div>
      <div class="conflict-title">Время удержания истекло</div>
      <div class="conflict-text">Кто-то другой мог занять это время. Проверим и вернём его, если оно всё ещё свободно.</div>
      <div class="conflict-actions">
        <button type="button" class="btn btn-primary btn-block" id="retryHoldBtn">Вернуть ${selectedSlot.startLocal.slice(11, 16)}</button>
        <a href="${BOOKING_DATETIME_URL}" class="btn btn-outline btn-block">Выбрать другое время</a>
      </div>
    </div>
  `;
  document.getElementById('retryHoldBtn').addEventListener('click', () => init());
}

// ---- Таймер удержания ----

function startCountdown() {
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const secondsLeft = Math.max(0, Math.round((new Date(hold.holdExpiresAt).getTime() - Date.now()) / 1000));
  const timerEl = document.getElementById('holdTimer');
  const bannerEl = document.getElementById('holdBanner');
  if (!timerEl || !bannerEl) {
    clearInterval(countdownTimer); // экран уже сменился (конфликт и т.п.)
    return;
  }
  if (secondsLeft <= 0) {
    onHoldExpired();
    return;
  }
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
  // Задание: "когда остаётся меньше минуты, таймер меняет вид".
  bannerEl.classList.toggle('is-warning', secondsLeft < 60);
}

// ---- Сводка визита (правая колонка) ----

function visitSummaryHtml() {
  const dateStr = selectedSlot.startLocal.slice(0, 10);
  const time = selectedSlot.startLocal.slice(11, 16);
  const servicesHtml = selectedServices
    .map(
      (s) => `
        <div class="visit-summary-service-row"><span>${escapeHtml(s.name)} · ${formatDuration(s.durationMinutes)}</span><span>${formatPriceRub(s.priceRub)}</span></div>
      `,
    )
    .join('');

  return `
    <div class="visit-summary-title">Ваша запись</div>

    <div class="visit-summary-row-head">
      <div class="visit-summary-datetime">${formatDayMonth(dateStr)}, ${time}</div>
      <a href="${BOOKING_DATETIME_URL}" class="visit-summary-change">Изменить</a>
    </div>

    <div class="visit-summary-master">
      <span class="avatar-circle" aria-hidden="true">${escapeHtml(initials(masterName))}</span>
      <div class="visit-summary-master-info"><div class="visit-summary-master-name">${escapeHtml(masterName)}</div></div>
      <a href="${BOOKING_MASTER_URL}" class="visit-summary-change">Изменить</a>
    </div>

    <div class="visit-summary-row-head">
      <div class="visit-summary-title">Услуги</div>
      <a href="${BOOKING_SERVICES_URL}" class="visit-summary-change">Изменить</a>
    </div>
    <div class="visit-summary-services">${servicesHtml}</div>

    <div class="visit-summary-total"><span>Итого: ${formatDuration(totalDurationMinutes)}</span><span>${formatPriceRub(totalPriceRub)}</span></div>
    <div class="visit-summary-note">Оплата в салоне, сумма справочная</div>
    <div class="visit-summary-note">г. Москва, ул. Тверская, 12</div>
  `;
}

// ---- Левая колонка: данные клиента ----

function renderIdentityPanel() {
  const panel = document.getElementById('identityPanel');
  if (!panel) return;

  if (currentUser) {
    panel.innerHTML = `
      <div class="identity-logged-in">
        <span class="avatar-circle" aria-hidden="true">${escapeHtml(initials(currentUser.name))}</span>
        <div class="identity-logged-in-info">
          <div class="identity-logged-in-name">Вы вошли как ${escapeHtml(currentUser.name)}</div>
          <div class="identity-logged-in-email">${escapeHtml(currentUser.email)}</div>
        </div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="identity-tabs">
      <button type="button" class="identity-tab${identityTab === 'login' ? ' is-active' : ''}" data-tab="login">Войти</button>
      <button type="button" class="identity-tab${identityTab === 'signup' ? ' is-active' : ''}" data-tab="signup">Создать аккаунт</button>
    </div>

    <div class="identity-tab-panel" id="loginPanel" ${identityTab === 'login' ? '' : 'hidden'}>
      <div class="form-alert is-error" id="loginAlert" role="alert" hidden></div>
      <form id="loginTabForm" novalidate>
        <div class="form-field">
          <label class="form-label" for="loginEmail2">E-mail</label>
          <input class="form-input" type="email" id="loginEmail2" name="email" placeholder="you@mail.ru" autocomplete="email" required>
          <span class="field-error" data-for="email"></span>
        </div>
        <div class="form-field password-field">
          <label class="form-label" for="loginPassword2">Пароль</label>
          <input class="form-input" type="password" id="loginPassword2" name="password" placeholder="••••••••" autocomplete="current-password" required>
          <button type="button" class="password-toggle" id="loginPasswordToggle2" aria-label="Показать пароль">👁</button>
          <span class="field-error" data-for="password"></span>
        </div>
        <div class="form-hint-link"><a href="${PASSWORD_RESET_URL}">Забыли пароль?</a></div>
      </form>
    </div>

    <div class="identity-tab-panel" id="signupPanel" ${identityTab === 'signup' ? '' : 'hidden'}>
      <div class="form-alert is-error" id="signupAlert" role="alert" hidden></div>
      <form id="signupTabForm" novalidate>
        <div class="form-field">
          <label class="form-label" for="signupName">Имя</label>
          <input class="form-input" type="text" id="signupName" name="name" placeholder="Как к вам обращаться" autocomplete="name" required>
          <span class="field-error" data-for="name"></span>
        </div>
        <div class="form-field">
          <label class="form-label" for="signupEmail">E-mail</label>
          <input class="form-input" type="email" id="signupEmail" name="email" placeholder="you@mail.ru" autocomplete="email" required>
          <span class="field-error" data-for="email"></span>
        </div>
        <div class="form-field">
          <label class="form-label" for="signupPhone">Телефон</label>
          <input class="form-input" type="tel" id="signupPhone" name="phone" placeholder="+7 999 000-00-00" autocomplete="tel" required>
          <span class="field-error" data-for="phone"></span>
        </div>
        <div class="form-field password-field">
          <label class="form-label" for="signupPassword">Пароль</label>
          <input class="form-input" type="password" id="signupPassword" name="password" placeholder="••••••••" autocomplete="new-password" required>
          <button type="button" class="password-toggle" id="signupPasswordToggle" aria-label="Показать пароль">👁</button>
          <span class="field-error" data-for="password"></span>
        </div>
      </form>
    </div>

    <div class="identity-footnote">После входа вернём вас сюда же — выбранное время сохранится</div>
  `;

  wirePasswordToggle(document.getElementById('loginPasswordToggle2'), document.getElementById('loginPassword2'));
  wirePasswordToggle(document.getElementById('signupPasswordToggle'), document.getElementById('signupPassword'));

  panel.querySelectorAll('.identity-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      identityTab = btn.dataset.tab;
      renderIdentityPanel();
    });
  });

  document.getElementById('loginTabForm').addEventListener('submit', (e) => {
    e.preventDefault();
    onConfirmClick();
  });
  document.getElementById('signupTabForm').addEventListener('submit', (e) => {
    e.preventDefault();
    onConfirmClick();
  });
}

// ---- Основной экран ----

function renderScreen() {
  errorBox.hidden = true;
  screen.innerHTML = `
    <div class="hold-banner" id="holdBanner">
      <div class="hold-banner-text">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
        <span>Держим ${selectedSlot.startLocal.slice(11, 16)} за вами</span>
      </div>
      <div class="hold-banner-timer" id="holdTimer">--:--</div>
    </div>

    <div id="expiredPanel" hidden></div>

    <div id="mainContent">
      <div class="confirm-layout">
        <div class="identity-panel" id="identityPanel"></div>
        <div class="visit-summary-card">${visitSummaryHtml()}</div>
      </div>

      <div class="form-field">
        <label class="form-label" for="commentField">Комментарий мастеру (необязательно)</label>
        <textarea class="form-input" id="commentField" rows="3" maxlength="200" placeholder="Например, пожелания по оттенку"></textarea>
        <div class="comment-counter" id="commentCounter">0 / 200</div>
      </div>

      <label class="checkbox-row is-checked" id="remindRow">
        <span class="checkbox-box" aria-hidden="true">✓</span>
        <span>Напомнить мне о визите <span class="checkbox-hint">— напоминание появится в личном кабинете</span></span>
      </label>

      <div class="form-alert is-error" id="confirmAlert" role="alert" hidden></div>

      <button type="button" class="btn btn-primary btn-block" id="confirmBtn">Подтвердить запись</button>
      <div class="confirm-cta-note">Отменить или перенести можно не позднее чем за 2 часа до визита</div>
    </div>
  `;

  renderIdentityPanel();

  const commentField = document.getElementById('commentField');
  const counter = document.getElementById('commentCounter');
  commentField.addEventListener('input', () => {
    commentValue = commentField.value;
    counter.textContent = `${commentValue.length} / 200`;
  });

  const remindRow = document.getElementById('remindRow');
  remindRow.addEventListener('click', () => {
    remindEnabled = !remindEnabled;
    remindRow.classList.toggle('is-checked', remindEnabled);
    remindRow.querySelector('.checkbox-box').textContent = remindEnabled ? '✓' : '';
  });

  document.getElementById('confirmBtn').addEventListener('click', onConfirmClick);
}

// ---- «Подтвердить запись»: вход/регистрация (если нужно) + подтверждение ----

async function onConfirmClick() {
  const confirmBtn = document.getElementById('confirmBtn');
  const confirmAlert = document.getElementById('confirmAlert');
  hideAlert(confirmAlert);

  if (!currentUser) {
    const activeForm = document.getElementById(identityTab === 'login' ? 'loginTabForm' : 'signupTabForm');
    const activeAlert = document.getElementById(identityTab === 'login' ? 'loginAlert' : 'signupAlert');
    hideAlert(activeAlert);

    const validators =
      identityTab === 'login'
        ? { email: validateEmail, password: validatePassword }
        : { name: validateRequired, email: validateEmail, phone: validatePhone, password: validatePassword };
    if (!runClientValidation(activeForm, validators)) return;

    setSubmitting(confirmBtn, true, 'Подтвердить запись');
    try {
      if (identityTab === 'login') {
        const email = activeForm.elements.namedItem('email').value.trim();
        const password = activeForm.elements.namedItem('password').value;
        const result = await login({ email, password, holdToken: hold.holdToken });
        currentUser = result.user;
      } else {
        const result = await register({
          name: activeForm.elements.namedItem('name').value.trim(),
          email: activeForm.elements.namedItem('email').value.trim(),
          phone: activeForm.elements.namedItem('phone').value.trim(),
          password: activeForm.elements.namedItem('password').value,
          // Чекбокса согласия с офертой на этом экране нет — то же решение,
          // что и на самостоятельном register.html (js/register.js).
          termsAccepted: true,
          holdToken: hold.holdToken,
        });
        currentUser = result.user;
      }
      renderIdentityPanel();
    } catch (err) {
      setSubmitting(confirmBtn, false, 'Подтвердить запись');
      if (err instanceof ApiRequestError) {
        showServerError(activeForm, activeAlert, err);
      } else {
        throw err;
      }
      return;
    }
  } else {
    setSubmitting(confirmBtn, true, 'Подтвердить запись');
  }

  try {
    const appointment = await confirmAppointment({
      holdToken: hold.holdToken,
      comment: commentValue || undefined,
      remindEnabled,
    });
    setLastAppointment(appointment);
    clearHold();
    window.location.href = BOOKING_SUCCESS_URL;
  } catch (err) {
    setSubmitting(confirmBtn, false, 'Подтвердить запись');
    if (err instanceof ApiRequestError && err.status === 409) {
      renderConflict(err);
    } else if (err instanceof ApiRequestError) {
      confirmAlert.textContent = err.message;
      confirmAlert.hidden = false;
    } else {
      throw err;
    }
  }
}

// ---- Инициализация ----

async function init() {
  renderSkeleton();

  let services;
  let masters;
  try {
    [services, masters] = await Promise.all([fetchServices(), fetchMasters()]);
  } catch (err) {
    renderGenericError(err);
    return;
  }

  selectedServices = services.filter((s) => serviceIds.includes(s.id));
  totalDurationMinutes = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  totalPriceRub = selectedServices.reduce((sum, s) => sum + s.priceRub, 0);
  const masterRow = masters.find((m) => m.id === selectedSlot.masterId);
  masterName = masterRow ? masterRow.name : '—';

  // Не критично для остального экрана — гость это гость, форма входа
  // покажется сама (renderIdentityPanel).
  try {
    currentUser = await fetchMe();
  } catch {
    currentUser = null;
  }

  try {
    hold = await ensureHold();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) {
      renderConflict(err);
    } else {
      renderGenericError(err);
    }
    return;
  }

  renderScreen();
  startCountdown();
}

initBookingFlow(4);
init();
