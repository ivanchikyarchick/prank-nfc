const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

// Структура даних
const sessions = {}; 
// {id: { sound, image, createdAt, lastActiveAt: timestamp, totalVictims: number }}

const activeVictims = {}; 
// {socketId: {roomId, device, ip, joinedAt}}

// Створення нової кімнати
app.post('/create', (req, res) => {
    const { sound = '', image = '' } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA');
    const now = Date.now();

    sessions[id] = {
        sound: sound.trim(),
        image: image.trim(),
        createdAt,
        lastActiveAt: now,
        totalVictims: 0
    };

    res.json({ id, createdAt });
});

// ОНОВЛЕННЯ медіа
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    const { sound, image } = req.body;

    if (!sessions[id]) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (sound !== undefined && sound !== '') sessions[id].sound = sound.trim();
    if (image !== undefined && image !== '') sessions[id].image = image.trim();

    // Оновлюємо час активності
    sessions[id].lastActiveAt = Date.now();

    io.to(id).emit('update-media', {
        sound: sessions[id].sound || '',
        image: sessions[id].image || ''
    });

    res.json({ success: true, session: sessions[id] });
});

// Отримання однієї сесії
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) {
        res.json({
            sound: session.sound || '',
            image: session.image || '',
            createdAt: session.createdAt
        });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// === НОВЕ: Отримання ВСІХ сесій з статистикою ===
app.get('/sessions', (req, res) => {
    const result = Object.keys(sessions).map(id => {
        const s = sessions[id];
        const onlineCount = Object.values(activeVictims).filter(v => v.roomId === id).length;

        return {
            id,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt, // timestamp
            totalVictims: s.totalVictims,
            onlineCount,
            sound: s.sound || '',
            image: s.image || ''
        };
    });

    // Сортуємо за останньою активністю (найсвіжіші зверху)
    result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    res.json(result);
});

// === НОВЕ: Видалення сесії ===
app.delete('/session/:id', (req, res) => {
    const id = req.params.id;
    if (sessions[id]) {
        delete sessions[id];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Статус для історії (сумісність з admin.html)
app.post('/check-status', (req, res) => {
    const { ids } = req.body;
    const result = ids.map(id => {
        const count = Object.values(activeVictims).filter(v => v.roomId === id).length;
        const sess = sessions[id];
        return {
            id,
            active: count > 0 && sess,
            count,
            date: sess ? sess.createdAt : null
        };
    });
    result.sort((a, b) => b.active - a.active);
    res.json(result);
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {

    socket.on('join-room-admin', (roomId) => {
        socket.join(roomId);
        sendVictimList(roomId);
    });

    socket.on('join-room-victim', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);

        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

        activeVictims[socket.id] = {
            socketId: socket.id,
            roomId,
            device: parseDevice(data.userAgent),
            ip,
            joinedAt: new Date().toLocaleTimeString()
        };

        // Оновлюємо статистику сесії
        if (sessions[roomId]) {
            sessions[roomId].totalVictims += 1;
            sessions[roomId].lastActiveAt = Date.now();
        }

        sendVictimList(roomId);
        io.to(roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });

        // Надсилаємо медіа новій жертві
        if (sessions[roomId]) {
            socket.emit('update-media', {
                sound: sessions[roomId].sound || '',
                image: sessions[roomId].image || ''
            });
        }
    });

    socket.on('trigger-scare', (roomId) => {
        io.to(roomId).emit('play-sound');
    });

    socket.on('disconnect', () => {
        const victim = activeVictims[socket.id];
        if (victim) {
            const roomId = victim.roomId;
            delete activeVictims[socket.id];
            sendVictimList(roomId);
        }
    });
});

function sendVictimList(roomId) {
    const users = Object.values(activeVictims).filter(v => v.roomId === roomId);
    io.to(roomId).emit('update-victim-list', users);
}

function parseDevice(ua) {
    if (!ua) return "Unknown";
    if (ua.includes('Android')) return "📱 Android";
    if (ua.includes('iPhone')) return "📱 iPhone";
    if (ua.includes('Windows')) return "💻 Windows PC";
    if (ua.includes('Macintosh')) return "💻 Mac";
    return "📱 Device";
}

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
    console.log(`Watch: http://localhost:${PORT}/watch.html`);
});
