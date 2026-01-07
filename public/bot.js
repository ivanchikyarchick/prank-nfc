const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// --- НАЛАШТУВАННЯ БОТА ---
const token = '8597954828:AAFCUWRD3rq3HGdN9ZYnvMU4wx1LFC32WWE'; // Твій токен
const bot = new TelegramBot(token, { polling: true });

// --- НАЛАШТУВАННЯ ШЛЯХІВ ---
// Важливо: ми використовуємо ту саму папку, що і сервер
const uploadDir = path.join(__dirname, 'public', 'uploads');
// Твій домен на Render (без слеша в кінці)
const PUBLIC_DOMAIN = 'https://prank-nfc.onrender.com'; 

// Переконуємось, що папка існує
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

console.log('🤖 TELEGRAM BOT ЗАПУЩЕНО В ОКРЕМОМУ ФАЙЛІ...');

// Функція завантаження файлу
const downloadFile = (url, filename, chatId) => {
    const filePath = path.join(uploadDir, filename);
    const file = fs.createWriteStream(filePath);

    https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close(() => {
                const publicUrl = `${PUBLIC_DOMAIN}/uploads/${filename}`;
                bot.sendMessage(chatId, `✅ **Все, файл сохранил!**\n\n🔗 Ссылка:\n\`${publicUrl}\``, { parse_mode: 'Markdown' });
            });
        });
    }).on('error', (err) => {
        fs.unlink(filename, () => {}); // Видаляємо битий файл
        bot.sendMessage(chatId, `❌ Ошибочка получилась: ${err.message}`);
    });
};

// --- ОБРОБКА ПОВІДОМЛЕНЬ ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Ігноруємо текстові команди
    if (msg.text && !msg.text.startsWith('/')) {
        bot.sendMessage(chatId, '📂 Дай мне картинку, аудио (MP3) или голосовуху, а я создам ссылку.');
        return;
    }

    let fileId = null;
    let ext = '';

    // Визначаємо тип файлу
    if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id; // Найкраща якість
        ext = '.jpg';
    } else if (msg.audio) {
        fileId = msg.audio.file_id;
        ext = '.mp3'; // Зазвичай mp3
    } else if (msg.voice) {
        fileId = msg.voice.file_id;
        ext = '.ogg';
    } else if (msg.document) {
        fileId = msg.document.file_id;
        // Пробуємо взяти оригінальне розширення
        ext = path.extname(msg.document.file_name) || '.dat';
    }

    if (fileId) {
        bot.sendMessage(chatId, '⏳ Брат, дай подумаю...');
        
        try {
            // Отримуємо пряме посилання від Telegram API
            const fileLink = await bot.getFileLink(fileId);
            const newFilename = `${Date.now()}-${uuidv4().slice(0,8)}${ext}`;
            
            // Качаємо
            downloadFile(fileLink, newFilename, chatId);
        } catch (error) {
            bot.sendMessage(chatId, `❌ Ошибочка АПИ если уж такое случилось, пиши @ivasites: ${error.message}`);
        }
    }
});

// Обробка помилок polling (щоб не падав сервер)
bot.on('polling_error', (error) => {
    console.log(`[Bot Error] ${error.code}: ${error.message}`);
});

module.exports = bot;
