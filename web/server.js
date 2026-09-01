// Dev-сервер для web/: раздаёт статику из этой папки и проксирует всё
// под /api на бэкенд (server/, порт 3000 по умолчанию). Без внешних
// зависимостей — тот же приём, что уже применён в frontend/server.js для
// чернового тестового фронтенда.
//
// Прокси, а не CORS-заголовки на бэкенде: браузер видит один и тот же
// origin и для статики, и для API, поэтому сессионная cookie входа
// (HttpOnly, SameSite=Lax) будет работать без единой правки в server/,
// когда экраны с авторизацией здесь появятся.
//
// Запуск: npm start (из web/), бэкенд должен быть уже поднят
// (server/: npm run migrate && npm run seed && npm start).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = __dirname;

const WEB_PORT = Number(process.env.WEB_PORT || 5174);
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

// Всё, что начинается с /api/, уходит на настоящий бэкенд как есть.
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
    console.error('[web/server] бэкенд недоступен:', err.message);
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

server.listen(WEB_PORT, () => {
  console.log(`[web/server] лендинг: http://localhost:${WEB_PORT}`);
  console.log(`[web/server] API проксируется на: ${API_ORIGIN}`);
});
