// Полный пересброс базы: удаляет файл SQLite (и его WAL/SHM-спутники)
// и заново накатывает все миграции с нуля.
//
// Осознанно не наполняет данными — «пересоздать базу» и «наполнить
// тестовыми данными» это два разных действия с разным смыслом
// (например, на CI нужен только пересбор схемы, без сидов).
// Тестовые данные — отдельным шагом: npm run seed.
//
// Запуск: npm run db:reset (из папки server/)

import fs from 'node:fs';
import { env } from '../config/env.js';

// Та же защита, что и в seed.js: reset необратимо удаляет файл базы,
// на проде это буквально потеря всех записей клиентов без возможности
// отменить. Ошибиться и запустить не тот npm-скрипт на боевом сервере
// довольно легко — пусть в этом случае скрипт откажется работать сам,
// а не полагается на то, что человек не ошибётся.
if (env.isProduction) {
  console.error('reset.js необратимо удаляет файл базы: NODE_ENV=production, выхожу без изменений');
  process.exit(1);
}

const filesToRemove = [env.databaseFile, `${env.databaseFile}-wal`, `${env.databaseFile}-shm`];

for (const file of filesToRemove) {
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`удалён файл: ${file}`);
  }
}

// Импорт после удаления файлов: connection.js (его подключает migrate.js)
// откроет DatabaseSync и тем самым создаст файл заново, уже пустым.
const { migrate } = await import('./migrate.js');
migrate();

console.log('база пересоздана с нуля');
