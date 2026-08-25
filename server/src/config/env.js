// Загрузка и нормализация переменных окружения.
// Используется всеми скриптами в src/db/*, а позже — и API-сервером.

import path from 'node:path';
import fs from 'node:fs';

// Node (>=20.6) умеет читать .env сам, без пакета dotenv.
// .env — локальный, необязательный: на CI/проде переменные обычно
// приходят из окружения напрямую, поэтому файл может отсутствовать.
const envFilePath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_FILE = process.env.DATABASE_FILE || './data/database.sqlite';

export const env = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  // путь резолвится от корня server/, а не от текущей рабочей директории,
  // чтобы скрипты одинаково работали независимо от того, откуда их запустили
  databaseFile: path.resolve(import.meta.dirname, '../..', DATABASE_FILE),
};
