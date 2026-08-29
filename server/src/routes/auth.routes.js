// Регистрация, вход, выход, профиль текущего пользователя.
//
// Сессии — подписанный токен без состояния на сервере (см.
// src/security/session.js), в httpOnly cookie. holdToken можно передать
// при регистрации/входе — так шаг 4 прототипа привязывает анонимное
// удержание слота (созданное на шаге 3) к вошедшему клиенту.

import { badRequest } from '../http/errors.js';
import {
  requireString,
  requireEmail,
  requirePassword,
  requirePhone,
  requireBoolean,
  optionalString,
} from '../validation/validate.js';
import { findUserByEmail, insertUser, toPublicUser } from '../db/repositories/users.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { createSessionToken } from '../security/session.js';
import { serializeSessionCookie, serializeSessionCookieClear } from '../http/cookies.js';
import { attachClientToHold } from '../domain/holdAttach.js';
import { requestPasswordReset, confirmPasswordReset } from '../domain/passwordReset.js';
import { requireAuth } from '../middleware/auth.js';
import { dateToSql, toIsoUtc } from '../time/salonClock.js';
import { env } from '../config/env.js';

function setSessionCookie(ctx, userId) {
  const { token, expiresAt } = createSessionToken(userId);
  ctx.res.setHeader('Set-Cookie', serializeSessionCookie(token, expiresAt, { secure: env.isProduction }));
}

export function registerRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    const body = ctx.body;
    const name = requireString(body.name, 'name', { max: 200 });
    const email = requireEmail(body.email);
    const phone = requirePhone(body.phone);
    const password = requirePassword(body.password);
    const termsAccepted = requireBoolean(body.termsAccepted, 'termsAccepted');
    const holdToken = optionalString(body.holdToken, 'holdToken', { max: 100 });

    if (!termsAccepted) throw badRequest('Нужно принять условия оферты', { field: 'termsAccepted' });

    if (findUserByEmail(email)) {
      throw badRequest('Пользователь с таким e-mail уже зарегистрирован', { field: 'email' });
    }

    const now = new Date();
    const nowSql = dateToSql(now);
    const user = insertUser({
      name,
      email,
      phone,
      passwordHash: hashPassword(password),
      role: 'client',
      termsAcceptedAt: nowSql,
      now: nowSql,
    });

    setSessionCookie(ctx, user.id);
    const holdAttached = holdToken ? attachClientToHold(holdToken, user.id, now) : false;

    return { status: 201, body: { user: toPublicUser(user), holdAttached } };
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = ctx.body;
    const email = requireEmail(body.email);
    const password = requireString(body.password, 'password', { max: 200 });
    const holdToken = optionalString(body.holdToken, 'holdToken', { max: 100 });

    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw badRequest('Неверный e-mail или пароль', { field: 'password' });
    }

    setSessionCookie(ctx, user.id);
    const now = new Date();
    const holdAttached = holdToken ? attachClientToHold(holdToken, user.id, now) : false;

    return { status: 200, body: { user: toPublicUser(user), holdAttached } };
  });

  router.post('/api/auth/logout', async (ctx) => {
    // Токен без состояния на сервере (см. src/security/session.js) —
    // logout снимает cookie у клиента; сам токен, если его успели
    // скопировать, действителен до истечения TTL. Задокументировано там же.
    ctx.res.setHeader('Set-Cookie', serializeSessionCookieClear({ secure: env.isProduction }));
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
  // ВАЖНО про поле resetToken: в проде токен должен уходить по e-mail, а
  // не возвращаться клиенту. Он в ответе сейчас только потому, что
  // email/Telegram-интеграции нет и не будет в MVP (паспорт продукта,
  // раздел "Ограничения") — без какого-либо канала доставки протестировать
  // и вообще воспользоваться восстановлением было бы нечем. Подробный
  // разбор компромисса — domain/passwordReset.js и server/README.md, раздел 6.
  router.post('/api/auth/password-reset/request', async (ctx) => {
    const email = requireEmail(ctx.body.email);
    const result = requestPasswordReset(email);

    const body = {
      message: 'Если такой e-mail зарегистрирован, ссылка для восстановления пароля выдана.',
    };
    if (result.issued) {
      body.resetToken = result.token;
      body.expiresAt = toIsoUtc(result.expiresAt);
    }
    return { status: 200, body };
  });

  router.post('/api/auth/password-reset/confirm', async (ctx) => {
    const email = requireEmail(ctx.body.email);
    const token = requireString(ctx.body.token, 'token', { max: 200 });
    const newPassword = requirePassword(ctx.body.newPassword, 'newPassword');

    confirmPasswordReset({ email, token, newPassword });

    return { status: 200, body: { message: 'Пароль изменён, теперь можно войти с новым паролем.' } };
  });
}
