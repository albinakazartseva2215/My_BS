// Восстановление пароля — Функция 1 паспорта продукта ("регистрация и
// вход по e-mail, включая восстановление пароля"). Таблица
// password_reset_tokens была в схеме с самого начала (docs/db-schema.md,
// 3.3), логики не было.
//
// ВАЖНОЕ ОГРАНИЧЕНИЕ MVP, зафиксированное в паспорте продукта, раздел
// "Ограничения": "Уведомления приходят только внутри личного кабинета,
// интеграция с e-mail или Telegram не входит в MVP". У обычного
// восстановления пароля ровно та задача, которую эта цитата запрещает
// решать штатно, — доставить токен ВНЕ личного кабинета, потому что
// человек как раз не может в него войти. Без email/Telegram-интеграции
// решить это "по-настоящему" нечем.
//
// Решение, принятое явно с постановщиком задачи: на время MVP токен
// восстановления возвращается прямо в теле ответа API
// (POST /api/auth/password-reset/request), а не отправляется по почте.
// Это не то, как эта функция должна работать в проде — токен превращает
// "знание e-mail" в "может сбросить пароль этого аккаунта", теряя
// свойство подтверждения владения почтой, ради которого обычно и нужен
// email-канал. Когда появится реальная email/Telegram-интеграция, отдачу
// токена в ответе нужно убрать и заменить отправкой по каналу — само
// хранение и проверка токена (эта логика) менять не придётся.

import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { dateToSql } from '../time/salonClock.js';
import { badRequest } from '../http/errors.js';
import { findUserByEmail, updateUserPasswordHash } from '../db/repositories/users.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import {
  invalidateActiveTokensForUser,
  insertToken,
  findActiveTokenForUser,
  markTokenUsed,
} from '../db/repositories/passwordResetTokens.js';

function invalidTokenError() {
  // Одна и та же формулировка на "нет такого email", "токен истёк" и
  // "токен неверный" — не даём подтверждению пароля стать способом
  // проверить, зарегистрирован ли e-mail в системе.
  return badRequest('Ссылка для восстановления пароля недействительна или истекла');
}

// Возвращает { issued: false } — если аккаунта с таким e-mail нет (маршрут
// сам решает, как по-разному не ответить на этот случай, см. auth.routes.js) —
// либо { issued: true, token, expiresAt }.
export function requestPasswordReset(email, now = new Date()) {
  const user = findUserByEmail(email);
  if (!user) return { issued: false };

  invalidateActiveTokensForUser(user.id);

  const rawToken = crypto.randomBytes(32).toString('base64url');
  // Тот же scrypt-формат, что и у пароля пользователя (security/passwords.js) —
  // осознанно повторяет docs/db-schema.md, 3.3: "хешируется так же, как пароль".
  const tokenHash = hashPassword(rawToken);
  const expiresAt = new Date(now.getTime() + env.passwordResetTtlMinutes * 60_000);

  insertToken({
    userId: user.id,
    tokenHash,
    expiresAtSql: dateToSql(expiresAt),
    now: dateToSql(now),
  });

  return { issued: true, token: rawToken, expiresAt };
}

export function confirmPasswordReset({ email, token, newPassword }, now = new Date()) {
  const user = findUserByEmail(email);
  if (!user) throw invalidTokenError();

  const activeToken = findActiveTokenForUser(user.id, dateToSql(now));
  if (!activeToken) throw invalidTokenError();

  if (!verifyPassword(token, activeToken.token_hash)) throw invalidTokenError();

  const nowSql = dateToSql(now);
  updateUserPasswordHash(user.id, hashPassword(newPassword), nowSql);
  markTokenUsed(activeToken.id, nowSql);
}
