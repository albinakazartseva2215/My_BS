// Календарные хелперы, общие для нескольких экранов визарда (Booking · 3 и
// · 4) — чистый расчёт дат/подписей, без обращения к серверу. "Прошедшее"/
// "вне горизонта" по-настоящему решает сервер (reason в ответе availability,
// см. js/api.js) — эти функции только считают сетку месяца и формируют
// подписи вроде "4 сентября".

export const MONTH_NOMINATIVE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTH_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}
export function ymdToStr(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`; // m — 0-индексированный, как в Date
}
export function todayYmd() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}
export function todayStr() {
  const t = todayYmd();
  return ymdToStr(t.y, t.m, t.d);
}
export function addDaysToStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymdToStr(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
export function leadBlanksForMonth(y, m) {
  const dow = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0=Вс..6=Сб
  return (dow + 6) % 7; // 0=Пн..6=Вс, неделя в календаре начинается с понедельника
}
export function nextMonthYM(y, m) {
  return m === 11 ? [y + 1, 0] : [y, m + 1];
}
export function prevMonthYM(y, m) {
  return m === 0 ? [y - 1, 11] : [y, m - 1];
}
// "4 сентября" — без склонения дня недели/года, ровно то, что нужно
// подписям вроде "ближайшее свободное время" или "Сегодня"/"Завтра".
export function formatDayMonth(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${Number(d)} ${MONTH_GENITIVE[m - 1]}`;
}
// "Сегодня" / "Завтра" / "4 сентября" — для алтернативных слотов на
// Booking · 4b и подсказки "ближайшее время" на Booking · 3.
export function relativeDayLabel(dateStr) {
  const today = todayStr();
  if (dateStr === today) return 'Сегодня';
  if (dateStr === addDaysToStr(today, 1)) return 'Завтра';
  return formatDayMonth(dateStr);
}
