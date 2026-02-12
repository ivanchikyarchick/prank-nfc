FROM node:18-alpine

# Встановлюємо ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Копіюємо package.json
COPY package*.json ./

# Встановлюємо залежності
RUN npm install

# Копіюємо всі файли
COPY . .

# Створюємо папку для завантажень
RUN mkdir -p public/uploads

# Koyeb використовує змінну PORT
EXPOSE 8000

# Запуск
CMD ["node", "server.js"]
