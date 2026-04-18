//"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
//--remote-debugging-port=9333 ^
//--user-data-dir="C:\chrome-debug\fb-profile"

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
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
    `, ['-5125359663']);

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

async function findFileInput(page) {
    const frames = page.frames();

    for (const frame of frames) {
        const input = await frame.$('input[type="file"]');
        if (input) return input;
    }
    return null;
}

async function handleReloadDialog(page) {
    page.on('dialog', async dialog => {
        const msg = dialog.message();

        if (msg.includes('Tải lại') || msg.includes('reload')) {
            console.log('🔄 Phát hiện dialog reload');

            await dialog.accept();
        } else {
            console.log('⚠️ Dialog khác:', msg);
            await dialog.dismiss(); // hoặc accept tùy bạn
        }
    });
}

async function uploadFacebookImage(page, articleId) {
    try {
        const imagePath = path.join(__dirname, 'photo', `${articleId}-1002494162336.jpg`);

        if (!fs.existsSync(imagePath)) {
            console.log('❌ Không có ảnh → bỏ bài');
            return false;
        }

        // ⚠️ BẮT file chooser ĐÚNG CÁCH
        const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.click('[aria-label="Chọn thêm ảnh."]') // phải là click thật
        ]);

        // Upload file
        await fileChooser.accept([imagePath]);

        console.log('📸 Upload ảnh thành công (fileChooser)');

        await sleep(3000);

        return true;

    } catch (err) {
        console.log('❌ Lỗi upload ảnh:', err.message);
        return false;
    }
}


async function inputFacebookContent(page, content) {
    try {
        // chỉ lấy editor đang visible
        const editor = await page.evaluateHandle(() => {
            const editors = Array.from(document.querySelectorAll('[contenteditable="true"]'));
            return editors.find(el => el.offsetParent !== null); // chỉ lấy cái đang hiển thị
        });

        if (!editor) {
            console.log('❌ Không tìm thấy editor visible');
            return false;
        }

        const el = editor.asElement();

        await el.click();

        await page.evaluate((text) => {
            const editors = Array.from(document.querySelectorAll('[contenteditable="true"]'));
            const el = editors.find(e => e.offsetParent !== null);

            if (!el) return;

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

        console.log('✍️ Đã nhập nội dung (visible editor)');

        return true;

    } catch (err) {
        console.log('❌ Lỗi nhập nội dung:', err.message);
        return false;
    }
}

// ===== POST =====
async function postOneFacebook(page, article) {
    console.log(`📝 GROUP Đăng ID ${article.id}`);

    await page.goto('https://www.facebook.com/groups/9720991467921048', {
        waitUntil: 'domcontentloaded'
    });

    await sleep(5000);

    // ===== 1. CLICK "BẠN VIẾT GÌ ĐI..." =====
    const openBox = await page.evaluateHandle(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.find(el => el.innerText.includes('Bạn viết gì'));
    });

    if (!openBox) {
        console.log('❌ Không tìm thấy ô tạo bài viết');
        return false;
    }

    await openBox.click();
    console.log('✍️ Đã mở popup viết bài');

    await sleep(3000);

    const content = article.article;

    // ===== 2. INPUT CONTENT =====
    const okContent = await inputFacebookContent(page, content);

    if (!okContent) {
        console.log('❌ Fail content → bỏ bài');
        return false;
    }

    // ===== 3. UPLOAD IMAGE (fileChooser) =====
    const imagePath = path.join(__dirname, 'photo', `${article.id}-5125359663.jpg`);

    if (!fs.existsSync(imagePath)) {
        console.log('❌ Không có ảnh → KHÔNG đăng');
        return false;
    }

    try {
        const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('div[role="button"]'));
                const btn = btns.find(el => el.innerText.includes('Ảnh') || el.innerText.includes('photo'));
                if (btn) btn.click();
            })
        ]);

        await fileChooser.accept([imagePath]);

        console.log('📸 Upload ảnh thành công');

        await sleep(5000);

    } catch (err) {
        console.log('❌ Lỗi upload ảnh:', err.message);
        return false;
    }

    // ===== 4. CLICK ĐĂNG =====
    const postBtn = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"]'));
        return btns.find(el => el.innerText.trim() === 'Đăng');
    });

    if (!postBtn) {
        console.log('❌ Không tìm thấy nút Đăng');
        return false;
    }

    await postBtn.click();

    console.log('🚀 Đã đăng bài GROUP');

    await sleep(5000);

    await markFacebookDone(article.id);

    return true;
}

// ===== MAIN FLOW =====
async function runFacebookBot() {
    const { page } = await connectFacebook();

    await handleReloadDialog(page);

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