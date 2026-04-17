//"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
//--remote-debugging-port=9333 ^
//--user-data-dir="C:\chrome-debug\fb-profile"

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

// ===== DB =====
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

// ===== LOGIN =====
async function checkLoginFacebook(page) {
    await page.goto('https://www.facebook.com/', {
        waitUntil: 'networkidle2'
    });

    await sleep(3000);

    const isLoginButton = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('span'));
        return btns.some(el => el.innerText.trim() === 'Đăng nhập');
    });

    return !isLoginButton;
}

async function connectFacebook() {
    const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9333',
        defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages.length ? pages[0] : await browser.newPage();

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8'
    });

    try { await page.emulateTimezone('Asia/Ho_Chi_Minh'); } catch {}

    return { page };
}

// ===== GET DATA =====
async function getFacebookArticles() {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
        SELECT id, article
        FROM content
        WHERE facebook_status = 0
        AND \`group\` = ?
        ORDER BY id DESC
        LIMIT 10
    `, ['-1002494162336']);

    await conn.end();
    return rows;
}

// ===== UPDATE STATUS =====
async function markFacebookDone(id) {
    const conn = await mysql.createConnection(dbConfig);

    await conn.execute(`
        UPDATE content
        SET facebook_status = 1
        WHERE id = ?
    `, [id]);

    await conn.end();

    console.log(`✅ Updated facebook_status ID ${id}`);
}

async function uploadFacebookImage(page, articleId) {
    try {
        const imagePath = path.join(__dirname, 'photo', `${articleId}-1002494162336.jpg`);

        if (!fs.existsSync(imagePath)) {
            console.log('❌ Không có ảnh → bỏ bài');
            return false;
        }

        // ===== BẮT FILE CHOOSER =====
        const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span'));
                const btn = spans.find(el => el.innerText.trim() === 'Thêm ảnh/video');
                if (btn) btn.click();
            })
        ]);

        await fileChooser.accept([imagePath]);

        console.log('📸 Upload ảnh thành công (fileChooser)');

        await sleep(5000);

        return true;

    } catch (err) {
        console.log('❌ Lỗi upload ảnh:', err.message);
        return false;
    }
}

async function inputFacebookContent(page, content) {
    try {
        const editor = await page.waitForSelector('[contenteditable="true"]', {
            timeout: 10000
        });

        if (!editor) {
            console.log('❌ Không tìm thấy editor');
            return false;
        }

        await editor.click();

        await page.evaluate((text) => {
            const el = document.querySelector('[contenteditable="true"]');
            el.focus();

            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);

            const event = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true
            });

            el.dispatchEvent(event);
        }, content);

        await page.keyboard.press(' ');
        await page.keyboard.press('Backspace');

        console.log('✍️ Đã nhập nội dung');

        return true;

    } catch (err) {
        console.log('❌ Lỗi nhập nội dung:', err.message);
        return false;
    }
}

// ===== POST =====
async function postOneFacebook(page, article) {
    console.log(`📝 FB Đăng ID ${article.id}`);

    await page.goto('https://business.facebook.com/latest/composer/?asset_id=287755947762680', {
        waitUntil: 'networkidle2'
    });

    await sleep(5000);

    const content = article.article;

    // ===== INPUT CONTENT =====
    const okContent = await inputFacebookContent(page, content);

    if (!okContent) {
        console.log('❌ Fail content → bỏ bài');
        return false;
    }

    // ===== UPLOAD IMAGE =====
    const okImage = await uploadFacebookImage(page, article.id);

    if (!okImage) {
        console.log('❌ Không có ảnh hoặc upload fail → KHÔNG đăng');
        return false;
    }

    // ===== CLICK ĐĂNG =====
    const postBtn = await page.evaluateHandle(() => {
        const els = Array.from(document.querySelectorAll('div[role="button"]'));
        return els.find(el => el.innerText.trim() === 'Đăng');
    });

    if (!postBtn) {
        console.log('❌ Không tìm thấy nút Đăng');
        return false;
    }

    await postBtn.click();

    console.log('🚀 Đã click Đăng');

    await sleep(5000);

    await markFacebookDone(article.id);

    return true;
}

// ===== MAIN FLOW =====
async function runFacebookBot() {
    const { page } = await connectFacebook();

    console.log('🚀 Bắt đầu đăng Facebook');

    // ✅ CHECK LOGIN TRƯỚC
    const isLogged = await checkLoginFacebook(page);

    if (!isLogged) {
        console.log('❌ FB chưa login → vui lòng đăng nhập');
        return;
    }

    const articles = await getFacebookArticles();

    if (!articles.length) {
        console.log('❌ Không có bài FB');
        return;
    }

    for (const article of articles) {
        const success = await postOneFacebook(page, article);

        if (success) {
            console.log('🎯 FB DONE → nghỉ');
            await sleep(60 * 60000);
            break;
        }
    }
}

// ===== LOOP =====
(async () => {
    while (true) {
        try {
            await runFacebookBot(); // FB
        } catch (err) {
            console.error('❌ ERROR:', err.message);
        }

        console.log('⏳ Chờ 60s...');
        await sleep(60000);
    }
})();