// Сборка HTTP-приложения: роутер + сквозная обработка запроса (тело,
// пользователь из сессии, единая обработка ошибок). Экспортирует
// requestListener для http.createServer — сам server.listen(...) в index.js,
// чтобы app.js можно было использовать и в тестах без реального сокета.

import { URL } from 'node:url';
import { Router } from './http/router.js';
import { readJsonBody } from './http/body.js';
import { sendJson, sendError, sendRedirect } from './http/respond.js';
import { ApiError } from './http/errors.js';
import { resolveCurrentUser } from './middleware/auth.js';

import { registerRoutes as registerAuthRoutes } from './routes/auth.routes.js';
import { registerRoutes as registerCatalogRoutes } from './routes/catalog.routes.js';
import { registerRoutes as registerAvailabilityRoutes } from './routes/availability.routes.js';
import { registerRoutes as registerHoldsRoutes } from './routes/holds.routes.js';
import { registerRoutes as registerAppointmentsRoutes } from './routes/appointments.routes.js';
import { registerRoutes as registerMasterRoutes } from './routes/master.routes.js';
import { registerRoutes as registerAdminRoutes } from './routes/admin.routes.js';
import { registerRoutes as registerNotificationsRoutes } from './routes/notifications.routes.js';

const router = new Router();
registerAuthRoutes(router);
registerCatalogRoutes(router);
registerAvailabilityRoutes(router);
registerHoldsRoutes(router);
registerAppointmentsRoutes(router);
registerMasterRoutes(router);
registerAdminRoutes(router);
registerNotificationsRoutes(router);

export async function requestListener(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    sendError(res, 400, 'bad_request', 'Некорректный URL');
    return;
  }

  const match = router.match(req.method, url.pathname);
  if (!match) {
    sendError(res, 404, 'not_found', 'Маршрут не найден');
    return;
  }
  if (match.methodNotAllowed) {
    res.setHeader('Allow', match.allowedMethods.join(', '));
    sendError(res, 405, 'method_not_allowed', `Метод не поддерживается, доступны: ${match.allowedMethods.join(', ')}`);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const user = resolveCurrentUser(req);
    const query = Object.fromEntries(url.searchParams.entries());
    const ctx = { req, res, params: match.params, query, body, user };

    const result = await match.handler(ctx);
    // Обычный путь — JSON; result.redirect — только у маршрутов похода на
    // Яндекс и обратно (routes/auth.routes.js), где ответ — переход
    // браузера на другую страницу, а не тело для AJAX-вызова.
    if (result.redirect) {
      sendRedirect(res, result.redirect);
    } else {
      sendJson(res, result.status, result.body);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err.status, err.code, err.message, err.details);
      return;
    }
    console.error('[app] необработанная ошибка:', err);
    sendError(res, 500, 'internal_error', 'Внутренняя ошибка сервера');
  }
}
