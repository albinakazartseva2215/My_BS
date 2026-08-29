// Определение текущего пользователя по сессионной cookie и проверки прав
// доступа. requireAuth/requireRole бросают ApiError — 401 без входа,
// 403 при нехватке прав, как требует задача.

import { parseCookies, SESSION_COOKIE_NAME } from '../http/cookies.js';
import { verifySessionToken } from '../security/session.js';
import { findUserById } from '../db/repositories/users.js';
import { unauthorized, forbidden } from '../http/errors.js';

// Возвращает пользователя из БД (или null), если в запросе есть валидная
// сессия. Не бросает — используется и там, где вход опционален
// (например, привязка удержания к уже вошедшему клиенту).
export function resolveCurrentUser(req) {
  const cookies = parseCookies(req);
  let token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice('Bearer '.length);
  }
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = findUserById(session.userId);
  return user ?? null;
}

export function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireRole(ctx, role) {
  const user = requireAuth(ctx);
  if (user.role !== role) throw forbidden();
  return user;
}
