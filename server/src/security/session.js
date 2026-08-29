// Сессии без отдельной таблицы в БД — её нет в docs/db-schema.md, и заводить
// её только ради логина значило бы менять схему в обход документа.
// Вместо этого — подписанный (HMAC-SHA256) токен без состояния на сервере:
// он несёт id пользователя, кто выписал (сессия ложится в httpOnly cookie),
// и срок действия. Сервер только проверяет подпись и срок — по базе данных
// на каждый запрос это не бьёт.
//
// Оборотная сторона: у токена нет server-side отзыва. /api/auth/logout
// удаляет cookie у клиента, но сам токен математически действителен до
// истечения TTL, если он утёк раньше. Для масштаба этого сервиса (один
// салон, вход только по email/паролю) это осознанный компромисс —
// если понадобится жёсткий logout/отзыв, нужна таблица сессий/чёрный
// список, это уже выходит за рамки текущей схемы.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const TTL_MS = env.sessionTtlDays * 24 * 60 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

export function createSessionToken(userId) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TTL_MS;
  const payload = `${userId}.${issuedAt}.${expiresAt}`;
  const encodedPayload = base64url(payload);
  const signature = sign(encodedPayload);
  return { token: `${encodedPayload}.${signature}`, expiresAt };
}

// Возвращает { userId, expiresAt } или null, если токен отсутствует,
// повреждён, подделан или истёк.
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(payload);
  if (!match) return null;
  const [, userIdStr, , expiresAtStr] = match;
  const expiresAt = Number(expiresAtStr);
  if (Date.now() > expiresAt) return null;

  return { userId: Number(userIdStr), expiresAt };
}
