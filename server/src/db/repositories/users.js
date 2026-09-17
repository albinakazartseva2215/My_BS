import db from '../connection.js';

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Роли — списком в отдельной таблице (user_roles), не единственным
// значением в колонке users.role (требование: "храни роли списком, у
// одного человека может быть несколько ролей одновременно" — см.
// docs/db-schema.md, раздел 3.2, и "Спорные решения" про явный пересмотр
// более раннего решения "мастера не логинятся").
export function listRolesForUser(userId) {
  return db
    .prepare('SELECT role FROM user_roles WHERE user_id = ?')
    .all(userId)
    .map((r) => r.role);
}

// Пользователь вместе со своими ролями одним объектом — то, что должно
// попадать в ctx.user и в любой ответ API, а не голая строка из users.
export function findUserWithRolesById(id) {
  const user = findUserById(id);
  if (!user) return null;
  return { ...user, roles: listRolesForUser(id) };
}

export function findUserWithRolesByEmail(email) {
  const user = findUserByEmail(email);
  if (!user) return null;
  return { ...user, roles: listRolesForUser(user.id) };
}

export function userHasRole(userId, role) {
  return db.prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?').get(userId, role) !== undefined;
}

// INSERT OR IGNORE — идемпотентно: повторная выдача уже имеющейся роли не
// ошибка (например, при повторной привязке мастера к тому же аккаунту).
export function grantRole(userId, role) {
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').run(userId, role);
}

export function revokeRole(userId, role) {
  const info = db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role = ?').run(userId, role);
  return info.changes > 0;
}

// roles — непустой список хотя бы с одной ролью на момент создания
// (обычно ['client'] при обычной регистрации; список, а не одна роль, —
// на случай, если когда-нибудь понадобится завести пользователя сразу с
// несколькими ролями в одном месте, не через отдельные grantRole).
//
// passwordHash/provider/providerId — необязательные (миграция
// 009_yandex_oauth.sql, docs/db-schema.md, 3.2): обычная регистрация
// передаёт только passwordHash, вход через Яндекс (domain/yandexAuth.js) —
// только provider/providerId, пароля у такого аккаунта нет.
export function insertUser({
  name,
  email,
  phone,
  passwordHash = null,
  provider = null,
  providerId = null,
  roles,
  termsAcceptedAt,
  now,
}) {
  const info = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, provider, provider_id, terms_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(name, email, phone, passwordHash, provider, providerId, termsAcceptedAt, now, now);
  const userId = Number(info.lastInsertRowid);
  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)');
  for (const role of roles) insertRole.run(userId, role);
  return findUserWithRolesById(userId);
}

// Восстановление пароля (domain/passwordReset.js) — единственный вызывающий код.
export function updateUserPasswordHash(userId, passwordHash, now) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, userId);
}

// Привязка уже существующего (найденного по email) аккаунта к внешнему
// входу — domain/yandexAuth.js, findOrCreateYandexUser. Перезаписывает
// provider/provider_id безусловно и идемпотентно: повторный вход тем же
// Яндекс-аккаунтом просто подтверждает ту же связь ещё раз, а не считается
// ошибкой (UNIQUE(provider, provider_id), docs/db-schema.md, раздел 4,
// защищает от того, что два РАЗНЫХ наших аккаунта получат один и тот же
// provider_id — если такое всё же случится, вызов упадёт исключением
// UNIQUE-ограничения; это страховочный случай, отдельно не обрабатываем).
export function linkProviderToUser(userId, provider, providerId, now) {
  db.prepare('UPDATE users SET provider = ?, provider_id = ?, updated_at = ? WHERE id = ?').run(
    provider,
    providerId,
    now,
    userId,
  );
}

// Никогда не отдаётся password_hash или terms_accepted_at (внутренние поля) —
// требование задачи: не возвращать хеши паролей и лишние поля из БД.
// Ожидает row.roles — массив (см. findUserWithRolesById/ByEmail выше);
// если его нет, значит вызывающий код забыл подгрузить роли — намеренно
// не подставляем тут тихий дефолт [], чтобы такая ошибка была видна сразу.
export function toPublicUser(row) {
  if (!Array.isArray(row.roles)) {
    throw new TypeError('toPublicUser: row.roles должен быть массивом — используйте findUserWithRolesById/ByEmail');
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roles: row.roles,
  };
}
