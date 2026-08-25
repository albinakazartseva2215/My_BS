// Хеширование паролей — на встроенном node:crypto (scrypt), без внешних
// пакетов вроде bcrypt: тот же принцип "Node.js и SQLite" без лишнего,
// что и у остального бэкенда (см. src/db/connection.js).
//
// Формат хранимого значения: "scrypt:<соль-hex>:<хеш-hex>" — схема
// хеширования записана прямо в строке, чтобы её можно было сменить
// в будущем, не потеряв возможность проверить уже сохранённые пароли.
//
// Используется и в seed.js (тестовые пользователи), и будет переиспользовано
// в API аутентификации, когда он появится — это единственное место,
// где вообще должен упоминаться пароль в открытом виде.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const SCHEME = 'scrypt';

export function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new TypeError('hashPassword: пароль должен быть непустой строкой');
  }
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = scryptSync(plainPassword, salt, KEY_LENGTH);
  return `${SCHEME}:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(plainPassword, storedHash) {
  const parts = typeof storedHash === 'string' ? storedHash.split(':') : [];
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;

  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plainPassword, salt, expected.length);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
