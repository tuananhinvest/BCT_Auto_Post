require('dotenv').config(); // Đọc file .env
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = 3000; // Cổng mà webhook sẽ chạy

// Lấy thông tin từ biến môi trường
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Biến toàn cục để lưu Promise
let resolve2FA;

// Cấu hình body parser
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Webhook server is running');
}); // Route mặc định

// Endpoint để nhận tin nhắn từ Telegram
app.post(`/webhook`, async (req, res) => {
    const { message } = req.body;

    if (message && resolve2FA) {
        const chatId = message.chat.id;
        const text = message.text;

        // Xử lý mã 2FA
        if (text && text.match(/^\d{6}$/)) { // Kiểm tra nếu tin nhắn là mã 6 chữ số
            console.log(`Mã 2FA nhận được: ${text}`);
            // Gọi hàm để xử lý mã 2FA
            resolve2FA(text); // Giải phóng Promise
            resolve2FA = null; // Reset resolve2FA
        } else {
            // Gửi hướng dẫn người dùng nhập mã 2FA
            await sendMessage(chatId, 'Vui lòng nhập mã 2FA (6 chữ số):');
        }
    }

    res.sendStatus(200); // Trả về status 200 cho Telegram
});

// Hàm gửi tin nhắn
async function sendMessage(chatId, text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
        });
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

// Hàm đăng ký webhook
async function setWebhook() {
    try {
        const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
            url: WEBHOOK_URL,
        });
        console.log('Webhook đã được đăng ký:', response.data);
    } catch (error) {
        console.error('Lỗi khi đăng ký webhook:', error);
    }
}

// Khởi động server và đăng ký webhook
app.listen(PORT, async () => {
    console.log(`Webhook server is running on http://localhost:${PORT}/webhook`);
    await setWebhook(); // Gọi hàm đăng ký webhook
});

// Export hàm để thiết lập promise cho 2FA
const waitFor2FACode = () => {
    return new Promise((resolve) => {
        resolve2FA = resolve; // Lưu trữ hàm resolve để gọi sau này
    });
};

module.exports = { waitFor2FACode };
