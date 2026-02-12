FROM node:18-alpine

# Встановлюємо ffmpeg
RUN apk add --no-cache ffmpeg

# Створюємо робочу директорію
WORKDIR /app

# Копіюємо package files
COPY package*.json ./

# Встановлюємо залежності
RUN npm install --production

# Копіюємо всі файли проекту
COPY . .

# Створюємо директорію для завантажень
RUN mkdir -p public/uploads

# Встановлюємо права
RUN chmod -R 755 public/uploads

# Порт (Koyeb використовує змінну PORT)
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8000) + '/', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Запуск сервера
CMD ["node", "server.js"]
