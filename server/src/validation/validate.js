// Общие проверки входных данных. Все бросают ApiError(400, ...) с понятным
// русским сообщением — вызывается в самом начале обработчика маршрута,
// до какого-либо обращения к БД (требование задачи).

import { badRequest } from '../http/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{5,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') throw badRequest(`Поле "${field}" должно быть строкой`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`Поле "${field}" не может быть пустым`);
  if (trimmed.length > max) throw badRequest(`Поле "${field}" слишком длинное (максимум ${max} символов)`);
  return trimmed;
}

export function optionalString(value, field, opts = {}) {
  if (value === undefined || value === null) return null;
  return requireString(value, field, opts);
}

export function requireEmail(value, field = 'email') {
  const email = requireString(value, field, { min: 3, max: 255 });
  if (!EMAIL_RE.test(email)) throw badRequest(`Поле "${field}" должно быть корректным e-mail`);
  return email.toLowerCase();
}

export function requirePhone(value, field = 'phone') {
  const phone = requireString(value, field, { min: 5, max: 32 });
  if (!PHONE_RE.test(phone)) throw badRequest(`Поле "${field}" должно быть телефоном (цифры, +, -, скобки, пробелы)`);
  return phone;
}

export function requirePassword(value, field = 'password') {
  if (typeof value !== 'string') throw badRequest(`Поле "${field}" должно быть строкой`);
  if (value.length < 8) throw badRequest(`Поле "${field}" должно быть не короче 8 символов`);
  if (value.length > 200) throw badRequest(`Поле "${field}" слишком длинное`);
  return value;
}

export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw badRequest(`Поле "${field}" должно быть true/false`);
  return value;
}

export function optionalBoolean(value, field, fallback = undefined) {
  if (value === undefined || value === null) return fallback;
  return requireBoolean(value, field);
}

export function requireInt(value, field, { min, max } = {}) {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) {
    throw badRequest(`Поле "${field}" должно быть целым числом`);
  }
  if (min !== undefined && num < min) throw badRequest(`Поле "${field}" должно быть не меньше ${min}`);
  if (max !== undefined && num > max) throw badRequest(`Поле "${field}" должно быть не больше ${max}`);
  return num;
}

export function optionalInt(value, field, opts = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireInt(value, field, opts);
}

export function requireIntArray(value, field, { min = 1, itemMin } = {}) {
  let arr = value;
  if (typeof arr === 'string') {
    arr = arr.split(',').map((s) => s.trim()).filter((s) => s !== '');
  }
  if (!Array.isArray(arr)) throw badRequest(`Поле "${field}" должно быть массивом идентификаторов`);
  if (arr.length < min) throw badRequest(`Поле "${field}" должно содержать хотя бы ${min} элемент(ов)`);
  const ints = arr.map((item) => requireInt(item, field, { min: itemMin ?? 1 }));
  const unique = [...new Set(ints)];
  if (unique.length !== ints.length) throw badRequest(`Поле "${field}" не должно содержать повторов`);
  return unique;
}

export function requireOneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest(`Поле "${field}" должно быть одним из: ${allowed.join(', ')}`);
  }
  return value;
}

export function requireDateString(value, field) {
  const str = requireString(value, field, { min: 10, max: 10 });
  if (!DATE_RE.test(str)) throw badRequest(`Поле "${field}" должно быть датой в формате YYYY-MM-DD`);
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw badRequest(`Поле "${field}" содержит несуществующую дату`);
  }
  return str;
}

export function requireTimeString(value, field) {
  const str = requireString(value, field, { min: 4, max: 5 });
  if (!TIME_RE.test(str)) throw badRequest(`Поле "${field}" должно быть временем в формате HH:MM`);
  return str;
}

// Принимает ISO-8601 datetime, обязательно в UTC ('Z' или '+00:00') —
// требование задачи: время принимается и хранится строго в UTC, чтобы на
// границе не оставалось неоднозначного локального времени без зоны.
// Возвращает объект Date.
export function requireUtcDateTime(value, field) {
  const str = requireString(value, field, { min: 19, max: 40 });
  const isUtc = /Z$|[+-]00:00$/.test(str);
  if (!isUtc) {
    throw badRequest(
      `Поле "${field}" должно быть временем в UTC (ISO-8601 с суффиксом "Z"), например 2026-09-01T11:00:00Z`,
    );
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) throw badRequest(`Поле "${field}" содержит некорректную дату/время`);
  return date;
}

export function ensureBodyIsObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Тело запроса должно быть JSON-объектом');
  }
  return body;
}
