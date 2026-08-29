// Минимальный роутер без внешних зависимостей (без express) — в духе
// остального бэкенда ("Node.js и SQLite и ничего третьего", см.
// server/README.md, раздел 2). Поддерживает только то, что нужно этому
// API: методы, статические сегменты и параметры вида :id.

export class Router {
  #routes = [];

  #add(method, pattern, handler) {
    const paramNames = [];
    const regexSource = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.#routes.push({ method, regex: new RegExp(`^${regexSource}$`), paramNames, handler });
  }

  get(pattern, handler) {
    this.#add('GET', pattern, handler);
  }

  post(pattern, handler) {
    this.#add('POST', pattern, handler);
  }

  patch(pattern, handler) {
    this.#add('PATCH', pattern, handler);
  }

  put(pattern, handler) {
    this.#add('PUT', pattern, handler);
  }

  delete(pattern, handler) {
    this.#add('DELETE', pattern, handler);
  }

  // Возвращает { handler, params } либо null. Если путь совпал у другого
  // метода — это тоже полезно знать вызывающему коду (405 вместо 404),
  // поэтому отдельно возвращаем набор разрешённых методов.
  match(method, pathname) {
    const allowedMethods = new Set();
    for (const route of this.#routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      allowedMethods.add(route.method);
      if (route.method !== method) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params };
    }
    if (allowedMethods.size > 0) {
      return { methodNotAllowed: true, allowedMethods: [...allowedMethods] };
    }
    return null;
  }
}
