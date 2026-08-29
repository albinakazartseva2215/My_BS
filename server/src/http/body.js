// Чтение и разбор JSON-тела запроса без внешних библиотек вроде body-parser.

import { badRequest } from './errors.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 МБ с запасом — этому API хватает с большим запасом

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const method = req.method;
    if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
      resolve({});
      return;
    }

    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(badRequest('Тело запроса слишком большое'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(badRequest('Тело запроса должно быть JSON-объектом'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(badRequest('Некорректный JSON в теле запроса'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}
