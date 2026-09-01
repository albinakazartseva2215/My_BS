// Логика лендинга: подтягивает услуги и мастеров из API (правило задания
// «список услуг и мастеров — из API, а не руками в разметке»), плюс
// декоративные куски, унаследованные из прототипа (демо-слоты, FAQ,
// мобильное меню, плавный скролл шапки).
//
// Все обращения к серверу — только через js/api.js (docs/frontend-rules.md,
// правило 3); здесь их напрямую нет.

import { fetchServices, fetchMasters, describeError } from './api.js';
import { BOOKING_START_URL } from './routes.js';
import { formatDuration, formatPriceRub } from './format.js';
import { closeMobileNav } from './nav.js';
import { initHeader } from './header.js';

// ---- Иконки услуг ----
// Иконки — чисто декоративные, взяты из прототипа один в один и привязаны
// к названию услуги. Для услуги, которой нет в этом списке (например,
// новую добавят через админку), используется общий кружок — это не
// подмена данных API, а просто дефолтная картинка для карточки.
const SERVICE_ICONS = {
  'Стрижка': '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><line x1="8" y1="8" x2="20" y2="18"/><line x1="8" y1="16" x2="20" y2="6"/>',
  'Окрашивание': '<rect x="3" y="5" width="18" height="16" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  'Уход и маски': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke-linejoin="round"/>',
  'Укладка': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="16" y2="14"/>',
  'Мытьё и стайлинг': '<path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z"/>',
};
const SERVICE_ICON_FALLBACK = '<circle cx="12" cy="12" r="9"/>';

function serviceIconSvg(name) {
  const inner = SERVICE_ICONS[name] || SERVICE_ICON_FALLBACK;
  return `<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;
}

// Цена услуги в каталоге — со словом "от" (справочная, консультация
// мастера может её изменить, см. текст под сеткой услуг); formatPriceRub
// сам по себе (без "от") — в js/format.js, используется ещё в account.js
// для точной суммы уже оформленной записи.
function formatServicePrice(priceRub) {
  return `от ${formatPriceRub(priceRub)}`;
}

// ---- Заглушки на время загрузки ----

function renderSkeletonCards(container, count, heightPx) {
  container.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement('div');
    card.className = container.id === 'mastersGrid' ? 'master-card' : 'service-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = `<div class="skeleton-line" style="height:${heightPx}px;border-radius:var(--radius-md)"></div>`;
    container.appendChild(card);
  }
}

function renderApiError(container, err, onRetry) {
  const box = document.createElement('div');
  box.className = 'api-error';
  box.textContent = describeError(err);
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-outline';
  retryBtn.textContent = 'Повторить';
  retryBtn.addEventListener('click', onRetry);
  box.appendChild(document.createElement('br'));
  box.appendChild(retryBtn);
  container.innerHTML = '';
  container.appendChild(box);
}

// ---- Услуги (GET /api/services) ----

function renderServiceCard(service) {
  const card = document.createElement('div');
  card.className = 'service-card';
  card.innerHTML = `
    ${serviceIconSvg(service.name)}
    <div class="service-head">
      <div class="service-name">${escapeHtml(service.name)}</div>
      <div class="service-price">${formatServicePrice(service.priceRub)}</div>
    </div>
    <div class="service-description">${escapeHtml(service.description || '')}</div>
    <div class="service-duration">${formatDuration(service.durationMinutes)}</div>
    <a href="${BOOKING_START_URL}" class="btn btn-primary btn-block">Записаться</a>
  `;
  return card;
}

async function loadServices() {
  const grid = document.getElementById('servicesGrid');
  renderSkeletonCards(grid, 5, 180);
  try {
    const services = await fetchServices();
    grid.innerHTML = '';
    if (services.length === 0) {
      grid.innerHTML = '<div class="api-error">Пока нет доступных услуг.</div>';
      return;
    }
    for (const service of services) {
      grid.appendChild(renderServiceCard(service));
    }
  } catch (err) {
    renderApiError(grid, err, loadServices);
  }
}

// ---- Мастера (GET /api/masters) ----

// Строка "ближайшее окно" — декоративная витрина, как и было в прототипе,
// а не реальные данные: GET /api/masters их не отдаёт (docs/ui-map.md,
// пробел А.1). Решение по этому пробелу уже принято в доках — оставить
// как контент страницы, а не подтягивать отдельными запросами
// availability по каждому мастеру. Три варианта текста — те же, что были
// у трёх карточек в прототипе, назначаются по порядку карточек.
const DECORATIVE_NEXT_SLOTS = ['Ближайшее время: сегодня, 15:30', 'Ближайшее время: завтра, 10:00', 'Ближайшее время: сегодня, 18:00'];

function renderMasterCard(master, index) {
  const card = document.createElement('div');
  card.className = 'master-card';
  const photo = master.photoUrl
    ? `<img class="master-photo" src="${escapeHtml(master.photoUrl)}" alt="${escapeHtml(master.name)}">`
    : `<div class="master-photo photo-placeholder" aria-hidden="true">фото</div>`;
  card.innerHTML = `
    ${photo}
    <div class="master-name">${escapeHtml(master.name)}</div>
    <div class="master-specialization">${escapeHtml(master.specialization || '')}</div>
    <div class="master-rating">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12,3 14.7,9 21,9.5 16.2,13.7 17.6,20 12,16.6 6.4,20 7.8,13.7 3,9.5 9.3,9"/></svg>
      <span class="master-rating-value">${master.ratingAvg.toFixed(1)}</span>
      <span class="master-rating-count">(${master.reviewsCount})</span>
    </div>
    <div class="master-next-slot">${DECORATIVE_NEXT_SLOTS[index % DECORATIVE_NEXT_SLOTS.length]}</div>
    <a href="${BOOKING_START_URL}" class="btn btn-primary btn-block">Записаться</a>
  `;
  return card;
}

async function loadMasters() {
  const grid = document.getElementById('mastersGrid');
  renderSkeletonCards(grid, 3, 260);
  try {
    const masters = await fetchMasters();
    grid.innerHTML = '';
    if (masters.length === 0) {
      grid.innerHTML = '<div class="api-error">Пока нет доступных мастеров.</div>';
      updateTrustStrip(masters);
      return;
    }
    // Лендинг показывает витрину из первых мастеров списка — API не
    // возвращает никакого рейтинга "топ", поэтому выбран порядок ответа
    // как есть, без придуманной сортировки.
    masters.slice(0, 3).forEach((master, index) => {
      grid.appendChild(renderMasterCard(master, index));
    });
    updateTrustStrip(masters);
  } catch (err) {
    renderApiError(grid, err, loadMasters);
    document.getElementById('trustRating').textContent = '—';
    document.getElementById('trustMastersCount').textContent = '—';
  }
}

// ---- Trust strip: рейтинг и число мастеров — из того же ответа
// GET /api/masters, что уже пришёл для карточек, без отдельного запроса.
// "2 400+ Записей оформлено" и "Мгновенно" здесь не трогаю — для числа
// оформленных записей нет публичного эндпоинта (см. docs/ui-map.md и
// комментарий в index.html), а "Мгновенно" вообще не про данные.
function updateTrustStrip(masters) {
  document.getElementById('trustMastersCount').textContent = String(masters.length);

  const rated = masters.filter((m) => typeof m.ratingAvg === 'number');
  const ratingEl = document.getElementById('trustRating');
  if (rated.length === 0) {
    ratingEl.textContent = '—';
    return;
  }
  const avg = rated.reduce((sum, m) => sum + m.ratingAvg, 0) / rated.length;
  ratingEl.textContent = `${avg.toFixed(1)} ★`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Ссылки "Записаться" на карточках — по карте экранов (js/routes.js) ----
// "Войти"/аватар в шапке теперь не забота лендинга — их рисует и решает
// сама шапка, см. js/header.js.

function wireNavigationLinks() {
  document.querySelectorAll('.js-booking-link').forEach((el) => {
    el.setAttribute('href', BOOKING_START_URL);
  });
}

// ---- Плавный скролл шапки к своим блокам ----
// Обычный переход по #якорю сработал бы и без JS, но упёрся бы в верхний
// край секции ровно под sticky-шапкой — компенсируем её высоту.
function wireSmoothScroll() {
  const header = document.querySelector('.site-header');
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    const targetId = link.getAttribute('href').slice(1);
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
      window.scrollTo({ top, behavior: 'smooth' });
      closeMobileNav();
    });
  });
}

// ---- Демо-слоты (полностью статичная иллюстрация, не связана с API —
// docs/ui-map.md, раздел «Лендинг») ----

function wireDemoSlots() {
  const ribbon = document.getElementById('demoRibbon');
  const dow = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const today = new Date();
  dow.forEach((label, i) => {
    const day = document.createElement('button');
    day.type = 'button';
    day.className = 'demo-day' + (i === 2 ? ' is-active' : '');
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    day.innerHTML = `<div class="demo-day-dow">${label}</div><div class="demo-day-num">${date.getDate()}</div>`;
    day.addEventListener('click', () => {
      ribbon.querySelectorAll('.demo-day').forEach((el) => el.classList.remove('is-active'));
      day.classList.add('is-active');
    });
    ribbon.appendChild(day);
  });

  const cta = document.getElementById('demoCta');
  const slots = document.querySelectorAll('.demo-slot:not(:disabled)');
  slots.forEach((slot) => {
    slot.addEventListener('click', () => {
      const wasSelected = slot.classList.contains('is-selected');
      slots.forEach((s) => s.classList.remove('is-selected'));
      if (!wasSelected) slot.classList.add('is-selected');
      const selected = document.querySelector('.demo-slot.is-selected');
      cta.textContent = selected ? `Записаться на ${selected.dataset.slot}` : 'Записаться на выбранное время';
    });
  });
}

// ---- FAQ ----

const FAQ_ITEMS = [
  { q: 'Нужно ли платить онлайн?', a: 'Нет, оплата происходит в салоне после визита.' },
  { q: 'Можно ли отменить запись?', a: 'Да, из своего аккаунта, без звонка администратору.' },
  { q: 'Что, если время займут раньше меня?', a: 'Слот бронируется в момент подтверждения; если его успели занять, мы покажем ближайшее свободное время.' },
  { q: 'Как я узнаю, что запись подтверждена?', a: 'Сразу после подтверждения на экране появится карточка записи с деталями.' },
  { q: 'Нужно ли регистрироваться?', a: 'Да, по электронной почте — это занимает около минуты.' },
  { q: 'Можно ли выбрать конкретного мастера?', a: 'Да, запись всегда оформляется к конкретному мастеру.' },
];

function renderFaq() {
  const list = document.getElementById('faqList');
  FAQ_ITEMS.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'faq-item';
    el.innerHTML = `
      <button type="button" class="faq-question">
        <span>${escapeHtml(item.q)}</span>
        <span class="faq-icon" aria-hidden="true">+</span>
      </button>
      <div class="faq-answer" hidden>${escapeHtml(item.a)}</div>
    `;
    const button = el.querySelector('.faq-question');
    const answer = el.querySelector('.faq-answer');
    button.addEventListener('click', () => {
      const isOpen = el.classList.toggle('is-open');
      answer.hidden = !isOpen;
    });
    list.appendChild(el);
  });
}

// ---- Инициализация ----
// initHeader() — синхронно и первым: дальше wireSmoothScroll() ищет по
// странице ссылки-якоря шапки (a[href^="#"]), они должны уже быть в DOM.

initHeader();
wireNavigationLinks();
wireSmoothScroll();
wireDemoSlots();
renderFaq();
loadServices();
loadMasters();
