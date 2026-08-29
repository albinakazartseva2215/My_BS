// Административная панель: просмотр всех записей, управление услугами и
// мастерами (включая их график, исключения и ручные блокировки времени —
// без этого админ не смог бы вообще настроить нового мастера, а расчёт
// свободного времени (раздел 5 документа схемы) не из чего было бы считать).
// Каждый маршрут — requireRole(ctx, 'admin'), поэтому обычный клиент
// получает 403, а неавторизованный — 401 (см. middleware/auth.js).

import { requireRole } from '../middleware/auth.js';
import { badRequest, notFound, conflict } from '../http/errors.js';
import {
  requireInt,
  optionalInt,
  requireString,
  optionalString,
  requireIntArray,
  optionalBoolean,
  requireBoolean,
  requireOneOf,
  requireDateString,
  requireTimeString,
  requireUtcDateTime,
  requireTimezone,
} from '../validation/validate.js';
import {
  listAllServicesForAdmin,
  findServiceById,
  findCategoryById,
  findCategoryByName,
  listAllCategories,
  insertCategory,
  updateCategory,
  toPublicCategory,
  insertService,
  updateService,
  toAdminService,
} from '../db/repositories/services.js';
import {
  listAllMastersForAdmin,
  findMasterById,
  findMasterByUserId,
  insertMaster,
  updateMaster,
  toAdminMaster,
  listServiceIdsForMaster,
  replaceMasterServices,
  listWeeklyScheduleForMaster,
  replaceWeeklySchedule,
  listScheduleExceptionsForMaster,
  upsertScheduleException,
  deleteScheduleException,
  toPublicScheduleException,
  listTimeBlocksForMaster,
  insertTimeBlock,
  deleteTimeBlock,
  toPublicTimeBlock,
} from '../db/repositories/masters.js';
import { findServicesByIds } from '../db/repositories/services.js';
import { listAppointmentsForAdmin } from '../db/repositories/appointments.js';
import { toAppointmentView } from '../domain/appointmentView.js';
import { createAppointment, markAppointmentCompleted } from '../domain/booking.js';
import { completePastAppointments } from '../domain/completionSweep.js';
import { getSalonProfile, updateSalonProfile, toAdminSalonProfile } from '../db/repositories/salonProfile.js';
import {
  findUserById,
  findUserWithRolesById,
  toPublicUser,
  listRolesForUser,
  grantRole,
  revokeRole,
} from '../db/repositories/users.js';
import { dateToSql } from '../time/salonClock.js';

const APPOINTMENT_STATUSES = ['hold', 'confirmed', 'completed', 'cancelled', 'expired'];
// 'client' сюда не включена намеренно как выдаваемая/отзываемая роль —
// её и так получает любой зарегистрировавшийся, отдельно назначать её
// через админку незачем; убрать её у кого-то тоже отдельного смысла не
// несёт (человек просто перестанет быть "просто клиентом", если у него
// останется master/admin). Список — то, чем реально может управлять
// админ поверх обычной регистрации.
const GRANTABLE_ROLES = ['admin', 'master'];

function nowSql() {
  return dateToSql(new Date());
}

function requireExistingMaster(masterId) {
  const master = findMasterById(masterId);
  if (!master) throw notFound('Мастер не найден');
  return master;
}

export function registerRoutes(router) {
  // ---- Профиль салона и продуктовые настройки бронирования ------------------
  // salon_profile — единственное место, где живут настройки, которые
  // может менять администратор салона (адрес, часы работы, часовой пояс,
  // шаг сетки слотов, горизонт бронирования, длительность удержания
  // слота) — не .env: .env только для секретов и инфраструктуры
  // (docs/db-schema.md, "Спорные решения", п.15).
  router.get('/api/admin/salon-profile', async (ctx) => {
    requireRole(ctx, 'admin');
    return { status: 200, body: toAdminSalonProfile(getSalonProfile()) };
  });

  router.patch('/api/admin/salon-profile', async (ctx) => {
    requireRole(ctx, 'admin');
    const body = ctx.body;
    const fields = {};
    if (body.name !== undefined) fields.name = requireString(body.name, 'name', { max: 200 });
    if (body.address !== undefined) fields.address = requireString(body.address, 'address', { max: 500 });
    if (body.phone !== undefined) fields.phone = requireString(body.phone, 'phone', { max: 50 });
    if (body.workingHoursNote !== undefined) {
      fields.workingHoursNote = optionalString(body.workingHoursNote, 'workingHoursNote', { max: 300 });
    }
    if (body.timezone !== undefined) fields.timezone = requireTimezone(body.timezone, 'timezone');
    if (body.bookingStepMinutes !== undefined) {
      fields.bookingStepMinutes = requireInt(body.bookingStepMinutes, 'bookingStepMinutes', { min: 1, max: 24 * 60 });
    }
    if (body.bookingHorizonDays !== undefined) {
      fields.bookingHorizonDays = requireInt(body.bookingHorizonDays, 'bookingHorizonDays', { min: 1 });
    }
    if (body.holdDurationMinutes !== undefined) {
      fields.holdDurationMinutes = requireInt(body.holdDurationMinutes, 'holdDurationMinutes', { min: 1, max: 24 * 60 });
    }

    const profile = updateSalonProfile(fields, nowSql());
    return { status: 200, body: toAdminSalonProfile(profile) };
  });

  // ---- Пользователи и роли -------------------------------------------------
  // Роли — список (docs/db-schema.md, раздел 3.2): выдать/забрать —
  // отдельные операции над user_roles, а не перезапись одного значения.
  // 'client' сюда не назначается/не отзывается (см. GRANTABLE_ROLES выше).
  router.get('/api/admin/users/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const user = findUserWithRolesById(id);
    if (!user) throw notFound('Пользователь не найден');
    return { status: 200, body: toPublicUser(user) };
  });

  router.post('/api/admin/users/:id/roles', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const role = requireOneOf(ctx.body.role, 'role', GRANTABLE_ROLES);
    if (!findUserById(id)) throw notFound('Пользователь не найден');

    grantRole(id, role);
    return { status: 200, body: { userId: id, roles: listRolesForUser(id) } };
  });

  router.delete('/api/admin/users/:id/roles/:role', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const role = requireOneOf(ctx.params.role, 'role', GRANTABLE_ROLES);
    if (!findUserById(id)) throw notFound('Пользователь не найден');

    const currentRoles = listRolesForUser(id);
    if (currentRoles.length <= 1 && currentRoles.includes(role)) {
      // Не даём случайно оставить учётку вовсе без ролей — это не
      // столько защита от злоупотребления, сколько от опечатки админа:
      // без единственной оставшейся роли аккаунт стал бы functionally
      // мёртвым (requireRole никогда не пройдёт ни для одной проверки).
      throw badRequest('Нельзя отозвать единственную оставшуюся роль пользователя');
    }

    revokeRole(id, role);
    return { status: 200, body: { userId: id, roles: listRolesForUser(id) } };
  });

  // ---- Записи: полный список для админ-панели ---------------------------
  router.get('/api/admin/appointments', async (ctx) => {
    requireRole(ctx, 'admin');
    // Лениво переводим прошедшие confirmed-визиты в completed перед
    // выдачей списка — тот же принцип, что и releaseExpiredHolds перед
    // расчётом слотов: не ждать таймера, чтобы админ не увидел статус,
    // который уже устарел прямо в момент запроса (docs/db-schema.md, раздел 6).
    completePastAppointments();
    const { query } = ctx;
    const status = query.status !== undefined ? requireOneOf(query.status, 'status', APPOINTMENT_STATUSES) : undefined;
    const masterId = query.masterId !== undefined ? requireInt(query.masterId, 'masterId', { min: 1 }) : undefined;
    const clientId = query.clientId !== undefined ? requireInt(query.clientId, 'clientId', { min: 1 }) : undefined;
    const from = query.from !== undefined ? requireDateString(query.from, 'from') : undefined;
    const to = query.to !== undefined ? requireDateString(query.to, 'to') : undefined;

    const salon = getSalonProfile();
    const appointments = listAppointmentsForAdmin({
      status,
      masterId,
      clientId,
      fromSql: from ? `${from} 00:00:00` : undefined,
      toSql: to ? `${to} 00:00:00` : undefined,
    }).map((a) => toAppointmentView(a, { timezone: salon.timezone, includeClient: true }));

    return { status: 200, body: { appointments } };
  });

  // Ручное бронирование администратором — например, клиент договорился по
  // телефону в обход обычной формы. Единственный маршрут, где вообще можно
  // выставить overlapOverride ("осознанное наложение", docs/db-schema.md,
  // 3.11б): бронирование поверх уже занятого этим же мастером времени.
  router.post('/api/admin/appointments', async (ctx) => {
    // ЗДЕСЬ проверка роли — requireRole бросает 401 (нет сессии) или 403
    // (сессия есть, но role !== 'admin') ДО того, как тело запроса вообще
    // прочитано. overlapOverride ниже читается уже после этой строки —
    // значит дойти сюда и стать true он может только у настоящего админа.
    requireRole(ctx, 'admin');

    const body = ctx.body;
    const clientId = requireInt(body.clientId, 'clientId', { min: 1 });
    const masterId = requireInt(body.masterId, 'masterId', { min: 1 });
    const startUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
    const serviceIds = requireIntArray(body.serviceIds, 'serviceIds');
    const comment = optionalString(body.comment, 'comment', { max: 200 });
    const remindEnabled = optionalBoolean(body.remindEnabled, 'remindEnabled', true);
    const overlapOverride = optionalBoolean(body.overlapOverride, 'overlapOverride', false);

    const client = findUserById(clientId);
    if (!client) throw badRequest('Клиент не найден', { field: 'clientId' });

    const appointment = createAppointment({
      masterId,
      startUtc,
      serviceIds,
      clientId,
      status: 'confirmed',
      comment,
      remindEnabled,
      overlapOverride,
    });

    const salon = getSalonProfile();
    return {
      status: 201,
      body: toAppointmentView(appointment, { timezone: salon.timezone, includeClient: true }),
    };
  });

  // Ручное завершение визита (docs/db-schema.md, раздел 6: "completed...
  // проставляется фоновой задачей или админом" — это вторая половина того
  // "или"; фоновая — completePastAppointments выше и в index.js). Нужно,
  // когда конец визита ещё не наступил по времени записи, а по факту он
  // уже завершился (клиент ушёл раньше), либо просто чтобы не ждать таймер.
  router.post('/api/admin/appointments/:id/complete', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const appointment = markAppointmentCompleted({ appointmentId: id });
    const salon = getSalonProfile();
    return {
      status: 200,
      body: toAppointmentView(appointment, { timezone: salon.timezone, includeClient: true }),
    };
  });

  // ---- Категории услуг ------------------------------------------------------
  // Задание на API просило управление услугами и мастерами; вкладки
  // категорий (service_categories) до сих пор наполнялись только через
  // npm run seed. Без CRUD админ не смог бы завести новую категорию для
  // новой услуги — только переиспользовать те, что заведены сидом. Это и
  // есть тот случай, ради которого просили доработать всё, что осталось
  // за рамками задачи на "услуги и мастера".
  router.get('/api/admin/service-categories', async (ctx) => {
    requireRole(ctx, 'admin');
    const categories = listAllCategories().map(toPublicCategory);
    return { status: 200, body: { categories } };
  });

  router.post('/api/admin/service-categories', async (ctx) => {
    requireRole(ctx, 'admin');
    const body = ctx.body;
    const name = requireString(body.name, 'name', { max: 100 });
    const sortOrder = optionalInt(body.sortOrder, 'sortOrder', { min: 0 }) ?? 0;

    if (findCategoryByName(name)) {
      throw badRequest('Категория с таким названием уже существует', { field: 'name' });
    }

    const category = insertCategory({ name, sortOrder });
    return { status: 201, body: toPublicCategory(category) };
  });

  router.patch('/api/admin/service-categories/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    if (!findCategoryById(id)) throw notFound('Категория не найдена');

    const body = ctx.body;
    const fields = {};
    if (body.name !== undefined) {
      fields.name = requireString(body.name, 'name', { max: 100 });
      const existing = findCategoryByName(fields.name);
      if (existing && existing.id !== id) {
        throw badRequest('Категория с таким названием уже существует', { field: 'name' });
      }
    }
    if (body.sortOrder !== undefined) fields.sortOrder = requireInt(body.sortOrder, 'sortOrder', { min: 0 });

    const category = updateCategory(id, fields);
    return { status: 200, body: toPublicCategory(category) };
  });

  // ---- Услуги -------------------------------------------------------------
  router.get('/api/admin/services', async (ctx) => {
    requireRole(ctx, 'admin');
    const services = listAllServicesForAdmin().map(toAdminService);
    return { status: 200, body: { services } };
  });

  router.post('/api/admin/services', async (ctx) => {
    requireRole(ctx, 'admin');
    const body = ctx.body;
    const categoryId = requireInt(body.categoryId, 'categoryId', { min: 1 });
    const name = requireString(body.name, 'name', { max: 200 });
    const description = optionalString(body.description, 'description', { max: 2000 });
    const durationMinutes = requireInt(body.durationMinutes, 'durationMinutes', { min: 1, max: 24 * 60 });
    const priceRub = requireInt(body.priceRub, 'priceRub', { min: 0 });
    const isActive = optionalBoolean(body.isActive, 'isActive', true);

    if (!findCategoryById(categoryId)) throw badRequest('Категория услуг не найдена', { field: 'categoryId' });

    const service = insertService({ categoryId, name, description, durationMinutes, priceRub, isActive, now: nowSql() });
    return { status: 201, body: toAdminService(service) };
  });

  router.patch('/api/admin/services/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const existing = findServiceById(id);
    if (!existing) throw notFound('Услуга не найдена');

    const body = ctx.body;
    const fields = {};
    if (body.categoryId !== undefined) {
      fields.categoryId = requireInt(body.categoryId, 'categoryId', { min: 1 });
      if (!findCategoryById(fields.categoryId)) throw badRequest('Категория услуг не найдена', { field: 'categoryId' });
    }
    if (body.name !== undefined) fields.name = requireString(body.name, 'name', { max: 200 });
    if (body.description !== undefined) fields.description = optionalString(body.description, 'description', { max: 2000 });
    if (body.durationMinutes !== undefined) {
      fields.durationMinutes = requireInt(body.durationMinutes, 'durationMinutes', { min: 1, max: 24 * 60 });
    }
    if (body.priceRub !== undefined) fields.priceRub = requireInt(body.priceRub, 'priceRub', { min: 0 });
    if (body.isActive !== undefined) fields.isActive = requireBoolean(body.isActive, 'isActive');

    const service = updateService(id, fields, nowSql());
    return { status: 200, body: toAdminService(service) };
  });

  // ---- Мастера --------------------------------------------------------------
  router.get('/api/admin/masters', async (ctx) => {
    requireRole(ctx, 'admin');
    const masters = listAllMastersForAdmin().map((m) => ({
      ...toAdminMaster(m),
      serviceIds: listServiceIdsForMaster(m.id),
    }));
    return { status: 200, body: { masters } };
  });

  router.get('/api/admin/masters/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const master = requireExistingMaster(id);
    return {
      status: 200,
      body: {
        ...toAdminMaster(master),
        serviceIds: listServiceIdsForMaster(id),
        weeklySchedule: listWeeklyScheduleForMaster(id).map((r) => ({
          weekday: r.weekday,
          startTime: r.start_time,
          endTime: r.end_time,
        })),
        scheduleExceptions: listScheduleExceptionsForMaster(id).map(toPublicScheduleException),
      },
    };
  });

  router.post('/api/admin/masters', async (ctx) => {
    requireRole(ctx, 'admin');
    const body = ctx.body;
    const name = requireString(body.name, 'name', { max: 200 });
    const specialization = optionalString(body.specialization, 'specialization', { max: 300 });
    const photoUrl = optionalString(body.photoUrl, 'photoUrl', { max: 2000 });
    const isActive = optionalBoolean(body.isActive, 'isActive', true);

    const master = insertMaster({
      name,
      specialization,
      ratingAvg: null,
      reviewsCount: 0,
      photoUrl,
      isActive,
      now: nowSql(),
    });
    return { status: 201, body: toAdminMaster(master) };
  });

  router.patch('/api/admin/masters/:id', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const existingMaster = requireExistingMaster(id);

    const body = ctx.body;
    const fields = {};
    if (body.name !== undefined) fields.name = requireString(body.name, 'name', { max: 200 });
    if (body.specialization !== undefined) fields.specialization = optionalString(body.specialization, 'specialization', { max: 300 });
    if (body.photoUrl !== undefined) fields.photoUrl = optionalString(body.photoUrl, 'photoUrl', { max: 2000 });
    if (body.isActive !== undefined) fields.isActive = requireBoolean(body.isActive, 'isActive');
    // Привязка/отвязка учётной записи — "мастер видит своё расписание"
    // (требование 4) работает только через эту связь. userId: null снимает
    // привязку; положительное число — привязывает и заодно выдаёт роль
    // 'master' (инвариант: привязанный master.user_id обязан иметь роль
    // master, иначе GET /api/master/appointments не пропустит его же
    // собственный профиль — проверяется в коде приложения, не CHECK'ом,
    // SQLite не умеет кросс-табличные ограничения).
    if (body.userId !== undefined) {
      if (body.userId === null) {
        fields.userId = null;
      } else {
        const targetUserId = requireInt(body.userId, 'userId', { min: 1 });
        if (!findUserById(targetUserId)) throw badRequest('Пользователь не найден', { field: 'userId' });

        // Связь user_id ⇄ master.id должна быть 1:1 в обе стороны —
        // проверяем обе, отдельными запросами, потому что уникальный
        // индекс в БД (ux_masters_user_id) сам по себе ловит только
        // сторону "один user_id — не более чем у одного master", но
        // ничего не мешает ОБЫЧНОМУ UPDATE молча переписать чужую
        // привязку конкретно у ЭТОЙ строки (это и есть баг, найденный
        // вручную: PATCH на master id=2, уже привязанный к user_id=4,
        // с телом {userId: 2} тихо забирал профиль у одного пользователя
        // и отдавал другому, без единой ошибки).
        if (existingMaster.user_id !== null && existingMaster.user_id !== targetUserId) {
          throw conflict(
            'Этот профиль мастера уже привязан к другому пользователю — сначала отвяжите его (userId: null)',
          );
        }
        const existingLink = findMasterByUserId(targetUserId);
        if (existingLink && existingLink.id !== id) {
          throw conflict('Этот пользователь уже привязан к другому профилю мастера');
        }

        grantRole(targetUserId, 'master');
        fields.userId = targetUserId;
      }
    }

    const master = updateMaster(id, fields, nowSql());
    return { status: 200, body: toAdminMaster(master) };
  });

  // Полная замена набора услуг, которые мастер выполняет.
  router.put('/api/admin/masters/:id/services', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    requireExistingMaster(id);
    const serviceIds = requireIntArray(ctx.body.serviceIds, 'serviceIds', { min: 0 });
    if (serviceIds.length > 0 && findServicesByIds(serviceIds).length !== serviceIds.length) {
      throw badRequest('Одна или несколько услуг не найдены');
    }
    replaceMasterServices(id, serviceIds);
    return { status: 200, body: { masterId: id, serviceIds: listServiceIdsForMaster(id) } };
  });

  // Полная замена недельного графика мастера.
  router.put('/api/admin/masters/:id/schedule', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    requireExistingMaster(id);

    const rawEntries = ctx.body.schedule;
    if (!Array.isArray(rawEntries)) throw badRequest('Поле "schedule" должно быть массивом');
    const seenWeekdays = new Set();
    const entries = rawEntries.map((entry, index) => {
      if (entry === null || typeof entry !== 'object') throw badRequest(`schedule[${index}] должен быть объектом`);
      const weekday = requireInt(entry.weekday, `schedule[${index}].weekday`, { min: 1, max: 7 });
      const startTime = requireTimeString(entry.startTime, `schedule[${index}].startTime`);
      const endTime = requireTimeString(entry.endTime, `schedule[${index}].endTime`);
      if (endTime <= startTime) throw badRequest(`schedule[${index}]: endTime должно быть позже startTime`);
      if (seenWeekdays.has(weekday)) throw badRequest(`schedule: день недели ${weekday} повторяется`);
      seenWeekdays.add(weekday);
      return { weekday, startTime, endTime };
    });

    replaceWeeklySchedule(id, entries);
    return {
      status: 200,
      body: {
        masterId: id,
        weeklySchedule: listWeeklyScheduleForMaster(id).map((r) => ({
          weekday: r.weekday,
          startTime: r.start_time,
          endTime: r.end_time,
        })),
      },
    };
  });

  // Разовое отклонение от графика (выходной/другие часы) на дату.
  // Идемпотентно: повторный вызов на ту же дату заменяет предыдущее значение.
  router.post('/api/admin/masters/:id/schedule-exceptions', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    requireExistingMaster(id);

    const body = ctx.body;
    const date = requireDateString(body.date, 'date');
    const isDayOff = requireBoolean(body.isDayOff, 'isDayOff');
    let startTime = null;
    let endTime = null;
    if (!isDayOff) {
      startTime = requireTimeString(body.startTime, 'startTime');
      endTime = requireTimeString(body.endTime, 'endTime');
      if (endTime <= startTime) throw badRequest('endTime должно быть позже startTime');
    } else if (body.startTime !== undefined || body.endTime !== undefined) {
      throw badRequest('Для выходного дня startTime/endTime указывать не нужно');
    }
    const reason = optionalString(body.reason, 'reason', { max: 300 });

    const exception = upsertScheduleException({ masterId: id, date, isDayOff, startTime, endTime, reason, now: nowSql() });
    return { status: 201, body: toPublicScheduleException(exception) };
  });

  router.delete('/api/admin/masters/:id/schedule-exceptions/:exceptionId', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const exceptionId = requireInt(ctx.params.exceptionId, 'exceptionId', { min: 1 });
    requireExistingMaster(id);
    const deleted = deleteScheduleException(id, exceptionId);
    if (!deleted) throw notFound('Исключение графика не найдено');
    return { status: 204, body: null };
  });

  // Ручные блокировки времени (обед, техническая пауза и т.п.).
  router.get('/api/admin/masters/:id/time-blocks', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    requireExistingMaster(id);
    const from = ctx.query.from !== undefined ? requireUtcDateTime(ctx.query.from, 'from') : undefined;
    const to = ctx.query.to !== undefined ? requireUtcDateTime(ctx.query.to, 'to') : undefined;
    const blocks = listTimeBlocksForMaster(id, {
      from: from ? dateToSql(from) : undefined,
      to: to ? dateToSql(to) : undefined,
    }).map(toPublicTimeBlock);
    return { status: 200, body: { timeBlocks: blocks } };
  });

  router.post('/api/admin/masters/:id/time-blocks', async (ctx) => {
    const admin = requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    requireExistingMaster(id);

    const body = ctx.body;
    const startUtc = requireUtcDateTime(body.startDatetime, 'startDatetime');
    const endUtc = requireUtcDateTime(body.endDatetime, 'endDatetime');
    if (endUtc.getTime() <= startUtc.getTime()) throw badRequest('endDatetime должно быть позже startDatetime');
    const reason = optionalString(body.reason, 'reason', { max: 300 });

    const block = insertTimeBlock({
      masterId: id,
      startDatetime: dateToSql(startUtc),
      endDatetime: dateToSql(endUtc),
      reason,
      createdByUserId: admin.id,
      now: nowSql(),
    });
    return { status: 201, body: toPublicTimeBlock(block) };
  });

  router.delete('/api/admin/masters/:id/time-blocks/:blockId', async (ctx) => {
    requireRole(ctx, 'admin');
    const id = requireInt(ctx.params.id, 'id', { min: 1 });
    const blockId = requireInt(ctx.params.blockId, 'blockId', { min: 1 });
    requireExistingMaster(id);
    const deleted = deleteTimeBlock(id, blockId);
    if (!deleted) throw notFound('Блокировка времени не найдена');
    return { status: 204, body: null };
  });
}
