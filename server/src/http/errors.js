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
