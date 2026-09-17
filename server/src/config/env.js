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

// путь резолвится от корня server/, а не от текущей рабочей директории,
// чтобы скрипты одинаково работали независимо от того, откуда их запустили
const resolvedDatabaseFile = path.resolve(import.meta.dirname, '../..', DATABASE_FILE);

// Ключ для HMAC-хеша токена сессии (docs/db-schema.md, раздел 3.3а;
// src/security/session.js, src/domain/session.js) — это настоящий
// секрет: утечка даёт возможность подобрать/подтвердить хеш токена,
// поэтому нигде, кроме .env/файла рядом с базой, и никогда в самой БД
// (там же лежит token_hash — хранить рядом ещё и ключ к нему было бы
// бессмысленно) и никогда в docker-compose.yml/истории git — это то, что
// заведомо утечёт при закрытии репозитория никогда не бывающем полностью
// надёжным (история хранит всё, доступ рано или поздно получает кто-то
// ещё).
//
// Если SESSION_SECRET явно не задан переменной окружения, приложение
// придумывает его само при первом запуске и сохраняет в файл рядом с
// файлом базы (тот же смонтированный том /data, что переживает
// пересборку образа) — при следующих запусках просто читает его оттуда.
// Так секрет не нужно ни задавать руками, ни класть в docker-compose.yml.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  const sessionSecretFile = path.join(path.dirname(resolvedDatabaseFile), '.session_secret');
  try {
    fs.mkdirSync(path.dirname(sessionSecretFile), { recursive: true });
    if (fs.existsSync(sessionSecretFile)) {
      sessionSecret = fs.readFileSync(sessionSecretFile, 'utf8').trim();
    }
    if (!sessionSecret) {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      // 0o600 — читать/писать может только владелец файла (процесс Node
      // внутри контейнера), не "все, у кого есть доступ к тому".
      fs.writeFileSync(sessionSecretFile, sessionSecret, { mode: 0o600 });
      console.warn(
        `[env] SESSION_SECRET не задан — сгенерирован случайный и сохранён в ${sessionSecretFile}. ` +
          'Он переживёт пересборку и перезапуск контейнера (файл лежит на том же томе, что и база). ' +
          'Чтобы задать секрет явно (например, при переносе на другой сервер), пропишите SESSION_SECRET.',
      );
    }
  } catch (error) {
    // Диск/том недоступен на запись — не подсовываем тихо секрет, который
    // исчезнет при перезапуске и разлогинит всех: в production это те же
    // риски, что раньше решались отказом стартовать без SESSION_SECRET.
    if (NODE_ENV === 'production') {
      throw new Error(
        `Не удалось создать/прочитать файл секрета сессий (${sessionSecretFile}): ${error.message}. ` +
          'Либо смонтируйте том на запись, либо задайте SESSION_SECRET явно.',
        { cause: error },
      );
    }
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[env] не удалось сохранить SESSION_SECRET на диск — использую случайный секрет на время ' +
        `работы процесса (${error.message}); все сессии обнулятся при перезапуске.`,
    );
  }
}

export const env = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  databaseFile: resolvedDatabaseFile,
  port: PORT,
  sessionSecret,
  // sessionTtlDays и passwordResetTtlMinutes — параметры безопасности
  // (насколько долго действителен токен входа/сброса пароля), а не
  // продуктовые настройки бронирования — в отличие от
  // hold_duration_minutes, который переехал в salon_profile
  // (docs/db-schema.md, "Спорные решения", п.15): это решение
  // разработчика/эксплуатации, не то, что должен крутить администратор
  // салона через настройки продукта.
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30),
  // Заглушка входа через Яндекс (domain/yandexAuth.js) — ВРЕМЕННОЕ решение
  // на время, пока у сервиса нет постоянного адреса для redirect_uri и
  // приложение на oauth.yandex.ru не зарегистрировано (см. .env.example,
  // server/README.md). Выключена по умолчанию; включённая, она подставляет
  // ОДИН и тот же тестовый email/имя вместо реального Яндекса — это не
  // авторизация, а имитация ответа Яндекса для проверки нашей части кода.
  yandexLoginStub: {
    enabled: process.env.YANDEX_LOGIN_STUB_ENABLED === 'true',
    email: process.env.YANDEX_LOGIN_STUB_EMAIL || 'yandex-stub@ton-salon.test',
    name: process.env.YANDEX_LOGIN_STUB_NAME || 'Тестовый пользователь Яндекс',
  },
};

// Жёсткий запрет, а не только предупреждение в документации: с включённой
// заглушкой в production любой, кто вызовет POST /api/auth/yandex/login,
// вошёл бы под одним и тем же тестовым аккаунтом без единой проверки
// личности — это не гипотетическая дыра, а полный обход входа. Тот же
// приём fail-fast, что и у проверки версии Node (db/connection.js): падать
// сразу при старте с понятным сообщением, а не отвечать на боевые запросы
// поверх включённой заглушки.
if (env.isProduction && env.yandexLoginStub.enabled) {
  throw new Error(
    'YANDEX_LOGIN_STUB_ENABLED=true запрещён при NODE_ENV=production — это заглушка для проверки входа через ' +
      'Яндекс без самого Яндекса (см. .env.example), с ней вход открыт под одним тестовым аккаунтом для кого ' +
      'угодно. Уберите переменную или поставьте false.',
  );
}
