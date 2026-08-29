// Сессии входа — выпуск, проверка, отзыв. Токен клиенту (httpOnly cookie)
// отдаётся ровно один раз, при создании; дальше сервер знает только его
// хеш (см. docs/db-schema.md, раздел 3.3а).

import { env } from '../config/env.js';
import { dateToSql } from '../time/salonClock.js';
import { generateSessionToken, hashSessionToken } from '../security/session.js';
import { findUserWithRolesById } from '../db/repositories/users.js';
import {
  insertSession,
  findActiveSessionByTokenHash,
  revokeSessionByTokenHash,
} from '../db/repositories/sessions.js';

// Возвращает { token, expiresAt } — token отдаётся вызывающему коду
// (routes/auth.routes.js) РОВНО один раз, чтобы положить в cookie; сам
// он больше нигде не сохраняется, в БД уходит только его хеш.
export function createSession(userId, now = new Date()) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + env.sessionTtlDays * 24 * 60 * 60 * 1000);

  insertSession({
    userId,
    tokenHash,
    expiresAtSql: dateToSql(expiresAt),
    now: dateToSql(now),
  });

  return { token, expiresAt };
}

// Пользователь по предъявленному токену — null, если токена нет,
// он не найден, отозван или истёк, либо если пользователь за это время
// был удалён (FK ON DELETE CASCADE физически не даст такой сессии
// остаться, но проверка на всякий случай дешёвая). Возвращённый объект
// несёт .roles (массив) — requireRole/requireAuth во всём остальном коде
// читают роль именно оттуда, не из отдельного запроса к БД.
export function resolveUserByToken(token, now = new Date()) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashSessionToken(token);
  const session = findActiveSessionByTokenHash(tokenHash, dateToSql(now));
  if (!session) return null;
  return findUserWithRolesById(session.user_id) ?? null;
}

// logout — помечает сессию отозванной (не удаляет строку, см.
// db/repositories/sessions.js). Возвращает true, если такая активная
// сессия действительно была; false — не ошибка, просто нечего отзывать
// (токен уже истёк/отозван/не был предъявлен).
export function revokeSession(token, now = new Date()) {
  if (!token || typeof token !== 'string') return false;
  const tokenHash = hashSessionToken(token);
  return revokeSessionByTokenHash(tokenHash, dateToSql(now));
}
