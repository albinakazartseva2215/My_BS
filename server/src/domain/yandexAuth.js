// Вход через Яндекс в один клик — рядом с обычной формой входа
// (web/login.html, web/register.html). Разбор компромиссов —
// docs/db-schema.md, «Спорные решения», п.19; таблица — миграция
// 009_yandex_oauth.sql.
//
// Токен Яндекса сюда никогда не попадает и не сохраняется: getYandexProfile
// отдаёт только { email, name, providerId } — уже готовые данные профиля,
// не сам access_token (сам access_token живёт только внутри
// fetchRealYandexProfile, ровно на два запроса к Яндексу, и никуда за
// пределы этой функции не выходит). Дальше в дело идёт только наш
// собственный токен сессии (createSession, domain/session.js) — ровно тот
// же, что выдаёт обычный e-mail/пароль-вход, теми же правилами
// (ограниченный срок действия, httpOnly-cookie).

import { env } from '../config/env.js';
import { badGateway } from '../http/errors.js';
import { dateToSql } from '../time/salonClock.js';
import {
  findUserWithRolesByEmail,
  findUserWithRolesById,
  insertUser,
  linkProviderToUser,
} from '../db/repositories/users.js';

const PROVIDER_YANDEX = 'yandex';
const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token';
const YANDEX_INFO_URL = 'https://login.yandex.ru/info';

// Настоящий поход в Яндекс — код авторизации (пришёл на redirect_uri,
// routes/auth.routes.js, GET /api/auth/yandex/callback) меняется на
// access_token, тем же токеном сразу запрашивается профиль. Права
// приложения — ровно login:email и login:info (см. GET /api/auth/yandex/start),
// поэтому дальше читаются только email/имя/фамилия, больше ничего.
// access_token живёт только в переменной внутри этой функции — наружу не
// возвращается и нигде не сохраняется, использован он здесь ровно один раз
// (запрос профиля) и на этом его жизнь заканчивается.
async function fetchRealYandexProfile(authorizationCode) {
  const tokenResponse = await fetch(YANDEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: env.yandex.clientId,
      client_secret: env.yandex.clientSecret,
      redirect_uri: env.yandex.redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    throw badGateway(
      `Яндекс отказал в обмене кода авторизации на токен (HTTP ${tokenResponse.status}): ${await tokenResponse.text()}`,
    );
  }
  const tokenPayload = await tokenResponse.json();
  const accessToken = tokenPayload.access_token;
  if (!accessToken) {
    throw badGateway('Ответ Яндекса на обмен кода авторизации не содержит access_token.');
  }

  const infoResponse = await fetch(`${YANDEX_INFO_URL}?format=json`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!infoResponse.ok) {
    throw badGateway(`Яндекс отказал в запросе профиля пользователя (HTTP ${infoResponse.status}): ${await infoResponse.text()}`);
  }
  const profile = await infoResponse.json();
  // access_token дальше в этой функции больше не используется и никуда не
  // передаётся — единственный запрос, для которого он был нужен, уже сделан.

  const email = profile.default_email;
  if (!email) {
    throw badGateway(
      'Яндекс не вернул e-mail пользователя — проверьте, что у приложения включено право login:email.',
    );
  }
  // Имя и фамилия, как и просили (не display_name/real_name — те могут
  // быть псевдонимом, который человек сам указал в Яндекс ID); пустая
  // строка вместо отсутствующего поля не отличается от отсутствующего
  // имени — .filter(Boolean) убирает пропуски, а не подставляет "undefined".
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  if (!name) {
    throw badGateway(
      'Яндекс не вернул имя и фамилию пользователя — проверьте, что у приложения включено право login:info.',
    );
  }

  return {
    email,
    name,
    // id — устойчивый внутренний идентификатор аккаунта в Яндексе, не email
    // (docs/db-schema.md, «Спорные решения», п.19) — храним как строку, тем
    // же типом, что и колонка provider_id (TEXT).
    providerId: String(profile.id),
  };
}

export async function getYandexProfile(authorizationCode) {
  return fetchRealYandexProfile(authorizationCode);
}

// Требования 1-4 задачи: ищем по email, при совпадении привязываем внешний
// вход к найденному аккаунту (не создаём второй), иначе заводим новый —
// всегда с ролью 'client' (обычный пользователь сервиса; никакая другая
// роль через этот путь не выдаётся, тем же приёмом, что и обычная
// регистрация — routes/auth.routes.js жёстко проставляет роль в коде, не
// читает её из входных данных).
export function findOrCreateYandexUser({ email, name, providerId }, now = new Date()) {
  const nowSql = dateToSql(now);

  const existing = findUserWithRolesByEmail(email);
  if (existing) {
    linkProviderToUser(existing.id, PROVIDER_YANDEX, providerId, nowSql);
    return findUserWithRolesById(existing.id);
  }

  return insertUser({
    name,
    email,
    // Телефон обязателен в схеме (users.phone NOT NULL) — Яндекс его не
    // отдаёт, а расширять схему ради одного нового источника регистрации
    // не стали (docs/db-schema.md, «Спорные решения», п.19). Пустая
    // строка — заметная заглушка, а не выдуманный номер.
    phone: '',
    passwordHash: null,
    provider: PROVIDER_YANDEX,
    providerId,
    roles: ['client'],
    // Отдельного экрана согласия с офертой на кнопке "Войти через Яндекс"
    // нет — тот же приём, что уже принят на register.html (web/js/register.js:
    // чекбокса оферты там больше нет, termsAccepted:true шлётся всегда).
    termsAcceptedAt: nowSql,
    now: nowSql,
  });
}

// Пользователь уже вошёл (ctx.user, есть активная сессия) в момент возврата
// с Яндекса — привязываем Яндекс к ТЕКУЩЕМУ аккаунту, вместо поиска/создания
// по email из профиля Яндекса (findOrCreateYandexUser выше). Без этого
// разбора: если email в Яндекс ID отличается от email регистрации на сайте,
// findOrCreateYandexUser не находил совпадения и заводил ВТОРОЙ, отдельный
// аккаунт — а setSessionCookie в routes/auth.routes.js после этого тихо
// подменял сессию на него, посреди уже открытого визита под другим
// аккаунтом. Живой случай — docs/development-log.md, «Вход через Яндекс
// подменял сессию на другой аккаунт».
//
// email/name из профиля Яндекса здесь намеренно не используются — эта
// функция только подтверждает связь с внешним входом, не переписывает имя
// или почту уже существующего аккаунта тем, что прислал Яндекс.
export function linkYandexToCurrentUser(currentUser, { providerId }, now = new Date()) {
  const nowSql = dateToSql(now);
  linkProviderToUser(currentUser.id, PROVIDER_YANDEX, providerId, nowSql);
  return findUserWithRolesById(currentUser.id);
}
