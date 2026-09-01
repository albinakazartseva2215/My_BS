// Форматирование, общее для нескольких страниц (лендинг и личный кабинет
// используют одни и те же цены/длительности из API) — вынесено сюда,
// чтобы не дублировать в каждом файле.

// Русские формы множественного числа — без этого "1 минута/2 минуты/5
// минут" выглядели бы неправильно при любых значениях из API.
export function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} ${pluralRu(minutes, 'минута', 'минуты', 'минут')}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = `${hours} ${pluralRu(hours, 'час', 'часа', 'часов')}`;
  if (rest === 0) return hoursText;
  return `${hoursText} ${rest} ${pluralRu(rest, 'минута', 'минуты', 'минут')}`;
}

export function formatPriceRub(priceRub) {
  return `${priceRub.toLocaleString('ru-RU')} ₽`;
}

export function initials(fullName) {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
