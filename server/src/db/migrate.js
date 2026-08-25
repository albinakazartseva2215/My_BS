// Простой раннер миграций: без внешних библиотек, на голом node:sqlite.
//
// Как это работает:
//  - каждая миграция — файл *.sql в src/db/migrations/, имя начинается
//    с числового префикса (0001_init.sql, 0002_..., ...) — этот префикс
//    задаёт порядок применения;
//  - какие файлы уже применены, хранится в служебной таблице
//    schema_migrations прямо в самой базе;
//  - при запуске применяются только те файлы, которых ещё нет в этой
//    таблице, каждый — в своей транзакции.
//
// Запуск: npm run migrate (из папки server/)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import db from './connection.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, 'migrations');

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
    );
  `);
}

function getAppliedMigrations() {
  const rows = db.prepare('SELECT filename FROM schema_migrations').all();
  return new Set(rows.map((row) => row.filename));
}

export function migrate() {
  ensureMigrationsTable();
  const applied = getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const markApplied = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
  let appliedCount = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    db.exec('BEGIN');
    try {
      db.exec(sql);
      markApplied.run(file);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`миграция ${file} не применилась: ${error.message}`, { cause: error });
    }

    console.log(`применена миграция: ${file}`);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    console.log('новых миграций нет, база уже актуальна');
  }
}

// Запуск как самостоятельного скрипта (а не только импорт из других файлов).
// Сравнение через pathToFileURL, а не ручную сборку "file://" + путь —
// на Windows путь должен стать "file:///C:/...", простая конкатенация
// даёт "file://C:/..." и сравнение никогда не совпадает.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  migrate();
}
