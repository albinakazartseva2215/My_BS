// Точка входа HTTP API. Требует уже применённых миграций (npm run migrate)
// и, для ручной проверки, тестовых данных (npm run seed) — сам сервер
// схему не создаёт и не сидирует.
//
// Запуск: npm start (из папки server/)

import http from 'node:http';
import { requestListener } from './app.js';
import { env } from './config/env.js';
import { releaseExpiredHolds } from './domain/holdExpiry.js';
import { completePastAppointments } from './domain/completionSweep.js';
import { sweepExpiredBuckets } from './middleware/rateLimit.js';

const server = http.createServer((req, res) => {
  requestListener(req, res).catch((err) => {
    console.error('[index] сбой обработчика запроса:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' } }));
  });
});

server.listen(env.port, () => {
  console.log(`[index] API слушает http://localhost:${env.port} (NODE_ENV=${env.nodeEnv})`);
});

// Фоновая зачистка истёкших удержаний (требование 4 задачи) — не только
// лениво перед расчётами, но и по таймеру, чтобы слоты освобождались, даже
// если в этот момент никто не делает запросов к API. Заодно — фоновая
// половина docs/db-schema.md, раздел 6 ("completed... проставляется
// фоновой задачей или админом"): прошедшие подтверждённые визиты не должны
// зависать в confirmed до первого запроса к /api/admin/appointments.
const SWEEP_INTERVAL_MS = 60_000;
const sweepTimer = setInterval(() => {
  try {
    releaseExpiredHolds();
  } catch (err) {
    console.error('[index] ошибка фоновой зачистки истёкших удержаний:', err);
  }
  try {
    completePastAppointments();
  } catch (err) {
    console.error('[index] ошибка фоновой зачистки завершённых визитов:', err);
  }
  try {
    sweepExpiredBuckets();
  } catch (err) {
    console.error('[index] ошибка зачистки счётчиков ограничения частоты запросов:', err);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref(); // не должен держать процесс живым сам по себе

function shutdown() {
  console.log('[index] завершение работы...');
  clearInterval(sweepTimer);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
