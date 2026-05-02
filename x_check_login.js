///Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//--remote-debugging-port=9222 \
//--user-data-dir="$HOME/chrome-debug/bct-profile"

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { errorSendMessenger } = require('./errorTelegramBot');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_DATABASE
};

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ===== CONNECT CHROME =====
async function connectExisting() {
    try {
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        console.log('✅ Connected Chrome');

        const pages = await browser.pages();

        const lastPage = pages[pages.length - 1];
        
        for (const p of pages) {
            const url = p.url();

            // 👉 BỎ QUA TAB KHÔNG ĐÓNG ĐƯỢC
            if (
                url.startsWith('chrome://') ||
                url.startsWith('devtools://') ||
                url.startsWith('chrome-extension://')
            ) {
                console.log('⏭️ Skip:', url);
                continue;
            }

            if (p !== lastPage) {
                console.log('👉 Closing:', url);
                await p.close();
                console.log('👉 Close done:', url);
                await sleep(500);
            }
        }
        
        const page = await browser.newPage();

        return { page };

    } catch (e) {
        console.error('❌ Không connect được Chrome:', e.message);
        throw e;
    }
}

// ===== CHECK LOGIN =====
async function checkLoginX(page) {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    return page.url().includes('/home');
}

// ===== GET DATA =====
async function getArticles() {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
        SELECT id, article
        FROM content
        WHERE x_status = 0
        AND \`group\` = ?
        ORDER BY id DESC
        LIMIT 10
    `, ['-5125359663']);

    await conn.end();
    return rows;
}

// ===== UPDATE STATUS =====
async function markDone(id) {
    const conn = await mysql.createConnection(dbConfig);

    await conn.execute(`
        UPDATE content
        SET x_status = 1
        WHERE id = ?
    `, [id]);

    await conn.end();

    console.log(`✅ Updated x_status ID ${id}`);
}

// ===== PASTE CONTENT (FIX DRAFT.JS) =====
async function pasteContent(page, content) {
    const selector = '[data-testid="tweetTextarea_0"]';

    await page.waitForSelector(selector, { visible: true });
    await page.click(selector);

    await page.evaluate((text) => {
        const el = document.querySelector('[data-testid="tweetTextarea_0"]');
        el.focus();

        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', text);

        const event = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true
        });

        el.dispatchEvent(event);
    }, content);

    // 👉 THÊM TRICK NHẸ ĐỂ BẬT NÚT POST
    await page.keyboard.press(' ');
    await page.keyboard.press('Backspace');

    await sleep(1500);
}

// ===== INPUT CONTENT =====
async function inputContent(page, content) {
    await pasteContent(page, content);
}

// ===== UPLOAD IMAGE =====
async function uploadImage(page, id) {
    const imagePath = path.join(__dirname, 'photo', `${id}-5125359663.jpg`);

    if (!fs.existsSync(imagePath)) {
        console.log('⚠️ Không có ảnh → vẫn đăng');
        return false;
    }

    const input = await page.$('input[data-testid="fileInput"]');

    if (!input) {
        console.log('⚠️ Không tìm thấy input file');
        return false;
    }

    await input.uploadFile(imagePath);

    console.log('📸 Upload ảnh');

    await sleep(5000);

    return true;
}

// ===== CLICK POST =====
async function clickPost(page) {
    const selector = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';

    // 👉 đợi nút xuất hiện + enable
    await page.waitForFunction((sel) => {
        const btn = document.querySelector(sel);
        return btn && !btn.disabled;
    }, { timeout: 15000 }, selector);

    const btn = await page.$(selector);

    if (!btn) {
        throw new Error('❌ Không tìm thấy nút Post');
    }

    // scroll cho chắc
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), btn);

    await sleep(2000);

    await btn.click();

    console.log('🚀 Đã click Post');

    // đợi reset editor = thành công
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="tweetTextarea_0"]');
        return el && el.innerText.trim() === '';
    }, { timeout: 10000 }).catch(() => {});

    await sleep(3000);

    return true;
}

// ===== POST 1 =====
async function postOne(page, article) {
    console.log(`📝 Đăng ID ${article.id}`);

    //await page.goto('https://x.com/home', {
    //    waitUntil: 'load'
    //});

    const content = article.article;

    await inputContent(page, content);

    await uploadImage(page, article.id);

    const ok = await clickPost(page);

    if (ok) {
        await markDone(article.id);
        return true;
    }

    return false;
}

// ===== MAIN FLOW =====
async function runBot() {
    const { page } = await connectExisting();

    const isLogged = await checkLoginX(page);

    console.log("Đang vào X");

    if (!isLogged) {
        console.log('❌ Chưa login → login tay trước');
        await sleep(10000);
        return;
    }

    console.log('🚀 Bắt đầu đăng X');

    const articles = await getArticles();

    if (!articles.length) {
        console.log('❌ Không có bài');
        return;
    }

    for (const article of articles) {
        //console.log(article);
        const success = await postOne(page, article);

        if (success) {
            console.log('🎯 DONE → nghỉ');
            await sleep(60*60000);
            break;
        }
    }
}

// ===== LOOP =====
(async () => {
    while (true) {
        try {
            await runBot();
        } catch (err) {
            console.error('❌ ERROR:', err.message);
            await errorSendMessenger('BCT X Auto Post gặp lỗi');
        }

        console.log('⏳ Chờ 60s...');
        await sleep(60000);
    }
})();