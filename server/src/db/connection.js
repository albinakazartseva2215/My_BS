// Единая точка подключения к SQLite. Всё остальное в проекте — миграции,
// сиды, а позже и API — берёт соединение отсюда, а не открывает своё.
//
// БД — встроенный в сам Node.js модуль node:sqlite, без внешних пакетов.
// На сервере (BeGet) заранее не известно, какая версия Node установлена,
// поэтому здесь же — явная проверка версии с понятной ошибкой вместо
// невнятного падения где-то дальше по коду.

import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

// node:sqlite впервые появился в Node 22.5.0 (experimental). Если версия
// ниже — модуля физически не существует, и import ниже упал бы с сырым
// ERR_MODULE_NOT_FOUND. Проверяем сами и объясняем, что делать.
const MIN_NODE_VERSION = [22, 5];
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const isTooOld =
  nodeMajor < MIN_NODE_VERSION[0] ||
  (nodeMajor === MIN_NODE_VERSION[0] && nodeMinor < MIN_NODE_VERSION[1]);

if (isTooOld) {
  throw new Error(
    `Установлен Node.js ${process.versions.node}, а модуль node:sqlite появился только ` +
      `в Node ${MIN_NODE_VERSION.join('.')}.0. Обновите Node.js на сервере (на BeGet — через панель ` +
      `управления или nvm: "nvm install --lts && nvm use --lts") и запустите снова.`,
  );
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  // Между 22.5 и тем моментом, когда фичу включили по умолчанию, node:sqlite
  // существовал, но требовал флаг --experimental-sqlite. Все npm-скрипты
  // в этом проекте (migrate/seed/db:reset) уже передают этот флаг сами —
  // если ошибка всё равно здесь, скорее всего скрипт запустили напрямую
  // через "node ...", а не через "npm run ...".
  throw new Error(
    `Не удалось загрузить встроенный модуль node:sqlite (Node.js ${process.versions.node}). ` +
      'Если версия Node — 22.5–23.x, ей может требоваться флаг --experimental-sqlite: ' +
      'запускайте через "npm run migrate" / "npm run seed" / "npm run db:reset", а не напрямую ' +
      'через "node src/db/....js" — флаг уже прописан в package.json.',
    { cause: error },
  );
}

// Файл базы лежит в server/data/ — создаём папку, если её ещё нет
// (например, при самом первом запуске на чистой машине).
fs.mkdirSync(path.dirname(env.databaseFile), { recursive: true });

export const db = new DatabaseSync(env.databaseFile);

// SQLite по умолчанию не проверяет внешние ключи — без этой прагмы
// ON DELETE CASCADE / SET NULL и вообще ссылочная целостность из
// docs/db-schema.md молча не будут соблюдаться.
db.exec('PRAGMA foreign_keys = ON');

// WAL: читающие запросы не блокируются записью — разумный дефолт для
// веб-бэкенда, где чтение (расчёт свободного времени) намного чаще записи.
db.exec('PRAGMA journal_mode = WAL');

export default db;
