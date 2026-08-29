// Хеширование паролей — на встроенном node:crypto (scrypt), без внешних
// пакетов вроде bcrypt/argon2: у обоих есть нативные (C++) сборки, которые
// на сервере могут не собраться без компилятора/node-gyp — тот же риск,
// из-за которого для БД выбран node:sqlite, а не better-sqlite3 (см.
// src/db/connection.js). node:sqlite уже скомпилирован внутрь Node,
// scrypt — тоже: ничего собирать не нужно ни там, ни здесь.
//
// Формат хранимого значения:
//   scrypt:<N>:<r>:<p>:<keylen>:<соль-hex>:<хеш-hex>
// Соль — случайная и своя для каждого пароля (randomBytes на каждый вызов
// hashPassword, не общая на все записи). Параметры стойкости (N — cost,
// он же основной "вес" вычисления; r — blockSize; p — parallelization) и
// длина производного ключа хранятся ПРЯМО В СТРОКЕ, а не берутся из
// текущих констант модуля — иначе смена дефолтов для новых паролей в
// будущем (например, увеличение N на более мощном сервере) сделала бы
// непроверяемыми все уже сохранённые хеши: verifyPassword должен
// пересчитывать scrypt с ТЕМИ ЖЕ параметрами, с которыми хеш был создан,
// а взять их неоткуда, кроме как из самой строки.
//
// Используется и в seed.js (тестовые пользователи — то же самое
// требование "то же самое применяй в тестовых данных"), и в API
// аутентификации (routes/auth.routes.js, domain/passwordReset.js) — это
// единственное место, где вообще должен упоминаться пароль в открытом виде.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCHEME = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

// Дефолты — ровно то, что node:crypto подставляет сам, если не передать
// options в scryptSync (N=16384=2^14, r=8, p=1). Здесь они не "магические
// дефолты Node", а осознанно зафиксированные параметры этого проекта —
// прописаны явно, чтобы значение было видно в коде, а не подразумевалось.
const DEFAULT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });

export function hashPassword(plainPassword, params = DEFAULT_PARAMS) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new TypeError('hashPassword: пароль должен быть непустой строкой');
  }
  const { N, r, p } = params;
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = scryptSync(plainPassword, salt, KEY_LENGTH, { N, r, p });
  return `${SCHEME}:${N}:${r}:${p}:${KEY_LENGTH}:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(plainPassword, storedHash) {
  if (typeof plainPassword !== 'string' || typeof storedHash !== 'string') return false;

  const parts = storedHash.split(':');
  if (parts.length !== 7 || parts[0] !== SCHEME) return false;

  const [, nStr, rStr, pStr, keylenStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const keylen = Number(keylenStr);
  if (![N, r, p, keylen].every((n) => Number.isInteger(n) && n > 0)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== keylen) return false;

  let actual;
  try {
    // Параметры — из самой строки хеша (см. заголовок файла), не из
    // DEFAULT_PARAMS: иначе смена дефолтов для новых паролей сломала бы
    // проверку старых.
    actual = scryptSync(plainPassword, salt, keylen, { N, r, p });
  } catch {
    // Повреждённая или сфабрикованная строка (например, N — не степень
    // двойки, как того требует scrypt) — не валим процесс, просто "неверно".
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
