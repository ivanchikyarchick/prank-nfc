const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {}; // Головний об'єкт сесій
const activeVictims = {};

// Створення нової кімнати + дані про творця
app.post('/create', (req, res) => {
    const { sound = '', image = '' } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA');
    const now = Date.now();

    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const shortIp = ip.split(',')[0].trim();

    sessions[id] = {
        sound: sound.trim(),
        image: image.trim(),
        createdAt,
        lastActiveAt: now,
        totalVictims: 0,
        creator: {
            ip: shortIp,
            device: parseDevice(userAgent),
            userAgent: userAgent.substring(0, 100),
            createdTimestamp: now
        }
    };

    res.json({ id, createdAt });
});

// Оновлення медіа
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    const { sound, image } = req.body;

    if (!sessions[id]) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (sound !== undefined && sound !== '') sessions[id].sound = sound.trim();
    if (image !== undefined && image !== '') sessions[id].image = image.trim();

    sessions[id].lastActiveAt = Date.now();

    io.to(id).emit('update-media', {
        sound: sessions[id].sound || '',
        image: sessions[id].image || ''
    });

    res.json({ success: true, session: sessions[id] });
});

// Одна сесія (для сумісності)
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

// ВСІ сесії з деталями та творцем
app.get('/sessions', (req, res) => {
    const result = Object.keys(sessions).map(id => {
        const s = sessions[id];
        const onlineCount = Object.values(activeVictims).filter(v => v.roomId === id).length;

        return {
            id,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            totalVictims: s.totalVictims,
            onlineCount,
            sound: s.sound || '',
            image: s.image || '',
            creator: s.creator || { ip: 'Unknown', device: 'Unknown', userAgent: 'Unknown' }
        };
    });

    result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    res.json(result);
});

// Видалення сесії
app.delete('/session/:id', (req, res) => {
    const id = req.params.id;
    if (sessions[id]) {
        delete sessions[id];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Сумісність з admin.html
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

        if (sessions[roomId]) {
            sessions[roomId].totalVictims += 1;
            sessions[roomId].lastActiveAt = Date.now();
        }

        sendVictimList(roomId);
        io.to(roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });

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
    console.log(`Admin: /admin.html | Watch: /watch.html | Victim: /victim.html?id=...`);
});
