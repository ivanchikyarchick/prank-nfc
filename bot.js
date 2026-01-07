const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// --- НАСТРОЙКИ ---
const token = '8597954828:AAFCUWRD3rq3HGdN9ZYnvMU4wx1LFC32WWE'; 
const bot = new TelegramBot(token, { polling: true });

// Пути (должны совпадать с server.js)
const uploadDir = path.join(__dirname, 'public', 'uploads');
// Твой домен на Render
const PUBLIC_DOMAIN = 'https://prank-nfc.onrender.com'; 

// Проверка папки
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

console.log('🤖 TELEGRAM BOT ЗАПУЩЕН...');

// --- 1. КОМАНДА /START ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
`👋 **Привет!**

Я файловый сервер для твоего пранка.
Ты можеш использовать меня бля всего-чего угодно.

📂 **Кидай мне:**
- 🖼 Картинки (JPG/PNG)
- 🎵 Музыку (MP3)
- 🎤 Голосовые
- 🎬 Видео (MP4)
- 📁 Файлы

Я дам прямую ссылку.`, { parse_mode: 'Markdown' });
});

// --- 2. ОБРАБОТКА ФАЙЛОВ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return;

    // Если просто текст
    if (msg.text) {
        bot.sendMessage(chatId, '🖼 Кидай файл, а не текст.');
        return;
    }

    let fileId = null;
    let ext = '.dat';
    let typeName = '📁 Файл';

    // Определяем тип файла
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
    } else if (msg.document) {
        fileId = msg.document.file_id;
        ext = path.extname(msg.document.file_name) || '.dat';
        typeName = '📁 Док';
    }

    // Загрузка
    if (fileId) {
        const tempMsg = await bot.sendMessage(chatId, '⏳ Обработка...', { disable_notification: true });
        
        try {
            const fileLink = await bot.getFileLink(fileId);
            const newFilename = `${Date.now()}-${uuidv4().slice(0,8)}${ext}`;
            const publicUrl = `${PUBLIC_DOMAIN}/uploads/${newFilename}`;
            
            downloadFile(fileLink, newFilename, chatId, publicUrl, typeName, tempMsg.message_id);
        } catch (error) {
            bot.sendMessage(chatId, `❌ Ошибочка API: ${error.message}`);
        }
    }
});

// --- 3. ФУНКЦИЯ ЗАГРУЗКИ ---
const downloadFile = (url, filename, chatId, publicUrl, typeName, msgIdToDelete) => {
    const filePath = path.join(uploadDir, filename);
    const file = fs.createWriteStream(filePath);

    https.get(url, (response) => {
        response.pipe(file);
        
        file.on('finish', () => {
            file.close(() => {
                // !!! МАГИЯ ЗДЕСЬ: Добавляем в глобальный список сервера !!!
                if (global.botFiles) {
                    global.botFiles.unshift({
                        filename: filename,
                        url: publicUrl,
                        type: typeName,
                        uploadedAt: new Date().toLocaleTimeString('ru-RU')
                    });
                    
                    // Держим только последние 30 файлов
                    if (global.botFiles.length > 30) global.botFiles.pop();
                }

                // Удаляем сообщение "Обработка..."
                bot.deleteMessage(chatId, msgIdToDelete).catch(()=>{});

                // Отправляем результат
                bot.sendMessage(chatId, `✅ **Готово!**\n\n🔗 Ссылка:\n\`${publicUrl}\`\n\n👀 _Уже работает_`, { parse_mode: 'Markdown' });
            });
        });
    }).on('error', (err) => {
        fs.unlink(filename, () => {});
        bot.sendMessage(chatId, `❌ Ошибка записи: ${err.message}`);
    });
};

// --- 4. ОБРАБОТКА ОШИБОК (Чтобы сервер не падал) ---
bot.on('polling_error', (error) => {
    // Игнорируем ошибки соединения Телеграм, чтобы сервер не перезагружался
    // console.log(`[Telegram Error] ${error.code}`); 
});

module.exports = bot;
