// Разбор и сборка Cookie/Set-Cookie без внешних пакетов — формат простой,
// писать целую библиотеку ради него не нужно.

export function parseCookies(req) {
  const header = req.headers.cookie;
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

const SESSION_COOKIE_NAME = 'session';

export function serializeSessionCookie(token, expiresAt, { secure } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeSessionCookieClear({ secure } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export { SESSION_COOKIE_NAME };
