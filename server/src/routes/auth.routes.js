// Регистрация, вход, выход, профиль текущего пользователя.
//
// Сессии — токен с ограниченным сроком действия, хеш которого хранится
// в БД (docs/db-schema.md, раздел 3.3а; domain/session.js), в httpOnly
// cookie. holdToken можно передать при регистрации/входе — так шаг 4
// прототипа привязывает анонимное удержание слота (созданное на шаге 3)
// к вошедшему клиенту.

import { randomBytes } from 'node:crypto';
import { ApiError, badRequest } from '../http/errors.js';
import {
  requireString,
  requireEmail,
  requirePassword,
  requirePhone,
  requireBoolean,
  optionalString,
} from '../validation/validate.js';
import { findUserWithRolesByEmail, insertUser, toPublicUser } from '../db/repositories/users.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { createSession, revokeSession } from '../domain/session.js';
import {
  serializeSessionCookie,
  serializeSessionCookieClear,
  serializeYandexOauthStateCookie,
  serializeYandexOauthStateCookieClear,
  YANDEX_OAUTH_STATE_COOKIE_NAME,
  parseCookies,
  isRequestSecure,
} from '../http/cookies.js';
import { extractSessionToken, requireAuth } from '../middleware/auth.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import { attachClientToHold } from '../domain/holdAttach.js';
import { requestPasswordReset, confirmPasswordReset } from '../domain/passwordReset.js';
import { getYandexProfile, findOrCreateYandexUser, linkYandexToCurrentUser } from '../domain/yandexAuth.js';
import { dateToSql, toIsoUtc } from '../time/salonClock.js';
import { env } from '../config/env.js';

// Экраны входа/регистрации (web/login.html, web/register.html) — куда
// возвращать браузер после похода на Яндекс. Бэкенд и веб-страницы — разные
// сервисы без общего кода (web/js/routes.js держит свои константы отдельно,
// см. комментарий там же), поэтому пути здесь продублированы буквально, а
// не импортированы. ACCOUNT/ADMIN — совпадают с ACCOUNT_URL/
// ADMIN_APPOINTMENTS_URL оттуда: на них ведёт и обычный вход тоже.
const YANDEX_LOGIN_SCREEN_URL = '/login.html';
const ACCOUNT_URL = '/account.html';
const ADMIN_URL = '/admin';

function setSessionCookie(ctx, userId, now) {
  const { token, expiresAt } = createSession(userId, now);
  // secure — по реальному протоколу ЭТОГО запроса (isRequestSecure), а не
  // по NODE_ENV: на проде без HTTPS (сайт пока открыт по IP, без домена)
  // Secure-cookie от NODE_ENV=production браузер молча не сохранил бы —
  // подробности в http/cookies.js, isRequestSecure.
  ctx.res.setHeader('Set-Cookie', serializeSessionCookie(token, expiresAt, { secure: isRequestSecure(ctx.req) }));
}

export function registerRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    enforceRateLimit(ctx, 'register');
    const body = ctx.body;
    const name = requireString(body.name, 'name', { max: 200 });
    const email = requireEmail(body.email);
    const phone = requirePhone(body.phone);
    const password = requirePassword(body.password);
    const termsAccepted = requireBoolean(body.termsAccepted, 'termsAccepted');
    const holdToken = optionalString(body.holdToken, 'holdToken', { max: 100 });

    if (!termsAccepted) throw badRequest('Нужно принять условия оферты', { field: 'termsAccepted' });

    if (findUserWithRolesByEmail(email)) {
      throw badRequest('Пользователь с таким e-mail уже зарегистрирован', { field: 'email' });
    }

    const now = new Date();
    const nowSql = dateToSql(now);
    // roles всегда ['client'] — публичная регистрация не может выдать
    // себе роль admin/master, что бы ни было в теле запроса (в body такого
    // поля даже не читается, см. требование 7 про недопустимые поля).
    const user = insertUser({
      name,
      email,
      phone,
      passwordHash: hashPassword(password),
      roles: ['client'],
      termsAcceptedAt: nowSql,
      now: nowSql,
    });

    setSessionCookie(ctx, user.id, now);
    const holdAttached = holdToken ? attachClientToHold(holdToken, user.id, now) : false;

    return { status: 201, body: { user: toPublicUser(user), holdAttached } };
  });

  router.post('/api/auth/login', async (ctx) => {
    enforceRateLimit(ctx, 'login');
    const body = ctx.body;
    const email = requireEmail(body.email);
    const password = requireString(body.password, 'password', { max: 200 });
    const holdToken = optionalString(body.holdToken, 'holdToken', { max: 100 });

    const user = findUserWithRolesByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw badRequest('Неверный e-mail или пароль', { field: 'password' });
    }

    const now = new Date();
    setSessionCookie(ctx, user.id, now);
    const holdAttached = holdToken ? attachClientToHold(holdToken, user.id, now) : false;

    return { status: 200, body: { user: toPublicUser(user), holdAttached } };
  });

  // Вход через Яндекс в один клик — кнопка на web/login.html и
  // web/register.html. Не AJAX-вызов, а обычный переход браузера: только
  // так пользователь реально попадёт на страницу согласия Яндекса и
  // сможет там ввести логин/подтвердить вход — fetch() показать эту
  // страницу не умеет. holdToken (как у /login и /register выше) этот
  // маршрут сознательно не принимает — кнопка стоит на отдельных экранах
  // входа/регистрации, а не в визарде записи (booking-4.html); понадобится
  // там — добавить отдельно, не расширяя эту логику молча.
  //
  // state — случайное значение, кладётся в короткоживущую httpOnly-cookie
  // (10 минут, http/cookies.js) и в саму ссылку на Яндекс; /yandex/callback
  // ниже сверяет одно с другим. Без этого сторонний сайт мог бы прислать
  // жертве свою собственную ссылку на /yandex/callback с чужим кодом
  // авторизации — это увело бы жертву в чужой Яндекс-аккаунт (классическая
  // login CSRF для OAuth); совпадение cookie (её мог поставить только этот
  // же браузер на этом же заходе) и значения в query исключает подмену.
  router.get('/api/auth/yandex/start', async (ctx) => {
    enforceRateLimit(ctx, 'yandexLogin');

    const state = randomBytes(24).toString('base64url');
    ctx.res.setHeader(
      'Set-Cookie',
      serializeYandexOauthStateCookie(state, { secure: isRequestSecure(ctx.req) }),
    );

    const authorizeUrl = new URL('https://oauth.yandex.ru/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', env.yandex.clientId);
    authorizeUrl.searchParams.set('redirect_uri', env.yandex.redirectUri);
    // Ровно два права — email и имя/фамилия, требование задачи "больше
    // ничего не запрашивай". Список прав самого приложения задаётся один
    // раз при регистрации на oauth.yandex.ru, но явный scope здесь не даёт
    // Яндексу молча запросить у пользователя что-то ещё, если однажды в
    // консоли приложению добавят более широкие права.
    authorizeUrl.searchParams.set('scope', 'login:email login:info');
    authorizeUrl.searchParams.set('state', state);

    return { redirect: authorizeUrl.toString() };
  });

  // Адрес возврата (redirect_uri) — сюда Яндекс переводит браузер после
  // экрана согласия, с ?code=... в случае успеха либо ?error=... если
  // человек нажал «Отмена» или сам Яндекс отказал. Ответ всегда —
  // редирект обратно на экран входа: либо сразу в аккаунт (успех), либо на
  // login.html с понятным сообщением (любая неудача) — то, что должно
  // получиться в браузере, недоступно fetch()/JSON, а без явного редиректа
  // здесь браузер просто показал бы пустой ответ API вместо страницы.
  router.get('/api/auth/yandex/callback', async (ctx) => {
    const cookieState = parseCookies(ctx.req)[YANDEX_OAUTH_STATE_COOKIE_NAME];
    // Cookie одноразовая — снимаем её в любом случае (успех, отказ,
    // подделанный state), повторно предъявить тот же state нельзя.
    ctx.res.setHeader('Set-Cookie', serializeYandexOauthStateCookieClear({ secure: isRequestSecure(ctx.req) }));

    const { code, state, error } = ctx.query;

    if (error) {
      // access_denied — человек сам нажал «Отмена» на экране согласия;
      // любое другое значение — отказ по другой причине на стороне
      // Яндекса, но пользователю в обоих случаях нужен один и тот же
      // понятный выход, а не разбор кода ошибки.
      const reason = error === 'access_denied' ? 'denied' : 'failed';
      return { redirect: `${YANDEX_LOGIN_SCREEN_URL}?yandexError=${reason}` };
    }
    if (!code || !state || !cookieState || state !== cookieState) {
      return { redirect: `${YANDEX_LOGIN_SCREEN_URL}?yandexError=failed` };
    }

    try {
      const profile = await getYandexProfile(code);
      const now = new Date();
      // Уже вошли (ctx.user — resolveCurrentUser в app.js, читает сессионную
      // cookie на каждый запрос) — привязываем Яндекс к ТЕКУЩЕМУ аккаунту, а
      // не ищем/заводим по email из профиля Яндекса. Иначе, если почта в
      // Яндекс ID отличается от почты регистрации на сайте, этот шаг тихо
      // заводил второй аккаунт и подменял сессию посреди уже открытого
      // визита — живой случай, docs/development-log.md.
      const user = ctx.user
        ? linkYandexToCurrentUser(ctx.user, profile, now)
        : findOrCreateYandexUser(profile, now);
      setSessionCookie(ctx, user.id, now);
      return { redirect: user.roles.includes('admin') ? ADMIN_URL : ACCOUNT_URL };
    } catch (err) {
      // Сюда попадает и badGateway (Яндекс ответил не тем, чего ждали —
      // domain/yandexAuth.js), и вообще любая другая ошибка — пользователь
      // в браузере в любом случае должен увидеть понятный текст на
      // login.html, а не сырой JSON или пустую страницу; details для
      // разбора остаются в консоли сервера.
      console.error('[auth] вход через Яндекс не завершился:', err instanceof ApiError ? err.message : err);
      return { redirect: `${YANDEX_LOGIN_SCREEN_URL}?yandexError=failed` };
    }
  });

  router.post('/api/auth/logout', async (ctx) => {
    // Реальный отзыв — сессия помечается revoked_at в БД (не только
    // снятие cookie, как было раньше без таблицы sessions, см.
    // domain/session.js) — токен, даже если его успели скопировать,
    // больше не пройдёт resolveUserByToken.
    const token = extractSessionToken(ctx.req);
    if (token) revokeSession(token);
    ctx.res.setHeader('Set-Cookie', serializeSessionCookieClear({ secure: isRequestSecure(ctx.req) }));
    return { status: 204, body: null };
  });

  router.get('/api/auth/me', async (ctx) => {
    const user = requireAuth(ctx);
    return { status: 200, body: { user: toPublicUser(user) } };
  });

  // Функция 1 паспорта продукта: "...включая восстановление пароля".
  // Ответ одной и той же формы независимо от того, есть ли такой e-mail —
  // не подтверждаем/опровергаем регистрацию по этому полю.
  //
  // ВАЖНО про поле resetToken: в проде токен НЕ возвращается клиентом —
  // см. env.isProduction ниже. Раньше отдавался всегда, независимо от
  // окружения: это была осознанная уступка на время MVP, пока нет
  // email/Telegram-канала (паспорт продукта, раздел "Ограничения"), но по
  // факту это давало ЛЮБОМУ, кто знает чужой e-mail, рабочий токен сброса
  // пароля — то есть полноценный захват аккаунта без пароля жертвы
  // (найдено проверкой безопасности, живой запрос подтвердил). Тот же
  // приём, что уже используется в проекте для db:reset/seed (раздел 3
  // server/README.md) — то, что нельзя безопасно включить без ещё не
  // реализованной части (реальная отправка письма), не включается молча
  // в production, а не изображает готовую фичу. Итог: в разработке
  // (NODE_ENV=development/test) resetToken по-прежнему в ответе — сброс
  // пароля можно проверить и использовать без email-интеграции; в
  // production токен придётся реализовать через реальную отправку письма,
  // когда появится email-канал — тогда это условие снимается, а не
  // переносится. До этого момента restore пароля в production не работает
  // end-to-end — это честнее, чем работающая, но дырявая версия.
  router.post('/api/auth/password-reset/request', async (ctx) => {
    // Без лимита этот маршрут был тем же вектором в квадрате: не только
    // токен уходил кому попало, но и без всякого ограничения частоты —
    // можно было перебирать e-mail-адреса как угодно быстро. Лимит как у
    // register (спам/перебор с одного IP — не обычный юзерский сценарий).
    enforceRateLimit(ctx, 'passwordResetRequest');
    const email = requireEmail(ctx.body.email);
    const result = requestPasswordReset(email);

    // Аккаунт без пароля (вход только через Яндекс) — единственный случай,
    // где этот маршрут ГОВОРИТ прямо, что аккаунт с таким email есть, а не
    // отвечает той же обезличенной формулировкой, что и "email не
    // зарегистрирован" ниже. Осознанный компромисс по прямому требованию —
    // разбор в docs/db-schema.md, «Спорные решения», п.19.
    if (result.oauthOnly) {
      return {
        status: 200,
        body: {
          message: 'Вход в этот аккаунт выполняется через Яндекс — пароля у него нет, сбрасывать нечего. ' +
            'Используйте кнопку «Войти через Яндекс» на экране входа.',
          oauthOnly: true,
          provider: result.provider,
        },
      };
    }

    const body = {
      message: 'Если такой e-mail зарегистрирован, ссылка для восстановления пароля выдана.',
    };
    if (result.issued && !env.isProduction) {
      body.resetToken = result.token;
      body.expiresAt = toIsoUtc(result.expiresAt);
    }
    return { status: 200, body };
  });

  router.post('/api/auth/password-reset/confirm', async (ctx) => {
    // Токен сам по себе высокоэнтропийный (не подобрать перебором за
    // разумное время), но лимит — та же защита в глубину, что и у login:
    // ни один маршрут аутентификации не должен оставаться без ограничения
    // частоты просто потому, что подбор конкретно этого значения и так
    // маловероятен.
    enforceRateLimit(ctx, 'passwordResetConfirm');
    const email = requireEmail(ctx.body.email);
    const token = requireString(ctx.body.token, 'token', { max: 200 });
    const newPassword = requirePassword(ctx.body.newPassword, 'newPassword');

    confirmPasswordReset({ email, token, newPassword });

    return { status: 200, body: { message: 'Пароль изменён, теперь можно войти с новым паролем.' } };
  });
}
