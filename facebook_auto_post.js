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

// ===== DATABASE =====
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

//=====
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

// ===== FUNCTION SUPPORT POST FLOW =====
async function inputFacebookContent(page, content) {
    try {
        const editor = await page.waitForSelector(
            '[contenteditable="true"][aria-placeholder*="Tạo bài"]',
            { timeout: 10000 }
        );

        await editor.click();

        await page.evaluate((text) => {
            const el = document.querySelector('[contenteditable="true"][aria-placeholder*="Tạo bài"]');

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

        console.log('✍️ Đã paste nội dung');

        return true;

    } catch (err) {
        console.log('❌ Lỗi paste:', err.message);
        return false;
    }
}

async function uploadImageToGroup(page, articleId) {
    try {
        const imagePath = path.join(__dirname, 'photo', `${articleId}-5125359663.jpg`);

        if (!fs.existsSync(imagePath)) {
            console.log('❌ Không có ảnh → bỏ bài');
            return false;
        }

        // ✅ Tìm đúng dialog có input[type="file"]
        const dialogs = await page.$$('[role="dialog"]');
        if (!dialogs.length) {
            console.log('❌ Không có dialog');
            return false;
        }

        let dialog = null;
        for (const d of dialogs) {
            const input = await d.$('input[type="file"]');
            if (input) {
                dialog = d;
                break;
            }
        }

        if (!dialog) {
            console.log('❌ Không tìm thấy dialog có input file');
            return false;
        }

        // ✅ Bỏ ẩn input rồi upload thẳng
        const input = await dialog.$('input[type="file"]');

        await page.evaluate((el) => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
            el.style.position = 'fixed';
            el.style.top = '0';
            el.style.left = '0';
            el.style.zIndex = '9999';
        }, input);

        await input.uploadFile(imagePath);

        console.log('📸 Upload ảnh OK');

        await page.waitForFunction(() => {
            return document.querySelectorAll('img[src^="blob:"]').length > 0;
        }, { timeout: 15000 }).catch(() => {
            console.log('⚠️ Không detect được preview ảnh');
        });

        await sleep(2000);
        return true;

    } catch (err) {
        console.log('❌ Lỗi upload:', err.message);
        return false;
    }
}

async function clickPostGroup(page) {
    try {
        // ✅ Tìm đúng dialog có nút "Đăng"
        const dialogs = await page.$$('[role="dialog"]');

        let postBtn = null;
        for (const dialog of dialogs) {
            const btn = await dialog.$('[aria-label="Đăng"]');
            if (btn) {
                postBtn = btn;
                break;
            }
        }

        if (!postBtn) {
            console.log('❌ Không tìm thấy nút Đăng');
            return false;
        }

        await postBtn.click();
        console.log('🚀 Đã click Đăng');

        await sleep(5000);
        return true;

    } catch (err) {
        console.log('❌ Lỗi click đăng:', err.message);
        return false;
    }
}

// ===== POST FLOW =====
async function postOneFacebook(page, article) {
    console.log(`📝 GROUP Đăng ID ${article.id}`);

    await page.goto('https://www.facebook.com/groups/9720991467921048', {
        waitUntil: 'domcontentloaded'
    });

    await sleep(5000);

    // ===== 1. CLICK "BẠN VIẾT GÌ ĐI..." =====
    const openBox = await page.evaluateHandle(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        const el = spans.find(e => e.innerText.includes('Bạn viết gì'));
        return el ? el.closest('div') : null;
    });
    
    if (!openBox) {
        console.log('❌ Không tìm thấy box');
        return false;
    }
    
    await openBox.asElement().click();
    
    console.log('✍️ Đã mở popup');
    
    await sleep(3000);

    const content = article.article;

    // ===== 2. INPUT CONTENT =====
    const okContent = await inputFacebookContent(page, content);

    if (!okContent) {
        console.log('❌ Fail content → bỏ bài');
        return false;
    }

    // ===== 3. UPLOAD IMAGE =====
    const okImage = await uploadImageToGroup(page, article.id);
    
    if (!okImage) {
        console.log('❌ Upload ảnh fail → bỏ bài');
        return false;
    }
    
    // ===== 4. CLICK ĐĂNG =====
    const okPost = await clickPostGroup(page);
    
    if (!okPost) {
        return false;
    }
    
    await sleep(2000);

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