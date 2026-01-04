const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid'); // Бібліотека для унікальних кодів
const path = require('path');

app.use(express.static('public'));
app.get('/', (req, res) => {
    res.redirect('/admin.html');
});
app.use(express.json());

// Тут зберігаємо налаштування активних сесій
const sessions = {};

// 1. Створити нову сесію
app.post('/create', (req, res) => {
    const { sound, image } = req.body;
    const id = uuidv4(); // Генеруємо унікальний код (наприклад: 550e8400...)
    sessions[id] = { sound, image };
    console.log(`Створено сесію: ${id}`);
    res.json({ id });
});

// 2. Отримати дані сесії (для жертви)
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) {
        res.json(session);
    } else {
        res.status(404).json({ error: 'Сесію не знайдено' });
    }
});

// WebSocket логіка
io.on('connection', (socket) => {
    // Приєднуємось до конкретної кімнати по ID
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`Користувач зайшов у кімнату: ${roomId}`);
    });

    // Команда "Налякати"
    socket.on('trigger-scare', (roomId) => {
        io.to(roomId).emit('play-sound');
    });
});

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущено! Порт ${PORT}`);
});
