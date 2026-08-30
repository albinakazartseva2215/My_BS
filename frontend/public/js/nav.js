// Общий кусок логики шапки: кто вошёл, кнопка "Выйти". Подключается на
// каждой странице; сама разметка nav — статический HTML в каждом файле
// (обычные ссылки, никакого роутинга).

import { apiFetch, showError } from './api.js';

async function initNav() {
  const statusEl = document.getElementById('nav-status');
  if (!statusEl) return;

  try {
    const data = await apiFetch('/auth/me');
    const user = data.user;
    statusEl.innerHTML =
      `Вы вошли как <b>${escapeHtml(user.name)}</b> (${escapeHtml(user.email)}), ` +
      `роли: ${user.roles.map((r) => `<code>${escapeHtml(r)}</code>`).join(' ')} ` +
      `— <button id="logout-btn" type="button" class="small">Выйти</button>`;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
      } catch (err) {
        // logout всё равно "должен" сработать локально даже если запрос
        // не удался сетевым образом — но покажем ошибку, а не скроем её.
        console.error(err);
      }
      window.location.href = 'login.html';
    });
  } catch (err) {
    statusEl.innerHTML = `Вы не вошли — <a href="login.html">Войти</a> / <a href="register.html">Регистрация</a>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', initNav);
