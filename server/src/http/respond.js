// Отправка JSON-ответов — единственное место, где сервер пишет в res,
// чтобы формат ответа (Content-Type, кодировка, форма ошибки) был
// одинаковым для всех маршрутов.

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res, status, code, message, details) {
  sendJson(res, status, { error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

// Редирект браузера (302) — нужен там, где ответ на запрос не JSON, а
// переход на другую страницу (routes/auth.routes.js, поход на Яндекс и
// обратно: пользователь должен реально попасть на страницу Яндекса и
// вернуться, это не AJAX-вызов, который умеет показать JSON). Отдельная
// функция, а не sendJson с другим Content-Type — тело редиректа не нужно
// вовсе, а status здесь всегда 3xx, что и так видно по названию.
export function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
