// Регистрация, вход, выход, профиль текущего пользователя.
//
// Сессии — токен с ограниченным сроком действия, хеш которого хранится
// в БД (docs/db-schema.md, раздел 3.3а; domain/session.js), в httpOnly
// cookie. holdToken можно передать при регистрации/входе — так шаг 4
// прототипа привязывает анонимное удержание слота (созданное на шаге 3)
// к вошедшему клиенту.

import { badRequest } from '../http/errors.js';
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
import { serializeSessionCookie, serializeSessionCookieClear, isRequestSecure } from '../http/cookies.js';
import { extractSessionToken, requireAuth } from '../middleware/auth.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import { attachClientToHold } from '../domain/holdAttach.js';
import { requestPasswordReset, confirmPasswordReset } from '../domain/passwordReset.js';
import { getYandexProfile, findOrCreateYandexUser } from '../domain/yandexAuth.js';
import { dateToSql, toIsoUtc } from '../time/salonClock.js';
import { env } from '../config/env.js';

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
  // web/register.html. Тело запроса пустое: email/имя пользователя сюда не
  // передаёт браузер (это была бы дыра — любой мог бы прислать чужой
  // email и получить его сессию), их называет только сам Яндекс — сейчас,
  // пока приложение там не зарегистрировано, вместо него отвечает
  // заглушка (getYandexProfile, domain/yandexAuth.js, включается
  // YANDEX_LOGIN_STUB_ENABLED). holdToken (как у /login и /register выше)
  // этот маршрут сознательно не принимает — кнопка стоит на отдельных
  // экранах входа/регистрации, а не в визарде записи (booking-4.html);
  // понадобится там — добавить отдельно, не расширяя эту заглушку молча.
  router.post('/api/auth/yandex/login', async (ctx) => {
    enforceRateLimit(ctx, 'yandexLogin');
    const profile = await getYandexProfile();

    const now = new Date();
    const user = findOrCreateYandexUser(profile, now);
    setSessionCookie(ctx, user.id, now);

    return { status: 200, body: { user: toPublicUser(user) } };
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
