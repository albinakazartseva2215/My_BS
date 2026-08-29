// Загрузка и нормализация переменных окружения.
// Используется всеми скриптами в src/db/*, а также API-сервером.

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Node (>=20.6) умеет читать .env сам, без пакета dotenv.
// .env — локальный, необязательный: на CI/проде переменные обычно
// приходят из окружения напрямую, поэтому файл может отсутствовать.
const envFilePath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_FILE = process.env.DATABASE_FILE || './data/database.sqlite';
const PORT = Number(process.env.PORT || 3000);

// Секрет для подписи сессионных токенов (см. src/security/session.js).
// Сессии сделаны без отдельной таблицы в БД (её нет в docs/db-schema.md) —
// подписанный токен несёт id пользователя и срок действия, сервер только
// проверяет подпись. Без SESSION_SECRET в проде токены нельзя доверять —
// приложение отказывается стартовать. В деве, если секрет не задан,
// генерируем случайный на процесс: сессии просто слетят при перезапуске.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET не задан. В production он обязателен — без него подписи ' +
        'сессионных токенов будут меняться при каждом перезапуске процесса, и все ' +
        'пользователи разлогинятся. Задайте случайную строку (например, ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`).',
    );
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[env] SESSION_SECRET не задан — использую случайный секрет на время работы процесса ' +
      '(все сессии обнулятся при перезапуске). Для устойчивых сессий задайте SESSION_SECRET в .env.',
  );
}

export const env = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  // путь резолвится от корня server/, а не от текущей рабочей директории,
  // чтобы скрипты одинаково работали независимо от того, откуда их запустили
  databaseFile: path.resolve(import.meta.dirname, '../..', DATABASE_FILE),
  port: PORT,
  sessionSecret,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  holdDurationMinutes: Number(process.env.HOLD_DURATION_MINUTES || 10),
  // Срок жизни токена восстановления пароля (docs/db-schema.md, 3.3:
  // "короткий срок жизни, например 30 минут").
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30),
};
