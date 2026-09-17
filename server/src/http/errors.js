// Единый тип ошибки для всего API. Роуты бросают ApiError (или её фабрики
// ниже), а центральный обработчик в app.js превращает это в осмысленный
// JSON-ответ с нужным HTTP-статусом — 400/401/403/404/409 по требованиям
// задачи, а не голый 500 на любую проблему.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Требуется вход в аккаунт') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Недостаточно прав') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Не найдено') => new ApiError(404, 'not_found', message);
export const conflict = (message, details) => new ApiError(409, 'conflict', message, details);
export const tooManyRequests = (message, details) => new ApiError(429, 'too_many_requests', message, details);
// Функция существует в коде, но сознательно не реализована. Не 500
// ("что-то сломалось") — это ожидаемое, объяснимое состояние.
export const notImplemented = (message) => new ApiError(501, 'not_implemented', message);
// Мы сами выступили "шлюзом" к внешнему сервису (Яндексу — обмен кода на
// токен, запрос профиля, domain/yandexAuth.js) и получили от него ответ,
// которого не ждали: не HTTP 200, не тот JSON. Отдельный код статуса, а не
// 500 — проблема не в нашем сервере, а в ответе того, к кому мы обратились.
export const badGateway = (message, details) => new ApiError(502, 'bad_gateway', message, details);
