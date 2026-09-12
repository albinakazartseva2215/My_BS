# Образ бэкенда сервиса записи «Тон» (server/ — только API, без фронтендов
# frontend/ и web/, у них своя раздача статики).
#
# Версия Node — та же, на которой проект разрабатывался и проверялся
# (см. server/README.md, разделы 2-3: node:sqlite нужен >=22.5.0, но
# фиксируем именно ту версию, что стояла у автора, а не "любую подходящую").
FROM node:24.19.0-alpine

WORKDIR /app

# Сначала манифест отдельным слоем — npm install перекешируется, пока
# зависимости не меняются. Сейчас их нет (package.json: "dependencies": {}),
# но слой пригодится, как только они появятся.
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
# Файл базы — вне /app: этот путь монтируется на сервере отдельным томом
# (см. server/DEPLOY.md) и не теряется при пересборке образа, в отличие от
# всего остального внутри /app. Папку по этому пути создаёт сам процесс
# при старте (src/db/connection.js), если её ещё нет.
ENV DATABASE_FILE=/data/database.sqlite

VOLUME ["/data"]
EXPOSE 3000

# Миграции применяются самим приложением при старте (src/index.js) —
# отдельной команды перед запуском не нужно.
#
# node напрямую, а не "npm start": сигналы (SIGTERM при остановке
# контейнера) должны доходить до процесса Node напрямую — с npm как
# обёрткой graceful shutdown в src/index.js не гарантирован. Флаг
# --experimental-sqlite оставлен для согласованности с npm-скриптами
# (package.json) — на этой версии Node он уже не обязателен, но и не мешает.
CMD ["node", "--experimental-sqlite", "src/index.js"]
