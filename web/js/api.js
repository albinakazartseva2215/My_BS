// Тонкая обёртка над fetch — единственное место в web/, где страницы
// обращаются к серверу (docs/frontend-rules.md, правило 3). Внутри самих
// страниц/страничных скриптов запросов быть не должно — только вызовы
// функций отсюда.
//
// Здесь же — единственный источник строкового текста ошибки для показа
// клиенту (docs/frontend-rules.md, правило 7: ошибку API показываем на
// экране, а не только в консоли).

export class ApiRequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (networkErr) {
    console.error('[api] сеть недоступна:', networkErr);
    throw new ApiRequestError(
      0,
      'network_error',
      'Не удалось связаться с сервером. Проверьте, что бэкенд (server/) и web/server.js запущены.',
    );
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // не-JSON ответ — покажем как есть ниже
    }
  }

  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiRequestError(
      res.status,
      err.code || 'unknown_error',
      err.message || text || `Ошибка запроса, HTTP ${res.status}`,
      err.details,
    );
  }

  return data;
}

// Форматирует ошибку API текстом, готовым к показу на странице.
export function describeError(err) {
  if (!(err instanceof ApiRequestError)) {
    return err && err.message ? err.message : String(err);
  }
  if (err.status === 0) return err.message;
  return `${err.message} (HTTP ${err.status}, ${err.code})`;
}

// ---- Публичный каталог (server/src/routes/catalog.routes.js) ----

export async function fetchServices() {
  const data = await apiFetch('/services');
  return data.services;
}

export async function fetchMasters() {
  const data = await apiFetch('/masters');
  return data.masters;
}

// ---- Аутентификация (server/src/routes/auth.routes.js) ----
//
// Сессию сервер выдаёт сам — Set-Cookie с httpOnly-кукой на login/register
// (docs/frontend-rules.md ничего не пишет про это отдельно, но задание
// прямо требует: "сессию не трогаем", "токен в память браузера не
// сохраняем"). Поэтому здесь нет ни чтения document.cookie, ни
// localStorage/sessionStorage — только credentials:'same-origin' в
// apiFetch, чтобы браузер сам отправлял и принимал куку. Ответы этих
// функций отдают { user, holdAttached } — токена в теле ответа нет вообще,
// сохранять нечего.

export async function login({ email, password }) {
  return apiFetch('/auth/login', { method: 'POST', body: { email, password } });
}

export async function register({ name, email, phone, password, termsAccepted }) {
  return apiFetch('/auth/register', { method: 'POST', body: { name, email, phone, password, termsAccepted } });
}

export async function logout() {
  return apiFetch('/auth/logout', { method: 'POST' });
}

export async function fetchMe() {
  const data = await apiFetch('/auth/me');
  return data.user;
}

export async function requestPasswordReset(email) {
  return apiFetch('/auth/password-reset/request', { method: 'POST', body: { email } });
}

export async function confirmPasswordReset({ email, token, newPassword }) {
  return apiFetch('/auth/password-reset/confirm', { method: 'POST', body: { email, token, newPassword } });
}

// ---- Записи клиента (server/src/routes/appointments.routes.js) ----
// Используется только для минимальной заглушки личного кабинета —
// список записей текущего клиента (полноценный личный кабинет с
// переносом/отменой — отдельный экран, ещё не свёрстан).
export async function fetchAppointments() {
  const data = await apiFetch('/appointments');
  return data.appointments;
}
