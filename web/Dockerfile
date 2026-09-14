# Образ раздачи фронтенда сервиса записи «Тон» (web/ — актуальные экраны
# клиента и закрытая на сервере админка, см. web/README.md; черновой
# frontend/ сюда не входит, см. frontend/README.md — "Черновой тестовый
# фронтенд").
#
# web/server.js — уже готовый dev-сервер без зависимостей: раздаёт статику
# из этой же папки и проксирует всё под /api/* на бэкенд, поэтому браузер
# видит один origin и для страниц, и для API — сессионная cookie входа
# (HttpOnly, SameSite=Lax) работает без единой правки в server/ (см.
# комментарий в самом server.js). В контейнере это тот же самый процесс,
# просто API_ORIGIN указывает не на localhost, а на соседний контейнер
# бэкенда по имени сервиса из docker-compose.yml.
FROM node:24.19.0-alpine

WORKDIR /app

# Манифест отдельным слоем, как в server/Dockerfile — сейчас в нём нет
# зависимостей ("dependencies": {}), но слой пригодится, если появятся.
COPY package*.json ./
RUN npm install --omit=dev

# Только то, что реально раздаётся: HTML/CSS/JS и сам сервер. README.md
# в образ не идёт — это документация для разработчика, не для рантайма.
COPY server.js ./
COPY index.html login.html register.html password-reset.html account.html \
     account-appointment.html account-notifications.html \
     booking-1.html booking-2.html booking-3.html booking-4.html booking-5.html \
     tokens.css ./
COPY admin ./admin
COPY css ./css
COPY js ./js

ENV NODE_ENV=production
ENV WEB_PORT=8080
# Имя "backend" — имя сервиса из docker-compose.yml в корне репозитория:
# в общей docker-сети compose контейнеры видят друг друга по имени
# сервиса, отдельный DNS/IP настраивать не нужно.
ENV API_ORIGIN=http://backend:3000

EXPOSE 8080

CMD ["node", "server.js"]
