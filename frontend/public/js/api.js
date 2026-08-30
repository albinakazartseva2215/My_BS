// Тонкая обёртка над fetch для всего фронтенда. Один центральный поток
// ошибок — apiFetch всегда бросает ApiRequestError с текстом, готовым к
// показу пользователю, а не только в консоль (требование задачи).

export class ApiRequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (networkErr) {
    console.error('[api] сеть недоступна:', networkErr);
    throw new ApiRequestError(
      0,
      'network_error',
      'Не удалось связаться с сервером. Проверьте, что бэкенд (server/) и фронтенд-прокси (frontend/) запущены.',
    );
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // не-JSON ответ (например, статика 404 от прокси) — покажем как есть
      data = null;
    }
  }

  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiRequestError(
      res.status,
      err.code || 'unknown_error',
      err.message || text || `Ошибка запроса, HTTP ${res.status}`,
      err.details,
    );
  }

  return data;
}

// Форматирует ошибку для показа на странице текстом — требование задачи:
// "если время занято, пользователь должен увидеть понятное сообщение",
// и в целом ошибки API — не только в консоль.
export function describeError(err) {
  if (!(err instanceof ApiRequestError)) {
    return err && err.message ? err.message : String(err);
  }
  let text = err.message;
  if (err.status === 409) {
    text = `Это время уже занято или конфликтует с другой записью: ${err.message}`;
  } else if (err.status === 401) {
    text = `Нужно войти в аккаунт: ${err.message}`;
  } else if (err.status === 403) {
    text = `Недостаточно прав: ${err.message}`;
  } else if (err.status === 0) {
    text = err.message;
  }
  if (err.details && err.details.field) {
    text += ` [поле: ${err.details.field}]`;
  }
  return `${text} (HTTP ${err.status || '—'}, ${err.code})`;
}

export function showError(el, err) {
  if (!el) return;
  if (!err) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = describeError(err);
}

export function showOk(el, text) {
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

export function clearBox(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

// Разбор списка id через запятую в форме "1, 2,3" -> [1,2,3]. Бросает
// понятную ошибку, а не NaN, если ввели мусор.
export function parseIdList(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new Error(`"${s}" — не целое число`);
      return n;
    });
}

// datetime-local input ("2026-09-01T11:00") трактуем как локальное время
// БРАУЗЕРА пользователя и переводим в UTC ISO с суффиксом Z — так проще
// всего дать тестировщику вводить дату/время без ручного пересчёта в UTC.
export function localInputToUtcIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// UTC ISO -> значение для <input type=datetime-local> (локальное время
// браузера), для предзаполнения форм переноса записи.
export function utcIsoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
