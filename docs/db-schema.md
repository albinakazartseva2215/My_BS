# Схема базы данных SQLite — сервис записи «Тон»

Документ описывает схему БД для прототипа, зафиксированного в «Карта переходов прототипа.xlsx» (11 экранов, 44 назначенных перехода) и в «Паспорт продукта.docx». Код не пишется — это проектный документ для последующей реализации в Claude Code.

Ограничения из паспорта продукта, которые напрямую влияют на схему:

- один бизнес с несколькими мастерами, не маркетплейс — мультитенантность не нужна;
- оплата только на месте — онлайн-платежей и статусов оплаты в схеме нет;
- уведомления только внутри личного кабинета — интеграций с e-mail/Telegram в схеме нет;
- права доступа только `admin`/`user`, без вспомогательных сервисов вроде Supabase RLS — роль хранится в самой таблице пользователей и проверяется в коде приложения.

---

## 1. Экраны прототипа и данные на них

| Экран | Что показывает / что вводит пользователь | Откуда эти данные (таблицы) |
|---|---|---|
| **Landing my B.S.** | Профиль салона (название «Тон», адрес, телефон, часы работы); карточки услуг (название, описание, длительность, цена «от»); карточки мастеров (имя, специализация, рейтинг, число отзывов, ближайшее окно); лента демо-слотов на неделю; блок отзывов (статичный маркетинг) | `salon_profile`, `services` + `service_categories`, `masters`, вычисление свободного времени (раздел 5); отзывы в схему не включены — см. «Спорные решения» |
| **Booking · 1 · Услуги** | Вкладки категорий; карточки услуг с чекбоксами; сводка выбранного (кол-во, длительность, сумма) | `service_categories`, `services` |
| **Booking · 2 · Мастер** | Баннер выбранных услуг; опция «любой свободный мастер»; карточки мастеров (имя, специализация, рейтинг, отзывы, ближайшее окно); состояние «никто не подходит» | `masters`, `master_services` (пересечение мастеров, которые делают ВСЕ выбранные услуги) |
| **Booking · 3 · Дата и время** | Баннер выбора; календарь на 4 месяца с маркерами дня («есть окно», «окон нет», «выходной», «прошедшая дата»), пролистывание дальше 3 месяцев заблокировано с подписью «Запись открывается за 3 месяца»; сетка слотов утро/день/вечер по часам; сообщение «Мы придержим это время, пока вы оформляете запись» | Доступность вычисляется, не хранится: `master_weekly_schedule`, `schedule_exceptions`, `time_blocks`, `appointments` + параметры `salon_profile.timezone` / `booking_step_minutes` / `booking_horizon_days` (см. раздел 5). **Момент выбора слота — это момент создания строки `appointments` со `status='hold'`.** Клиент на этом шаге ещё не вошёл в аккаунт (вход — только следующий шаг), поэтому `client_id` в этой строке пока `NULL`, а идентифицирует её `hold_token` |
| **Booking · 4 · Вход в потоке** | Таймер удержания слота — тот же отсчёт, что начался на шаге 3; форма входа (e-mail, пароль); форма регистрации (имя, e-mail, телефон, пароль, согласие с офертой); ссылка «Забыли пароль?» (экран не создан) | `users` (создание/проверка по `email`); после успешного входа или регистрации `appointments.client_id` дозаполняется по `hold_token`, полученному на шаге 3; `password_reset_tokens` (нужна по паспорту, хотя экрана нет — см. «Спорные решения») |
| **Booking · 5 · Подтверждение** | Полная карточка визита (дата, время, мастер, список услуг с ценами, итоговая сумма и длительность, адрес); предупреждение о пересечении с другой записью клиента; поле комментария мастеру (≤200 симв., необязательно); чекбокс напоминания; отправка записи | `appointments`, `appointment_services`, `masters`, `services` |
| **Booking · 6 · Успех** | Итоговая карточка визита; кнопки «В личный кабинет» (экран не создан) и «Добавить в календарь» (клиентская функция, БД не нужна) | `appointments`, `appointment_services` |
| **Ошибка · Слот занят** (полноэкранный и модальный варианты) | Сообщение о том, что слот заняли; список альтернативных свободных слотов; сохранённый набор услуг | Тот же расчёт свободного времени + `appointments.status` — это сценарий 2 из паспорта («состояние гонки»), см. раздел 4 (уникальный индекс) |
| *Нерешённые переходы (лист «Нерешённые случаи»)* | Вход без брони, личный кабинет, восстановление пароля, запись на две даты — экранов нет, но функции заявлены в паспорте | Личный кабинет = выборка `appointments` по `client_id`; восстановление пароля = `password_reset_tokens`; «две даты» не требует новых таблиц — это просто два независимых `appointments` |

---

## 2. Формат хранения дат и времени

Единый формат: **ISO-8601, TEXT, время — только UTC**, без указания смещения в самой строке.

- Момент времени (начало/конец записи, блокировки, `created_at` и т.п.) → `'YYYY-MM-DD HH:MM:SS'`, например `2026-08-18 11:00:00`.
- Дата без времени (исключение в графике мастера) → `'YYYY-MM-DD'`.
- Время суток без даты (границы регулярной смены мастера) → `'HH:MM'`.

Почему так, а не `INTEGER` unix-время и не `REAL`/встроенный тип даты:

1. В SQLite нет отдельного типа даты/времени — это либо `TEXT`, либо `INTEGER`, либо `REAL`, и хранить нужно то, что удобно читать и сравнивать.
2. Строка ISO-8601 сортируется и сравнивается лексикографически так же, как хронологически — `ORDER BY start_datetime`, `WHERE start_datetime > ?` работают без преобразований.
3. Встроенные функции SQLite (`date()`, `datetime()`, `strftime()`) по умолчанию понимают именно этот формат — не нужны кастомные конвертеры.
4. Значение читаемо человеком при просмотре базы напрямую (важно на этапе прототипа и отладки).
5. Время всегда в UTC — единая точка отсчёта исключает ошибки часового пояса при сравнении записей разных мастеров/клиентов; конвертация в локальное время (пока салон работает в одном городе — это Europe/Moscow) — задача уровня приложения, не БД.

---

## 3. Таблицы

### 3.1 `salon_profile` — профиль салона и параметры расчёта свободного времени

Одна строка с данными, которые повторяются на лендинге, подтверждении и экране успеха (адрес, телефон, часы работы), плюс три параметра, без которых расчёт свободного времени «на лету» (раздел 5) неоднозначен или не соответствует тому, что показывают экраны прототипа — см. пояснение под таблицей.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | всегда `1`, таблица на одну строку |
| `name` | TEXT | да | | название салона, например «Тон» |
| `address` | TEXT | да | | «г. Москва, ул. Тверская, 12» |
| `phone` | TEXT | да | | контактный телефон салона |
| `working_hours_note` | TEXT | нет | | текст вида «Ежедневно, 10:00–21:00» для лендинга (справочный, не участвует в расчёте слотов — расчёт идёт по графику мастеров) |
| `timezone` | TEXT | да | | IANA-имя часового пояса, например `Europe/Moscow` |
| `booking_step_minutes` | INTEGER | да | | шаг, с которым нарезаются доступные времена начала записи |
| `booking_horizon_days` | INTEGER | да | | на сколько дней вперёд от текущего момента вообще можно записаться |
| `hold_duration_minutes` | INTEGER | да | | сколько минут держится слот, пока клиент оформляет запись, по умолчанию 10 (добавлено позже, см. раздел 3.1а) |
| `updated_at` | TEXT | да | | ISO-8601, момент последнего изменения |

**Зачем нужны три новых поля — их не хватало для расчёта из требования 3:**

- **`timezone`.** `appointments.start_datetime`, `time_blocks.start_datetime` и т.п. хранятся в UTC (раздел 2), а `master_weekly_schedule.weekday` и `schedule_exceptions.date` заданы в местном, «настенном» времени салона (мастер работает «по понедельникам с 10 до 20» — это локальное время, не UTC). Чтобы на «Booking · 3» правильно определить, какой день недели и какая дата у мастера сейчас, и правильно вычесть из его локального рабочего окна записи и блокировки, которые хранятся в UTC, нужно знать часовой пояс салона — без него граница суток «плывёт», и вечерние/утренние слоты на стыке полуночи могут посчитаться не в том дне.
- **`booking_step_minutes`.** Экран Booking · 3 предлагает слоты ровно по часам — `09:00, 10:00, 11:00…`, а не каждые 5 или 15 минут. Это шаг нарезки, а не длительность услуги (услуги в `services.duration_minutes` бывают некратны часу, например 135 минут). Раньше этот шаг нигде не хранился, то есть при расчёте свободных окон было неизвестно, с каким интервалом предлагать старты — без него алгоритм в принципе не может построить сетку слотов, только «сплошной свободный интервал».
- **`booking_horizon_days`.** Тот же экран прямо показывает ограничение: «Запись открывается за 3 месяца» и календарь физически не даёт пролистать дальше 3 месяцев вперёд (`monthOffset` ограничен 0–3). Это бизнес-правило, а не техническое ограничение календаря — без сохранённого значения новый разработчик не узнает, что горизонт вообще ограничен, и продублирует «3 месяца» магическим числом прямо в коде фронтенда.

```sql
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
```

### 3.1а. Доработка `salon_profile`: `hold_duration_minutes`

При первой реализации API длительность удержания слота (сколько минут
держится слот, пока клиент оформляет запись — требование 4 к API) стала
переменной окружения `HOLD_DURATION_MINUTES`, а не полем в
`salon_profile`, — недосмотр: по сути это ровно того же рода параметр,
что уже есть в этой таблице, `booking_step_minutes` и
`booking_horizon_days`, — не секрет и не инфраструктурная настройка
(секрет — это, например, `SESSION_SECRET`, у которого утечка компрометирует
безопасность; здесь же утечка значения не значит вообще ничего), а
именно продуктовое решение о поведении бронирования, которое
администратор салона должен мочь поменять сам, без деплоя нового `.env`
и без обращения к разработчику — тем же способом, каким уже меняет
`booking_step_minutes`/`booking_horizon_days`.

```sql
ALTER TABLE salon_profile
  ADD COLUMN hold_duration_minutes INTEGER NOT NULL DEFAULT 10 CHECK (hold_duration_minutes > 0);
```

### 3.2 `users` — аккаунты клиентов, администраторов и (теперь) мастеров

Единая таблица логинов. Изначально роль хранилась прямо здесь (`role TEXT`,
`'client'`/`'admin'`) — паспорт продукта требовал ровно эти две, а мастера
не логинились вовсе (см. п.16 «Спорные решения» — этот абзац сейчас
описывает УЖЕ пересмотренное состояние). По прямому требованию — роли
списком, у одного человека может быть несколько одновременно (например,
мастер и администратор), проверка «есть ли нужная роль» вместо «совпадает
ли единственное значение» — колонка `role` заменена отдельной таблицей
`user_roles` (раздел 3.2а). Сама `users` теперь хранит только то, что
описывает человека, а не его права.

**Доработка (миграция `009_yandex_oauth.sql`): вход через Яндекс в один
клик.** `password_hash` стал необязательным, добавлены `provider` и
`provider_id` — см. п.19 «Спорные решения» и `server/src/domain/
yandexAuth.js`. У пользователя, пришедшего только через Яндекс, пароля в
системе нет и не будет, пока он явно не заведёт его сам (такой функции
пока не реализовано); у обычной регистрации email+паролем оба новых поля
остаются `NULL` — это тоже валидное, постоянное состояние, а не временное.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `name` | TEXT | да | | «Как к вам обращаться» из формы регистрации (либо имя, отданное Яндексом) |
| `email` | TEXT | да | UNIQUE | логин; используется для входа и восстановления пароля; для входа через Яндекс — тоже поле поиска/привязки аккаунта (см. п.19) |
| `phone` | TEXT | да | | указывается при регистрации без пометки «необязательно»; у аккаунта, заведённого через Яндекс, — пустая строка (Яндекс телефон не отдаёт, см. п.19) |
| `password_hash` | TEXT | нет | | хеш пароля со своей солью (scrypt, `node:crypto`, без внешних пакетов — bcrypt/argon2 не подходят: нативные сборки, риск не собраться на сервере, см. `server/README.md`, раздел 4); самого пароля в БД нет — требование 5. `NULL` — у аккаунта нет пароля вообще (вход только через `provider`) |
| `provider` | TEXT | нет | | внешний сервис, подтвердивший личность — сейчас только `'yandex'`; `NULL` — обычная регистрация email+паролем |
| `provider_id` | TEXT | нет | UNIQUE (вместе с `provider`) | идентификатор пользователя ВНУТРИ внешнего сервиса — не email (email на стороне Яндекса может смениться, внутренний id — нет), см. п.19 |
| `terms_accepted_at` | TEXT | да | | момент согласия с офертой (чекбокс на форме регистрации блокирует кнопку, пока не отмечен); для входа через Яндекс — момент создания аккаунта, тем же приёмом, что уже применяется на `register.html` (см. п.19) |
| `created_at` | TEXT | да | | |
| `updated_at` | TEXT | да | | |

```sql
CREATE TABLE users (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,
  password_hash      TEXT,
  provider           TEXT,
  provider_id        TEXT,
  terms_accepted_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_email ON users(email);
CREATE UNIQUE INDEX ux_users_provider_id ON users(provider, provider_id) WHERE provider IS NOT NULL;
```

### 3.2а `user_roles` — роли пользователя, списком

Один пользователь — ноль или сколько угодно строк здесь. `'client'`
получает при обычной регистрации (`routes/auth.routes.js` жёстко
проставляет ровно эту роль — из тела запроса роль никогда не читается,
см. требование 7 про поля, которые пользователь не вправе задавать сам).
`'admin'`/`'master'` выдаёт только администратор (`POST /api/admin/users/:id/roles`).

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `user_id` | INTEGER | да | PK (сост.), FK → `users.id` | |
| `role` | TEXT | да | PK (сост.) | `'client'` \| `'admin'` \| `'master'`, фиксированный набор |

```sql
CREATE TABLE user_roles (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('client','admin','master')),
  PRIMARY KEY (user_id, role)
);
```

### 3.3 `password_reset_tokens` — восстановление пароля

Ссылка «Забыли пароль?» есть на экране входа, но целевого экрана в прототипе нет (лист «Нерешённые случаи»). Функция при этом прямо заявлена в паспорте продукта («Функция 1 … включая восстановление пароля»), поэтому таблица нужна уже сейчас.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `user_id` | INTEGER | да | FK → `users.id` | кому принадлежит токен |
| `token_hash` | TEXT | да | UNIQUE | хешируется так же, как пароль — сам токен в открытом виде в БД не хранится |
| `expires_at` | TEXT | да | | короткий срок жизни, например 30 минут |
| `used_at` | TEXT | нет | | момент использования; NULL — токен ещё активен |
| `created_at` | TEXT | да | | |

```sql
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
```

### 3.3а `sessions` — токены сессии входа

До этой таблицы `POST /api/auth/login` выдавал подписанный (HMAC) токен
без какого-либо состояния на сервере: срок действия проверялся по
математике подписи, а не по строке в БД (см. `server/README.md`,
раздел 6). У этого был явный минус — `logout` мог только снять cookie у
клиента, а сам токен, если его успели скопировать, оставался
действителен до истечения срока: отозвать его раньше было нечем. Эта
таблица добавлена именно для двух вещей: ограничить срок действия
записью в базе (не только математикой подписи) и дать `logout` реальный
эффект.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `user_id` | INTEGER | да | FK → `users.id` | |
| `token_hash` | TEXT | да | UNIQUE | хеш токена — сам токен в БД не хранится, только в httpOnly-cookie у клиента (см. ниже, почему не scrypt, как у `password_reset_tokens`) |
| `expires_at` | TEXT | да | | `now + SESSION_TTL_DAYS` на момент выдачи — ограниченный срок действия из требования к API |
| `revoked_at` | TEXT | нет | | момент явного выхода (`POST /api/auth/logout`); `NULL` — сессия ещё не отозвана явно (но могла истечь по `expires_at`) |
| `created_at` | TEXT | да | | |

```sql
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_sessions_token_hash ON sessions(token_hash);
CREATE INDEX ix_sessions_user ON sessions(user_id);
```

Действующая сессия — строка, у которой `revoked_at IS NULL AND
expires_at > текущий момент`. Истёкшие и отозванные строки не удаляются
физически — тот же принцип, что и у `appointments.status IN
('expired','cancelled')` и `password_reset_tokens.used_at`: история
входов не обязана исчезать сразу же, как переставать быть действующей.

**Почему хеш токена — HMAC-SHA256, а не scrypt, как у `password_reset_tokens.token_hash`.**
Это не непоследовательность, а разные задачи. `scrypt` — сознательно
*медленный* алгоритм, и это правильно для пароля или токена сброса
пароля: они низкоэнтропийные (пароль подбирается по словарю, токен
сброса — хоть и случаен, но проверяется по паре email+токен, то есть
пространство перебора практически ограничено активными токенами
одного пользователя) — медленность мешает перебору. Токен сессии —
256 бит чистой случайности, которую вообще не перебирают: угадать его
не легче, чем разложить сам SHA-256, независимо от того, быстрый хеш
или медленный. Зато токен сессии проверяется на **каждом**
аутентифицированном запросе к API, а не как пароль — один раз при
входе. scrypt на каждый запрос — это заметная и совершенно ненужная
здесь CPU-нагрузка. HMAC-SHA256 с ключом `SESSION_SECRET` (тот же секрет,
что подписывал токены в старой, ещё не хранившей их в БД версии, см.
`server/README.md`) — быстрый, детерминированный (нужен для поиска
строки по `token_hash` одним запросом) и с ключом: утечка одной только
таблицы `sessions` без `SESSION_SECRET` не даёт восстановить токен.

### 3.4 `service_categories` — категории услуг

Вкладки «Стрижка / Окрашивание / Уход / Укладка» на экране Booking · 1. Отдельная таблица, а не фиксированный список в коде, потому что админ по паспорту управляет услугами сам, без разработчика.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `name` | TEXT | да | UNIQUE | «Стрижка» и т.д. |
| `sort_order` | INTEGER | да | | порядок вкладок |

```sql
CREATE TABLE service_categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_category_name ON service_categories(name);
```

### 3.5 `services` — услуги

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `category_id` | INTEGER | да | FK → `service_categories.id` | |
| `name` | TEXT | да | | «Стрижка», «Окрашивание» и т.д. |
| `description` | TEXT | нет | | краткое описание |
| `duration_minutes` | INTEGER | да | | длительность, используется при расчёте слотов |
| `price_rub` | INTEGER | да | | цена в целых рублях (см. «Спорные решения» — почему целые) |
| `is_active` | INTEGER | да | | 0/1; неактивные услуги скрыты из выбора, но остаются в истории записей |
| `created_at` | TEXT | да | | |
| `updated_at` | TEXT | да | | |

```sql
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
```

### 3.6 `masters` — мастера

Профиль мастера — самостоятельная сущность, не строка в `users`: карточка
на лендинге/Booking · 2 (имя, специализация, рейтинг) существует независимо
от того, логинится ли этот человек вообще. Управляет профилем администратор
(функция «единая панель для управления расписанием, услугами и записями»).

Это, тем не менее, не означает «мастера не могут логиниться» — `user_id`
(необязательное поле ниже) допускает связь с учётной записью, у которой
есть роль `master` (раздел 3.2а); тогда `GET /api/master/appointments`
показывает записи именно из расписания этого профиля. Профиль без `user_id`
по-прежнему обычный случай — мастер существует и виден клиентам, но ни в
какой аккаунт не входит.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `name` | TEXT | да | | «Анна Соколова» |
| `specialization` | TEXT | нет | | краткая подпись под именем, например «Окрашивание, стрижка» |
| `rating_avg` | REAL | нет | | отображаемый рейтинг, например 4.9 (см. «Спорные решения») |
| `reviews_count` | INTEGER | да | | 0 по умолчанию |
| `photo_url` | TEXT | нет | | в прототипе — заглушка «фото» |
| `is_active` | INTEGER | да | | уволенный/неактивный мастер скрыт из выбора, но виден в истории записей |
| `user_id` | INTEGER | нет | UNIQUE (частично), FK → `users.id` | связь с учётной записью, у которой роль `master`; NULL — профиль без логина (см. выше) |
| `created_at` | TEXT | да | | |
| `updated_at` | TEXT | да | | |

```sql
CREATE TABLE masters (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  specialization  TEXT,
  rating_avg      REAL,
  reviews_count   INTEGER NOT NULL DEFAULT 0,
  photo_url       TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_masters_user_id ON masters(user_id) WHERE user_id IS NOT NULL;
```

### 3.7 `master_services` — какие услуги делает мастер

Экран Booking · 2 показывает только мастеров, которые могут выполнить **весь** набор выбранных услуг за один визит, и явное состояние «никто не подходит» — это прямое доказательство, что связь мастер↔услуга должна быть реальной таблицей, а не текстовым тегом.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `master_id` | INTEGER | да | PK (сост.), FK → `masters.id` | |
| `service_id` | INTEGER | да | PK (сост.), FK → `services.id` | |

```sql
CREATE TABLE master_services (
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (master_id, service_id)
);
CREATE INDEX ix_master_services_service ON master_services(service_id);
```

### 3.8 `master_weekly_schedule` — регулярный график мастера

Шаблон «этот мастер обычно работает в такие-то дни недели с … до …». Отсутствие строки на день недели = мастер в этот день не работает (выходной по умолчанию).

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `master_id` | INTEGER | да | FK → `masters.id` | |
| `weekday` | INTEGER | да | | 1 = понедельник … 7 = воскресенье (ISO-8601) |
| `start_time` | TEXT | да | | `'HH:MM'` |
| `end_time` | TEXT | да | | `'HH:MM'`, больше `start_time` |

```sql
CREATE TABLE master_weekly_schedule (
  id          INTEGER PRIMARY KEY,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX ux_schedule_master_weekday ON master_weekly_schedule(master_id, weekday);
```

### 3.9 `schedule_exceptions` — отклонения от регулярного графика

Разовый выходной, отпуск, сокращённый или удлинённый день у конкретного мастера в конкретную дату — то, что календарь на Booking · 3 показывает маркерами «выходной» / «окон нет» поверх обычного графика.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `master_id` | INTEGER | да | FK → `masters.id` | |
| `date` | TEXT | да | | `'YYYY-MM-DD'` |
| `is_day_off` | INTEGER | да | | 0/1 |
| `start_time` | TEXT | нет | | заполняется, только если `is_day_off = 0` |
| `end_time` | TEXT | нет | | заполняется, только если `is_day_off = 0` |
| `reason` | TEXT | нет | | «отпуск», «болезнь» и т.п., для админ-панели |
| `created_at` | TEXT | да | | |

```sql
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
```

### 3.10 `time_blocks` — ручные блокировки времени

Требование 3 явно называет «блокировки» как третий источник для расчёта свободного времени, отдельно от графика и от записей. Это время, которое админ закрывает вручную (обед, личные дела, техническая пауза) и которое не привязано ни к какому клиенту.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `master_id` | INTEGER | да | FK → `masters.id` | |
| `start_datetime` | TEXT | да | | ISO-8601, UTC |
| `end_datetime` | TEXT | да | | больше `start_datetime` |
| `reason` | TEXT | нет | | |
| `created_by_user_id` | INTEGER | нет | FK → `users.id` | какой админ поставил блокировку; NULL, если админ удалён |
| `created_at` | TEXT | да | | |

```sql
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
```

### 3.11 `appointments` — записи

Ядро схемы. Одна строка — один визит клиента к мастеру, от момента удержания слота (шаг 3, ещё анонимно) до подтверждения (шаг 5/6) или истечения/отмены.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `client_id` | INTEGER | нет | FK → `users.id` | `NULL`, пока запись в статусе `hold` и клиент ещё не вошёл/не зарегистрировался — слот придерживается с шага 3, а вход происходит только на шаге 4. Обязателен, как только статус становится `confirmed` или `completed` (см. `CHECK` в DDL и «Спорные решения») |
| `master_id` | INTEGER | да | FK → `masters.id` | конкретный мастер; даже если клиент выбрал «любой свободный», к моменту выбора времени система закрепляет за записью реального мастера (см. «Спорные решения») |
| `start_datetime` | TEXT | да | | ISO-8601, UTC |
| `end_datetime` | TEXT | да | | `start_datetime` + суммарная длительность услуг |
| `status` | TEXT | да | | фиксированный набор, см. раздел 6 |
| `hold_expires_at` | TEXT | нет | | заполнено только при `status = 'hold'`; экраны Booking · 3/4/5 показывают обратный отсчёт от этого момента |
| `hold_token` | TEXT | нет | UNIQUE (частично) | случайный токен, который браузер сохраняет у себя при создании анонимного удержания на шаге 3. По нему шаг 4 находит «свою» запись и привязывает к ней `client_id` после входа или регистрации — без него страница входа не могла бы знать, какую именно строку `hold` из всех активных удержаний в базе нужно подтвердить |
| `comment` | TEXT | нет | | комментарий мастеру, ≤200 символов |
| `remind_enabled` | INTEGER | да | | чекбокс «напомнить мне о визите», по умолчанию 1 |
| `total_price_rub` | INTEGER | да | | сумма по услугам на момент записи (снапшот) |
| `total_duration_minutes` | INTEGER | да | | сумма длительностей на момент записи (снапшот) |
| `created_at` | TEXT | да | | |
| `updated_at` | TEXT | да | | |
| `cancelled_at` | TEXT | нет | | момент отмены, если применимо |
| `overlap_override` | INTEGER | да | | 0/1, по умолчанию 0. Признак осознанного наложения — выставляется только API-слоем и только для записи, которую создаёт администратор поверх уже занятого времени (см. раздел 3.11б); в обычной записи всегда 0 |
| `cancelled_by_user_id` | INTEGER | нет | FK → `users.id` | кто отменил — сам клиент (владелец записи) или администратор от имени салона; `NULL`, если запись не отменена. Добавлено разделом 3.11г ниже |
| `cancel_reason` | TEXT | нет | | необязательный текст причины отмены, ≤300 символов; `NULL`, если запись не отменена или причину не указали. Добавлено разделом 3.11г ниже |

```sql
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
-- Ключевой индекс защиты от двойной записи — см. раздел 4
CREATE UNIQUE INDEX ux_appt_master_slot_active
  ON appointments(master_id, start_datetime)
  WHERE status IN ('hold','confirmed');
-- Позволяет шагу 4 найти анонимное удержание, созданное на шаге 3, и привязать к нему client_id
CREATE UNIQUE INDEX ux_appt_hold_token
  ON appointments(hold_token)
  WHERE hold_token IS NOT NULL;
```

### 3.11а. Триггеры защиты от пересечения записей одного мастера

`ux_appt_master_slot_active` (раздел 3.11) ловит только точное совпадение
времени **старта** двух активных записей одного мастера. Он не видит
случай, когда услуги разной длительности пересекаются при **разных**
стартах (например, визит 10:00–11:30 и визит 11:00–11:20 у одного
мастера) — SQLite не поддерживает range-exclusion ограничения (`EXCLUDE`,
как в PostgreSQL). Это прямо названо ограничением индекса в «Спорных
решениях», п.1 — там же было решено закрывать общий случай проверкой в
коде приложения внутри транзакции. Два триггера ниже переносят эту же
проверку на уровень самой БД: она сработает и тогда, когда код
приложения её не вызовет или обойдёт при прямом доступе к базе.

Условие пересечения — строго `NEW.start_datetime < other.end_datetime AND
NEW.end_datetime > other.start_datetime`. Записи впритык (конец одной
равно началу другой, например 15:00–16:00 и 16:00–17:00) под это условие
не попадают и пересечением не считаются. Проверяются только «активные»
записи одного мастера — `status IN ('hold','confirmed')`; отменённые,
истёкшие и уже оказанные слот не занимают и в проверку не входят — ни как
новая строка (`WHEN NEW.status IN (...)` не даёт триггеру сработать на
отмену/истечение), ни как существующая (`WHERE status IN (...)` в
подзапросе).

Два триггера, а не один: `BEFORE INSERT` ловит новую запись/удержание,
`BEFORE UPDATE` — перенос (смена `start_datetime`/`end_datetime`) и смену
мастера (`master_id`), включая перенос записи в занятое время у другого
мастера.

```sql
CREATE TRIGGER trg_appointments_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap')
  WHERE EXISTS (
    SELECT 1 FROM appointments
    WHERE master_id = NEW.master_id
      AND status IN ('hold', 'confirmed')
      AND NEW.start_datetime < end_datetime
      AND NEW.end_datetime > start_datetime
  );
END;

CREATE TRIGGER trg_appointments_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap')
  WHERE EXISTS (
    SELECT 1 FROM appointments
    WHERE master_id = NEW.master_id
      AND status IN ('hold', 'confirmed')
      AND id != NEW.id
      AND NEW.start_datetime < end_datetime
      AND NEW.end_datetime > start_datetime
  );
END;
```

Слой приложения (`server/src/domain/booking.js`) перехватывает текст
ошибки `appointment_overlap` и превращает его в HTTP 409 с понятным
русским сообщением и списком ближайших свободных слотов — сырой текст
ошибки SQLite клиенту никогда не отдаётся. Подробности — в
`server/README.md`, раздел 6.

### 3.11б. Осознанное наложение — бронирование администратором поверх занятого времени

Иногда салону нужно завести запись поверх уже занятого времени осознанно
(например, срочный клиент, о котором договорились по телефону в обход
обычной брони) — без этого админ вообще не мог бы это сделать: и триггер
из 3.11а, и частичный уникальный индекс `ux_appt_master_slot_active`
(раздел 3.11) одинаково блокируют и случайную двойную запись, и
намеренную. Добавлен признак `overlap_override` — и правка триггера
на `INSERT` (только на вставку, не на обновление — почему, см. ниже),
и правка самого индекса: без неё самый частый случай наложения —
совпадение времени СТАРТА с уже существующей активной записью — был бы
по-прежнему заблокирован индексом даже при выставленном признаке, а
признак спасал бы только пересечение при *разных* стартах.

```sql
ALTER TABLE appointments
  ADD COLUMN overlap_override INTEGER NOT NULL DEFAULT 0 CHECK (overlap_override IN (0, 1));

-- SQLite не поддерживает ALTER TRIGGER — пересоздаём через DROP + CREATE
DROP TRIGGER trg_appointments_no_overlap_insert;

CREATE TRIGGER trg_appointments_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN NEW.status IN ('hold', 'confirmed') AND NEW.overlap_override = 0
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap')
  WHERE EXISTS (
    SELECT 1 FROM appointments
    WHERE master_id = NEW.master_id
      AND status IN ('hold', 'confirmed')
      AND NEW.start_datetime < end_datetime
      AND NEW.end_datetime > start_datetime
  );
END;

-- SQLite не поддерживает ALTER INDEX — пересоздаём и его тоже, с тем же
-- условием "AND overlap_override = 0" в WHERE.
DROP INDEX ux_appt_master_slot_active;

CREATE UNIQUE INDEX ux_appt_master_slot_active
  ON appointments(master_id, start_datetime)
  WHERE status IN ('hold', 'confirmed') AND overlap_override = 0;
```

`trg_appointments_no_overlap_update` остаётся без изменений и признак не
учитывает — сознательное решение, см. «Спорные решения», п.13.

Кто может выставить признак и как — целиком на уровне API, не БД: сама
колонка не хранит и не проверяет роль (в SQLite нет столбцового ACL) —
только `server/src/routes/admin.routes.js`, маршрут `POST
/api/admin/appointments`, за проверкой `requireRole(ctx, 'admin')`, читает
`overlapOverride` из тела запроса. Обычные маршруты бронирования
(`POST /api/holds`, `POST /api/appointments`) это поле в теле запроса не
читают вовсе — что бы клиент туда ни прислал, оно никак не используется.
Подробности — `server/README.md`, раздел 6.

### 3.12 `appointment_services` — состав записи

Одна запись почти всегда включает несколько услуг («Стрижка + Окрашивание»). Цена, название и длительность услуги фиксируются на момент записи (снапшот), чтобы последующее изменение прайса или переименование услуги админом не искажало историю уже сделанных записей.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `appointment_id` | INTEGER | да | PK (сост.), FK → `appointments.id` | |
| `service_id` | INTEGER | да | PK (сост.), FK → `services.id` | |
| `service_name_snapshot` | TEXT | да | | название услуги на момент записи |
| `price_rub_snapshot` | INTEGER | да | | цена на момент записи |
| `duration_minutes_snapshot` | INTEGER | да | | длительность на момент записи |

```sql
CREATE TABLE appointment_services (
  appointment_id              INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id                  INTEGER NOT NULL REFERENCES services(id),
  service_name_snapshot       TEXT NOT NULL,
  price_rub_snapshot          INTEGER NOT NULL CHECK (price_rub_snapshot >= 0),
  duration_minutes_snapshot   INTEGER NOT NULL CHECK (duration_minutes_snapshot > 0),
  PRIMARY KEY (appointment_id, service_id)
);
CREATE INDEX ix_appt_services_service ON appointment_services(service_id);
```

### 3.11г. Доработка `appointments`: кто и почему отменил запись

Админ-панель («Записи») требует не просто знать, что запись отменена
(`status='cancelled'`, `cancelled_at` — было и раньше), а показывать
администратору, **кто** это сделал (сам клиент через личный кабинет или
администратор от имени салона) и **почему** (необязательный текст
причины). Раньше этого не было ни в схеме, ни в API — `cancelled_at`
отвечал только на «когда».

Оба поля пишет только сервер (`domain/booking.js:cancelAppointment`) —
`cancelled_by_user_id` берётся из текущей аутентифицированной сессии
(`ctx.user.id` в `routes/appointments.routes.js`, тот же маршрут
`POST /api/appointments/:id/cancel` обслуживает и клиента, и админа —
роль уже проверена `assertCanModifyAppointment`), клиент не может
подставить сюда чужой `id` — поля в теле запроса для этого просто нет.

```sql
ALTER TABLE appointments
  ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments
  ADD COLUMN cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300);
```

`ON DELETE SET NULL`, не `RESTRICT`/каскад — если пользователь, отменивший
запись, когда-нибудь будет удалён из `users`, это не должно ни заблокировать
его удаление, ни утащить за собой историю самой записи; кто именно отменил,
в этом гипотетическом случае просто станет неизвестно, а факт и причина
отмены (`cancel_reason`) — останутся.

### 3.13 `appointment_reschedule_log` — история переносов записи

Перенос (`PATCH /api/appointments/:id/reschedule`) и раньше не создавал
новую запись, а обновлял ту же строку (раздел 3.11, поле `master_id`,
`start_datetime`/`end_datetime`) — ровно так, как того требует сценарий
«это один и тот же визит, а не отмена плюс новая запись». Но сама история
изменений нигде не сохранялась: после переноса прежнее время было видно
только тем, кто успел его запомнить. Требование «сохраняй, откуда, куда и
кем перенесена запись» для администраторской панели («Записи») этого уже
не позволяет — понадобилась отдельная таблица-журнал, по одной строке на
каждый факт переноса (запись можно переносить многократно, и каждый раз —
это отдельное событие, а не перезаписываемое состояние).

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `appointment_id` | INTEGER | да | FK → `appointments.id` | какую запись перенесли |
| `old_start_datetime` | TEXT | да | | время ДО переноса, ISO-8601 UTC |
| `old_master_id` | INTEGER | да | FK → `masters.id` | мастер ДО переноса |
| `new_start_datetime` | TEXT | да | | время ПОСЛЕ переноса |
| `new_master_id` | INTEGER | да | FK → `masters.id` | мастер ПОСЛЕ переноса (обычно тот же, что и был, — смену мастера при переносе может задать только администратор, `routes/appointments.routes.js`) |
| `changed_by_user_id` | INTEGER | нет | FK → `users.id` | кто перенёс — клиент-владелец или администратор; `NULL`, если пользователь позже удалён |
| `created_at` | TEXT | да | | момент переноса |

```sql
CREATE TABLE appointment_reschedule_log (
  id                  INTEGER PRIMARY KEY,
  appointment_id      INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  old_start_datetime  TEXT NOT NULL,
  old_master_id       INTEGER NOT NULL REFERENCES masters(id),
  new_start_datetime  TEXT NOT NULL,
  new_master_id       INTEGER NOT NULL REFERENCES masters(id),
  changed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX ix_reschedule_log_appointment ON appointment_reschedule_log(appointment_id);
```

Отдельная таблица, а не "предыдущие" поля прямо в `appointments` (по
образцу `old_start_datetime` вместо истории) — та же причина, что и у
`schedule_exceptions` vs `master_weekly_schedule` (раздел 3.9): состояние
"было раньше" и так есть в самой строке `appointments` (её текущие
`start_datetime`/`master_id` — это и есть "куда"), а вот "было ДО этого
ещё раз, и ещё раз" одной парой колонок не выразить — при втором переносе
информация о первом молча потерялась бы. `ON DELETE CASCADE` на
`appointment_id` — история переноса не имеет смысла без самой записи,
которой больше нет физически (записи и так не удаляются, раздел 3.11,
«Спорные решения» п.10 — но если это когда-нибудь изменится, каскад не
оставит висячих строк журнала).

### 3.14 `notifications` — уведомления в личном кабинете

Экран «Уведомления» и счётчик непрочитанных в шапке кабинета были
подключены к статичной разметке без данных — ни хранилища, ни эндпоинтов
под события уведомлений не было (раздел 7 «Что на стороне экрана решить
нельзя» выше так и говорил: «в БД и API нет ни хранилища, ни одного
эндпоинта под события уведомлений»). Эта таблица и закрывает именно этот
пробел, не больше: только то, что реально понадобилось трём событиям,
перечисленным в задаче (раздел 8 ниже, «Когда создаётся уведомление») —
почта, push и любые внешние каналы по-прежнему вне охвата (задача прямо
это исключает), уведомление живёт только внутри личного кабинета.

| Поле | Тип | Обязательное | Ключ | Комментарий |
|---|---|---|---|---|
| `id` | INTEGER | да | PK | |
| `user_id` | INTEGER | да | FK → `users.id` | получатель — всегда конкретный клиент, не может быть NULL (у события, ради которого создаётся уведомление, получатель известен заранее, см. раздел 8) |
| `type` | TEXT | да | | тип события, фиксированный набор — см. `CHECK` в DDL и раздел 8 |
| `message` | TEXT | да | | готовый текст уведомления на русском, собранный сервером один раз в момент события (день недели и время — в часовом поясе салона на тот момент); не пересобирается при каждом чтении — то же рассуждение, что и у снапшота `appointment_services` (раздел 3.12): более поздний перенос той же записи не должен задним числом переписать текст уже показанного уведомления о предыдущем событии |
| `appointment_id` | INTEGER | да | FK → `appointments.id` | какая запись затронута; все три предусмотренных типа события всегда привязаны к конкретной записи — по этому полю строится ссылка «перейти к записи» на экране уведомлений |
| `is_read` | INTEGER | да | | 0/1, по умолчанию 0 |
| `created_at` | TEXT | да | | момент создания уведомления (не момент самого события — они совпадают, отдельного поля для события нет: уведомление создаётся сразу же, синхронно с самим действием, см. раздел 8) |

```sql
CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('appointment_cancelled', 'appointment_rescheduled', 'appointment_double_booked')),
  message         TEXT NOT NULL,
  appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  is_read         INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX ix_notifications_user_unread ON notifications(user_id) WHERE is_read = 0;
```

`ON DELETE CASCADE` на `appointment_id`, не `SET NULL` — уведомление без
записи, на которую оно ссылается, бесполезно и вводит в заблуждение
(«по ссылке из уведомления пользователь должен попадать на
соответствующую запись» перестало бы работать), а не полезный осколок
истории; записи в этом проекте физически не удаляются (раздел 3.11,
«Спорные решения» п.10), поэтому на практике каскад не сработает никогда —
это скорее объявление правильного поведения на случай, если это
когда-нибудь изменится, чем действующий сценарий.

Индекс `ix_notifications_user_unread` — частичный, только по
непрочитанным: именно он, а не полный `(user_id, is_read)`, обслуживает
самый частый запрос (раздел 8 ниже, «Список уведомлений и счётчик —
один запрос») — количество непрочитанных нужно при каждом открытии
любой страницы личного кабинета (счётчик в шапке), а не только на самом
экране уведомлений.

---

## 4. Уникальные ограничения и индексы

| Ограничение / индекс | Таблица | Зачем | Что сломается без него |
|---|---|---|---|
| `UNIQUE(email)` | `users` | e-mail — единственный логин; на него же завязано восстановление пароля | можно будет создать два аккаунта с одним e-mail — вход и восстановление пароля станут неоднозначными (в какой аккаунт входить?) |
| `UNIQUE(provider, provider_id) WHERE provider IS NOT NULL` | `users` | один аккаунт во внешнем сервисе (Яндекс) не может оказаться привязан сразу к двум нашим аккаунтам | без ограничения два разных наших пользователя теоретически могли бы получить один и тот же `provider_id` — вход через Яндекс стал бы неоднозначным (в какой из двух аккаунтов входить?) |
| `UNIQUE(token_hash)` | `password_reset_tokens` | токен восстановления должен однозначно указывать на один запрос | коллизия токенов теоретически позволит подобрать чужой токен и сбросить пароль другого пользователя |
| `UNIQUE(name)` | `service_categories` | вкладки категорий на Booking · 1 должны быть различимы | появятся две одинаковые вкладки «Стрижка», пользователь не поймёт разницу |
| `PRIMARY KEY(master_id, service_id)` | `master_services` | связь мастер↔услуга должна быть без дублей | задваивание строк не сломает данные напрямую, но исказит любые агрегаты («сколько услуг делает мастер») и усложнит проверку «есть ли связь» |
| `UNIQUE(master_id, weekday)` | `master_weekly_schedule` | у мастера один график на день недели | два конфликтующих графика на понедельник — расчёт свободного времени не сможет решить, какой из них верный, и либо задвоит окна, либо возьмёт случайный |
| `UNIQUE(master_id, date)` | `schedule_exceptions` | у мастера одно исключение на конкретную дату | два противоречащих исключения на одну дату (например, «выходной» и «работает до 15:00» одновременно) — календарь Booking · 3 покажет непредсказуемый маркер дня |
| `UNIQUE(master_id, start_datetime) WHERE status IN ('hold','confirmed') AND overlap_override = 0` (условие дополнено в 3.11б) | `appointments` | это и есть защита от сценария 2 из паспорта («состояние гонки»): два клиента не могут одновременно удержать/подтвердить один и тот же мастер+время | без индекса возможна двойная запись — ровно тот риск, который паспорт прямо называет главным. Ограничение частичное (только для активных статусов и без осознанного наложения), поэтому отменённые/истёкшие записи и намеренные наложения админа не мешают остальным операциям |
| `UNIQUE(hold_token) WHERE hold_token IS NOT NULL` | `appointments` | шаг 3 создаёт анонимное удержание без `client_id`, и только по этому токену шаг 4 понимает, какую именно строку подтверждать после входа | без уникальности два параллельных анонимных удержания могли бы получить одинаковый токен — тогда после входа один клиент случайно «подхватил» бы чужую бронь |
| `TRIGGER trg_appointments_no_overlap_insert/_update` (раздел 3.11а) | `appointments` | закрывает то, что не ловит частичный индекс выше — пересечение диапазонов при *разных* стартах (услуги разной длительности); срабатывает и на вставку, и на перенос/смену мастера | без триггера возможна двойная запись, если два визита пересекаются, но начинаются в разное время — ровно та дыра, которую сам частичный индекс закрыть не может |
| `INDEX(master_id, start_datetime)` | `appointments` | быстрый список записей мастера на день/период для админ-панели и для расчёта свободного времени | при росте базы каждая проверка занятости или дневной список админа станет полным сканированием таблицы |
| `INDEX(client_id, start_datetime)` | `appointments` | «Личный кабинет» — список своих записей клиента, отсортированный по дате | тот же список будет собираться полным сканированием таблицы, с ростом числа записей — всё медленнее |
| `INDEX(master_id, start_datetime)` | `time_blocks` | блокировки нужно быстро вычитать при расчёте свободного времени конкретного мастера на дату | расчёт слотов на каждый экран Booking · 3 будет перебирать все блокировки всех мастеров |
| `INDEX(category_id)` | `services` | фильтрация услуг по вкладке категории на Booking · 1 | при большом каталоге переключение вкладки категории будет читать всю таблицу услуг |
| `INDEX(service_id)` | `master_services` | обратный поиск «какие мастера делают услугу X» — нужен, чтобы вычислить пересечение мастеров по нескольким выбранным услугам на Booking · 2 | пересечение по нескольким услугам придётся считать полным перебором таблицы связей |
| `INDEX(user_id)` | `password_reset_tokens` | поиск активных токенов пользователя, инвалидация старых при выпуске нового | старые неиспользованные токены нельзя быстро найти и отозвать при повторном запросе восстановления |
| `UNIQUE(token_hash)` | `sessions` | проверка сессии на каждом аутентифицированном запросе — одна строка по хешу токена | коллизия хешей теоретически позволит одному токену пройти проверку сессии другого пользователя |
| `INDEX(user_id)` | `sessions` | быстрый поиск всех сессий пользователя (например, для будущего «выйти со всех устройств») | перебор активных сессий пользователя стал бы полным сканированием таблицы |
| `PRIMARY KEY(user_id, role)` | `user_roles` | одна и та же роль не может быть выдана одному пользователю дважды | задваивание строк не даёт лишних прав (проверка `roles.includes(role)` не заметит разницы), но искажает любой подсчёт «сколько ролей у скольких людей» и `INSERT OR IGNORE` в `grantRole` перестал бы быть идемпотентным без этого ограничения |
| `UNIQUE(user_id) WHERE user_id IS NOT NULL` | `masters` | один пользователь может быть привязан не более чем к одному профилю мастера | без индекса один аккаунт мог бы «владеть» сразу двумя расписаниями — `GET /api/master/appointments` не сможет решить, чьё показывать (см. также проверку с обратной стороны связи в коде — раздел 7, п.16) |
| `INDEX(appointment_id)` | `appointment_reschedule_log` | админ-панель («Записи») читает историю переносов одной конкретной записи | перебор истории переноса одной записи стал бы полным сканированием журнала по всем записям сразу |

---

## 5. Как считается свободное время (без отдельной таблицы слотов)

Отдельной таблицы «свободные слоты» в схеме нет и не создавалось по требованию 3 — свободное время вычисляется на лету, в момент запроса, на основании:

0. запрошенная дата не дальше `salon_profile.booking_horizon_days` дней от текущего момента — иначе она вне зоны бронирования и слоты не считаются вовсе;
1. `master_weekly_schedule` — базовый шаблон рабочих часов мастера на день недели нужной даты, день недели определяется в часовом поясе `salon_profile.timezone`;
2. `schedule_exceptions` — если на конкретную дату (в том же часовом поясе) есть исключение, оно полностью заменяет пункт 1 (выходной либо другие часы);
3. вычитаются интервалы из `appointments` со `status IN ('hold','confirmed')` на эту дату и этого мастера (сравнение идёт в UTC — местные границы дня из пунктов 1–2 переводятся в UTC через `timezone`);
4. вычитаются интервалы из `time_blocks` на эту дату и этого мастера (тоже в UTC);
5. то, что осталось, нарезается на кандидаты начала записи с шагом `salon_profile.booking_step_minutes`, и из них показываются только те, куда помещается суммарная длительность выбранных на Booking · 1 услуг (для сетки слотов утро/день/вечер).

Один и тот же расчёт используется и для календаря (Booking · 3), и для подбора альтернативных слотов на экране «Ошибка · Слот занят», и для «ближайшего окна» на карточках мастера на лендинге и на Booking · 2.

---

## 6. Статусы записи (`appointments.status`)

Фиксированный набор значений вместо свободного текста (требование 4), проверяется через `CHECK`:

| Статус | Когда возникает | Занимает ли слот |
|---|---|---|
| `hold` | Клиент выбрал время на шаге 3; действует, пока не истечёт `hold_expires_at`. `client_id` может быть `NULL` (клиент ещё не вошёл — см. `hold_token`) | да |
| `confirmed` | Клиент нажал «Записаться» на шаге подтверждения (Booking · 6 «Успех») | да |
| `completed` | Время визита прошло, услуга оказана (проставляется фоновой задачей или админом) | нет |
| `cancelled` | Клиент или админ отменили запись (сценарий 3 паспорта — «клиент отменил визит») | нет |
| `expired` | Удержание слота истекло без подтверждения (таймер на Booking · 4/5 дошёл до нуля) | нет |

---

## 7. Спорные решения

1. **Точное совпадение времени начала вместо полноценного исключения пересекающихся диапазонов — закрыто триггерами.** Уникальный индекс `ux_appt_master_slot_active` защищает только от буквального сценария 2 из паспорта — двух записей на один и тот же мастер и одну и ту же минуту старта; частичное пересечение при *разных* стартах он не ловит (SQLite не поддерживает range-exclusion ограничения, как `EXCLUDE` в PostgreSQL). Изначально эту дыру закрывала только проверка в коде приложения. Теперь этого недостаточно посчитали — добавлены два триггера (`trg_appointments_no_overlap_insert`/`_update`, раздел 3.11а), которые проверяют полноценное пересечение диапазонов на уровне самой таблицы `appointments`, при вставке и при обновлении (перенос, смена мастера). Это и есть последний рубеж защиты на уровне БД — работает, даже если код приложения проверку не вызовет. Запись всё равно создаётся внутри транзакции `BEGIN IMMEDIATE` (блокировка на запись берётся сразу при старте транзакции, а не при первой вставке) с предварительной проверкой пересечения в коде приложения (`server/src/domain/availability.js`) — она первой даёт понятную причину отказа (выходной, вне часов работы, ручная блокировка) там, где голый триггер умеет сказать только «пересекается».

2. **`CHECK`-ограничение вместо отдельной справочной таблицы для `status` и `role`.** Оба набора значений маленькие и меняются только вместе с кодом приложения (новый статус — это всегда новая бизнес-логика, а не запись, которую можно добавить через админку). Справочная таблица дала бы формальную ссылочную целостность, но добавила бы лишний JOIN без реальной пользы на этом масштабе. (`role` с тех пор переехала из `users.role` в `user_roles.role` — раздел 3.2а, п.16 ниже, — но сам список допустимых ролей всё ещё маленький фиксированный набор, поэтому рассуждение и здесь `CHECK`, а не отдельная справочная таблица, не изменилось.)

3. **«Любой свободный мастер» не хранится как `NULL` в `master_id`.** На экране Booking · 2 это фильтр выбора, а не персистентное состояние: к моменту, когда клиент выбирает конкретное время на Booking · 3, система уже обязана знать, чей график показывать, — значит, конкретный мастер закрепляется за записью не позже выбора слота. Хранить `NULL` пришлось бы поддерживать отдельной веткой логики почти во всех запросах к `appointments`, не давая взамен ничего, кроме дополнительной сложности.

4. **Деньги — целые рубли (`INTEGER`), не копейки и не `REAL`.** Во всех экранах прототипа цены целые («2 800 ₽», «900 ₽»), дробных рублей нет нигде. `REAL` создал бы риск ошибок округления при суммировании нескольких услуг. Если в будущем появится онлайн-оплата с копейками или скидками в процентах, это отдельное решение — сейчас, при оплате исключительно на месте, целые рубли достаточны и проще.

5. **Снапшот цены/названия/длительности услуги в `appointment_services`, но не снапшот имени мастера в `appointments`.** Цены и состав услуг меняются регулярно (это обычная работа админа с прайсом), и старая запись не должна «задним числом» менять сумму, которую видел клиент. Имя мастера меняется практически никогда; если мастер уходит из салона, он просто помечается `is_active = 0`, а история записей продолжает ссылаться на него по `master_id`. Асимметрия сознательная: дублировать то, что почти никогда не меняется, — не оправданная сложность.

6. **`rating_avg`/`reviews_count` — простые поля в `masters`, а не отдельная таблица отзывов.** На экранах (лендинг, Booking · 2) рейтинг и число отзывов показываются, но ни один экран прототипа и ни одна функция в паспорте продукта не описывают, что клиент может оставить отзыв — блок отзывов на лендинге статичный. Заводить полноценную таблицу `reviews` с модерацией сейчас означало бы проектировать функцию, которой нет в требованиях. Если она появится позже — это отдельная таблица со своим статусом модерации, а поля на `masters` тогда станут вычисляемым кэшем.

7. **`salon_profile` — таблица на одну строку, а не константы в коде.** Адрес и телефон салона повторяются одинаково на трёх разных экранах (лендинг, подтверждение, успех). Хранить это в БД чуть избыточно для сервиса с одним бизнесом, но зато правится в одном месте без деплоя — так же, как админ по паспорту правит услуги и мастеров без обращения к разработчику. При реальной необходимости это можно заменить на конфиг приложения без потери данных.

8. **`password_reset_tokens` включена в схему, хотя экрана восстановления пароля в прототипе нет.** Лист «Нерешённые случаи» явно фиксирует это как пробел в навигации, а не как отменённую функцию — сама функция прямо названа в паспорте продукта («Функция 1 … включая восстановление пароля»). Не включить таблицу сейчас — значит молча выбросить заявленное требование вместо того, чтобы явно отметить недостающий экран. API поверх этой таблицы реализован позже, отдельным заходом (`server/src/domain/passwordReset.js`) — тоже без экрана в прототипе, но по прямому указанию функции в паспорте, с отдельным разбором конфликта с ограничением «уведомления только внутри личного кабинета» (см. `server/README.md`, раздел 6).

9. **Регулярный график и исключения — две таблицы, а не одна дата-ориентированная.** Обычно график мастера стабилен месяцами, а отклонения (отпуск, разовый перенос) редки. Разделение снижает объём записи (не нужно генерировать строки на каждую дату вперёд) ценой того, что при расчёте свободного времени нужно объединять два источника вместо одного — это несложная и предсказуемая логика.

10. **Удержание слота (`hold`) — это статус и `hold_expires_at` в `appointments`, а не отдельная эфемерная таблица броней.** И временное удержание, и подтверждённая запись одинаково должны «занимать» мастера при расчёте свободного времени и одинаково участвовать в защите от двойной записи (индекс из раздела 4) — держать их в одной таблице проще, чем синхронизировать два источника истины. Цена решения — в `appointments` будут появляться строки со статусом `expired`, которые визитом так и не стали; это осознанно оставлено для истории (например, чтобы видеть, как часто клиенты не успевают подтвердить запись).

11. **`timezone`, `booking_step_minutes`, `booking_horizon_days` — добавлены в `salon_profile`, а не оставлены константами в коде.** Первая версия документа описывала расчёт свободного времени словами («вычитаем записи и блокировки из графика»), но не называла явно все входные данные этого расчёта. При более внимательном разборе экрана Booking · 3 обнаружилось, что как минимум три вещи, без которых расчёт не воспроизводим и не соответствует прототипу, нигде не хранились: часовой пояс (нужен, чтобы сопоставить локальный график мастера с датами/временем записей и блокировок в UTC), шаг сетки слотов (прототип предлагает старты ровно по часам, это не выводится из длительности услуг) и горизонт бронирования (прототип жёстко ограничивает запись тремя месяцами вперёд). Не заводил под них новую таблицу: это ровно такие же общесалонные настройки, как адрес и телефон, уже вынесенные в `salon_profile`, — отдельная таблица на три строки не добавила бы ничего, кроме лишнего JOIN при каждом расчёте слотов.

12. **`client_id` в `appointments` сделан необязательным, плюс добавлен `hold_token`.** При первом проходе по схеме я предполагал, что запись создаётся уже от имени известного клиента. Повторная проверка по карте переходов показала, что порядок экранов другой: слот удерживается на шаге 3 («Дата и время»), а вход или регистрация происходят только на шаге 4 — то есть в момент создания `hold`-строки клиента в системе ещё нет. Варианты решения: (а) не создавать строку в БД до входа, а держать выбор на клиенте/в сессии — но тогда таймер удержания на шагах 3–5 и защита от двойной записи (раздел 4) не работали бы до тех пор, пока клиент не введёт e-mail, и слот в это время мог бы уйти другому — прямое противоречие сообщению «мы придержим это время»; (б) завести отдельную таблицу анонимных удержаний, которая при входе переносится в `appointments` — синхронизация двух таблиц ради одной колонки того не стоит. Выбран третий вариант: `client_id` допускает `NULL` только для `status='hold'` (проверяется `CHECK`), а `hold_token` — это то, что до входа заменяет клиенту идентификацию «моей» записи; после успешного входа/регистрации приложение находит строку по токену и проставляет `client_id`.

13. **`overlap_override` учитывается только триггером и индексом на `INSERT`, не на `UPDATE`.** Требование — дать администратору осознанно забронировать время поверх уже занятого, но при этом такая запись дальше должна вести себя как обычная (раздел 3.11б). Если бы признак учитывался ещё и в триггере на `UPDATE`, он превратился бы в постоянное освобождение от проверки для этой конкретной строки — админ один раз поставил `overlap_override=1` при создании, и с этого момента запись можно было бы бесконтрольно двигать по календарю в любое занятое время, даже без переоформления решения. Это противоречило бы самой мысли «наложение — осознанный разовый выбор», а не «эта запись теперь особенная навсегда». Поэтому признак прощает только сам момент создания; перенос той же записи (тот же `PATCH .../reschedule`, что и у обычных записей) снова проверяется как у всех — если новое время тоже занято, потребуется либо выбрать свободное, либо заново создать конфликт вручную (для этого отдельного API-эндпоинта переноса с наложением сейчас нет — списано в `server/README.md`, раздел «Дальше по проекту», как сознательно не сделанное).

    Это же рассуждение по-другому проявилось при реализации: сначала поправили только триггер `trg_appointments_no_overlap_insert`, упустив, что `ux_appt_master_slot_active` — отдельная, самостоятельная защита (раздел 3.11а), и она тоже не знала про новый признак. В первой версии миграции админ с `overlapOverride=true` получал не 201, а 409 — именно на самом частом случае наложения (совпадение времени старта), потому что индекс останавливал вставку раньше, чем до неё вообще доходило дело до триггера. Нашлось это прогоном запроса через реальный HTTP API, а не чтением кода — исправление ушло в ту же миграцию 003, `WHERE status IN ('hold','confirmed') AND overlap_override = 0` вместо старого условия.

14. **Пересмотр раннего решения: сессии всё-таки хранятся в БД (`sessions`, раздел 3.3а), хотя изначально было решено обойтись без таблицы.** Первая версия API выдавала подписанный (HMAC) токен без какого-либо состояния на сервере — решение было принято явно и обосновано: заводить таблицу в обход документа схемы означало бы менять её по ходу задачи, а не по прямому запросу (см. историю `server/README.md`, раздел 6). Ограниченный срок действия токена и хранение его хеша, а не самого токена — это прямой запрос к API, и оба требования вместе физически нельзя выполнить без строки в базе: подписанный токен без состояния истекает только математически (по дате внутри самой подписи), а «отозвать раньше срока» и «не хранить сам токен, только его хеш» — это ровно то, для чего в принципе нужна таблица, не код. Как только требование появилось явно — решение пересмотрено, а не обойдено полумерой (например, укорачиванием TTL подписи вместо реального отзыва). Заодно закрылось то, что раньше было в `server/README.md` осознанным ограничением («жёсткий отзыв сессий») — не потому, что решили доделать «раз уж всё равно трогаем», а потому что новое требование само по себе требует того же механизма.

15. **`hold_duration_minutes` — тоже поле `salon_profile`, а не `.env`, тем же рассуждением, что и `timezone`/`booking_step_minutes`/`booking_horizon_days` (раздел 3.1).** При первой реализации попал в `HOLD_DURATION_MINUTES` в `.env` — по аналогии с `SESSION_TTL_DAYS`/`PASSWORD_RESET_TTL_MINUTES`, которые тоже читаются из окружения. Разница в том, что те два — параметры безопасности/инфраструктуры (срок жизни сессии, срок жизни токена сброса пароля): их не показывают в интерфейсе администратора салона, это решение уровня разработчика/эксплуатации, и оно не меняется без осмысленной причины, связанной с безопасностью, а не с бизнесом. `hold_duration_minutes` — ровно наоборот: это решение о том, сколько времени салон готов «морозить» слот ради одного нерешительного клиента, прежде чем отдать его следующему, — бизнес-компромисс между удобством и потерянными слотами, тот же тип решения, что и «шаг сетки слотов по часу, а не по 15 минут» (`booking_step_minutes`). Обнаружилось при выполнении отдельного требования «настройки продукта, которые может менять администратор салона, храни в БД, а не в `.env`» — перенесено в `salon_profile` (миграция `005_salon_profile_hold_duration.sql`), `.env`/`.env.example` и `config/env.js` от него избавлены.

16. **Явный пересмотр решения «мастера не логинятся»: роли теперь список (`user_roles`, раздел 3.2а), и одна из них — `master`.** Это решение прежде было принято и зафиксировано осознанно, не по умолчанию: раздел 3.6 (старая версия) прямо говорил «мастера не входят в `users`», а `server/README.md` фиксировал, что это «подтверждено с постановщиком задачи явно». Новое требование — прямо противоположное и настолько же явное: «роли храни списком, у одного человека может быть несколько ролей, например мастер и администратор одновременно», «мастер видит записи из своего расписания». Это не тихая отмена прежнего пункта задним числом, а такой же явный пересмотр по прямому запросу того же постановщика задачи — оставляю здесь оба факта («было решено X, стало Y по прямому запросу»), а не переписываю историю так, будто `role` в `users` никогда не было.
    Реализация — три связанные части:
    - `user_roles(user_id, role)` вместо `users.role` (одно значение → список; `users.role` физически удалена миграцией `006_user_roles.sql`, данные перенесены);
    - `masters.user_id` (nullable, unique-частично) — необязательная связь профиля мастера с учётной записью; профиль без логина по-прежнему легален (раздел 3.6);
    - на уровне приложения — `requireRole`/`requireAnyRole` (`server/src/middleware/auth.js`) проверяют `roles.includes(role)`, а не `role === x`; ownership-проверка для записей (`server/src/routes/appointments.routes.js`, `assertCanAccessAppointment`) — трёхсторонняя: `admin` видит всё, `client` — где он клиент, `master` — где `master_id` совпадает с профилем, привязанным к его `user_id`.

    Осознанно НЕ сделано в этом же заходе: право `master` менять (переносить/отменять) записи своего расписания — запрос говорил только «видит», расширять до записи молча не стали (`assertCanModifyAppointment` того же файла — по-прежнему только `client`-владелец или `admin`). Отдельная находка при ручной проверке нового `PATCH /api/admin/masters/:id`: первая версия проверяла только «не привязан ли уже ЭТОТ пользователь к другому мастеру», но не «не привязан ли уже ЭТОТ профиль мастера к другому пользователю» — из-за этого можно было молча переподвязать чужой (уже занятый) профиль мастера на нового пользователя, тихо отобрав доступ к расписанию у прежнего. Нашлось не чтением кода, а прогоном сценария через реальный API (тот же паттерн, что и в п.13) — исправлено проверкой обеих сторон связи, с явным требованием сначала отвязать (`userId: null`), если профиль уже занят.

17. **Перенос — история в отдельной таблице (`appointment_reschedule_log`, раздел 3.13), отмена — просто два новых поля в самой строке (раздел 3.11г).** На первый взгляд асимметрично — оба факта «что-то произошло с записью, кем и когда», но решены по-разному. Разница не случайна: отменить запись можно только один раз (после `status='cancelled'` со сменой статуса менять уже нечего — `cancelAppointment` в `domain/booking.js` и так требует `status IN ('hold','confirmed')`), значит «кто и почему» — это ровно одно значение на всю жизнь записи, пары новых колонок достаточно, как и `cancelled_at` до них. Перенести же запись можно многократно (перенос не меняет статус, `confirmed` остаётся `confirmed`) — если бы «откуда» и «кем» тоже были парой колонок прямо в `appointments`, второй перенос бы стёр память о первом, а «сохраняй, откуда, куда и кем перенесена запись» подразумевает именно историю, а не последнее известное значение. Тот же выбор (отдельная таблица под то, что может повторяться, а не колонки под то, что происходит не больше одного раза) уже делался раньше для графика мастера — `master_weekly_schedule` (шаблон) отдельно от `schedule_exceptions` (события-отклонения, могут копиться), раздел 3.9.

19. **Вход через Яндекс в один клик — `password_hash` стал необязательным, `provider`/`provider_id` добавлены в `users`; привязка по email, не по внутреннему id.** Требование — кнопка «Войти через Яндекс» рядом с обычной формой, без сбора пароля. Несколько решений внутри одной миграции (`009_yandex_oauth.sql`), каждое — отдельный компромисс:
    - **`password_hash` nullable вместо сентинел-значения.** Можно было бы не трогать схему и подставлять аккаунту без пароля какой-нибудь непроходимый хеш-заглушку — но это соврало бы о состоянии данных (поле выглядело бы так, будто пароль есть). `NULL` — честное «пароля нет», и `verifyPassword` (`security/passwords.js`) и так уже возвращает `false` на нестроковый `storedHash`, а не падает — вход по паролю на аккаунт без пароля корректно отвечает тем же «Неверный e-mail или пароль», без отдельной ветки кода.
    - **Перестройка таблицы без `PRAGMA foreign_keys=OFF`.** SQLite не поддерживает `ALTER TABLE ... ALTER COLUMN` (снять `NOT NULL` иначе нельзя) — единственный способ переименовать/пересоздать таблицу: новая таблица → перенос данных с сохранением `id` → `DROP` старой → `RENAME`. Официальная рекомендация SQLite — на время этой операции выключать `PRAGMA foreign_keys`, но раннер миграций (`db/migrate.js`) сам оборачивает файл в `BEGIN`/`COMMIT`, а смена этой прагмы внутри уже открытой транзакции — no-op, отключить её физически негде. Это не проблема именно для этой миграции: `DROP TABLE` родителя не проверяется внешними ключами сам по себе (проверяются только `INSERT`/`UPDATE`/`DELETE` на дочерней стороне, которых между `DROP` и `RENAME` не происходит), а `id` не меняются — ссылки из `sessions`/`user_roles`/`masters`/`password_reset_tokens`/`appointments`/... восстанавливаются полностью в момент, когда таблица получает старое имя обратно.
    - **Поиск/привязка аккаунта по email, а не по `provider_id` через отдельную таблицу связей (`oauth_accounts`).** Более строгий вариант отдельной таблицы `provider`+`provider_id`→`user_id` без опоры на email обсуждался, но отклонён по прямому указанию — искать по email, привязывать первый найденный аккаунт. Это тот же инвариант, что и `UNIQUE(email)` у `users`: один email — один аккаунт, вне зависимости от способа входа. Цена — если Яндекс когда-нибудь отдаст email, который уже занят чужим (не тем же человеком) локальным аккаунтом, вход привяжется к чужому аккаунту молча; это тот же класс риска, что и всегда был у `email` как единственного логина, не новый.
    - **`phone` остаётся `NOT NULL`, но у аккаунта из Яндекса — пустая строка.** Яндекс в базовом наборе прав (`login:email`, `login:info`) телефон не отдаёт, а задача не просила делать `phone` необязательным. Расширять схему ещё на одно поле ради одного нового источника регистрации не стал — пустая строка явно заметна (не похожа на настоящий номер), в остальном коде `phone` сейчас нигде не используется для реальной отправки (SMS/звонков нет), только отображается (`toPublicUser`). Если это станет проблемой — доращивать поток регистрации через Яндекс отдельным шагом «добавьте телефон», не сейчас.
    - **`terms_accepted_at` проставляется автоматически, без отдельного согласия на этом экране.** Тот же приём, что уже принят на `register.html` (`web/js/register.js`: чекбокса оферты на форме нет, `termsAccepted: true` шлётся всегда) — здесь тот же принцип перенесён на сервер: `findOrCreateYandexUser` (`server/src/domain/yandexAuth.js`) сам проставляет `terms_accepted_at = now` новому аккаунту, а не требует отдельного экрана согласия ради одной кнопки.
    - **Реальный обмен кода на профиль — было решено временно обойтись заглушкой, теперь заменено на настоящий Яндекс.** Пока у сервиса не было постоянного адреса для `redirect_uri`, `getYandexProfile()` (`domain/yandexAuth.js`) вместо обращения к Яндексу подставляла тестовые email/имя из `.env` (`YANDEX_LOGIN_STUB_*`) — это было явным временным решением, а не готовой функцией (разбор — `docs/development-log.md`, «Вход через внешний сервис (Яндекс)»). Как только приложение зарегистрировали на oauth.yandex.ru, заглушку убрали целиком (саму функцию, флаг и обе переменные окружения) — `fetchRealYandexProfile()` теперь делает то, для чего и была оставлена отдельной функцией с самого начала: обмен `code` на `access_token` (`POST oauth.yandex.ru/token`) и запрос профиля тем же токеном (`GET login.yandex.ru/info`), права ровно `login:email`+`login:info`. `access_token` используется один раз внутри этой функции и никуда дальше не передаётся. Остальная логика входа (`findOrCreateYandexUser`, сам роут) не менялась ни на этом шаге, ни на предыдущем — ровно так, как и планировалось при выделении функции.
    - **Восстановление пароля для аккаунта без пароля — текст сообщает про вход через Яндекс, не общая формулировка.** До этой миграции `POST /api/auth/password-reset/request` намеренно отвечал одинаково для любого email — зарегистрирован он или нет (раздел 6 `server/README.md`, «не подтверждаем/опровергаем регистрацию по этому полю»). Для аккаунта без пароля это по прямому запросу нарушено: ответ отдельно называет способ входа («вход через Яндекс»), а не молчит, как для несуществующего email. Компромисс осознанный и по прямому требованию: раскрывает факт «этот email привязан к аккаунту без пароля», но избавляет пользователя от тупика (код, который некуда ввести, потому что вводить нечего).

20. **Текст уведомления (`notifications.message`) — готовая строка, собранная в момент события, а не шаблон с полями, из которых собирал бы её экран.** Разобрать это можно было и по-другому: хранить `type` + `appointment_id` и на экране самим подставлять день/время из текущего состояния записи в шаблон под каждый `type`. Отклонено по той же причине, что и решение №5 выше (снапшот цены услуги в `appointment_services`) — запись после уведомления о переносе может быть перенесена ЕЩЁ раз; если бы текст собирался на лету из текущего `start_datetime`, старое уведомление «перенесена на пятницу, 11:00» после второго переноса молча стало бы врать (сейчас там на самом деле не пятница, 11:00, а что-то третье) — то же рассуждение, что «более поздний перенос не должен задним числом переписывать факт события, которое уже было показано пользователю».

---

## 8. Когда создаётся уведомление

Ровно три события — по прямому перечню задачи, не по всем случаям, где
уведомление казалось бы уместным («других событий пока не добавляй»):

1. **`appointment_cancelled`** — администратор отменил запись клиента.
2. **`appointment_rescheduled`** — администратор перенёс запись клиента.
3. **`appointment_double_booked`** — администратор создал новую запись
   поверх уже занятого времени (`overlap_override`, раздел 3.11б), и это
   затронуло чью-то чужую активную запись.

Общее правило одно, не три отдельных проверки: уведомление создаётся,
когда действие с записью выполнил **не тот человек, которому запись
принадлежит** (`appointments.client_id`). Кто именно выполнил действие —
`domain/booking.js` знает не по роли, а по `id` вызывающего пользователя,
который передают маршруты (`cancelledByUserId`/`changedByUserId`,
раздел 3.11г/3.13); сравнение "actor id ≠ owner id" — это и есть
"не по инициативе самого пользователя", без отдельного обращения к
`user_roles`. Практически иначе, кроме как через администратора, actor ≠
owner тут возникнуть не может — `assertCanModifyAppointment`
(`routes/appointments.routes.js`) в принципе не пускает никого другого
менять чужую запись, — но домену это знать не обязательно, он просто
сравнивает два `id`.

Когда клиент делает то же самое над своей же записью (отменяет,
переносит, создаёт запись, включая подтверждение своего же удержания) —
actor id совпадает с owner id, уведомление не создаётся. То же для самого
первого бронирования: создатель записи — тот же человек, кому она
принадлежит, событие ожидаемое, не сюрприз.

**Список уведомлений и счётчик — один запрос.** `GET /api/notifications`
отдаёт и сам список, и `unreadCount` одним ответом — отдельного эндпоинта
ради одного числа нет по прямому требованию задачи; `unreadCount` не
`notifications.filter(...).length` на экране, а отдельный `COUNT` по
частичному индексу `ix_notifications_user_unread` — понадобится в шапке
кабинета на КАЖДОЙ странице, не только на самом экране уведомлений, и
не должен тянуть за собой весь список ради одного числа.

**Прочитанным отмечается по одному** — `POST /api/notifications/:id/read`,
только собственные уведомления (`WHERE id = ? AND user_id = ?` — чужой
`id` вернёт 404, «не найдено», а не 403 «нет прав»: 403 подтвердил бы
чужому пользователю, что уведомление с таким `id` вообще существует,
просто не его).
