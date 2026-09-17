// Логика экрана регистрации. Все обращения к серверу — только через
// js/api.js (docs/frontend-rules.md, правило 3).

import { register, ApiRequestError } from './api.js';
import { ACCOUNT_URL, YANDEX_LOGIN_START_URL } from './routes.js';
import { initHeader } from './header.js';
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

const form = document.getElementById('registerForm');
const alertEl = document.getElementById('formAlert');
const submitBtn = document.getElementById('registerSubmit');
const passwordInput = document.getElementById('registerPassword');
const strengthBars = document.querySelectorAll('#passwordStrength .password-strength-bar');
const strengthLabel = document.getElementById('passwordStrengthLabel');
const yandexBtn = document.getElementById('yandexLoginBtn');

initHeader();
wirePasswordToggle(document.getElementById('registerPasswordToggle'), passwordInput);

// "Войти через Яндекс" на экране регистрации — тот же переход, что и на
// login.html (js/login.js): не запрос через api.js, а обычная навигация
// браузера, только так пользователь попадёт на страницу согласия Яндекса.
// Сервер сам решает, создать новый аккаунт или войти в уже существующий с
// этим e-mail (server/src/domain/yandexAuth.js) — этот экран в это не
// вмешивается, кнопка одинаковая на login.html и здесь. Неудачу (отмена,
// ошибка обмена кода) GET /api/auth/yandex/callback всегда возвращает на
// login.html с сообщением (см. js/login.js) — не сюда, поэтому отдельной
// обработки ошибки здесь нет.
yandexBtn.addEventListener('click', () => {
  window.location.href = YANDEX_LOGIN_START_URL;
});

// ---- Индикатор сложности пароля ----
// Чисто подсказка для клиента — единственное правило пароля, которое
// реально проверяется (и на клиенте, и на сервере), это длина ≥ 8
// символов (server/src/validation/validate.js, requirePassword). Индикатор
// ничего не блокирует и не отправляется на сервер.
function passwordStrength(value) {
  if (value.length < 8) return 0;
  let score = 1;
  if (value.length >= 12) score += 1;
  const varietyCount = [/[a-zа-я]/, /[A-ZА-Я]/, /[0-9]/, /[^a-zA-Zа-яА-Я0-9]/].filter((re) => re.test(value)).length;
  if (varietyCount >= 3) score += 1;
  return Math.min(score, 3);
}

function updateStrengthMeter() {
  const score = passwordStrength(passwordInput.value);
  const levelClass = ['', 'is-filled-weak', 'is-filled-medium', 'is-filled-strong'][score];
  strengthBars.forEach((bar, i) => {
    bar.className = 'password-strength-bar' + (i < score ? ` ${levelClass}` : '');
  });
  if (!passwordInput.value) {
    strengthLabel.textContent = 'Не короче 8 символов';
  } else {
    strengthLabel.textContent = ['Слишком короткий', 'Слабый пароль', 'Средний пароль', 'Надёжный пароль'][score];
  }
}
passwordInput.addEventListener('input', updateStrengthMeter);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(alertEl);

  const clientOk = runClientValidation(form, {
    name: validateRequired,
    email: validateEmail,
    phone: validatePhone,
    password: validatePassword,
  });
  if (!clientOk) return;

  const payload = {
    name: form.elements.namedItem('name').value.trim(),
    email: form.elements.namedItem('email').value.trim(),
    phone: form.elements.namedItem('phone').value.trim(),
    password: form.elements.namedItem('password').value,
    // Чекбокса согласия с офертой на экране больше нет (по просьбе —
    // "убери галочку публичной оферты"), но сервер всё равно требует
    // termsAccepted:true в теле запроса (server/src/routes/auth.routes.js:
    // requireBoolean + явная проверка, иначе 400 "Нужно принять условия
    // оферты") — без этого поля регистрация не проходила бы вообще. Шлём
    // true сами, без отдельного действия клиента на этом экране.
    termsAccepted: true,
  };

  setSubmitting(submitBtn, true, 'Создать и продолжить');
  try {
    // Сессию (Set-Cookie) ставит сервер сам — см. api.js. Токена в ответе
    // нет, в браузере ничего не сохраняем.
    await register(payload);
    window.location.href = ACCOUNT_URL;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      showServerError(form, alertEl, err);
    } else {
      throw err;
    }
  } finally {
    setSubmitting(submitBtn, false, 'Создать и продолжить');
  }
});
