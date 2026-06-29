FROM node:20-alpine

WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm install --omit=optional

# Копируем исходники
COPY . .

# Порт для веб-режима
EXPOSE 7924

CMD ["node", "serve.js"]
