const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {}; // {id: {sound, image, createdAt}}
const activeVictims = {}; // {socketId: {roomId, device, ip, ...}}

// Створення нової кімнати
app.post('/create', (req, res) => {
    const { sound, image } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA');
    sessions[id] = { sound, image, createdAt };
    res.json({ id, createdAt });
});

// ОНОВЛЕННЯ медіа (виправлено)
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    const { sound, image } = req.body;

    if (!sessions[id]) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (sound !== undefined && sound !== '') sessions[id].sound = sound;
    if (image !== undefined && image !== '') sessions[id].image = image;

    // Надсилаємо оновлення всім у кімнаті
    io.to(id).emit('update-media', {
        sound: sessions[id].sound || '',
        image: sessions[id].image || ''
    });

    res.json({ success: true, session: sessions[id] });
});

// Інформація про сесію
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) res.json(session);
    else res.status(404).json({ error: 'Not found' });
});

// Статус для історії
app.post('/check-status', (req, res) => {
    const { ids } = req.body;
    const result = ids.map(id => {
        const count = Object.values(activeVictims).filter(v => v.roomId === id).length;
        return { 
            id, 
            active: count > 0 && sessions[id],
            count: count,
            date: sessions[id] ? sessions[id].createdAt : null
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
        socket.join(data.roomId);
        
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        
        activeVictims[socket.id] = {
            socketId: socket.id,
            roomId: data.roomId,
            device: parseDevice(data.userAgent),
            ip: ip,
            joinedAt: new Date().toLocaleTimeString()
        };

        sendVictimList(data.roomId);
        io.to(data.roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });

        // Надсилаємо актуальні медіа новій жертві
        if (sessions[data.roomId]) {
            socket.emit('update-media', {
                sound: sessions[data.roomId].sound || '',
                image: sessions[data.roomId].image || ''
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
http.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
