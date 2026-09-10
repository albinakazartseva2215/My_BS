import db from '../connection.js';

export function listActiveServices() {
  return db
    .prepare(
      `SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
       WHERE s.is_active = 1
       ORDER BY c.sort_order ASC, s.name ASC`,
    )
    .all();
}

export function listAllServicesForAdmin() {
  return db
    .prepare(
      `SELECT s.*, c.name AS category_name
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
       ORDER BY c.sort_order ASC, s.name ASC`,
    )
    .all();
}

export function findServiceById(id) {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
}

export function findServicesByIds(ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM services WHERE id IN (${placeholders})`).all(...ids);
}

export function findCategoryById(id) {
  return db.prepare('SELECT * FROM service_categories WHERE id = ?').get(id);
}

export function findCategoryByName(name) {
  return db.prepare('SELECT * FROM service_categories WHERE name = ?').get(name);
}

export function listAllCategories() {
  return db.prepare('SELECT * FROM service_categories ORDER BY sort_order ASC, name ASC').all();
}

export function insertCategory({ name, sortOrder }) {
  const info = db
    .prepare('INSERT INTO service_categories (name, sort_order) VALUES (?, ?)')
    .run(name, sortOrder);
  return findCategoryById(Number(info.lastInsertRowid));
}

export function updateCategory(id, fields) {
  const columns = [];
  const values = [];
  if (fields.name !== undefined) {
    columns.push('name = ?');
    values.push(fields.name);
  }
  if (fields.sortOrder !== undefined) {
    columns.push('sort_order = ?');
    values.push(fields.sortOrder);
  }
  if (columns.length === 0) return findCategoryById(id);
  values.push(id);
  db.prepare(`UPDATE service_categories SET ${columns.join(', ')} WHERE id = ?`).run(...values);
  return findCategoryById(id);
}

export function toPublicCategory(row) {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

export function insertService({ categoryId, name, description, durationMinutes, priceRub, isActive, now }) {
  const info = db
    .prepare(
      `INSERT INTO services (category_id, name, description, duration_minutes, price_rub, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(categoryId, name, description, durationMinutes, priceRub, isActive ? 1 : 0, now, now);
  return findServiceById(Number(info.lastInsertRowid));
}

export function updateService(id, fields, now) {
  const columns = [];
  const values = [];
  for (const [key, column] of [
    ['categoryId', 'category_id'],
    ['name', 'name'],
    ['description', 'description'],
    ['durationMinutes', 'duration_minutes'],
    ['priceRub', 'price_rub'],
    ['isActive', 'is_active'],
  ]) {
    if (fields[key] === undefined) continue;
    columns.push(`${column} = ?`);
    values.push(key === 'isActive' ? (fields[key] ? 1 : 0) : fields[key]);
  }
  if (columns.length === 0) return findServiceById(id);
  columns.push('updated_at = ?');
  values.push(now, id);
  db.prepare(`UPDATE services SET ${columns.join(', ')} WHERE id = ?`).run(...values);
  return findServiceById(id);
}

// Сколько раз услуга уже встречается в оформленных записях (appointment_services,
// docs/db-schema.md, 3.12 — снапшот, а не живая ссылка, но FK на service_id
// у неё всё равно есть и никуда не делся). Нужно, чтобы решить: услугу
// можно физически удалить, или у неё уже есть история и её нужно только
// отключить (см. DELETE /api/admin/services/:id, routes/admin.routes.js).
export function countAppointmentServicesForService(serviceId) {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM appointment_services WHERE service_id = ?')
    .get(serviceId);
  return row.cnt;
}

// Вызывать только когда countAppointmentServicesForService(id) === 0 —
// иначе упадёт с ошибкой внешнего ключа (appointment_services.service_id
// REFERENCES services(id) без ON DELETE, PRAGMA foreign_keys = ON в
// db/connection.js). master_services на этот же id удалится сама, каскадом
// (ON DELETE CASCADE) — это не история, а просто список "кто это умеет
// делать", терять его вместе с самой услугой корректно.
export function deleteServiceById(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

export function toPublicService(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    priceRub: row.price_rub,
  };
}

export function toAdminService(row) {
  return {
    ...toPublicService(row),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
