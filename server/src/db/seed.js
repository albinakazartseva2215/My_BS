// Тестовые данные для локальной разработки — наполняют пустую базу так,
// чтобы сразу было чем проверять сервис: аккаунты с разными ролями,
// мастера с графиком, услуги и уже существующие записи в календаре.
//
// Роли пользователей — списком (user_roles), не единственным значением
// (docs/db-schema.md, раздел 3.2 и "Спорные решения" — там же разбор
// того, что это явный пересмотр более раннего решения "мастера не
// логинятся"). Ниже нарочно заведены оба демонстрационных случая: мастер
// с собственным логином (роль только master) и человек с двумя ролями
// одновременно (master + admin) — ровно тот пример, который просили
// показать явно, а не только описать в документации.
//
// Требования к паролям (хеш scrypt с солью и параметрами стойкости в
// строке, см. security/passwords.js) применяются и здесь: hashPassword —
// та же самая функция, что и в API аутентификации, тестовым пользователям
// никакого послабления не делается.
//
// Скрипт идемпотентен: полностью очищает управляемые им таблицы и
// заливает данные заново, поэтому повторный запуск не создаёт дублей.
// Пока в проекте нет API регистрации, seed — единственный источник
// строк в users, поэтому ему разрешено удалять всю таблицу целиком;
// как только появится реальная регистрация, это нужно будет сузить
// до "удалять только тестовых пользователей по email".
//
// Запуск: npm run seed (из папки server/)

import db from './connection.js';
import { env } from '../config/env.js';
import { hashPassword } from '../security/passwords.js';

if (env.isProduction) {
  console.error('seed.js предназначен только для разработки: NODE_ENV=production, выхожу без изменений');
  process.exit(1);
}

// ---- Демо-учётки для входа при ручной проверке -----------------------
export const DEMO_CREDENTIALS = {
  admin: { email: 'admin@ton-salon.test', password: 'AdminDemo123!' },
  client: { email: 'client@ton-salon.test', password: 'ClientDemo123!' },
  // Роль master, привязана к профилю мастера "Анна Соколова" — видит
  // только записи в своём расписании (GET /api/master/appointments).
  master: { email: 'anna.master@ton-salon.test', password: 'MasterDemo123!' },
  // Две роли одновременно (master + admin) — привязана к профилю мастера
  // "Полина Ерохина". Демонстрирует, что роли — список, а не одно значение.
  masterAdmin: { email: 'polina.masteradmin@ton-salon.test', password: 'MasterAdminDemo123!' },
};

// ---- Вспомогательное: даты для "ближайших дней" в календаре ----------
// Салон работает по местному времени Europe/Moscow (см. salon_profile.timezone
// в схеме). У Москвы фиксированное смещение UTC+3 без перехода на летнее/
// зимнее время, поэтому для тестовых данных достаточно простого вычитания
// часов — полноценная зона understanding здесь избыточна (это делает
// будущий API поверх Intl/дат, не сид).
const MOSCOW_UTC_OFFSET_HOURS = 3;

function toSqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Календарный день через N дней от сегодняшнего (в UTC-полночь), с
// пропуском воскресенья — у мастеров это выходной по графику ниже,
// класть туда запись было бы нереалистично.
function businessDayFromNow(daysFromNow) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + daysFromNow);
  if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1); // 0 = воскресенье
  return day;
}

// Момент "столько-то часов и минут по Москве" в указанный день, в виде
// строки для хранения — переводим в UTC вычитанием фиксированного смещения.
function moscowTimeOn(day, hours, minutes) {
  const dt = new Date(day);
  dt.setUTCHours(hours - MOSCOW_UTC_OFFSET_HOURS, minutes, 0, 0);
  return dt;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function seed() {
  db.exec('BEGIN');
  try {
    // порядок удаления — от дочерних таблиц к родительским
    // (foreign_keys = ON в connection.js, иначе упрёмся во внешние ключи)
    db.exec(`
      DELETE FROM appointment_services;
      DELETE FROM appointments;
      DELETE FROM master_services;
      DELETE FROM master_weekly_schedule;
      DELETE FROM schedule_exceptions;
      DELETE FROM time_blocks;
      DELETE FROM masters;
      DELETE FROM services;
      DELETE FROM service_categories;
      DELETE FROM users;
      DELETE FROM salon_profile;
    `);

    const now = new Date();
    const nowSql = toSqlDateTime(now);

    // 0. Профиль салона — без него не из чего считать свободное время
    db.prepare(`
      INSERT INTO salon_profile
        (id, name, address, phone, working_hours_note, timezone, booking_step_minutes, booking_horizon_days, hold_duration_minutes, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Тон',
      'г. Москва, ул. Тверская, 12',
      '+7 999 123-45-67',
      'Ежедневно, 10:00–21:00',
      'Europe/Moscow',
      60,
      90,
      10,
      nowSql,
    );

    // 1. Пользователи: у каждого пароль в виде хеша (scrypt) и список
    //    ролей в user_roles (не колонка role — её больше нет, см. шапку
    //    файла). insertUserRole вызывается отдельно для каждой роли, так
    //    один человек может получить сразу несколько.
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, phone, password_hash, terms_accepted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertUserRole = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)');

    function createUser({ id, name, email, phone, password, roles }) {
      insertUser.run(id, name, email, phone, hashPassword(password), nowSql, nowSql, nowSql);
      for (const role of roles) insertUserRole.run(id, role);
    }

    createUser({
      id: 1,
      name: 'Администратор салона',
      email: DEMO_CREDENTIALS.admin.email,
      phone: '+7 999 111-22-33',
      password: DEMO_CREDENTIALS.admin.password,
      roles: ['admin'],
    });
    createUser({
      id: 2,
      name: 'Ирина Смирнова',
      email: DEMO_CREDENTIALS.client.email,
      phone: '+7 999 444-55-66',
      password: DEMO_CREDENTIALS.client.password,
      roles: ['client'],
    });
    const clientUserId = 2;

    // Учётка мастера "Анна Соколова" — только роль master, без admin.
    createUser({
      id: 3,
      name: 'Анна Соколова',
      email: DEMO_CREDENTIALS.master.email,
      phone: '+7 999 222-33-44',
      password: DEMO_CREDENTIALS.master.password,
      roles: ['master'],
    });
    // Учётка "Полина Ерохина" — master И admin одновременно, ровно тот
    // пример, который просили показать явно.
    createUser({
      id: 4,
      name: 'Полина Ерохина',
      email: DEMO_CREDENTIALS.masterAdmin.email,
      phone: '+7 999 555-66-77',
      password: DEMO_CREDENTIALS.masterAdmin.password,
      roles: ['master', 'admin'],
    });

    // 2. Мастера — два профиля со специализацией, оба теперь привязаны к
    //    учётным записям выше через user_id (profile мастера и вход в
    //    аккаунт — по-прежнему разные сущности, docs/db-schema.md, 3.6,
    //    но связь между ними теперь может существовать).
    const insertMaster = db.prepare(`
      INSERT INTO masters (id, name, specialization, rating_avg, reviews_count, is_active, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);
    insertMaster.run(1, 'Анна Соколова', 'Окрашивание, стрижка', 4.9, 128, 3, nowSql, nowSql);
    insertMaster.run(2, 'Полина Ерохина', 'Стрижка, укладка', 4.9, 74, 4, nowSql, nowSql);
    const ANNA = 1;
    const POLINA = 2;

    // 3. Пять услуг с реальной длительностью и ценой (значения — из
    //    прототипа, экран Booking · 1 · Услуги)
    const insertCategory = db.prepare('INSERT INTO service_categories (id, name, sort_order) VALUES (?, ?, ?)');
    for (const [id, name, sortOrder] of [
      [1, 'Стрижка', 1],
      [2, 'Окрашивание', 2],
      [3, 'Уход', 3],
      [4, 'Укладка', 4],
    ]) {
      insertCategory.run(id, name, sortOrder);
    }

    const insertService = db.prepare(`
      INSERT INTO services (id, category_id, name, description, duration_minutes, price_rub, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const SERVICES = [
      { id: 1, categoryId: 1, name: 'Стрижка', description: 'Мытьё, стрижка, укладка', durationMinutes: 45, priceRub: 2800 },
      { id: 2, categoryId: 2, name: 'Окрашивание', description: 'Балаяж, тонирование, седина', durationMinutes: 135, priceRub: 7500 },
      { id: 3, categoryId: 3, name: 'Уход и маски', description: 'Восстановление и питание волос', durationMinutes: 30, priceRub: 1900 },
      { id: 4, categoryId: 4, name: 'Укладка', description: 'На волосы любой длины', durationMinutes: 30, priceRub: 1500 },
      { id: 5, categoryId: 4, name: 'Мытьё и стайлинг', description: 'Быстрое обновление образа', durationMinutes: 20, priceRub: 900 },
    ];
    for (const s of SERVICES) {
      insertService.run(s.id, s.categoryId, s.name, s.description, s.durationMinutes, s.priceRub, nowSql, nowSql);
    }
    const serviceById = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

    // 4. Кто из мастеров что делает + недельный график (Пн–Сб 10:00–20:00,
    //    воскресенье выходной — отсутствие строки графика на этот день)
    const insertMasterService = db.prepare('INSERT INTO master_services (master_id, service_id) VALUES (?, ?)');
    for (const [masterId, serviceId] of [
      [ANNA, 1], [ANNA, 2], [ANNA, 3],   // Анна: стрижка, окрашивание, уход
      [POLINA, 1], [POLINA, 4], [POLINA, 5], // Полина: стрижка, укладка, мытьё и стайлинг
    ]) {
      insertMasterService.run(masterId, serviceId);
    }

    const insertSchedule = db.prepare(
      'INSERT INTO master_weekly_schedule (master_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)',
    );
    for (const masterId of [ANNA, POLINA]) {
      for (let weekday = 1; weekday <= 6; weekday += 1) {
        insertSchedule.run(masterId, weekday, '10:00', '20:00');
      }
    }

    // Пример отклонения от графика — отпуск у Полины через две недели
    db.prepare(`
      INSERT INTO schedule_exceptions (master_id, date, is_day_off, reason, created_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(POLINA, toSqlDateTime(businessDayFromNow(14)).slice(0, 10), 'отпуск', nowSql);

    // Пример ручной блокировки — обеденный перерыв у Анны завтра
    const lunchDay = businessDayFromNow(1);
    db.prepare(`
      INSERT INTO time_blocks (master_id, start_datetime, end_datetime, reason, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ANNA,
      toSqlDateTime(moscowTimeOn(lunchDay, 13, 0)),
      toSqlDateTime(moscowTimeOn(lunchDay, 14, 0)),
      'обеденный перерыв',
      1, // администратор
      nowSql,
    );

    // 5. Две-три уже существующие записи на ближайшие дни — календарь
    //    не пустой, есть что показать и с чем проверять пересечения слотов
    const insertAppointment = db.prepare(`
      INSERT INTO appointments
        (id, client_id, master_id, start_datetime, end_datetime, status, comment, remind_enabled,
         total_price_rub, total_duration_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?, ?, ?)
    `);
    const insertAppointmentService = db.prepare(`
      INSERT INTO appointment_services
        (appointment_id, service_id, service_name_snapshot, price_rub_snapshot, duration_minutes_snapshot)
      VALUES (?, ?, ?, ?, ?)
    `);

    function createAppointment({ id, masterId, day, hour, minute, serviceIds, comment }) {
      const start = moscowTimeOn(day, hour, minute);
      const services = serviceIds.map((sid) => serviceById[sid]);
      const totalDuration = services.reduce((sum, s) => sum + s.durationMinutes, 0);
      const totalPrice = services.reduce((sum, s) => sum + s.priceRub, 0);
      const end = addMinutes(start, totalDuration);

      insertAppointment.run(
        id,
        clientUserId,
        masterId,
        toSqlDateTime(start),
        toSqlDateTime(end),
        comment ?? null,
        totalPrice,
        totalDuration,
        nowSql,
        nowSql,
      );
      for (const s of services) {
        insertAppointmentService.run(id, s.id, s.name, s.priceRub, s.durationMinutes);
      }
    }

    // Запись 1: завтра утром, стрижка у Анны
    createAppointment({
      id: 1,
      masterId: ANNA,
      day: businessDayFromNow(1),
      hour: 11,
      minute: 0,
      serviceIds: [1],
    });

    // Запись 2: послезавтра днём, укладка у Полины
    createAppointment({
      id: 2,
      masterId: POLINA,
      day: businessDayFromNow(2),
      hour: 15,
      minute: 0,
      serviceIds: [4],
    });

    // Запись 3: через 4 дня, окрашивание + уход у Анны (несколько услуг
    // в одной записи — проверяет appointment_services и сумму по ним)
    createAppointment({
      id: 3,
      masterId: ANNA,
      day: businessDayFromNow(4),
      hour: 12,
      minute: 0,
      serviceIds: [2, 3],
      comment: 'Затонировать в тёплый оттенок',
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seed();

console.log('тестовые данные загружены');
console.log('');
console.log('демо-вход:');
console.log(`  админ:               ${DEMO_CREDENTIALS.admin.email} / ${DEMO_CREDENTIALS.admin.password}`);
console.log(`  клиент:              ${DEMO_CREDENTIALS.client.email} / ${DEMO_CREDENTIALS.client.password}`);
console.log(`  мастер (Анна):       ${DEMO_CREDENTIALS.master.email} / ${DEMO_CREDENTIALS.master.password}`);
console.log(`  мастер+админ (Полина): ${DEMO_CREDENTIALS.masterAdmin.email} / ${DEMO_CREDENTIALS.masterAdmin.password}`);
