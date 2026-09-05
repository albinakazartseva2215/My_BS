// Состояние визарда записи (Booking · 1–…), общее для нескольких страниц.
//
// В черновом фронте (frontend/) этого шага между экранами не было вообще —
// там состояние передавалось через query-параметры URL прямо в ссылке
// (frontend/public/booking.html читает ?masterId=&serviceIds=&startDatetime=
// из window.location.search). Здесь так не получится: у визарда записи
// несколько шагов подряд (Booking · 1 → 2 → 3 → 4 → 5), на каждом можно
// вернуться назад и поменять выбор, и часть данных (выбранные услуги)
// нужна не только на соседнем шаге, а до самого конца сценария — тащить
// всё это цепочкой query-параметров через шесть страниц (as an alternative
// to a real store) быстро стало бы менее читаемым, чем один общий файл.
//
// Единственное отдельное место, которое ходит в sessionStorage — как
// js/api.js остаётся единственным местом, которое ходит в сеть
// (docs/frontend-rules.md, правило 3). Страницы вызывают только функции
// отсюда, ни одна не читает sessionStorage напрямую.
//
// sessionStorage, а не localStorage: запись — процесс одной вкладки за
// один присест, а не что-то, что должно пережить закрытие браузера и
// всплыть неделю спустя (и тем более не должно тихо утекать в новую,
// не связанную сессию той же вкладки). Кука сессии входа (js/api.js) здесь
// ни при чём — это состояние шагов ДО входа, доступное анонимно.

const STORAGE_KEY = 'tone:booking-flow:v1';

function readState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Приватный режим/отключённый sessionStorage/битый JSON — ведём себя
    // так, как будто выбора ещё не было, а не падаем всей страницей.
    return {};
  }
}

function writeState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // См. readState — если сохранить не получилось, шаг просто не
    // запомнится между страницами; сама страница должна остаться рабочей.
  }
}

// ---- Услуги (Booking · 1) ----

export function getSelectedServiceIds() {
  const state = readState();
  return Array.isArray(state.serviceIds) ? state.serviceIds : [];
}

export function setSelectedServiceIds(serviceIds) {
  const state = readState();
  state.serviceIds = [...serviceIds];
  // Смена набора услуг могла сделать ранее выбранного мастера неподходящим
  // (он мог не выполнять новую услугу) — не тащим устаревший выбор дальше
  // молча, пусть Booking · 2 попросит выбрать мастера заново. Выбранный
  // слот тем более не может пережить смену услуг — длительность визита
  // изменилась, старое время могло перестать помещаться. Удержание
  // (см. ниже) точно так же держит СТАРОЕ время — тоже не переживает.
  delete state.master;
  delete state.slot;
  delete state.hold;
  writeState(state);
}

// ---- Мастер (Booking · 2) ----
// choice — { type: 'any' } (любой свободный) либо { type: 'master', id }.

export function getSelectedMaster() {
  const state = readState();
  return state.master && typeof state.master === 'object' ? state.master : null;
}

export function setSelectedMaster(choice) {
  const state = readState();
  state.master = choice;
  // Смена мастера обнуляет ранее выбранный слот — он был на календаре
  // ДРУГОГО мастера. Booking · 3 сам вызывает эту функцию ровно один раз —
  // когда разрешает "любой свободный" в конкретного мастера (см. там же),
  // и делает это ДО того, как слот вообще выбран, так что на практике
  // здесь нечего терять; но обнулять на любую смену мастера правильно
  // независимо от того, кто вызвал.
  delete state.slot;
  delete state.hold;
  writeState(state);
}

// ---- Слот времени (Booking · 3) ----
// slot — { masterId, startUtc, endUtc, startLocal, endLocal } (ISO-строки,
// как их отдаёт GET /api/masters/:id/availability). masterId хранится
// вместе со слотом (а не только отдельно в state.master), чтобы Booking · 4
// могло проверить, что слот и текущий выбор мастера друг другу не
// противоречат, одним сравнением, без похода в API.

export function getSelectedSlot() {
  const state = readState();
  return state.slot && typeof state.slot === 'object' ? state.slot : null;
}

export function setSelectedSlot(slot) {
  const state = readState();
  const prev = state.slot;
  state.slot = slot;
  // Новый слот — старое удержание не про него: если оно ещё активно,
  // Booking · 4 должен создать новое, а не показывать таймер чужого
  // времени. Сравниваем по startUtc, а не просто "сбрасываем всегда", —
  // выбор того же самого времени повторно (например, вернулись назад и
  // ничего не поменяли) не должен зря пересоздавать удержание.
  if (!(prev && slot && prev.startUtc === slot.startUtc && prev.masterId === slot.masterId)) {
    delete state.hold;
  }
  writeState(state);
}

// ---- Удержание слота (Booking · 4) ----
// hold — { holdToken, holdExpiresAt, masterId, startUtc } (holdExpiresAt —
// ISO-строка из ответа POST /api/holds). masterId/startUtc хранятся вместе
// с токеном, чтобы при возврате на экран можно было проверить, что
// удержание всё ещё про ТЕКУЩИЙ слот, одним сравнением, без похода в API
// (см. js/booking-4.js).

export function getHold() {
  const state = readState();
  return state.hold && typeof state.hold === 'object' ? state.hold : null;
}

export function setHold(hold) {
  const state = readState();
  state.hold = hold;
  writeState(state);
}

export function clearHold() {
  const state = readState();
  delete state.hold;
  writeState(state);
}

// ---- Последняя оформленная запись (Booking · 5 · Успех) ----
// Кладётся сюда сразу из ответа POST /api/appointments — отдельного GET
// экрану успеха не нужно (docs/ui-map.md, раздел 7: "карточка — это тот же
// объект appointmentView, который вернул POST /api/appointments").

export function setLastAppointment(appointmentView) {
  const state = readState();
  state.lastAppointment = appointmentView;
  writeState(state);
}

export function getLastAppointment() {
  const state = readState();
  return state.lastAppointment && typeof state.lastAppointment === 'object' ? state.lastAppointment : null;
}

// ---- Сброс сценария (пригодится на "Записаться ещё раз" и подобных) ----

export function clearBookingFlow() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // см. readState/writeState
  }
}
