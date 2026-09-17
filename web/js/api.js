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

// Вход через Яндекс в один клик — НЕ функция здесь: это переход браузера
// на GET /api/auth/yandex/start (routes.js: YANDEX_LOGIN_START_URL), не
// fetch-вызов, иначе Яндекс не смог бы показать пользователю свою
// страницу согласия. См. js/login.js/js/register.js — кнопка ведёт туда
// напрямую через window.location.href.

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

// reason — необязательный (docs/db-schema.md, 3.11г: "кто и почему
// отменил"). Клиентский экран отмены его не передаёт (undefined — тело
// запроса просто без поля reason, сервер трактует это как "без причины");
// админ-панель («Записи») передаёт текст из формы отмены.
export async function cancelAppointmentById(id, reason) {
  const body = reason !== undefined ? { reason } : undefined;
  return apiFetch(`/appointments/${id}/cancel`, { method: 'POST', body });
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

// ---- Админ: услуги и мастера (server/src/routes/admin.routes.js) ----
//
// Все запросы ниже требуют роль admin — сервер уже проверяет её сам
// (requireRole в каждом маршруте), здесь никакой отдельной проверки нет и
// не должно быть (docs/frontend-rules.md, правило 3: страницы не решают,
// можно им ходить в API или нет, — решает сервер, ответом 401/403).

// Услуги — в отличие от fetchServices() выше (публичный каталог, только
// активные), возвращает ВСЕ услуги, включая отключённые: админ должен
// видеть их с пометкой, а не как будто их не существует.
export async function fetchAdminServices() {
  const data = await apiFetch('/admin/services');
  return data.services;
}

// Категории нужны, чтобы заполнить список выбора в форме услуги. Полного
// экрана управления категориями (переименование/сортировка) пока нет
// (отдельный будущий экран, docs/ui-map.md, раздел 11 «Категории услуг»),
// но создание — есть, см. createAdminCategory ниже: без него на чистой
// базе (без npm run seed, как на проде) список пуст и услугу вообще не
// из чего создать (categoryId обязателен).
export async function fetchAdminCategories() {
  const data = await apiFetch('/admin/service-categories');
  return data.categories;
}

export async function createAdminCategory(fields) {
  return apiFetch('/admin/service-categories', { method: 'POST', body: fields });
}

export async function createAdminService(fields) {
  return apiFetch('/admin/services', { method: 'POST', body: fields });
}

export async function updateAdminService(id, fields) {
  return apiFetch(`/admin/services/${id}`, { method: 'PATCH', body: fields });
}

// Решение "удалить физически или отключить и объяснить почему" принимает
// сервер (задание: "решение должен принимать сервер") — ответ содержит
// { outcome: 'deleted' } либо { outcome: 'disabled', message, service }.
export async function deleteAdminService(id) {
  return apiFetch(`/admin/services/${id}`, { method: 'DELETE' });
}

// Мастера — тем же принципом, что и услуги: все, включая отключённых.
// Ответ уже включает serviceIds на каждого мастера (admin.routes.js,
// GET /api/admin/masters) — для чекбоксов "какие услуги выполняет"
// отдельный запрос карточки мастера не нужен. Недельный график в этот
// ответ не входит (см. fetchAdminMaster ниже).
export async function fetchAdminMasters() {
  const data = await apiFetch('/admin/masters');
  return data.masters;
}

// Карточка одного мастера — единственное, чего нет в fetchAdminMasters():
// недельный график (weeklySchedule) и исключения (scheduleExceptions).
// Нужна только чтобы открыть редактор графика работы (без него мастер —
// без единой строки в master_weekly_schedule — выглядит выходным каждый
// день: domain/availability.js трактует отсутствие строки на weekday как
// day_off, свободных слотов при этом нет вообще ни на одну дату).
export async function fetchAdminMaster(id) {
  return apiFetch(`/admin/masters/${id}`);
}

export async function createAdminMaster(fields) {
  return apiFetch('/admin/masters', { method: 'POST', body: fields });
}

export async function updateAdminMaster(id, fields) {
  return apiFetch(`/admin/masters/${id}`, { method: 'PATCH', body: fields });
}

export async function deleteAdminMaster(id) {
  return apiFetch(`/admin/masters/${id}`, { method: 'DELETE' });
}

// Полная замена набора услуг мастера (не частичные add/remove) — ровно так
// же, как уже сделано на сервере (PUT, не PATCH).
export async function replaceAdminMasterServices(id, serviceIds) {
  return apiFetch(`/admin/masters/${id}/services`, { method: 'PUT', body: { serviceIds } });
}

// Полная замена недельного графика мастера — тем же принципом (PUT, не
// PATCH), что и услуги выше. schedule — массив { weekday (1..7), startTime,
// endTime } только по рабочим дням; выходной день — просто отсутствие
// записи на этот weekday, отдельного isDayOff здесь нет (сервер именно
// так и хранит, server/src/routes/admin.routes.js).
export async function replaceAdminMasterSchedule(id, schedule) {
  return apiFetch(`/admin/masters/${id}/schedule`, { method: 'PUT', body: { schedule } });
}

// ---- Админ: записи, перенос с указанием мастера, перенос/блокировка
// времени (server/src/routes/admin.routes.js, server/src/routes/
// appointments.routes.js) — раздел «Записи» ----

// Нужен только часовой пояс салона — переводить локальный ввод времени
// (перенос, создание записи, «перерыв») в UTC перед отправкой на сервер
// (web/js/dates.js:localDateTimeToUtcIso). Один запрос на загрузку
// страницы, не на каждую форму.
export async function fetchAdminSalonProfile() {
  return apiFetch('/admin/salon-profile');
}

// from/to — YYYY-MM-DD, только чтобы не тащить с сервера вообще всю
// историю записей; точный отбор "записи именно на этот локальный день
// салона" — на странице, по уже готовому startLocal (см. комментарий в
// web/js/admin-appointments.js: буквальное сравнение from/to как UTC-дат
// здесь не подходит — сутки салона и UTC не совпадают, admin.routes.js
// этого не делает).
export async function fetchAdminAppointments({ from, to, masterId } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (masterId) qs.set('masterId', String(masterId));
  const data = await apiFetch('/admin/appointments' + (qs.toString() ? `?${qs}` : ''));
  return data.appointments;
}

// Ручное бронирование администратором, включая поверх занятого времени —
// overlapOverride передаётся только вторым, подтверждённым вызовом (см.
// wireCreateForm в admin-appointments.js): сначала всегда пробуем без
// него, чтобы обычная проверка занятости сработала и её увидел сервер.
export async function createAdminAppointment(fields) {
  return apiFetch('/admin/appointments', { method: 'POST', body: fields });
}

export async function completeAdminAppointment(id) {
  return apiFetch(`/admin/appointments/${id}/complete`, { method: 'POST' });
}

// Перенос с правом сменить мастера — только у администратора (сервер и
// так проверяет это отдельно, routes/appointments.routes.js); отдельная
// функция от rescheduleAppointmentById выше, а не общий параметр, чтобы
// клиентские экраны (booking-3.js) не могли даже случайно передать
// masterId — там для этого нет ни поля формы, ни вызова этой функции.
export async function rescheduleAdminAppointmentById(id, { startDatetime, masterId }) {
  const body = { startDatetime };
  if (masterId !== undefined) body.masterId = masterId;
  return apiFetch(`/appointments/${id}/reschedule`, { method: 'PATCH', body });
}

// Блокировка времени мастера — «перерыв» (docs/db-schema.md, 3.10,
// time_blocks): произвольный диапазон внутри дня, не обязательно весь день.
export async function createAdminTimeBlock(masterId, { startDatetime, endDatetime, reason }) {
  return apiFetch(`/admin/masters/${masterId}/time-blocks`, {
    method: 'POST',
    body: { startDatetime, endDatetime, reason },
  });
}

// «Выходной» и «отпуск» — оба через schedule_exceptions (docs/db-schema.md,
// 3.9): отпуск на странице оформляется как несколько дневных исключений
// подряд (по одному вызову на дату — см. web/js/admin-appointments.js),
// а не один многодневный time_block, чтобы каждый день отпуска остался
// независимо виден/снимаем в карточке графика мастера.
export async function createAdminScheduleException(masterId, { date, isDayOff, startTime, endTime, reason }) {
  const body = { date, isDayOff };
  if (!isDayOff) {
    body.startTime = startTime;
    body.endTime = endTime;
  }
  if (reason) body.reason = reason;
  return apiFetch(`/admin/masters/${masterId}/schedule-exceptions`, { method: 'POST', body });
}

// ---- Уведомления (server/src/routes/notifications.routes.js) ----
//
// Список и счётчик непрочитанных — один и тот же ответ (docs/db-schema.md,
// раздел 8): страница уведомлений использует notifications[], шапка
// (js/header.js) — только unreadCount из того же вызова, второго эндпоинта
// ради одного числа нет и не должно быть.
export async function fetchNotifications() {
  return apiFetch('/notifications');
}

export async function markNotificationRead(id) {
  return apiFetch(`/notifications/${id}/read`, { method: 'POST' });
}
