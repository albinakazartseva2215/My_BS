// Бутстрап первого администратора для окружений, где нет другого способа
// его завести: seed.js (демо-данные) сам отказывается работать при
// NODE_ENV=production (см. src/db/seed.js), а публичная регистрация
// (routes/auth.routes.js) всегда выдаёт только роль 'client' — иначе кто
// угодно мог бы зарегистрироваться администратором. Значит, на чистом
// проде без ручного похода в БД зайти было бы вообще некем.
//
// Что делает: при старте, если в базе ещё нет ни одного пользователя с
// ролью 'admin', создаёт одного — email берётся из ADMIN_EMAIL (или
// дефолт ниже), пароль либо из ADMIN_PASSWORD, либо придумывается сам и
// сохраняется в файл рядом с базой (тот же смонтированный том, что и
// .session_secret, см. src/config/env.js) — тем же приёмом, чтобы не
// класть пароль в docker-compose.yml. Если админ уже есть — ничего не
// делает, при каждом перезапуске контейнера это дешёвая проверка.
//
// Используется только для production (вызывается из src/index.js под
// env.isProduction) — в разработке администратора заводит npm run seed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from './connection.js';
import { env } from '../config/env.js';
import { insertUser } from './repositories/users.js';
import { hashPassword } from '../security/passwords.js';
import { dateToSql } from '../time/salonClock.js';

const DEFAULT_ADMIN_EMAIL = 'admin@ton-salon.local';
const DEFAULT_ADMIN_PHONE = '+7 000 000-00-00';

function hasAnyAdmin() {
  return db.prepare("SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1").get() !== undefined;
}

function generatePassword() {
  // 12 символов из URL-safe алфавита (a-zA-Z0-9-_) — 9 случайных байт,
  // это ~72 бита энтропии, с большим запасом сверх минимума в 8 символов
  // (requirePassword, validation/validate.js) и достаточно, чтобы не
  // подбираться перебором.
  return crypto.randomBytes(9).toString('base64url');
}

export function ensureAdminUser() {
  if (hasAnyAdmin()) return;

  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const credentialsFile = path.join(path.dirname(env.databaseFile), 'admin-credentials.txt');

  let password = process.env.ADMIN_PASSWORD;
  let passwordSource = 'ADMIN_PASSWORD';
  if (!password) {
    // Файл может уже существовать, если процесс когда-то создавал его, но
    // строка в users потом пропала (например, том с базой пересоздали, а
    // файл секретов — нет, или наоборот). Переиспользуем пароль из файла,
    // а не молча меняем его на новый под тем же email.
    if (fs.existsSync(credentialsFile)) {
      const saved = parseSavedPassword(fs.readFileSync(credentialsFile, 'utf8'));
      if (saved) {
        password = saved;
        passwordSource = 'файл (создан ранее)';
      }
    }
  }
  if (!password) {
    password = generatePassword();
    passwordSource = 'сгенерирован';
  }

  const now = dateToSql(new Date());
  let user;
  try {
    user = insertUser({
      name: 'Администратор',
      email,
      phone: DEFAULT_ADMIN_PHONE,
      passwordHash: hashPassword(password),
      roles: ['admin'],
      termsAcceptedAt: now,
      now,
    });
  } catch (error) {
    // Скорее всего — UNIQUE(email): кто-то уже зарегистрировался с этим
    // адресом как клиент. Не валим старт сервера из-за этого — админа
    // тогда придётся завести вручную (см. server/DEPLOY.md), но это не
    // повод не отвечать на остальные запросы.
    console.error(
      `[ensureAdmin] не удалось создать администратора (${email}): ${error.message}. ` +
        'Если e-mail уже занят другим пользователем — задайте ADMIN_EMAIL и перезапустите контейнер.',
    );
    return;
  }

  if (passwordSource !== 'файл (создан ранее)') {
    fs.writeFileSync(
      credentialsFile,
      `email: ${email}\npassword: ${password}\n`,
      { mode: 0o600 },
    );
  }

  console.warn('[ensureAdmin] создан первый администратор — используйте для входа в панель:');
  console.warn(`[ensureAdmin]   email:    ${email}`);
  console.warn(`[ensureAdmin]   password: ${password} (${passwordSource}; сохранён в ${credentialsFile})`);
  console.warn('[ensureAdmin] смените пароль после первого входа — второй раз это сообщение не появится.');

  return user;
}

function parseSavedPassword(fileContents) {
  const match = /^password:\s*(.+)$/m.exec(fileContents);
  return match ? match[1].trim() : null;
}
