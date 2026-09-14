// Бутстрап профиля салона (salon_profile) для production — без него
// getSalonProfile() (db/repositories/salonProfile.js) бросает обычную
// Error, а не ApiError: она рассчитана на то, что строка id=1 уже есть
// (таблица — ровно одна строка, docs/db-schema.md, 3.1), заводил её
// раньше только npm run seed, а он в production сам отказывается
// работать (src/db/seed.js). Итог на чистой базе — 500 на каждом
// эндпоинте, которому нужен профиль салона: /api/admin/salon-profile
// напрямую (его первым делом дёргает раздел «Записи» в админке, вместе с
// /api/admin/masters и /api/services, см. web/js/admin-appointments.js),
// а с ним и расчёт свободного времени (domain/availability.js), потому
// что оттуда берётся часовой пояс/шаг сетки/горизонт бронирования.
//
// Что делает: при старте, если строки id=1 ещё нет, создаёт её.
// name/address/phone — из SALON_NAME/SALON_ADDRESS/SALON_PHONE (не
// секреты, можно смело держать в docker-compose.yml), а если их не
// задали — понятные заглушки, по которым сразу видно, что это не
// настоящие данные. Остальные поля (часовой пояс, шаг сетки слотов,
// горизонт бронирования, длительность удержания слота) в INSERT не
// перечислены нарочно — используются DEFAULT из самой схемы
// (src/db/migrations/001_init.sql, 005_salon_profile_hold_duration.sql),
// чтобы значения по умолчанию не дублировались в двух местах.
//
// Используется только для production (вызывается из src/index.js под
// env.isProduction) — в разработке профиль заводит npm run seed.

import db from './connection.js';
import { dateToSql } from '../time/salonClock.js';

const DEFAULT_NAME = 'Название салона';
const DEFAULT_ADDRESS = 'Адрес не указан';
const DEFAULT_PHONE = '+7 000 000-00-00';

export function ensureSalonProfile() {
  const exists = db.prepare('SELECT 1 FROM salon_profile WHERE id = 1').get();
  if (exists) return;

  const now = dateToSql(new Date());
  db.prepare(
    `INSERT INTO salon_profile (id, name, address, phone, working_hours_note, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    process.env.SALON_NAME || DEFAULT_NAME,
    process.env.SALON_ADDRESS || DEFAULT_ADDRESS,
    process.env.SALON_PHONE || DEFAULT_PHONE,
    process.env.SALON_WORKING_HOURS_NOTE || null,
    now,
  );

  console.warn(
    '[ensureSalonProfile] создан профиль салона со значениями по умолчанию — ' +
      'это заглушки, не настоящие данные. Обновите название/адрес/телефон через ' +
      'PATCH /api/admin/salon-profile (или задайте SALON_NAME/SALON_ADDRESS/SALON_PHONE ' +
      'и передеплойте — но только пока строки ещё нет, повторно эти переменные не читаются).',
  );
}
