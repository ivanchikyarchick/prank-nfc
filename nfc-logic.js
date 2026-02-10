/**
 * 🛡️ NFC CONTROL SYSTEM v3.0 [INLINE BUTTONS + EXPLOSIONS]
 * Модуль управления сервером через Telegram
 * Язык интерфейса: Русский (Стандартный)
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// --- НАСТРОЙКИ ---
const token = '8249796254:AAGV3kYCPf-siSmvl4SOXU4_44HS0y5RUPM'; 
const ADMIN_ID = 8290877754; 

// Проверка наявності глобальних змінних
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
const editState = {}; // Состояние редактирования сессии

console.log('🤖 NFC Control Bot v3.0 starting...');

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

// --- ГЛАВНОЕ МЕНЮ /START ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    // Inline кнопка "Создать ловушку"
    bot.sendMessage(chatId, 
        "🤖 **NFC CONTROL v3.0**\n\n" +
        "✨ **Новые возможности:**\n" +
        "• 💥 Эффект взрывов на сайте\n" +
        "• 🎨 Редактирование картинок и звуков\n" +
        "• 🎯 Детонатор для мгновенного запуска\n" +
        "• 🔧 Полное управление сессиями\n\n" +
        "Выберите действие ниже:", 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "➕ Создать ловушку", callback_data: "create_new" }],
                    [{ text: "📂 Активные сессии", callback_data: "show_sessions" }]
                ]
            }
        }
    );
});

// --- АДМИН ПАНЕЛЬ /ADMIN ---
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    
    // Проверка прав
    if (chatId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "⛔️ У вас нет доступа к админ-панели.");
    }
    
    bot.sendMessage(chatId, 
        "🔐 **АДМИН-ПАНЕЛЬ**\n\n" +
        "Управление сервером и пользователями:", 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Статус сервера", callback_data: "admin_status" }],
                    [{ text: "👥 Все пользователи", callback_data: "admin_users" }]
                ]
            }
        }
    );
});

// --- ОБРАБОТКА СООБЩЕНИЙ (WIZARD) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Пропускаем команды
    if (text && text.startsWith('/')) return;

    // --- СОЗДАНИЕ ЛОВУШКИ (WIZARD) ---
    if (wizardState[chatId]) {
        const st = wizardState[chatId];

        // ШАГ 1: ИЗОБРАЖЕНИЕ
        if (st.step === 1) {
            let processMsg = null;
            
            // ФОТО
            if (msg.photo) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка изображения...");
                const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                st.data.image = f.url || '';
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } 
            // СТИКЕР → КОНВЕРТИРУЕМ В JPG
            else if (msg.sticker) {
                processMsg = await bot.sendMessage(chatId, "⏳ Конвертация стикера...");
                const f = await downloadFile(msg.sticker.file_id, 'sticker');
                
                if (f.path) {
                    try {
                        const converted = await convertStickerToImage(f.path);
                        st.data.image = converted.url || '';
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        st.data.image = '';
                    }
                }
            }
            // ВИДЕО → СОХРАНЯЕМ ДЛЯ ШАГА 2
            else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, "⏳ Обработка видео...");
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        st.data.sound = '';
                    }
                }
                st.data.image = ''; // Из видео картинку не берём
            }
            // SKIP
            else if (text && text.toLowerCase() === 'skip') {
                st.data.image = '';
            }
            else {
                return bot.sendMessage(chatId, "⚠️ Отправьте фото, стикер, видео или напишите 'skip'");
            }

            // Переход к шагу 2
            st.step = 2;
            return bot.sendMessage(chatId, 
                "📝 **ШАГ 2/2**\n\n" +
                "Отправьте:\n" +
                "• 🔊 **Аудио**\n" +
                "• 🎤 **Голосовое сообщение**\n" +
                "• 🎬 **Видео** (звук будет извлечён)\n\n" +
                "_Напишите 'skip' если звук уже загружен._", 
                { parse_mode: 'Markdown' }
            );
        }

        // ШАГ 2: ЗВУК
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
                processMsg = await bot.sendMessage(chatId, "⏳ Извлечение звука...");
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        st.data.sound = st.data.sound || '';
                    }
                }
            }
            // SKIP
            else if (text && text.toLowerCase() === 'skip') {
                st.data.sound = st.data.sound || '';
            }
            else {
                return bot.sendMessage(chatId, "⚠️ Отправьте аудио, голосовое, видео или 'skip'");
            }

            // Финиш
            finishSessionCreation(chatId, st.data);
            delete wizardState[chatId];
        }
    }

    // --- РЕДАКТИРОВАНИЕ СЕССИИ ---
    if (editState[chatId]) {
        const st = editState[chatId];
        const sessionId = st.sessionId;
        const s = global.sessions[sessionId];
        
        if (!s) {
            delete editState[chatId];
            return bot.sendMessage(chatId, "⚠️ Сессия не найдена.");
        }

        // ИЗМЕНИТЬ КАРТИНКУ
        if (st.mode === 'image') {
            let processMsg = null;
            
            if (msg.photo) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка...");
                const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                s.image = f.url || s.image;
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } else if (msg.sticker) {
                processMsg = await bot.sendMessage(chatId, "⏳ Конвертация...");
                const f = await downloadFile(msg.sticker.file_id, 'sticker');
                if (f.path) {
                    try {
                        const converted = await convertStickerToImage(f.path);
                        s.image = converted.url || s.image;
                    } catch (e) {}
                }
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } else {
                return bot.sendMessage(chatId, "⚠️ Отправьте фото или стикер.");
            }
            
            // Отправляем обновление на клиент
            global.io.to(sessionId).emit('update-media', { 
                image: s.image, 
                sound: s.sound, 
                auto: s.autoMode,
                explosions: s.explosionsEnabled || false
            });
            
            delete editState[chatId];
            bot.sendMessage(chatId, "✅ Картинка обновлена!");
            sendSessionControlPanel(chatId, sessionId);
        }

        // ИЗМЕНИТЬ ЗВУК
        if (st.mode === 'sound') {
            let processMsg = null;
            
            if (msg.audio) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка...");
                const f = await downloadFile(msg.audio.file_id, 'snd');
                s.sound = f.url || s.sound;
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } else if (msg.voice) {
                processMsg = await bot.sendMessage(chatId, "⏳ Загрузка...");
                const f = await downloadFile(msg.voice.file_id, 'voice');
                s.sound = f.url || s.sound;
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, "⏳ Извлечение звука...");
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        s.sound = audioData.url || s.sound;
                    } catch (e) {}
                }
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } else {
                return bot.sendMessage(chatId, "⚠️ Отправьте аудио, голосовое или видео.");
            }
            
            // Отправляем обновление
            global.io.to(sessionId).emit('update-media', { 
                image: s.image, 
                sound: s.sound, 
                auto: s.autoMode,
                explosions: s.explosionsEnabled || false
            });
            
            delete editState[chatId];
            bot.sendMessage(chatId, "✅ Звук обновлён!");
            sendSessionControlPanel(chatId, sessionId);
        }
    }
});

// --- ФУНКЦИЯ СОЗДАНИЯ СЕССИИ ---
function finishSessionCreation(chatId, data) {
    const id = uuidv4();
    const code = generateShortCode();

    const session = {
        id: id,
        shortCode: code,
        image: data.image || '',
        sound: data.sound || '',
        autoMode: false, // По умолчанию выключен
        explosionsEnabled: false, // Взрывы выключены
        totalVictims: 0,
        createdAt: new Date(),
        lastActiveAt: Date.now(),
        creator: {
            ip: 'Telegram Bot',
            device: '🤖 Bot',
            userId: chatId
        }
    };

    // Запись в глобальную память
    global.sessions[id] = session;
    global.shortLinks[code] = id;

    bot.sendMessage(chatId, "✅ **Ловушка создана!**", { parse_mode: 'Markdown' });
    sendSessionControlPanel(chatId, id);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ СЕССИЕЙ ---
function sendSessionControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) {
        bot.sendMessage(chatId, "⚠️ Сессия не найдена.");
        return;
    }

    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    const link = `https://prank-nfc.onrender.com/${s.shortCode}`; 

    let msg = `🆔 **ID:** \`${s.shortCode}\`\n🔗 **Ссылка:** \`${link}\`\n👥 **Онлайн:** ${victims.length}`;
    
    if (s.image) msg += "\n🖼 Фон: ✅";
    if (s.sound) msg += "\n🔊 Звук: ✅";

    if (victims.length > 0) {
        msg += "\n\n📱 **Устройства:**\n" + victims.map(v => `• ${v.device || 'Unknown'}`).join('\n');
    }

    bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🎨 Изменить картинку", callback_data: `edit_image_${sessionId}` },
                    { text: "🔊 Изменить звук", callback_data: `edit_sound_${sessionId}` }
                ],
                [
                    { text: s.explosionsEnabled ? "💥 Выключить взрывы" : "💥 Включить взрывы", callback_data: `toggle_explosions_${sessionId}` }
                ],
                [
                    { text: "💣 Детонатор", callback_data: `detonate_${sessionId}` }
                ],
                [
                    { text: "🔄 Обновить", callback_data: `refresh_${sessionId}` },
                    { text: "❌ Удалить", callback_data: `delete_${sessionId}` }
                ]
            ]
        }
    });
}

// --- ПОКАЗАТЬ ВСЕ СЕССИИ ---
function showAllSessions(chatId) {
    const sessions = Object.values(global.sessions || {});
    
    if (sessions.length === 0) {
        return bot.sendMessage(chatId, "📂 Нет активных сессий.");
    }

    const buttons = sessions.map(s => {
        return [{ text: `${s.shortCode} (👥 ${Object.values(global.activeVictims || {}).filter(v => v.roomId === s.id).length})`, callback_data: `view_${s.id}` }];
    });

    bot.sendMessage(chatId, "📂 **Активные сессии:**\n\nВыберите сессию для управления:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// --- ОБРАБОТКА CALLBACK КНОПОК ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    // СОЗДАТЬ НОВУЮ ЛОВУШКУ
    if (data === 'create_new') {
        wizardState[chatId] = { step: 1, data: {} };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, 
            "📝 **ШАГ 1/2**\n\n" +
            "Отправьте:\n" +
            "• 🖼 **Фото** (фон)\n" +
            "• 🎭 **Стикер** (будет конвертирован)\n" +
            "• 🎬 **Видео** (звук извлечён автоматически)\n\n" +
            "_Напишите 'skip' для стандартного фона._", 
            { parse_mode: 'Markdown' }
        );
    }

    // ПОКАЗАТЬ СЕССИИ
    if (data === 'show_sessions') {
        bot.answerCallbackQuery(query.id);
        return showAllSessions(chatId);
    }

    // ПРОСМОТР СЕССИИ
    if (data.startsWith('view_')) {
        const sessionId = data.replace('view_', '');
        bot.answerCallbackQuery(query.id);
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        return sendSessionControlPanel(chatId, sessionId);
    }

    // ИЗМЕНИТЬ КАРТИНКУ
    if (data.startsWith('edit_image_')) {
        const sessionId = data.replace('edit_image_', '');
        editState[chatId] = { sessionId, mode: 'image' };
        bot.answerCallbackQuery(query.id, { text: "📤 Отправьте новое фото или стикер" });
        return bot.sendMessage(chatId, "🎨 Отправьте новое изображение или стикер:");
    }

    // ИЗМЕНИТЬ ЗВУК
    if (data.startsWith('edit_sound_')) {
        const sessionId = data.replace('edit_sound_', '');
        editState[chatId] = { sessionId, mode: 'sound' };
        bot.answerCallbackQuery(query.id, { text: "📤 Отправьте новый звук" });
        return bot.sendMessage(chatId, "🔊 Отправьте аудио, голосовое или видео:");
    }

    // ВКЛЮЧИТЬ/ВЫКЛЮЧИТЬ ВЗРЫВЫ
    if (data.startsWith('toggle_explosions_')) {
        const sessionId = data.replace('toggle_explosions_', '');
        const s = global.sessions[sessionId];
        
        if (!s) {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ Сессия не найдена" });
        }

        s.explosionsEnabled = !s.explosionsEnabled;
        
        // Отправляем обновление клиенту
        global.io.to(sessionId).emit('update-media', { 
            image: s.image, 
            sound: s.sound, 
            auto: s.autoMode,
            explosions: s.explosionsEnabled
        });

        bot.answerCallbackQuery(query.id, { text: s.explosionsEnabled ? "💥 Взрывы включены!" : "❌ Взрывы выключены" });
        
        // Обновляем панель
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        return sendSessionControlPanel(chatId, sessionId);
    }

    // ДЕТОНАТОР
    if (data.startsWith('detonate_')) {
        const sessionId = data.replace('detonate_', '');
        global.io.to(sessionId).emit('play-sound');
        return bot.answerCallbackQuery(query.id, { text: "💣 Звук запущен!" });
    }

    // ОБНОВИТЬ
    if (data.startsWith('refresh_')) {
        const sessionId = data.replace('refresh_', '');
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        bot.answerCallbackQuery(query.id, { text: "🔄 Обновлено" });
        return sendSessionControlPanel(chatId, sessionId);
    }

    // УДАЛИТЬ
    if (data.startsWith('delete_')) {
        const sessionId = data.replace('delete_', '');
        const s = global.sessions[sessionId];
        
        if (s && global.shortLinks[s.shortCode]) {
            delete global.shortLinks[s.shortCode];
        }
        delete global.sessions[sessionId];
        
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        return bot.answerCallbackQuery(query.id, { text: "🗑 Удалено" });
    }

    // === АДМИН ПАНЕЛЬ ===
    if (data === 'admin_status') {
        if (chatId !== ADMIN_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔️ Нет доступа" });
        }

        const vCount = Object.keys(global.activeVictims || {}).length;
        const sCount = Object.keys(global.sessions || {}).length;
        
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, 
            `📊 **СТАТУС СЕРВЕРА**\n\n` +
            `🟢 Онлайн жертв: ${vCount}\n` +
            `📁 Всего сессий: ${sCount}\n` +
            `⚡ Статус: Active`, 
            { parse_mode: 'Markdown' }
        );
    }

    if (data === 'admin_users') {
        if (chatId !== ADMIN_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔️ Нет доступа" });
        }

        const userSessions = {};
        
        Object.values(global.sessions || {}).forEach(s => {
            const userId = s.creator?.userId || 'unknown';
            if (!userSessions[userId]) {
                userSessions[userId] = [];
            }
            userSessions[userId].push(s);
        });

        const buttons = Object.keys(userSessions).map(userId => {
            const count = userSessions[userId].length;
            return [{ text: `User ${userId} (📁 ${count})`, callback_data: `admin_user_${userId}` }];
        });

        if (buttons.length === 0) {
            bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, "👥 Нет пользователей с сессиями.");
        }

        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, "👥 **Пользователи:**", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    }

    if (data.startsWith('admin_user_')) {
        if (chatId !== ADMIN_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔️ Нет доступа" });
        }

        const userId = data.replace('admin_user_', '');
        const userSessions = Object.values(global.sessions || {}).filter(s => 
            String(s.creator?.userId) === userId
        );

        if (userSessions.length === 0) {
            bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, "⚠️ У этого пользователя нет сессий.");
        }

        const buttons = userSessions.map(s => {
            const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === s.id).length;
            return [{ text: `${s.shortCode} (👥 ${victims})`, callback_data: `admin_session_${s.id}` }];
        });

        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, `📁 **Сессии пользователя ${userId}:**`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    }

    if (data.startsWith('admin_session_')) {
        if (chatId !== ADMIN_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔️ Нет доступа" });
        }

        const sessionId = data.replace('admin_session_', '');
        const s = global.sessions[sessionId];

        if (!s) {
            bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, "⚠️ Сессия не найдена.");
        }

        const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
        const link = `https://prank-nfc.onrender.com/${s.shortCode}`;

        let msg = `🔐 **АДМИН ПРОСМОТР**\n\n`;
        msg += `🆔 ID: \`${s.shortCode}\`\n`;
        msg += `🔗 Ссылка: \`${link}\`\n`;
        msg += `👤 Создатель: ${s.creator?.userId || 'Unknown'}\n`;
        msg += `👥 Онлайн: ${victims.length}\n`;
        msg += `📅 Создана: ${new Date(s.createdAt).toLocaleString('ru-RU')}`;

        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🔄 Обновить", callback_data: `admin_session_${sessionId}` },
                        { text: "🗑 Удалить", callback_data: `admin_delete_${sessionId}` }
                    ]
                ]
            }
        });
    }

    if (data.startsWith('admin_delete_')) {
        if (chatId !== ADMIN_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔️ Нет доступа" });
        }

        const sessionId = data.replace('admin_delete_', '');
        const s = global.sessions[sessionId];
        
        if (s && global.shortLinks[s.shortCode]) {
            delete global.shortLinks[s.shortCode];
        }
        delete global.sessions[sessionId];
        
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        return bot.answerCallbackQuery(query.id, { text: "🗑 Сессия удалена" });
    }

    bot.answerCallbackQuery(query.id, { text: "⚠️ Неизвестная команда" });
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error.message);
});

console.log('✅ NFC Control Bot v3.0 loaded successfully');

module.exports = bot;
