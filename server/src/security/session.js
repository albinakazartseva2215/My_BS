// Крипто-примитивы для токена сессии — генерация и хеш, без обращения к
// БД и без бизнес-логики (та же роль в этом слое, что и у
// security/passwords.js: только математика). Хранение и проверку строки
// в таблице sessions — см. domain/session.js и db/repositories/sessions.js.
//
// Токен — случайные 256 бит (crypto.randomBytes), не подписанная
// структура, как было раньше (см. docs/db-schema.md, раздел 3.3а — там
// же обоснование, почему хеш токена HMAC-SHA256, а не scrypt, как у
// password_reset_tokens: токен сессии высокоэнтропийный и проверяется на
// каждом запросе, а не низкоэнтропийный и проверяемый один раз при входе).

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const TOKEN_BYTES = 32; // 256 бит

export function generateSessionToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token) {
  return createHmac('sha256', env.sessionSecret).update(token).digest('hex');
}

// Сравнение двух хешей постоянным временем — на случай, если где-то в
// будущем понадобится сравнить два уже посчитанных хеша напрямую, а не
// через SQL-поиск по token_hash (сейчас domain/session.js ищет строку по
// точному совпадению в БД, но выравнивание длины и timingSafeEqual
// дешевле держать здесь, рядом с hashSessionToken, чем в вызывающем коде).
export function hashesEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
