-- Начальная схема сервиса записи «Тон».
-- Источник истины — docs/db-schema.md, этот файл дословно повторяет
-- CREATE TABLE / CREATE INDEX из его раздела 3. Если меняете схему —
-- сначала правьте документ, потом добавляйте новую миграцию (002_...),
-- этот файл после применения на боевой базе больше не редактируется.

-- 3.1 salon_profile — профиль салона и параметры расчёта свободного времени
CREATE TABLE salon_profile (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  name                  TEXT NOT NULL,
  address               TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  working_hours_note    TEXT,
  timezone              TEXT NOT NULL DEFAULT 'Europe/Moscow',
  booking_step_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (booking_step_minutes > 0),
  booking_horizon_days  INTEGER NOT NULL DEFAULT 90 CHECK (booking_horizon_days > 0),
  updated_at            TEXT NOT NULL
);

-- 3.2 users — аккаунты клиентов и администратора
CREATE TABLE users (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('client','admin')),
  terms_accepted_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_email ON users(email);

-- 3.3 password_reset_tokens — восстановление пароля
CREATE TABLE password_reset_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX ix_reset_user ON password_reset_tokens(user_id);

-- 3.4 service_categories — категории услуг
CREATE TABLE service_categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_category_name ON service_categories(name);

-- 3.5 services — услуги
CREATE TABLE services (
  id                INTEGER PRIMARY KEY,
  category_id       INTEGER NOT NULL REFERENCES service_categories(id),
  name              TEXT NOT NULL,
  description       TEXT,
  duration_minutes  INTEGER NOT NULL CHECK (duration_minutes > 0),
  price_rub         INTEGER NOT NULL CHECK (price_rub >= 0),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_services_category ON services(category_id);

-- 3.6 masters — мастера
CREATE TABLE masters (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  specialization  TEXT,
  rating_avg      REAL,
  reviews_count   INTEGER NOT NULL DEFAULT 0,
  photo_url       TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- 3.7 master_services — какие услуги делает мастер
CREATE TABLE master_services (
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (master_id, service_id)
);
CREATE INDEX ix_master_services_service ON master_services(service_id);

-- 3.8 master_weekly_schedule — регулярный график мастера
CREATE TABLE master_weekly_schedule (
  id          INTEGER PRIMARY KEY,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX ux_schedule_master_weekday ON master_weekly_schedule(master_id, weekday);

-- 3.9 schedule_exceptions — отклонения от регулярного графика
CREATE TABLE schedule_exceptions (
  id          INTEGER PRIMARY KEY,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  is_day_off  INTEGER NOT NULL CHECK (is_day_off IN (0,1)),
  start_time  TEXT,
  end_time    TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL,
  CHECK (
    (is_day_off = 1 AND start_time IS NULL AND end_time IS NULL)
    OR
    (is_day_off = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);
CREATE UNIQUE INDEX ux_exception_master_date ON schedule_exceptions(master_id, date);

-- 3.10 time_blocks — ручные блокировки времени
CREATE TABLE time_blocks (
  id                  INTEGER PRIMARY KEY,
  master_id           INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  start_datetime      TEXT NOT NULL,
  end_datetime        TEXT NOT NULL CHECK (end_datetime > start_datetime),
  reason              TEXT,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX ix_blocks_master_time ON time_blocks(master_id, start_datetime);

-- 3.11 appointments — записи
CREATE TABLE appointments (
  id                       INTEGER PRIMARY KEY,
  client_id                INTEGER REFERENCES users(id),
  master_id                INTEGER NOT NULL REFERENCES masters(id),
  start_datetime           TEXT NOT NULL,
  end_datetime             TEXT NOT NULL CHECK (end_datetime > start_datetime),
  status                   TEXT NOT NULL CHECK (status IN ('hold','confirmed','completed','cancelled','expired')),
  hold_expires_at          TEXT,
  hold_token               TEXT,
  comment                  TEXT CHECK (comment IS NULL OR length(comment) <= 200),
  remind_enabled           INTEGER NOT NULL DEFAULT 1 CHECK (remind_enabled IN (0,1)),
  total_price_rub          INTEGER NOT NULL CHECK (total_price_rub >= 0),
  total_duration_minutes   INTEGER NOT NULL CHECK (total_duration_minutes > 0),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  cancelled_at              TEXT,
  -- клиент обязателен, как только запись перестаёт быть анонимным удержанием
  CHECK (status NOT IN ('confirmed','completed') OR client_id IS NOT NULL)
);
CREATE INDEX ix_appt_client ON appointments(client_id, start_datetime);
CREATE INDEX ix_appt_master_time ON appointments(master_id, start_datetime);
-- Ключевой индекс защиты от двойной записи — см. раздел 4 документа схемы
CREATE UNIQUE INDEX ux_appt_master_slot_active
  ON appointments(master_id, start_datetime)
  WHERE status IN ('hold','confirmed');
-- Позволяет шагу 4 найти анонимное удержание, созданное на шаге 3, и привязать к нему client_id
CREATE UNIQUE INDEX ux_appt_hold_token
  ON appointments(hold_token)
  WHERE hold_token IS NOT NULL;

-- 3.12 appointment_services — состав записи
CREATE TABLE appointment_services (
  appointment_id              INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id                  INTEGER NOT NULL REFERENCES services(id),
  service_name_snapshot       TEXT NOT NULL,
  price_rub_snapshot          INTEGER NOT NULL CHECK (price_rub_snapshot >= 0),
  duration_minutes_snapshot   INTEGER NOT NULL CHECK (duration_minutes_snapshot > 0),
  PRIMARY KEY (appointment_id, service_id)
);
CREATE INDEX ix_appt_services_service ON appointment_services(service_id);
