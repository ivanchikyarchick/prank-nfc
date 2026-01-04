const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {};
const activeVictims = {};

app.post('/create', (req, res) => {
    const { sound, image } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA');
    sessions[id] = { sound, image, createdAt };
    res.json({ id, createdAt });
});

app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) res.json(session);
    else res.status(404).json({ error: 'Not found' });
});

app.post('/check-status', (req, res) => {
    const { ids } = req.body;
    const result = ids.map(id => {
        const count = Object.values(activeVictims).filter(v => v.roomId === id).length;
        return { id, active: count > 0 && sessions[id], count };
    });
    res.json(result);
});

io.on('connection', (socket) => {
    socket.on('join-room-admin', (roomId) => socket.join(roomId));

    socket.on('join-room-victim', (data) => {
        socket.join(data.roomId);
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        activeVictims[socket.id] = { socketId: socket.id, roomId: data.roomId, device: data.userAgent, ip };
        io.to(data.roomId).emit('update-victim-list', Object.values(activeVictims).filter(v => v.roomId === data.roomId));
    });

    socket.on('trigger-scare', (roomId) => io.to(roomId).emit('play-sound'));
    socket.on('trigger-hack', (roomId) => io.to(roomId).emit('start-hack'));
    socket.on('trigger-break', (roomId) => io.to(roomId).emit('break-screen'));
    
    // 🔥 Команда для тексту від людини
    socket.on('send-god-text', (data) => {
        io.to(data.roomId).emit('display-god-text', data.text);
    });

    socket.on('disconnect', () => {
        const v = activeVictims[socket.id];
        if (v) {
            delete activeVictims[socket.id];
            io.to(v.roomId).emit('update-victim-list', Object.values(activeVictims).filter(usr => usr.roomId === v.roomId));
        }
    });
});

http.listen(process.env.PORT || 3000, () => console.log('Server started'));
