// Логика экрана входа. Все обращения к серверу — только через js/api.js
// (docs/frontend-rules.md, правило 3).

import { login, ApiRequestError } from './api.js';
import { ACCOUNT_URL, ADMIN_APPOINTMENTS_URL, YANDEX_LOGIN_START_URL } from './routes.js';
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
const yandexBtn = document.getElementById('yandexLoginBtn');

initHeader();
wirePasswordToggle(document.getElementById('loginPasswordToggle'), document.getElementById('loginPassword'));

// "Войти через Яндекс" — обычный переход, не запрос через api.js: только
// так браузер реально покажет пользователю страницу согласия Яндекса
// (server/src/routes/auth.routes.js, GET /api/auth/yandex/start сам
// редиректит дальше на oauth.yandex.ru).
yandexBtn.addEventListener('click', () => {
  window.location.href = YANDEX_LOGIN_START_URL;
});

// Сюда возвращает GET /api/auth/yandex/callback, если вход через Яндекс не
// завершился — человек нажал «Отмена» на экране согласия Яндекса
// (yandexError=denied) либо сам обмен кода на токен/профиль не удался
// (yandexError=failed, server/src/domain/yandexAuth.js). Без этого
// пользователь просто оказывался бы на пустом экране без объяснения — тот
// самый эффект, который и просили убрать.
const returnedFromYandex = new URLSearchParams(window.location.search).get('yandexError');
if (returnedFromYandex) {
  alertEl.textContent =
    returnedFromYandex === 'denied'
      ? 'Вход через Яндекс не завершён — вы отменили подтверждение. Попробуйте ещё раз или войдите по паролю.'
      : 'Не удалось войти через Яндекс. Попробуйте ещё раз или войдите по паролю.';
  alertEl.hidden = false;
  // Снимаем параметр из адресной строки — иначе обновление страницы
  // показывало бы то же сообщение повторно, хотя ничего не произошло.
  window.history.replaceState({}, '', window.location.pathname);
}

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
