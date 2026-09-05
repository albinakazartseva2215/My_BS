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

// serviceIds — необязательный фильтр (Booking · 2): сервер сам отдаёт
// только тех мастеров, которые выполняют ВЕСЬ переданный набор услуг
// (catalog.routes.js, пересечение master_services). Без аргумента —
// прежнее поведение (все активные мастера), как уже использует лендинг.
export async function fetchMasters(serviceIds) {
  const qs = serviceIds && serviceIds.length ? `?serviceIds=${serviceIds.join(',')}` : '';
  const data = await apiFetch('/masters' + qs);
  return data.masters;
}

// ---- Свободное время (server/src/routes/availability.routes.js) ----
//
// Booking · 3: один день одного мастера за вызов — сама страница решает,
// на сколько дней/месяцев вперёд и для скольких мастеров это вызывать
// (docs/ui-map.md, пробел А.3 — калькарь строится множеством вызовов
// этой же ручки, отдельного агрегирующего эндпоинта нет).
//
// Возвращает тело ответа целиком: `slots` — только свободные старты (как
// раньше), `allSlots` — те же кандидаты старта, но все, с status
// free/busy/past (нужно, чтобы показать занятое время в сетке видимым и
// неактивным, а не молча спрятанным — задание; см. комментарий у
// computeAvailableSlots в server/src/domain/availability.js), `reason` —
// почему слотов нет целиком (day_off/fully_booked/past_date/beyond_horizon).
export async function fetchAvailability({ masterId, date, serviceIds }) {
  return apiFetch(`/masters/${masterId}/availability?date=${date}&serviceIds=${serviceIds.join(',')}`);
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

// holdToken — необязательный (Booking · 4 визарда записи): сервер сам
// привяжет анонимное удержание слота к вошедшему клиенту (attachClientToHold).
// login.html/register.html (самостоятельные экраны входа вне визарда) его
// не передают — поведение для них не меняется.
export async function login({ email, password, holdToken }) {
  const body = { email, password };
  if (holdToken) body.holdToken = holdToken;
  return apiFetch('/auth/login', { method: 'POST', body });
}

export async function register({ name, email, phone, password, termsAccepted, holdToken }) {
  const body = { name, email, phone, password, termsAccepted };
  if (holdToken) body.holdToken = holdToken;
  return apiFetch('/auth/register', { method: 'POST', body });
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
export async function fetchAppointments() {
  const data = await apiFetch('/appointments');
  return data.appointments;
}

// Детали одной записи — экран "Личный кабинет · детали" и режим переноса
// на Booking · 3 (там нужны мастер/услуги уже оформленной записи).
export async function fetchAppointment(id) {
  return apiFetch(`/appointments/${id}`);
}

export async function cancelAppointmentById(id) {
  return apiFetch(`/appointments/${id}/cancel`, { method: 'POST' });
}

// masterId сюда намеренно не передаём — сервер и так разрешает менять
// мастера при переносе только администратору (см. комментарий в
// server/src/routes/appointments.routes.js), клиентский перенос — только
// новое время у того же мастера.
export async function rescheduleAppointmentById(id, startDatetime) {
  return apiFetch(`/appointments/${id}/reschedule`, { method: 'PATCH', body: { startDatetime } });
}

// ---- Удержание слота (server/src/routes/holds.routes.js) — Booking · 4 ----
// Анонимно: клиент на этом экране может быть ещё не вошёл (форма входа —
// часть того же экрана, см. js/booking-4.js). Конфликт по времени (кто-то
// успел занять слот) сервер отдаёт как 409 — ApiRequestError.details.nearbySlots.
export async function createHold({ masterId, startDatetime, serviceIds }) {
  return apiFetch('/holds', { method: 'POST', body: { masterId, startDatetime, serviceIds } });
}

// Явный отказ от удержания — используется, когда клиент выбрал другое
// время/мастера, пока прошлое удержание ещё не истекло само, чтобы не
// держать слот занятым до конца таймера впустую.
export async function releaseHold(holdToken) {
  return apiFetch(`/holds/${encodeURIComponent(holdToken)}`, { method: 'DELETE' });
}

// Подтверждение удержания в настоящую запись — требует входа (requireAuth
// на сервере); holdToken тот же, что вернул createHold. comment/remindEnabled —
// поля с самого экрана подтверждения.
export async function confirmAppointment({ holdToken, comment, remindEnabled }) {
  return apiFetch('/appointments', { method: 'POST', body: { holdToken, comment, remindEnabled } });
}
