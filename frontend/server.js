// Черновой dev-сервер для тестового фронтенда: раздаёт статику из public/
// и проксирует всё под /api на настоящий бэкенд (server/, порт 3000 по
// умолчанию). Без внешних зависимостей — тот же принцип, что и у бэкенда
// (server/README.md, раздел 2).
//
// Прокси, а не просто CORS-заголовки на бэкенде, выбран специально: тогда
// браузер видит один и тот же origin (http://localhost:5173) и для статики,
// и для API — сессионная cookie (HttpOnly, SameSite=Lax, без Secure в деве,
// см. server/src/http/cookies.js) работает без единой правки на бэкенде и
// без плясок с credentials/CORS на fetch.
//
// Запуск: npm start (из папки frontend/), бэкенд должен быть уже запущен
// (server/: npm run migrate && npm run seed && npm start).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 5173);
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';
const apiUrl = new URL(API_ORIGIN);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJsonError(res, status, message) {
  const body = JSON.stringify({ error: { code: 'proxy_error', message } });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Всё, что начинается с /api/, уходит на настоящий бэкенд как есть —
// метод, заголовки (включая Cookie), тело, query-строка. Ответ (включая
// Set-Cookie) прокидывается обратно без изменений.
function proxyApiRequest(req, res) {
  const targetOptions = {
    protocol: apiUrl.protocol,
    hostname: apiUrl.hostname,
    port: apiUrl.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: apiUrl.host },
  };

  const proxyReq = http.request(targetOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[frontend/server] бэкенд недоступен:', err.message);
    if (!res.headersSent) {
      sendJsonError(
        res,
        502,
        `Не удалось связаться с API на ${API_ORIGIN}. Убедитесь, что бэкенд запущен (server/: npm start).`,
      );
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

function serveStatic(req, res, pathname) {
  let relPath = decodeURIComponent(pathname);
  if (relPath === '/') relPath = '/index.html';
  // Уберём query/hash, если вдруг просочились, и не дадим выйти за public/.
  const resolved = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(400).end('Некорректный путь');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Страница не найдена: ' + relPath);
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname.startsWith('/api/')) {
    proxyApiRequest(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Метод не поддерживается для статики');
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(FRONTEND_PORT, () => {
  console.log(`[frontend/server] тестовый фронтенд: http://localhost:${FRONTEND_PORT}`);
  console.log(`[frontend/server] API проксируется на: ${API_ORIGIN}`);
});
