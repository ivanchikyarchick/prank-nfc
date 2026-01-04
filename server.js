const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());

// Головна -> на адмінку
app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {};

// Створення сесії
app.post('/create', (req, res) => {
    const { sound, image } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA'); // Час створення
    
    sessions[id] = { sound, image, createdAt };
    console.log(`Кімната створена: ${id}`);
    res.json({ id, createdAt });
});

// Інформація для жертви
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) res.json(session);
    else res.status(404).json({ error: 'Not found' });
});

// 🔥 НОВЕ: Перевірка статусу кімнат (для історії)
app.post('/check-status', (req, res) => {
    const { ids } = req.body; // Отримуємо список ID з localStorage адміна
    const result = ids.map(id => {
        // Перевіряємо, чи існує кімната в socket.io
        const room = io.sockets.adapter.rooms.get(id);
        const count = room ? room.size : 0;
        // Якщо в кімнаті > 0 людей і сесія існує - вона активна
        return { 
            id, 
            active: count > 0 && sessions[id],
            info: sessions[id] || null 
        };
    });
    // Сортуємо: спочатку активні
    result.sort((a, b) => b.active - a.active);
    res.json(result);
});

io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
    });

    // Коли заходить жертва, вона шле свої дані
    socket.on('victim-joined', (data) => {
        // Отримуємо IP (через проксі Render/Glitch)
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        
        // Відправляємо Адміну в цій кімнаті сповіщення
        io.to(data.roomId).emit('admin-alert', {
            msg: 'ЖЕРТВА ЗАЙШЛА! 🚨',
            device: data.userAgent,
            ip: ip,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('trigger-scare', (roomId) => {
        io.to(roomId).emit('play-sound');
    });
});

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => console.log(`Server: ${PORT}`));
