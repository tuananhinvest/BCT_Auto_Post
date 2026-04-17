const puppeteer = require('puppeteer-core')
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const COOKIE_PATH = path.join(__dirname, "cookies", "binance.json");

const BINANCE_REF_TEXT = `

⭐️ Đăng kí tài khoản binance để nhận hoàn lại 20% tiền phí giao dịch Spot, Futures, Margin vĩnh viễn: 

➡️ Link hoàn phí: https://accounts.binance.com/register?ref=KO2C41E8
- Mã giới thiệu: KO2C41E8`;

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_DATABASE,
    charset: 'utf8mb4'
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== CONNECT CHROME =====
async function connectChrome() {
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

        return { browser, page };

    } catch (e) {
        console.error('❌ Không connect được Chrome:', e.message);
        throw e;
    }
}

async function waitForSquareReady(page) {
    try {
        await page.waitForFunction(() => {
            const hasFeed = document.querySelector('[class*="feed"]');
            const hasEditor = document.querySelector('.ProseMirror[contenteditable="true"]');
            return hasFeed || hasEditor;
        }, { timeout: 15000 });

        return true;
    } catch {
        return false;
    }
}

async function getLatestArticle() {

    const connection = await mysql.createConnection(dbConfig);

    const [rows] = await connection.execute(`
        SELECT id, article
        FROM content
        WHERE binance_square_status = 0
        AND \`group\` = -5125359663
        ORDER BY id DESC
        LIMIT 10
    `);

    await connection.end();

    return rows;
}

async function markStatus(articleId, column) {

    const allowedColumns = [
        'binance_square_status',
        'orbit_status',
        'telegram_channel_status',
        'x_status'
    ];

    if (!allowedColumns.includes(column)) {
        throw new Error(`❌ Cột không hợp lệ: ${column}`);
    }

    const connection = await mysql.createConnection(dbConfig);

    try {

        await connection.execute(`
            UPDATE content
            SET ${column} = 1
            WHERE id = ?
        `, [articleId]);

        console.log(`✅ Updated ${column} for ID ${articleId}`);

    } catch (err) {

        console.error(`❌ Update status lỗi:`, err.message);

    } finally {

        await connection.end();

    }
}

async function inputArticleContent(page, content) {
    try {
        const selector = '.ProseMirror[contenteditable="true"]';

        await page.waitForSelector(selector, { visible: true });
        await page.click(selector);

        await sleep(3000);

        await page.evaluate((text) => {
            const el = document.querySelector('.ProseMirror[contenteditable="true"]');
            el.focus();

            const lines = text.split(/\r?\n/);

            const html = lines.map(line => {
                if (line.trim() === "") {
                    // 🔥 FIX: KHÔNG dùng <br>
                    return `<p></p>`;
                } else {
                    return `<p>${line}</p>`;
                }
            }).join('');

            const data = new DataTransfer();
            data.setData('text/html', html);
            data.setData('text/plain', text);

            const event = new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true
            });

            el.dispatchEvent(event);

        }, content);

        await new Promise(r => setTimeout(r, 5000));

        return true;

    } catch (err) {
        console.error("❌ inputArticleContent lỗi:", err.message);
        return false;
    }
}

async function clickPostButton(page) {

    try {

        const postButton = await page.waitForFunction(() => {

            const buttons = Array.from(document.querySelectorAll('button[data-bn-type="button"]'));

            return buttons.find(btn => {

                const span = btn.querySelector('span[data-bn-type="text"]');
                const text = span?.innerText?.trim();

                return text === 'Đăng' && !btn.disabled;

            });

        }, { timeout: 10000 });

        await page.evaluate(btn => {
            btn.scrollIntoView({ block: 'center' });
            btn.click();
        }, postButton);

        await sleep(5000);

        return true;

    } catch (err) {

        console.error('❌ clickPostButton lỗi:', err.message);

        return false;

    }
}

async function uploadCoverImage(page, articleId) {

    try {

        const imagePath = path.join(__dirname, 'photo', `${articleId}-5125359663.jpg`);

        if (!fs.existsSync(imagePath)) {

            console.warn('⚠️ Không tìm thấy ảnh bìa');

            return false;

        }
        
        const input = await page.$('input[type="file"]');

        if (!input) {

            console.warn('⚠️ Không tìm thấy input upload');

            return false;

        }

        await input.uploadFile(imagePath);

        await sleep(3000);

        console.log("✅ Upload ảnh bìa thành công");

        return true;

    } catch (err) {

        console.error("❌ Upload ảnh lỗi:", err.message);

        return false;

    }

}

async function openBinanceSquare() {

    const { browser, page } = await connectChrome();

    try {

        console.log("🔄 Loading Binance...");

        const squareUrl = "https://www.binance.com/vi/square";

        let ok = false;

        for (let i = 1; i <= 3; i++) {

            console.log(`🔄 Load Square lần ${i}`);

            await page.goto(squareUrl, {

                waitUntil: "domcontentloaded",
                timeout: 30000

            });

            if (await waitForSquareReady(page)) {

                console.log("✅ Binance Square sẵn sàng");

                ok = true;

                break;

            }

            await sleep(5000);

        }

        if (!ok) throw new Error("❌ Square không load");

        const articles = await getLatestArticle();

        for (const article of articles) {

            try {

                console.log(`📝 Đang đăng bài ID ${article.id}`);

                const finalContent = article.article + BINANCE_REF_TEXT;

                await sleep(5000);

                const contentSuccess = await inputArticleContent(page, finalContent);


                if (!contentSuccess) continue;

                await uploadCoverImage(page, article.id);

                await sleep(2000);

                const posted = await clickPostButton(page);

                if (posted) {

                    console.log(`📌 Đăng thành công ID ${article.id}`);

                    await markStatus(article.id, 'binance_square_status');

                    await sleep(60 * 60 * 1000);

                    //await openBinanceSquare();

                    return;

                }

            } catch (err) {

                console.error(`❌ Lỗi đăng bài ${article.id}`, err.message);

            }

        }

    } catch (err) {

        console.error("🚨 Error:", err);

    } finally {

        console.log("⏳ Chờ 60s trước lần chạy tiếp");

        await sleep(60000);

        await openBinanceSquare();

    }

}

(async () => {

    while (true) {

        try {

            await openBinanceSquare();

        } catch (err) {

            console.error("❌ Lỗi vòng lặp:", err.message);

        }

        await sleep(60000);

    }

})();