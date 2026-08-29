// Определение текущего пользователя по сессионной cookie и проверки прав
// доступа. requireAuth/requireRole бросают ApiError — 401 без входа,
// 403 при нехватке прав, как требует задача.

import { parseCookies, SESSION_COOKIE_NAME } from '../http/cookies.js';
import { resolveUserByToken } from '../domain/session.js';
import { unauthorized, forbidden } from '../http/errors.js';

export function extractSessionToken(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice('Bearer '.length);
  return null;
}

// Возвращает пользователя из БД (или null), если в запросе есть
// действующая (не отозванная, не истёкшая) сессия. Не бросает —
// используется и там, где вход опционален (например, привязка удержания
// к уже вошедшему клиенту).
export function resolveCurrentUser(req) {
  const token = extractSessionToken(req);
  if (!token) return null;
  return resolveUserByToken(token);
}

export function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

// Проверка "есть ли нужная роль В СПИСКЕ ролей пользователя", а не
// "совпадает ли единственное значение" — у одного человека может быть
// несколько ролей одновременно (например, мастер и администратор), см.
// docs/db-schema.md, раздел 3.2.
export function requireRole(ctx, role) {
  const user = requireAuth(ctx);
  if (!user.roles.includes(role)) throw forbidden();
  return user;
}

// Пропускает, если у пользователя есть ХОТЯ БЫ ОДНА из перечисленных
// ролей — для эндпоинтов, доступных нескольким ролям сразу (детали
// записи видят и её клиент, и мастер, у которого она в расписании, и
// админ — но какая именно роль сработала, дальше решает отдельная
// проверка принадлежности объекта, не эта функция).
export function requireAnyRole(ctx, roles) {
  const user = requireAuth(ctx);
  if (!roles.some((role) => user.roles.includes(role))) throw forbidden();
  return user;
}
