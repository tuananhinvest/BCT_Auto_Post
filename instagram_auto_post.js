//"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
//--remote-debugging-port=9333 ^
//--user-data-dir="C:\chrome-debug\fb-profile"

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

// ===== LOGIN =====
async function checkLoginInstagram(page) {
    await page.goto('https://www.instagram.com/', {
        waitUntil: 'networkidle2'
    });

    await sleep(5000);

    const isLoginPage = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.some(el => el.innerText.includes('Đăng nhập vào Instagram'));
    });

    // nếu KHÔNG phải trang login → đã login
    return !isLoginPage;
}

async function connectInstagram() {
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

// ===== DATABASE =====
async function getInstagramArticles() {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
        SELECT id, article
        FROM content
        WHERE instagram_status = 0
        AND \`group\` = ?
        ORDER BY id DESC
        LIMIT 10
    `, ['-5125359663']);

    await conn.end();
    return rows;
}

async function markInstagramDone(id) {
    const conn = await mysql.createConnection(dbConfig);

    await conn.execute(`
        UPDATE content
        SET instagram_status = 1
        WHERE id = ?
    `, [id]);

    await conn.end();

    console.log(`✅ Updated instagram_status ID ${id}`);
}

// ===== FUNCTION SUPPORT POST FLOW =====
async function clickCreateIG(page) {
    const btn = await page.waitForSelector('svg[aria-label="New post"]', {
        timeout: 10000
    });

    await btn.evaluate(el => el.closest('a').click());

    console.log('➕ Click Create');
    await sleep(2000);
}

async function clickPostType(page) {
    const handle = await page.evaluateHandle(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        const el = spans.find(e => e.innerText.trim() === 'Post');
        return el ? el.closest('[role="button"], div') : null;
    });

    if (!handle) {
        console.log('❌ Không tìm thấy Post');
        return false;
    }

    await handle.asElement().click();

    console.log('📝 Chọn Post');
    await sleep(2000);
    return true;
}

async function uploadImageIG(page, articleId) {
    const imagePath = path.join(__dirname, 'photo', `${articleId}-5125359663.jpg`);

    if (!fs.existsSync(imagePath)) {
        console.log('❌ Không có ảnh');
        return false;
    }

    const input = await page.waitForSelector('input[type="file"]', {
        timeout: 10000
    });

    await input.uploadFile(imagePath);

    console.log('📸 Upload ảnh IG');

    await sleep(2000);
    return true;
}

async function clickNextIG(page) {
    for (let i = 0; i < 2; i++) {
        const handle = await page.evaluateHandle(() => {
            const divs = Array.from(document.querySelectorAll('div'));
            const el = divs.find(e => e.innerText.trim() === 'Next');
            return el || null;
        });

        if (!handle) {
            console.log('❌ Không tìm thấy Next');
            return false;
        }

        await handle.asElement().click();

        console.log(`➡️ Next lần ${i + 1}`);
        await sleep(3000);
    }

    return true;
}

async function inputCaptionIG(page, content) {
    try {
        const editor = await page.waitForSelector(
            '[aria-label="Write a caption..."]',
            { timeout: 10000 }
        );

        await editor.click();

        await page.evaluate((text) => {
            const el = document.querySelector('[aria-label="Write a caption..."]');

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

        console.log('✍️ Paste caption IG');
        await sleep(3000);

        return true;

    } catch (err) {
        console.log('❌ Lỗi caption:', err.message);
        return false;
    }
}

async function clickShareIG(page) {
    const handle = await page.evaluateHandle(() => {
        const divs = Array.from(document.querySelectorAll('div'));
        const el = divs.find(e => e.innerText.trim() === 'Share');
        return el || null;
    });

    if (!handle) {
        console.log('❌ Không thấy Share');
        return false;
    }

    await handle.asElement().click();

    console.log('🚀 Đăng IG');

    await sleep(60000);
    return true;
}

// ===== POST FLOW =====
async function postOneInstagram(page, article) {
    console.log(`📝 IG đăng ID ${article.id}`);

    //await page.goto('https://www.instagram.com/', {
    //    waitUntil: 'domcontentloaded'
    //});
 
    await sleep(1000);
 
    // 1. Create
    await clickCreateIG(page);

    // 2. Post
    const okPostType = await clickPostType(page);
    if (!okPostType) return false;

    // 3. Upload ảnh
    const okImage = await uploadImageIG(page, article.id);
    if (!okImage) return false;

    // 4. Next
    const okNext = await clickNextIG(page);
    if (!okNext) return false;

    // 5. Caption
    const okCaption = await inputCaptionIG(page, article.article);
    if (!okCaption) return false;

    // 6. Share
    const okShare = await clickShareIG(page);
    if (!okShare) return false;
    
    await sleep(2000);
    await markInstagramDone(article.id);

    return true;
}

// ===== MAIN FLOW =====
async function runInstagramBot() {
    const { page } = await connectInstagram();

    console.log('🚀 Start Instagram Bot');

    const isLogged = await checkLoginInstagram(page);

    if (!isLogged) {
        console.log('❌ IG chưa login → mở Chrome login trước');
        return;
    }

    const articles = await getInstagramArticles();

    if (!articles.length) {
        console.log('❌ Không có bài IG');
        return;
    }

    for (const article of articles) {
        console.log(`📝 IG xử lý ID ${article.id}`);

        const success = await postOneInstagram(page, article);

        if (success) {
            console.log('🎯 IG DONE → nghỉ');
            await sleep(60 * 60000);
            break;
        }

    }
}

// ===== LOOP =====
(async () => {
    while (true) {
        try {
            await runInstagramBot();
        } catch (err) {
            console.error('❌ ERROR:', err.message);
            await errorSendMessenger('BCT Instagram Auto Post gặp lỗi');
        }

        console.log('⏳ Chờ 60s...');
        await sleep(60000);
    }
})();