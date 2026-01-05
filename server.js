const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

if (!GOOGLE_API_KEY) {
    console.warn('Warning: GOOGLE_API_KEY is not set. Gemini requests will likely fail.');
}

// Ініціалізація Gemini AI (оновлено на 2.5)
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin.html'));

const sessions = {};
const activeVictims = {};
const generatedSites = {};

// Маршрут для віддачі згенерованих сторінок: /cust.html/:id
app.get('/cust.html/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const fileName = `cust_${id}.html`;
        const filePath = path.join(__dirname, 'public', fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Not found');
        }

        res.sendFile(filePath);
    } catch (err) {
        console.error('Error serving generated site:', err);
        res.status(500).send('Server error');
    }
});

// AI генерація HTML сайту з використанням Gemini
app.post('/generate-site', async (req, res) => {
    try {
        const { theme, soundUrl } = req.body || {};

        // Валідація
        if (!theme || typeof theme !== 'string' || theme.trim().length < 3) {
            return res.status(400).json({ error: 'Тема повинна містити принаймні 3 символи' });
        }

        const sanitizedTheme = theme.trim();
        const sanitizedSoundUrl = (soundUrl && typeof soundUrl === 'string') ? soundUrl.trim() : '';

        console.log(`Generating AI site for theme: ${sanitizedTheme}`);

        const siteId = uuidv4().split('-').slice(0, 3).join('-');
        const fileName = `cust_${siteId}.html`;
        const filePath = path.join(__dirname, 'public', fileName);

        const prompt = `
            Створи HTML сторінку для жартівливої пастки на основі теми: "${sanitizedTheme}".
            Вимоги:
            1. Тематика: ${sanitizedTheme}
            2. ${sanitizedSoundUrl ? `Додай звук з URL: ${sanitizedSoundUrl}` : 'Без звуку'}
            3. Стиль: темна тема, мінімалістичний дизайн
            4. Містить: заголовок, опис теми, елементи взаємодії
            5. Додай креативні анімації та ефекти
            6. Включи JavaScript для динамічних ефектів
            7. Адаптивний дизайн для мобільних пристроїв
            8. Кольори повинні відповідати темі
            9. Додай елементи несподіванки (сюрпризи)
            Структура HTML:
            - Повний HTML документ з DOCTYPE
            - Стилі в тегу <style>
            - JavaScript в кінці тіла
            - Використовуй сучасні CSS властивості
            - Додай іконки та емодзі для наочності
            Обов'язково включи:
            1. Зображення-заглушку або CSS градієнт
            2. Кнопки або області для кліку
            3. Таймер або анімації
            4. Повідомлення що з'являються
            5. Можливість відтворення звуку (якщо є URL)
            Виведи ТІЛЬКИ HTML код без пояснень.
        `;

        // Функція збереження та відповіді
        async function saveAndRespond(htmlContent, generatedByLabel = 'Gemini AI') {
            try {
                await fsPromises.writeFile(filePath, htmlContent, 'utf8');

                const urlPath = `/cust.html/${siteId}`;
                generatedSites[siteId] = {
                    id: siteId,
                    theme: sanitizedTheme,
                    soundUrl: sanitizedSoundUrl || '',
                    fileName,
                    createdAt: new Date().toLocaleString('uk-UA'),
                    url: urlPath,
                    generatedBy: generatedByLabel
                };

                console.log(`Site saved: ${siteId} (by ${generatedByLabel})`);
                res.json({
                    success: true,
                    siteId,
                    url: urlPath,
                    directUrl: `${req.protocol}://${req.get('host')}${urlPath}`,
                    generatedBy: generatedByLabel
                });
            } catch (fsErr) {
                console.error('File save error:', fsErr);
                res.status(500).json({ error: 'Не вдалося зберегти згенерований файл' });
            }
        }

        // Виклик Gemini
        try {
            const result = await model.generateContent(prompt);

            // Різні можливі формати відповіді — намагаємось коректно отримати текст
            let aiResponse = '';
            if (result && typeof result === 'string') {
                aiResponse = result;
            } else if (result && result.response && typeof result.response.text === 'function') {
                try {
                    aiResponse = result.response.text();
                } catch (e) {
                    aiResponse = '';
                }
            } else if (result && Array.isArray(result.output) && result.output[0] && result.output[0].content) {
                aiResponse = result.output[0].content;
            } else if (result && result.content) {
                aiResponse = result.content;
            }

            // Очищаємо markdown-обгортки якщо є
            let htmlContent = (aiResponse || '').replace(/```html\n?/g, '')
                                                .replace(/```/g, '')
                                                .trim();

            // Fallback, якщо Gemini не повернув HTML
            if (!htmlContent.includes('<!DOCTYPE html>') && !htmlContent.includes('<html')) {
                console.log('Gemini returned non-HTML or empty, using fallback');
                htmlContent = generateFallbackHTML(sanitizedTheme, sanitizedSoundUrl);
            }

            await saveAndRespond(htmlContent, 'Gemini AI');
        } catch (aiError) {
            console.error('Gemini AI error:', aiError);
            // Fallback на базовий генератор
            const htmlContent = generateFallbackHTML(sanitizedTheme, sanitizedSoundUrl);
            await saveAndRespond(htmlContent, 'Fallback (Gemini failed)');
        }
    } catch (error) {
        console.error('Error generating site:', error);
        res.status(500).json({ error: 'Помилка генерації сайту: ' + (error && error.message ? error.message : String(error)) });
    }
});

// Fallback генератор HTML (якщо Gemini не працює)
function generateFallbackHTML(theme, soundUrl) {
    const themes = {
        'жахи': { bg: '#0a0a0c', color: '#ff0055', title: '👻 Жахлива пастка', emoji: '👹' },
        'комедія': { bg: '#1a0033', color: '#ffcc00', title: '🤣 Смішний сюрприз', emoji: '🤡' },
        'містика': { bg: '#1a1a2e', color: '#9d00ff', title: '🔮 Таємнича пастка', emoji: '🌙' },
        'техно': { bg: '#001122', color: '#00ffff', title: '🤖 Техно-ловушка', emoji: '⚡' },
        'природа': { bg: '#003311', color: '#00ff99', title: '🌿 Природний сюрприз', emoji: '🍃' },
        'музика': { bg: '#330033', color: '#ff66ff', title: '🎵 Музична пастка', emoji: '🎶' },
        'космос': { bg: '#000033', color: '#8888ff', title: '🚀 Космічна пригода', emoji: '🌌' },
        'спорт': { bg: '#330000', color: '#ff4444', title: '🏆 Спортивний виклик', emoji: '⚽' }
    };

    let selectedTheme = themes['техно'];
    for (const [key, value] of Object.entries(themes)) {
        if (theme.toLowerCase().includes(key)) {
            selectedTheme = value;
            break;
        }
    }

    // Повертаємо просту, безпечну HTML-версію (повний шаблон з оригіналу)
    return `
<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${selectedTheme.title} - AI Generated</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
            background: ${selectedTheme.bg};
            color: #fff;
            font-family: 'Segoe UI', Arial, sans-serif;
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;
            text-align:center;
        }
        .container { max-width:800px; width:100%; padding:30px; border-radius:12px; }
        h1 { color: ${selectedTheme.color}; margin-bottom:10px; }
        .theme-emoji { font-size:48px; margin-bottom:10px; }
        .theme-description { color:#ddd; margin-bottom:20px; }
        button { background:${selectedTheme.color}; color:#fff; border:none; padding:12px 20px; border-radius:8px; cursor:pointer; }
        footer { margin-top:20px; color:#888; font-size:12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="theme-emoji">${selectedTheme.emoji}</div>
        <h1>${selectedTheme.title}</h1>
        <div class="theme-description">
            <p><strong>Тема AI-генерації:</strong> "${theme}"</p>
            <p>✨ Сторінка створена як fallback, коли AI недоступний.</p>
        </div>
        ${soundUrl ? `
        <div>
            <audio id="themeAudio" preload="auto">
                <source src="${soundUrl}" type="audio/mp3">
            </audio>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button onclick="document.getElementById('themeAudio').play()">▶️ Відтворити</button>
                <button onclick="document.getElementById('themeAudio').pause()" style="background:#555;">⏹️ Стоп</button>
            </div>
        </div>
        ` : '<p style="color:#bbb;">🔇 Звук не додано</p>'}
        <footer>
            <p>Створено за допомогою AI Gemini Flash 2.5 | ${new Date().toLocaleString('uk-UA')}</p>
        </footer>
    </div>
</body>
</html>
    `;
}

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin: /admin.html | Watch: /watch.html | Victim: /victim.html?id=...`);
    console.log(`AI Sites (Gemini 2.5): /cust.html/[site-id]`);
});
