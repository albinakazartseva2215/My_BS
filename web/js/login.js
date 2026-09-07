// Логика экрана входа. Все обращения к серверу — только через js/api.js
// (docs/frontend-rules.md, правило 3).

import { login, ApiRequestError } from './api.js';
import { ACCOUNT_URL, ADMIN_APPOINTMENTS_URL } from './routes.js';
import { initHeader } from './header.js';
import {
  validateEmail,
  validatePassword,
  runClientValidation,
  showServerError,
  hideAlert,
  wirePasswordToggle,
  setSubmitting,
} from './forms.js';

const form = document.getElementById('loginForm');
const alertEl = document.getElementById('formAlert');
const submitBtn = document.getElementById('loginSubmit');

initHeader();
wirePasswordToggle(document.getElementById('loginPasswordToggle'), document.getElementById('loginPassword'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(alertEl);

  // Проверка на клиенте — только для удобства (не даёт слать заведомо
  // пустую/некорректную форму); финальное решение и его текст — всегда
  // от сервера, см. catch ниже.
  const clientOk = runClientValidation(form, {
    email: validateEmail,
    password: validatePassword,
  });
  if (!clientOk) return;

  const email = form.elements.namedItem('email').value.trim();
  const password = form.elements.namedItem('password').value;

  setSubmitting(submitBtn, true, 'Войти');
  try {
    // Ответ содержит только { user, holdAttached } — куда сессия и
    // ставится, решает сервер сам через Set-Cookie (см. api.js). Токен
    // здесь нигде не сохраняется — ни в переменной, ни в localStorage.
    const { user } = await login({ email, password });
    // Форма входа одна на всех (задание: "вторую форму входа не создавай") —
    // куда вести, решаем уже здесь, по ролям из ответа сервера (user.roles —
    // список, см. server/src/db/repositories/users.js:toPublicUser). Роль
    // проверяем через includes, а не равенством — у пользователя может быть
    // несколько ролей одновременно (тем же способом, что и на сервере,
    // server/src/middleware/auth.js:requireRole).
    window.location.href = user.roles.includes('admin') ? ADMIN_APPOINTMENTS_URL : ACCOUNT_URL;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      showServerError(form, alertEl, err);
    } else {
      throw err;
    }
  } finally {
    setSubmitting(submitBtn, false, 'Войти');
  }
});
