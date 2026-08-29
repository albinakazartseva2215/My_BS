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
