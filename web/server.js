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

// Пытается прочитать файлы-кандидаты по очереди и возвращает первый, что
// нашёлся. Нужно для "красивых" адресов раздела /admin (см. candidatesFor
// ниже) — по одному только URL не всегда напрямую видно имя физического
// файла, в отличие от остальных страниц web/, которые всегда ссылаются
// друг на друга полными именами с .html.
function readFirstExisting(candidates, index, cb) {
  if (index >= candidates.length) {
    cb(new Error('ENOENT'), null, null);
    return;
  }
  fs.readFile(candidates[index], (err, data) => {
    if (err) {
      readFirstExisting(candidates, index + 1, cb);
      return;
    }
    cb(null, data, candidates[index]);
  });
}

// Для пути без расширения (например /admin или /admin/services) пробуем по
// порядку: файл ровно с этим именем; index.html внутри одноимённой папки
// (тот же приём, что и "/" → "/index.html" ниже, только не только для
// корня); тот же путь с добавленным .html.
function candidatesFor(resolved) {
  const candidates = [resolved];
  if (path.extname(resolved) === '') {
    candidates.push(path.join(resolved, 'index.html'));
    candidates.push(resolved + '.html');
  }
  return candidates;
}

function serveStatic(req, res, pathname) {
  let relPath = decodeURIComponent(pathname);
  if (relPath === '/') relPath = '/index.html';
  const resolved = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(400).end('Некорректный путь');
    return;
  }

  readFirstExisting(candidatesFor(resolved), 0, (err, data, matchedPath) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Страница не найдена: ' + relPath);
      return;
    }
    const ext = path.extname(matchedPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ==================================================================
// Административный раздел (/admin) — доступ закрыт здесь же, на сервере,
// а не только в интерфейсе (задание: "закрой доступ на сервере, а не
// только в интерфейсе"). Это ВТОРАЯ по счёту, но не единственная линия
// защиты в проекте: каждый административный эндпоинт бэкенда отдельно и
// независимо проверяется на сервере API — requireRole(ctx, 'admin') в
// server/src/routes/admin.routes.js (объявление функции —
// server/src/middleware/auth.js:37-41). Проверка ниже касается только
// раздачи самих HTML-страниц веб-сервером web/ — она не заменяет и не
// дублирует ту, а закрывает свою часть периметра (иначе роль проверялась
// бы только при обращении к данным, а сама страница отдавалась бы всем).
// ==================================================================

const ADMIN_PREFIX = '/admin';

function isAdminPath(pathname) {
  return pathname === ADMIN_PREFIX || pathname.startsWith(ADMIN_PREFIX + '/');
}

// "Есть ли роль admin В СПИСКЕ ролей" — тем же способом, что и на сервере
// API (requireRole: user.roles.includes(role)), а не сравнением одного
// значения: у пользователя может быть несколько ролей одновременно
// (docs/db-schema.md, раздел 3.2).
function isAdminUser(user) {
  return !!user && Array.isArray(user.roles) && user.roles.includes('admin');
}

// Внутренний запрос к бэкенду с теми же cookie, что пришли в исходном
// запросе браузера, — тем же способом, что уже проксирует API (см.
// proxyApiRequest выше), только результат не отдаётся клиенту напрямую, а
// используется здесь для решения "пускать/не пускать" к странице.
function fetchCurrentUser(req, cb) {
  const options = {
    protocol: apiUrl.protocol,
    hostname: apiUrl.hostname,
    port: apiUrl.port,
    method: 'GET',
    path: '/api/auth/me',
    headers: { cookie: req.headers.cookie || '', host: apiUrl.host },
  };
  const apiReq = http.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', (chunk) => { raw += chunk; });
    apiRes.on('end', () => {
      if (apiRes.statusCode !== 200) { cb(null); return; } // 401 — не вошёл
      try {
        cb(JSON.parse(raw).user || null);
      } catch {
        cb(null);
      }
    });
  });
  apiReq.on('error', () => cb(null)); // бэкенд недоступен — считаем, что не вошёл, не 500
  apiReq.end();
}

function serveForbidden(res) {
  const filePath = path.join(PUBLIC_DIR, 'admin', '403.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Этот раздел только для администраторов.');
      return;
    }
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
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
  if (isAdminPath(pathname)) {
    fetchCurrentUser(req, (user) => {
      if (!isAdminUser(user)) {
        serveForbidden(res); // HTTP 403 — не только текст на экране, но и код ответа
        return;
      }
      serveStatic(req, res, pathname);
    });
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(WEB_PORT, () => {
  console.log(`[web/server] лендинг: http://localhost:${WEB_PORT}`);
  console.log(`[web/server] API проксируется на: ${API_ORIGIN}`);
});
