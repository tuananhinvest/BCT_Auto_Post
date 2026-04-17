require('dotenv').config();

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const input = require("input");

// ===== ENV =====
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION;
const GROUPS = ["-5125359663"];
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// ===== DB =====
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_DATABASE
};

// ===== VALIDATE =====
if (!apiId || !apiHash) {
    throw new Error("❌ Thiếu TELEGRAM_API_ID hoặc TELEGRAM_API_HASH");
}

const stringSession = new StringSession(sessionString || "");

// ===== PATH =====
const photoDir = path.join(__dirname, 'photo');

if (!fs.existsSync(photoDir)) {
    fs.mkdirSync(photoDir);
}

// ===== UTILS =====
async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ===== SAVE DB =====
async function saveArticle(article, groupId) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        const [result] = await connection.execute(`
            INSERT INTO content 
            (article, binance_square_status, orbit_status, telegram_channel_status, x_status, \`group\`)
            VALUES (?,0,0,0,0,?)
        `, [article, groupId]);

        console.log(`✅ Lưu DB ID: ${result.insertId} | Group: ${groupId}`);
        return result.insertId;

    } finally {
        await connection.end();
    }
}

// ===== DOWNLOAD IMAGE =====
async function downloadImage(client, message, id, group) {
    try {
        const filePath = path.join(photoDir, `${id}${group}.jpg`);

        const buffer = await client.downloadMedia(message);

        if (!buffer) {
            console.log("❌ Không lấy được buffer");
            return;
        }

        fs.writeFileSync(filePath, buffer);

        console.log(`📷 Ảnh đã lưu: ${filePath}`);
    } catch (err) {
        console.error("❌ Lỗi tải ảnh:", err.message);
    }
}

// ===== GET ARTICLE =====
async function getArticle() {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
        SELECT id, article
        FROM content
        WHERE telegram_channel_status = 0
        AND \`group\` = ?
        ORDER BY id DESC
        LIMIT 10
    `, ['-1002494162336']);

    await conn.end();
    return rows;
}

// ===== UPDATE STATUS =====
async function markDone(id) {
    const conn = await mysql.createConnection(dbConfig);

    await conn.execute(`
        UPDATE content
        SET telegram_channel_status = 1
        WHERE id = ?
    `, [id]);

    await conn.end();

    console.log(`✅ Đã update telegram_channel_status ID ${id}`);
}

// ===== SEND TELEGRAM =====
async function sendTelegram(client, article) {
    const imagePath = path.join(photoDir, `${article.id}-1002494162336.jpg`);
    console.log(imagePath);
    try {
        if (fs.existsSync(imagePath)) {
            console.log('📸 Gửi ảnh');

            await client.sendFile(CHANNEL_ID, {
                file: imagePath,
                caption: article.article
            });

        } else {
            console.log('📝 Gửi text');

            await client.sendMessage(CHANNEL_ID, {
                message: article.article
            });
        }

        return true;

    } catch (err) {
        console.error('❌ Lỗi gửi Telegram:', err.message);
        return false;
    }
}

// ===== POST LOOP =====
async function runPostLoop(client) {
    while (true) {
        try {
            console.log('🚀 Check gửi Telegram...');

            const articles = await getArticle();

            if (!articles.length) {
                console.log('❌ Không có bài');
            } else {
                for (const article of articles) {
                    console.log(`📩 Đang gửi ID ${article.id}`);
            
                    const ok = await sendTelegram(client, article);
            
                    if (ok) {
                        await markDone(article.id);
                        console.log('🎯 DONE');
                        break; // gửi 1 bài rồi nghỉ
                    }
                }
            }

        } catch (err) {
            console.error('❌ ERROR:', err.message);
        }

        console.log('⏳ Chờ 1 tiếng...');
        await sleep(60 * 60 * 1000);
    }
}

// ===== MAIN =====
(async () => {

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    // ===== LOGIN LẦN ĐẦU =====
    if (!sessionString) {
        console.log("🔐 Chưa có session → login...");

        await client.start({
            phoneNumber: async () => await input.text("📱 Nhập số điện thoại: "),
            password: async () => await input.text("🔑 Password (nếu có): "),
            phoneCode: async () => await input.text("📩 Nhập code Telegram: "),
            onError: (err) => console.log("Telegram error:", err),
        });

        // 👉 LẤY SESSION
        const session = client.session.save();

        console.log("💾 SESSION MỚI:");
        console.log(session);

        console.log("👉 Copy session này vào .env TELEGRAM_SESSION");

    } else {
        console.log("🔐 Đã có session → connect");
        await client.connect();
    }

    console.log("✅ Telegram user ready");
    // ===== LISTEN GROUP =====
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;

        const text = message.message || "";
        const groupId = String(message.chatId);

        if (text.length < 50) return;
        if (!message.media) return;

        console.log(`📩 Nhận bài từ group: ${groupId}`);

        const id = await saveArticle(text, groupId);
        if (!id) return;

        await downloadImage(client, message, id, groupId);

    }, new NewMessage({
        chats: GROUPS
    }));

    // ===== START POST LOOP =====
    //runPostLoop(client);

})();