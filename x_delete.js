// "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
// --remote-debugging-port=9222 ^
// --user-data-dir="D:\chrome-debug\x-profile"

const puppeteer = require('puppeteer-core');

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ===== KẾT NỐI CHROME HIỆN TẠI =====
async function connectExisting() {
    try {
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        console.log('✅ Connected Chrome');
        const pages = await browser.pages();
        
        let activePage = pages[pages.length - 1];
        
        for (const p of pages) {
            const url = p.url();
            if (
                url.startsWith('chrome://') ||
                url.startsWith('devtools://') ||
                url.startsWith('chrome-extension://')
            ) {
                continue;
            }
            if (p !== activePage) {
                await p.close();
                await sleep(500);
            }
        }
        
        return { page: activePage };
    } catch (e) {
        console.error('❌ Không connect được Chrome:', e.message);
        throw e;
    }
}

// ===== LOGIC XÓA BÀI VIẾT =====
// ===== LOGIC XÓA BÀI VIẾT =====
async function deletePost(page) {
    try {
        const caretSelector = '[data-testid="caret"]';
        await page.waitForSelector(caretSelector, { visible: true, timeout: 5000 });
        
        const carets = await page.$$(caretSelector);
        if (carets.length === 0) {
            console.log('⏳ Không tìm thấy bài viết nào để xóa. Đang tải lại trang...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            return false;
        }
        
        console.log('👉 Tìm thấy bài viết, đang click nút 3 chấm...');
        await carets[0].click();
        await sleep(1000); 

        // TÌM NÚT XÓA (Hỗ trợ Tiếng Việt & Tiếng Anh)
        const deleteMenuItem = await page.evaluateHandle(() => {
            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
            return menuItems.find(item => {
                const text = item.innerText.trim();
                return text.includes('Xóa') || text.includes('Delete');
            });
        });

        const deleteBtn = deleteMenuItem.asElement();

        // NẾU KHÔNG CÓ NÚT XÓA -> LOAD LẠI TRANG
        if (!deleteBtn) {
            console.log('⚠️ Bài viết này không có tùy chọn Xóa. Tiến hành load lại trang...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            return false;
        }

        await deleteBtn.click();
        console.log('👉 Đã chọn Xóa từ menu...');
        await sleep(1000);

        // XÁC NHẬN XÓA TẠI POPUP
        const confirmBtnSelector = '[data-testid="confirmationSheetConfirm"]';
        await page.waitForSelector(confirmBtnSelector, { visible: true, timeout: 3000 });
        const confirmBtn = await page.$(confirmBtnSelector);
        
        if (!confirmBtn) {
            throw new Error('Không tìm thấy nút xác nhận xóa trên Popup');
        }
        await confirmBtn.click();
        console.log('🎯 Đã bấm xác nhận! Xóa thành công 1 bài.');
        
        return true;
    } catch (error) {
        console.error('⚠️ Lỗi trong quá trình xóa bài:', error.message);
        console.log('🔄 Đang tải lại trang để xóa tiếp...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(2000);
        return false;
    }
}

// ===== RUN MAIN =====
(async () => {
    try {
        const { page } = await connectExisting();
        
        console.log('🌐 Đang di chuyển tới trang cá nhân...');
        await page.goto('https://x.com/xjaozhuang/all', { waitUntil: 'domcontentloaded' });
        await sleep(3000);

        while (true) {
            console.log('--- Bắt đầu lượt quét xóa bài ---');
            const result = await deletePost(page);
            
            // Nếu xóa thành công thì chờ 3s, nếu không xóa được thì chờ 2s rồi quét lại
            const waitTime = result ? 3000 : 2000;
            console.log(`⏳ Chờ ${waitTime / 1000} giây trước lượt tiếp theo...`);
            await sleep(waitTime);
        }

    } catch (err) {
        console.error('❌ LỖI HỆ THỐNG:', err.message);                      
    }
})();                                                                   