// Перевод между UTC (в чём всё хранится в БД, docs/db-schema.md раздел 2)
// и локальным "настенным" временем салона (salon_profile.timezone).
// Только Intl из самого Node — без внешних библиотек вроде luxon/date-fns.
//
// Где это используется:
//  - расчёт свободного времени (раздел 5 документа схемы) — график мастера
//    и исключения заданы в локальном времени, записи и блокировки — в UTC;
//  - отображение времени клиенту — храним и считаем в UTC, а в локальное
//    переводим только в ответе API (требование задачи).

const WEEKDAY_BY_SHORT_NAME = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Смещение таймзоны (в минутах, местное - UTC) в момент конкретного
// UTC-инстанта. Учитывает переход на летнее/зимнее время, если он есть
// у данной IANA-зоны (для Europe/Moscow сейчас его нет, но код не
// завязан на это специально).
export function getOffsetMinutes(utcDate, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(utcDate);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  if (tzName === 'GMT') return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzName);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

// 'YYYY-MM-DD' + 'HH:MM' в локальном времени зоны -> UTC Date.
// Смещение зависит от даты (DST), поэтому уточняем в 2 шага: считаем от
// первой оценки смещения, затем пересчитываем от результата — этого
// достаточно даже на границе перехода летнего/зимнего времени.
export function localToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const naiveUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  let resultMs = naiveUtcMs;
  for (let i = 0; i < 2; i += 1) {
    const offsetMin = getOffsetMinutes(new Date(resultMs), timeZone);
    resultMs = naiveUtcMs - offsetMin * 60_000;
  }
  return new Date(resultMs);
}

// UTC Date -> части локального времени зоны: календарная дата, время и
// ISO-номер дня недели (1 = понедельник … 7 = воскресенье).
export function utcToLocalParts(utcDate, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour; // hour12:false иногда даёт "24" в полночь
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
    weekdayIso: WEEKDAY_BY_SHORT_NAME[parts.weekday],
  };
}

// UTC Date -> строка ISO-8601 со смещением локальной зоны, например
// "2026-09-01T14:00:00+03:00" — только для отображения в ответах API.
export function formatLocalIso(utcDate, timeZone) {
  const { date, time } = utcToLocalParts(utcDate, timeZone);
  const offsetMin = getOffsetMinutes(utcDate, timeZone);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${date}T${time}${sign}${oh}:${om}`;
}

// ISO-номер дня недели календарной даты (не зависит от таймзоны — это
// сравнение чисел года/месяца/дня, а не физического момента времени).
export function isoWeekdayOfDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=вс..6=сб
  return jsDay === 0 ? 7 : jsDay;
}

export function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Формат хранения БД (раздел 2 документа схемы): 'YYYY-MM-DD HH:MM:SS', UTC,
// без указания смещения.
export function dateToSql(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function sqlToDate(sqlText) {
  return new Date(`${sqlText.replace(' ', 'T')}Z`);
}

// UTC Date -> ISO-8601 с суффиксом 'Z', стандартная форма для JSON-ответов.
export function toIsoUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
