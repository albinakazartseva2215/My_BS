// Общая "хром"-часть визарда записи — мини-шапка (лого + крестик закрытия)
// и степпер сверху. Одинаковая на каждом шаге Booking · 1–5 (см. те же
// стили верхней части во всех Full style guide DC/export/src/booking-*.dc.html),
// поэтому вынесена в один файл — так же, как общая шапка сайта уже вынесена
// в js/header.js, а не повторена в разметке каждой страницы.
//
// Разметка шапки визарда — своя, не initHeader() из header.js: в прототипе
// у Booking-экранов нет ни ссылок разделов, ни входа/аватара, ни бургера —
// только лого и крестик "закрыть" на Landing (docs/ui-map.md, разделы 2–3:
// "«×» и «Назад» → Landing"). Показывать здесь обычную шапку сайта значило
// бы дорисовывать в неё элементы, которых не было ни в прототипе, ни в
// задании.

import { BOOKING_SERVICES_URL, BOOKING_MASTER_URL, BOOKING_DATETIME_URL, BOOKING_CONFIRM_URL } from './routes.js';

// Степпер всегда об одних и тех же 4 шагах сценария (см. любой из
// booking-*.dc.html — "Услуги" / "Мастер" / "Время" / "Подтверждение") —
// у входа в прототипе был свой узел, но в нашей реализации вход и
// подтверждение — один экран (см. routes.js, BOOKING_CONFIRM_URL), поэтому
// пятого узла нет и не появится.
const STEPS = [
  { step: 1, label: 'Услуги', url: BOOKING_SERVICES_URL },
  { step: 2, label: 'Мастер', url: BOOKING_MASTER_URL },
  { step: 3, label: 'Время', url: BOOKING_DATETIME_URL },
  { step: 4, label: 'Подтверждение', url: BOOKING_CONFIRM_URL },
];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Требование задания: "пройденные шаги кликабельны, будущие приглушены" —
// пройденные (step < currentStep) ведут по своему адресу, текущий и
// будущие — нет (даже если бы у будущего шага уже была страница: пока до
// него не дошли по сценарию, возвращаться вперёд через степпер не даём,
// ровно как и в прототипе, где будущие узлы вообще без onClick).
function stepperItemHtml({ step, label, url }, currentStep) {
  const isDone = step < currentStep;
  const isCurrent = step === currentStep;
  const state = isDone ? 'is-done' : isCurrent ? 'is-current' : 'is-future';
  const circleContent = isDone ? '✓' : String(step);

  const inner = `
    <span class="stepper-circle" aria-hidden="true">${circleContent}</span>
    <span class="stepper-label">${escapeHtml(label)}</span>
  `;

  const content =
    isDone && url
      ? `<a class="stepper-step ${state}" href="${url}">${inner}</a>`
      : `<span class="stepper-step ${state}"${isCurrent ? ' aria-current="step"' : ' aria-disabled="true"'}>${inner}</span>`;

  return `<li class="stepper-item ${state}">${content}</li>`;
}

export function renderStepper(currentStep) {
  const items = STEPS.map((s) => stepperItemHtml(s, currentStep)).join('');
  return `<ol class="stepper" aria-label="Шаги записи">${items}</ol>`;
}

// Вставляет мини-шапку визарда и степпер в #booking-flow-root. Вызывать
// один раз в начале скрипта страницы — как initHeader() на обычных
// страницах (js/header.js).
export function initBookingFlow(currentStep) {
  const root = document.getElementById('booking-flow-root');
  if (!root) return;
  root.innerHTML = `
    <div class="flow-header">
      <a class="brand" href="index.html">
        <span class="brand-mark" aria-hidden="true">Т</span>
        <span class="brand-name">Тон</span>
      </a>
      <a class="flow-close" href="index.html" aria-label="Закрыть запись и вернуться на главную">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </a>
    </div>
    ${renderStepper(currentStep)}
  `;
}
