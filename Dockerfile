FROM node:20-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Создание директории для базы данных
RUN mkdir -p data

# Открываем порт (для webhook, если нужен)
EXPOSE 3000

# Запуск бота
CMD ["npm", "start"]
