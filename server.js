[file name]: server (1).js
[file content begin]
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {}; // Головний об'єкт сесій
const activeVictims = {};
const generatedSites = {}; // Зберігаємо згенеровані AI сайти

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

// AI генерація HTML сайту
app.post('/generate-site', (req, res) => {
    try {
        const { theme, soundUrl } = req.body;
        
        if (!theme || theme.trim().length < 3) {
            return res.status(400).json({ error: 'Тема повинна містити принаймні 3 символи' });
        }

        const siteId = uuidv4().split('-').slice(0, 3).join('-');
        const fileName = `cust_${siteId}.html`;
        const filePath = path.join(__dirname, 'public', fileName);
        
        // Генеруємо HTML на основі теми
        const htmlContent = generateHTMLByTheme(theme, soundUrl || '');
        
        // Зберігаємо файл
        fs.writeFileSync(filePath, htmlContent, 'utf8');
        
        // Зберігаємо інформацію про сайт
        generatedSites[siteId] = {
            id: siteId,
            theme: theme,
            soundUrl: soundUrl || '',
            fileName: fileName,
            createdAt: new Date().toLocaleString('uk-UA'),
            url: `/cust.html/${siteId}`
        };
        
        console.log(`AI site generated: ${siteId} - ${theme}`);
        
        res.json({ 
            success: true, 
            siteId: siteId,
            url: `/cust.html/${siteId}`,
            directUrl: `${req.protocol}://${req.get('host')}/cust.html/${siteId}`
        });
        
    } catch (error) {
        console.error('Error generating site:', error);
        res.status(500).json({ error: 'Помилка генерації сайту' });
    }
});

// Спеціальний маршрут для AI-сайтів
app.get('/cust.html/:siteId', (req, res) => {
    const { siteId } = req.params;
    const siteInfo = generatedSites[siteId];
    
    if (!siteInfo) {
        return res.status(404).send(`
            <html>
                <head><title>Сайт не знайдено</title></head>
                <body style="background: #0a0a0c; color: white; font-family: Arial; padding: 50px; text-align: center;">
                    <h1>🤖 Сайт не знайдено</h1>
                    <p>Цей AI-сайт був видалений або не існує</p>
                    <a href="/admin.html" style="color: #00ff99;">← Повернутися до адмін панелі</a>
                </body>
            </html>
        `);
    }
    
    // Читаємо файл і відправляємо
    const filePath = path.join(__dirname, 'public', siteInfo.fileName);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Файл не знайдено');
    }
});

// Отримати список згенерованих сайтів
app.get('/ai-sites', (req, res) => {
    const sites = Object.values(generatedSites).map(site => ({
        id: site.id,
        theme: site.theme,
        createdAt: site.createdAt,
        url: site.url
    }));
    
    res.json(sites);
});

// Видалити AI сайт
app.delete('/ai-site/:siteId', (req, res) => {
    const { siteId } = req.params;
    const siteInfo = generatedSites[siteId];
    
    if (!siteInfo) {
        return res.status(404).json({ error: 'Сайт не знайдено' });
    }
    
    // Видаляємо файл
    const filePath = path.join(__dirname, 'public', siteInfo.fileName);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    
    // Видаляємо з пам'яті
    delete generatedSites[siteId];
    
    console.log(`AI site deleted: ${siteId}`);
    res.json({ success: true });
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

// Функція для генерації HTML на основі теми
function generateHTMLByTheme(theme, soundUrl) {
    const themes = {
        'жахи': { bg: '#0a0a0c', color: '#ff0055', title: '👻 Місце жахам', emoji: '👹' },
        'комедія': { bg: '#1a0033', color: '#ffcc00', title: '🤣 Смішний сюрприз', emoji: '🤡' },
        'містика': { bg: '#1a1a2e', color: '#9d00ff', title: '🔮 Таємнича пастка', emoji: '🌙' },
        'техно': { bg: '#001122', color: '#00ffff', title: '🤖 Техно-ловушка', emoji: '⚡' },
        'природа': { bg: '#003311', color: '#00ff99', title: '🌿 Природний сюрприз', emoji: '🍃' },
        'музика': { bg: '#330033', color: '#ff66ff', title: '🎵 Музична пастка', emoji: '🎶' },
        'космос': { bg: '#000033', color: '#8888ff', title: '🚀 Космічна пригода', emoji: '🌌' },
        'спорт': { bg: '#330000', color: '#ff4444', title: '🏆 Спортивний виклик', emoji: '⚽' }
    };

    // Шукаємо найбільш підходящу тему
    let selectedTheme = themes['техно']; // default
    for (const [key, value] of Object.entries(themes)) {
        if (theme.toLowerCase().includes(key)) {
            selectedTheme = value;
            break;
        }
    }

    const html = `
<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${selectedTheme.title} - AI Generated</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: ${selectedTheme.bg};
            color: white;
            font-family: 'Segoe UI', sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            background-image: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 50%);
            overflow: hidden;
        }
        
        .container {
            max-width: 600px;
            padding: 30px;
            animation: fadeIn 2s ease;
        }
        
        h1 {
            font-size: 2.5em;
            color: ${selectedTheme.color};
            margin-bottom: 20px;
            text-shadow: 0 0 10px ${selectedTheme.color}88;
        }
        
        .emoji {
            font-size: 4em;
            margin: 20px 0;
            animation: bounce 2s infinite;
        }
        
        .description {
            font-size: 1.2em;
            line-height: 1.6;
            margin: 30px 0;
            color: #cccccc;
            background: rgba(0,0,0,0.3);
            padding: 20px;
            border-radius: 15px;
            border-left: 4px solid ${selectedTheme.color};
        }
        
        .sound-player {
            margin: 30px 0;
            padding: 20px;
            background: rgba(0,0,0,0.4);
            border-radius: 15px;
            border: 2px dashed ${selectedTheme.color};
        }
        
        .theme-info {
            margin-top: 40px;
            font-size: 0.9em;
            color: #888;
            padding: 10px;
            border-top: 1px solid #333;
        }
        
        .pulse {
            animation: pulse 3s infinite;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        
        @keyframes glow {
            0%, 100% { text-shadow: 0 0 5px ${selectedTheme.color}; }
            50% { text-shadow: 0 0 20px ${selectedTheme.color}, 0 0 30px ${selectedTheme.color}; }
        }
        
        .glowing-text {
            animation: glow 2s infinite;
        }
        
        .warning {
            color: ${selectedTheme.color};
            font-weight: bold;
            margin: 20px 0;
            padding: 10px;
            border: 1px solid ${selectedTheme.color};
            border-radius: 8px;
            background: rgba(255,0,0,0.1);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="emoji">${selectedTheme.emoji}</div>
        <h1 class="glowing-text">${selectedTheme.title}</h1>
        
        <div class="description">
            <p>🎯 Тема: <strong>${theme}</strong></p>
            <p>✨ Ця сторінка була створена AI на основі вашого запиту.</p>
            <p>📱 Автоматично адаптується під всі пристрої</p>
            <p>🎨 Унікальний дизайн згідно тематики</p>
        </div>
        
        ${soundUrl ? `
        <div class="sound-player">
            <p>🔊 Звуковий супровід:</p>
            <audio id="theme-sound" controls style="width: 100%; margin: 10px 0;">
                <source src="${soundUrl}" type="audio/mp3">
                Ваш браузер не підтримує аудіо елемент.
            </audio>
            <button onclick="playSound()" style="background: ${selectedTheme.color}; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-top: 10px;">
                ▶ Відтворити звук
            </button>
        </div>
        ` : '<div class="warning">⚠️ Звук не додано до цієї теми</div>'}
        
        <div class="theme-info">
            <p>🤖 Згенеровано AI | Тематика: ${theme}</p>
            <p>⏱️ ${new Date().toLocaleString('uk-UA')}</p>
            <p class="pulse">❗ Ця сторінка може містити несподівані елементи</p>
        </div>
    </div>
    
    <script>
        function playSound() {
            const audio = document.getElementById('theme-sound');
            if (audio) {
                audio.play().catch(e => console.log('Помилка відтворення:', e));
            }
        }
        
        // Автозапуск звуку (опціонально)
        setTimeout(() => {
            const audio = document.getElementById('theme-sound');
            if (audio && Math.random() > 0.5) {
                audio.volume = 0.3;
                audio.play().catch(() => {});
            }
        }, 3000);
        
        // Динамічні ефекти
        document.addEventListener('click', function(e) {
            const x = e.clientX;
            const y = e.clientY;
            const particle = document.createElement('div');
            particle.style.position = 'fixed';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.width = '10px';
            particle.style.height = '10px';
            particle.style.backgroundColor = '${selectedTheme.color}';
            particle.style.borderRadius = '50%';
            particle.style.pointerEvents = 'none';
            particle.style.zIndex = '9999';
            particle.style.animation = 'fadeOut 1s forwards';
            
            document.body.appendChild(particle);
            
            setTimeout(() => {
                particle.remove();
            }, 1000);
        });
        
        const style = document.createElement('style');
        style.textContent = \`
            @keyframes fadeOut {
                from { transform: scale(1); opacity: 1; }
                to { transform: scale(2); opacity: 0; }
            }
        \`;
        document.head.appendChild(style);
    </script>
</body>
</html>
    `;
    
    return html;
}

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
    console.log(`AI Sites: /cust.html/[site-id]`);
});
[file content end]
