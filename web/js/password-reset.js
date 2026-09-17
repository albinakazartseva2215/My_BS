// Логика экрана восстановления пароля — двухшаговая форма по описанию из
// docs/ui-map.md (пробел Б.6: "шаг 1 — ввод e-mail, шаг 2 — ввод токена и
// нового пароля"), экрана-образца в прототипе для неё нет. Все обращения
// к серверу — только через js/api.js (docs/frontend-rules.md, правило 3).

import { requestPasswordReset, confirmPasswordReset, ApiRequestError } from './api.js';
import { initHeader } from './header.js';
import {
  validateEmail,
  validateRequired,
  validatePassword,
  runClientValidation,
  showServerError,
  hideAlert,
  wirePasswordToggle,
  setSubmitting,
} from './forms.js';

const requestForm = document.getElementById('requestForm');
const requestAlert = document.getElementById('requestAlert');
const requestSuccessAlert = document.getElementById('requestSuccessAlert');
const requestNoteAlert = document.getElementById('requestNoteAlert');
const requestSubmit = document.getElementById('requestSubmit');

const confirmStep = document.getElementById('confirmStep');
const confirmForm = document.getElementById('confirmForm');
const confirmAlert = document.getElementById('confirmAlert');
const confirmSubmit = document.getElementById('confirmSubmit');

initHeader();
wirePasswordToggle(document.getElementById('confirmPasswordToggle'), document.getElementById('confirmNewPassword'));

function showConfirmStep() {
  confirmStep.hidden = false;
  confirmStep.scrollIntoView({ block: 'nearest' });
}

document.getElementById('revealConfirmStep').addEventListener('click', (event) => {
  event.preventDefault();
  showConfirmStep();
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(requestAlert);
  hideAlert(requestSuccessAlert);
  hideAlert(requestNoteAlert);

  const clientOk = runClientValidation(requestForm, { email: validateEmail });
  if (!clientOk) return;

  const email = requestForm.elements.namedItem('email').value.trim();

  setSubmitting(requestSubmit, true, 'Отправить код');
  try {
    // Ответ одинаковый независимо от того, зарегистрирован ли e-mail —
    // сервер намеренно не подтверждает и не опровергает это через текст
    // (server/src/domain/passwordReset.js). Показываем его как есть.
    const result = await requestPasswordReset(email);
    requestSuccessAlert.textContent = result.message;
    requestSuccessAlert.hidden = false;

    // Аккаунт без пароля (вход только через Яндекс, server/src/domain/
    // yandexAuth.js) — сбрасывать нечего, шаг 2 (код + новый пароль) для
    // него не имеет смысла, поэтому форму не открываем. Единственный
    // случай, где этот экран прямо разветвляется по ответу сервера — во
    // всех остальных сообщение просто показывается текстом (см. комментарий
    // выше про то, что ответ намеренно одинаковый).
    if (result.oauthOnly) return;

    // resetToken в ответе — только в деве (server/src/routes/auth.routes.js,
    // env.isProduction): в проде без email-канала его в ответе не будет
    // вовсе, и это ожидаемо — доставить код будет нечем, пока такого
    // канала нет. Здесь просто показываем то, что реально прислал сервер,
    // ничего не подставляем сами.
    if (result.resetToken) {
      requestNoteAlert.textContent = `Только для теста (в проде код придёт по e-mail): ${result.resetToken}. Действует до ${new Date(result.expiresAt).toLocaleString('ru-RU')}.`;
      requestNoteAlert.hidden = false;
      confirmForm.elements.namedItem('token').value = result.resetToken;
    }
    confirmForm.elements.namedItem('email').value = email;
    showConfirmStep();
  } catch (err) {
    if (err instanceof ApiRequestError) {
      showServerError(requestForm, requestAlert, err);
    } else {
      throw err;
    }
  } finally {
    setSubmitting(requestSubmit, false, 'Отправить код');
  }
});

confirmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(confirmAlert);

  const clientOk = runClientValidation(confirmForm, {
    email: validateEmail,
    token: validateRequired,
    newPassword: validatePassword,
  });
  if (!clientOk) return;

  const email = confirmForm.elements.namedItem('email').value.trim();
  const token = confirmForm.elements.namedItem('token').value.trim();
  const newPassword = confirmForm.elements.namedItem('newPassword').value;

  setSubmitting(confirmSubmit, true, 'Установить новый пароль');
  try {
    const result = await confirmPasswordReset({ email, token, newPassword });
    // Смены пароля недостаточно, чтобы куда-то вести автоматически —
    // сессию это не открывает (confirm ничего не логинит), поэтому просто
    // показываем текст сервера и явную ссылку на вход.
    confirmForm.replaceChildren();
    const success = document.createElement('div');
    success.className = 'form-alert is-success';
    success.setAttribute('role', 'status');
    success.textContent = result.message;
    confirmForm.before(success);
    const loginLink = document.createElement('a');
    loginLink.href = 'login.html';
    loginLink.className = 'btn btn-primary btn-block';
    loginLink.textContent = 'Войти с новым паролем';
    confirmForm.replaceWith(loginLink);
  } catch (err) {
    if (err instanceof ApiRequestError) {
      showServerError(confirmForm, confirmAlert, err);
    } else {
      throw err;
    }
  } finally {
    setSubmitting(confirmSubmit, false, 'Установить новый пароль');
  }
});
