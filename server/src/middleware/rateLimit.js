// Ограничение частоты запросов — требование 8, вход и регистрация
// (routes/auth.routes.js). В памяти процесса, без отдельной таблицы в БД
// и без внешних пакетов/Redis: сервис однопроцессный (см.
// server/README.md, раздел 2 — тот же принцип "ничего третьего", что и у
// остального бэкенда), писать в SQLite на каждую попытку входа — в том
// числе неудачную — было бы лишней нагрузкой на горячем пути ради того,
// что решается проще. Оборотная сторона in-memory: счётчики обнуляются
// при перезапуске процесса и не разделяются между несколькими
// инстансами/воркерами — если сервис когда-нибудь станет кластером,
// нужен будет общий стор (Redis и т.п.), это уже не in-memory решение.
//
// Ключ — IP-адрес клиента (req.socket.remoteAddress) + название маршрута,
// вход и регистрация считаются раздельно. IP берётся из самого сокета,
// не из заголовка X-Forwarded-For: этот сервис не задеклариован как
// стоящий за реверс-прокси, а доверять заголовку, который клиент может
// прислать любым, без проверенного адреса прокси перед сервером —
// значит дать любому обойти лимит, просто подставив случайный
// X-Forwarded-For. Если прокси появится — эту логику нужно будет
// переписать так, чтобы доверять заголовку только от известного адреса
// самого прокси, а не переключать её бездумно.

import { tooManyRequests } from '../http/errors.js';

const ROUTE_LIMITS = {
  // Логин чаще легитимно повторяют (опечатался в пароле) — лимит мягче.
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  // Регистрация с одного IP много раз подряд — почти всегда не обычный
  // пользователь, а перебор/спам — лимит жёстче.
  register: { max: 5, windowMs: 15 * 60 * 1000 },
  // Найдено проверкой безопасности: этот маршрут раньше был вообще без
  // лимита, хотя отдавал (в деве — и сейчас отдаёт, см. auth.routes.js)
  // токен сброса пароля в ответе. Без ограничения частоты можно было
  // перебирать e-mail-адреса с той же скоростью, что и сам HTTP-клиент
  // позволяет. Лимит как у register — легитимных частых повторов почти
  // не бывает, а риск перебора выше, чем у login.
  passwordResetRequest: { max: 5, windowMs: 15 * 60 * 1000 },
  // Токен высокоэнтропийный (не подобрать перебором за разумное время),
  // но маршрут аутентификации без лимита — не то, что должно быть по
  // умолчанию; лимит как у login.
  passwordResetConfirm: { max: 10, windowMs: 15 * 60 * 1000 },
  // Тот же маршрут аутентификации, что и login — тем же лимитом, чтобы
  // не остаться единственным способом входа без ограничения частоты
  // (domain/yandexAuth.js, routes/auth.routes.js).
  yandexLogin: { max: 10, windowMs: 15 * 60 * 1000 },
};

// key -> { count, windowStart }
const buckets = new Map();

function getClientIp(req) {
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

// Возвращает { limited: false } либо { limited: true, retryAfterSeconds }.
// Считает КАЖДЫЙ запрос (успешный или нет) — это ограничение частоты, а
// не защита только от неверных паролей: разница специально не делается,
// иначе лимит не защищал бы от спама регистраций, которые все "успешны".
export function checkRateLimit(req, routeName, now = Date.now()) {
  const limit = ROUTE_LIMITS[routeName];
  if (!limit) {
    throw new Error(`checkRateLimit: неизвестный маршрут "${routeName}" — добавьте его в ROUTE_LIMITS`);
  }

  const key = `${routeName}:${getClientIp(req)}`;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= limit.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { limited: false };
  }

  bucket.count += 1;
  if (bucket.count > limit.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + limit.windowMs - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false };
}

// Бросает ApiError(429, ...) и проставляет заголовок Retry-After — единая
// точка вызова для маршрутов, чтобы не дублировать в каждом из них и
// проверку, и выставление заголовка, и текст ошибки.
export function enforceRateLimit(ctx, routeName) {
  const result = checkRateLimit(ctx.req, routeName);
  if (!result.limited) return;
  ctx.res.setHeader('Retry-After', String(result.retryAfterSeconds));
  throw tooManyRequests('Слишком много попыток. Попробуйте снова позже.', {
    retryAfterSeconds: result.retryAfterSeconds,
  });
}

// Зачистка устаревших окон — без неё Map растёт на один ключ на каждый
// когда-либо обращавшийся IP и никогда не уменьшается. Тот же принцип
// ленивой+фоновой зачистки, что у domain/holdExpiry.js и
// domain/completionSweep.js — вызывается по таймеру в index.js.
export function sweepExpiredBuckets(now = Date.now()) {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    const limit = ROUTE_LIMITS[key.split(':')[0]];
    const windowMs = limit ? limit.windowMs : 15 * 60 * 1000;
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
      removed += 1;
    }
  }
  return removed;
}
