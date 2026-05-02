const axios = require('axios');

const BOT_TOKEN = '8444679952:AAE-KWfKYnObfWi7GpsAJoJA08yl4eT6rnU';
const CHAT_ID = 1075606697;

// ===== GỬI MESSAGE =====
async function errorSendMessenger(message) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        await axios.post(url, {
            chat_id: CHAT_ID,
            text: `🚨 ${message}`,
            parse_mode: 'HTML'
        });

        console.log('📩 Đã gửi Telegram');

    } catch (err) {
        console.log('❌ Lỗi gửi Telegram:', err.message);
    }
}

module.exports = {
    errorSendMessenger
};