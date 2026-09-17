// Вход через Яндекс в один клик — рядом с обычной формой входа
// (web/login.html, web/register.html). Разбор компромиссов —
// docs/db-schema.md, «Спорные решения», п.19; таблица — миграция
// 009_yandex_oauth.sql.
//
// Токен Яндекса сюда никогда не попадает и не сохраняется: getYandexProfile
// отдаёт только { email, name, providerId } — уже готовые данные профиля,
// не сам access_token. Дальше в дело идёт только наш собственный токен
// сессии (createSession, domain/session.js) — ровно тот же, что выдаёт
// обычный e-mail/пароль-вход, теми же правилами (ограниченный срок
// действия, httpOnly-cookie).

import { env } from '../config/env.js';
import { notImplemented } from '../http/errors.js';
import { dateToSql } from '../time/salonClock.js';
import {
  findUserWithRolesByEmail,
  findUserWithRolesById,
  insertUser,
  linkProviderToUser,
} from '../db/repositories/users.js';

const PROVIDER_YANDEX = 'yandex';

// ЗАГЛУШКА — временная, см. .env.example и server/README.md. Включена
// только явной переменной окружения (по умолчанию выключена и жёстко
// запрещена в production, config/env.js), подставляет фиксированные
// email/имя из настроек вместо настоящего ответа Яндекса.
function getStubYandexProfile() {
  return {
    email: env.yandexLoginStub.email,
    name: env.yandexLoginStub.name,
    // Настоящий provider_id — это поле "id" из ответа Яндекса
    // (login.yandex.ru/info), устойчивый идентификатор аккаунта, а не
    // email. У заглушки берём стабильную условную строку той же роли, а не
    // просто email — чтобы findOrCreateYandexUser не отличал заглушку от
    // настоящего профиля по форме данных.
    providerId: `stub:${env.yandexLoginStub.email}`,
  };
}

// Место для настоящего подключения. После регистрации приложения на
// oauth.yandex.ru (нужен постоянный адрес — redirect_uri, которого пока
// нет, см. .env.example) сюда добавляется обмен кода авторизации на
// access_token (POST https://oauth.yandex.ru/token) и запрос профиля
// (GET https://login.yandex.ru/info) — заменяется только тело этой
// функции, остальная логика входа (findOrCreateYandexUser, роут в
// routes/auth.routes.js) не меняется. Параметр не используется уже сейчас —
// понадобится там же, для обмена кода на токен.
async function fetchRealYandexProfile(authorizationCode) {
  throw notImplemented(
    'Вход через Яндекс ещё не подключён к настоящему Яндексу — приложение на oauth.yandex.ru не зарегистрировано ' +
      '(у сервиса пока нет постоянного адреса для redirect_uri). Для проверки нашей части входа включите ' +
      'YANDEX_LOGIN_STUB_ENABLED (см. .env.example) — только в разработке, не на боевом сервере.',
  );
}

export async function getYandexProfile(authorizationCode) {
  if (env.yandexLoginStub.enabled) return getStubYandexProfile();
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
