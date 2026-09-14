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

// Нужен ли атрибут Secure у Set-Cookie сессии — ответ на вопрос "эта
// конкретная связь с браузером реально HTTPS?", а не "включён ли вообще
// NODE_ENV=production". Раньше эти два вопроса путали (secure: isProduction) —
// в результате на проде без ещё не настроенного домена/HTTPS (сайт открыт
// по голому IP, как сейчас — см. server/DEPLOY.md) сервер помечал cookie
// как Secure, а реальное соединение было обычным http://, и браузер такую
// cookie молча не сохранял: вход отвечал 200 и правильным пользователем,
// но сессия тут же "забывалась" — все защищённые страницы выглядели так,
// будто вы не вошли.
//
//  - req.socket.encrypted — правда, если TLS завершает сам этот процесс
//    (сейчас нигде так не запущено — везде http.createServer, см.
//    src/index.js, — но на случай, если это когда-нибудь изменится).
//  - X-Forwarded-Proto — так обратный прокси (например, Traefik у
//    Coolify, когда для сервиса настроен домен + HTTPS) сообщает, каким
//    был протокол ДО себя, потому что до этого процесса запрос доходит
//    уже как обычный http. Без прокси перед процессом (как в текущем
//    деплое — порт из docker-compose.yml проброшен на контейнер
//    напрямую) заголовка просто не будет, и результат — false, что
//    совпадает с реальностью.
export function isRequestSecure(req) {
  if (req.socket && req.socket.encrypted) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (!forwardedProto) return false;
  return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
}

export { SESSION_COOKIE_NAME };
