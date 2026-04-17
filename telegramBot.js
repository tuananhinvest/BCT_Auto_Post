const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// =======================
// CẤU HÌNH PROXY (có mật khẩu)
// =======================
const proxyHost = process.env.PROXY_HOST;       // ví dụ: '123.45.67.89'
const proxyPort = process.env.PROXY_PORT;                  // ví dụ: 8080
const proxyUsername = process.env.PROXY_USERNAME; // ví dụ: 'user'
const proxyPassword = process.env.PROXY_PASSWORD; // ví dụ: 'password'

const proxyUrl = `http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;
const httpsAgent = new HttpsProxyAgent(proxyUrl);

// =======================
const TELEGRAM_BOT_TOKEN = '7843031121:AAHR-VawHDIqnj3bUvUO3Wo_MT6w-bjzRLo';
const CHAT_ID = process.env.CHAT_ID;
const LOCK_FILE = "bot.lock"; 
const MENTIONS = process.env.MENTIONS ? JSON.parse(process.env.MENTIONS) : [];
const LOGIN_MENTIONS = process.env.LOGIN_MENTIONS ? JSON.parse(process.env.LOGIN_MENTIONS) : [];

async function sendPhoto(photoPath, caption) {
    try {
        const env = process.env.NODE_ENV || 'UNKNOWN';
        caption = `\\[${env}] ${caption}`;
        // lặp danh sách LOGIN_MENTIONS và thêm vào caption
        for (const user of LOGIN_MENTIONS) {
            caption += ` [${user.username}](tg://user?id=${user.id})`;
        }
        
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('photo', fs.createReadStream(photoPath));
        form.append('caption', caption);
        form.append('parse_mode', 'Markdown');

        await axios.post(url, form, {
            headers: form.getHeaders(),
            // httpsAgent, // 👈 DÙNG AGENT Ở ĐÂY
        });
        console.log('✅ Hình ảnh đã được gửi qua Telegram');
    } catch (error) {
        console.error('❌ Lỗi khi gửi hình ảnh qua Telegram:', error.message);
    }
}

async function sendMessage(text, mention = []) {
    try {
        const env = process.env.NODE_ENV || 'UNKNOWN';
        const escapedEnv = env.replace(/([[\]])/g, '\\$1');
        text = `\\[${escapedEnv}\] ${text}`;
        for (let i = 0; i < mention.length; i++) {
            const user = mention[i];
            text = text + ` [${user.username}](tg://user?id=${user.id})`;
        }
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: CHAT_ID,
            text,
            parse_mode: 'Markdown',
        // }, {
        //     httpsAgent // 👈 DÙNG AGENT Ở ĐÂY
        });
    } catch (error) {
        console.error('❌ Lỗi khi gửi tin nhắn qua Telegram:', error.message);
    }
}

async function sendMessageEndProcess(text){
    await sendMessage(text, MENTIONS);
}

async function sendMessageCustom(text, to){
    const mentions = to.map(index => MENTIONS[index]);
    await sendMessage(text, mentions);
}

// ========== Các hàm khác giữ nguyên ==========
function isBotRunning() {
    return fs.existsSync(LOCK_FILE);
}

function createLockFile(content = "running") {
    fs.writeFileSync(LOCK_FILE, content);
}

function removeLockFile() {
    if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function newBotOtp(Token, text = '') {
    while (isBotRunning()) {
        console.log("Bot is running");
        await sleep(1000);
    }
    const bot = new TelegramBot(Token, {
        polling: true,
        // request: {
        //     agent: httpsAgent
        // }
    });
    createLockFile(text || 'common');
    console.log("Bot started");
    return bot;
}

async function stopBotOtp(bot) {
    if (bot) {
        bot.stopPolling();
    }
    removeLockFile();
    await sleep(1000);
    console.log("Bot stopped");
}

function stopBotOtpWhenProcessExit() {
    process.on("SIGINT", () => {
        console.log("Bot is stopping...");
        removeLockFile();
        process.exit();
    });

    process.on("exit", () => {
        removeLockFile();
    });
}

// ✅ Xuất các hàm
module.exports = {
    sendPhoto,
    sendMessage,
    sendMessageEndProcess,
    sendMessageCustom,
    newBotOtp,
    stopBotOtp,
    stopBotOtpWhenProcessExit,
    isBotRunning,
    createLockFile,
    removeLockFile
};
