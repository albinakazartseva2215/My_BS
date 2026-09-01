// Общие помощники для форм входа/регистрации/восстановления пароля:
// клиентская пред-проверка полей и показ ответа сервера (текст ошибки +
// подсветка поля, если сервер его назвал).
//
// Правило задания: клиентская проверка — только для удобства, настоящая
// проверка на сервере, и её ответ всё равно надо показать. Поэтому здесь
// нет ничего, что решало бы "форма верна" самостоятельно — только ранний
// отказ от заведомо некорректного запроса, а окончательный текст (успех
// или ошибка) всегда приходит от api.js.

import { ApiRequestError } from './api.js';

// Те же правила, что и на сервере (server/src/validation/validate.js) —
// продублированы намеренно: это подсказка клиенту, а не отдельный
// источник истины, финальное решение всегда за сервером.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{5,19}$/;

export function validateRequired(value) {
  return value.trim().length > 0 ? null : 'Заполните это поле';
}

export function validateEmail(value) {
  const v = value.trim();
  if (!v) return 'Заполните это поле';
  if (!EMAIL_RE.test(v)) return 'Введите корректный e-mail';
  return null;
}

export function validatePhone(value) {
  const v = value.trim();
  if (!v) return 'Заполните это поле';
  if (!PHONE_RE.test(v)) return 'Введите телефон цифрами (можно +, -, скобки, пробелы)';
  return null;
}

export function validatePassword(value) {
  if (!value) return 'Заполните это поле';
  if (value.length < 8) return 'Пароль должен быть не короче 8 символов';
  return null;
}

// ---- Отображение ошибок на форме ----

// Достаёт из формы контейнер под текст ошибки конкретного поля:
// ожидается <span class="field-error" data-for="имяПоля"> рядом с полем.
function fieldErrorEl(form, fieldName) {
  return form.querySelector(`.field-error[data-for="${fieldName}"]`);
}

export function setFieldError(form, fieldName, message) {
  const input = form.elements.namedItem(fieldName);
  const errorEl = fieldErrorEl(form, fieldName);
  if (input) input.classList.toggle('is-invalid', Boolean(message));
  if (errorEl) errorEl.textContent = message || '';
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
}

// Прогоняет { fieldName: validator } по значениям формы, расставляет
// текст под полями. Возвращает true, если форма прошла проверку.
export function runClientValidation(form, validators) {
  clearFieldErrors(form);
  let ok = true;
  for (const [fieldName, validator] of Object.entries(validators)) {
    const input = form.elements.namedItem(fieldName);
    const message = validator(input.value);
    if (message) {
      setFieldError(form, fieldName, message);
      ok = false;
    }
  }
  return ok;
}

// Показывает ответ сервера на форме: текст — всегда, подсветка поля —
// только если сервер прислал details.field (правило задания: "если
// сервер вернул, в каком поле проблема, подсвети это поле" — не все
// ошибки его называют, см. server/src/validation/validate.js, где
// большинство badRequest() брошены без details).
export function showServerError(form, alertEl, err) {
  const message = err instanceof ApiRequestError ? err.message : String((err && err.message) || err);
  alertEl.textContent = message;
  alertEl.hidden = false;

  const field = err instanceof ApiRequestError && err.details && err.details.field;
  if (field && form.elements.namedItem(field)) {
    setFieldError(form, field, message);
    form.elements.namedItem(field).focus();
  }
}

export function hideAlert(alertEl) {
  alertEl.hidden = true;
  alertEl.textContent = '';
}

// ---- Переключатель видимости пароля (как в прототипе Booking · 4) ----
export function wirePasswordToggle(toggleButton, input) {
  toggleButton.addEventListener('click', () => {
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    toggleButton.textContent = isVisible ? '👁' : '🙈';
    toggleButton.setAttribute('aria-label', isVisible ? 'Показать пароль' : 'Скрыть пароль');
  });
}

// ---- Состояние кнопки submit во время запроса ----
export function setSubmitting(button, isSubmitting, idleLabel) {
  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? 'Секунду…' : idleLabel;
}
