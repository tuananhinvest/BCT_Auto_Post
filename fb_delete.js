//"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
//--remote-debugging-port=9222 ^
//--user-data-dir="C:\chrome-debug\fb-profile"

const puppeteer = require('puppeteer-core');
const { errorSendMessenger } = require('./errorTelegramBot');
require('dotenv').config();

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ===== KẾT NỐI CHROME =====
async function connectFacebook() {
    try {
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        console.log('✅ Connected Chrome');

        const pages = await browser.pages();
        const lastPage = pages[pages.length - 1];

        // Đóng các tab thừa để giải phóng RAM (trừ các tab hệ thống)
        for (const p of pages) {
            const url = p.url();
            if (
                url.startsWith('chrome://') ||
                url.startsWith('devtools://') ||
                url.startsWith('chrome-extension://')
            ) {
                continue;
            }

            if (p !== lastPage) {
                console.log('👉 Closing extra tab:', url);
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

// ===== KIỂM TRA LOGIN =====
async function checkLoginFacebook(page) {
    await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2' });
    await sleep(3000);

    const isLoginButton = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('span'));
        return btns.some(el => el.innerText.trim() === 'Đăng nhập');
    });

    return !isLoginButton;
}

// ===== XỬ LÝ DIALOG NẾU CÓ =====
async function handleReloadDialog(page) {
    page.on('dialog', async dialog => {
        const msg = dialog.message();
        if (msg.includes('Tải lại') || msg.includes('reload')) {
            await dialog.accept();
        } else {
            await dialog.dismiss();
        }
    });
}

// ===== FLOW XÓA MỘT BÀI VIẾT (ĐÃ TỐI ƯU) =====
async function deleteOnePost(page) {
    try {
        // 1. Tìm nút 3 chấm ĐANG HIỂN THỊ trên màn hình
        const moreBtn = await page.evaluateHandle(() => {
            // Lấy tất cả các nút có aria-label bắt đầu bằng "Lựa chọn khác"
            const candidates = Array.from(document.querySelectorAll('div[role="button"][aria-label*="Lựa chọn khác"]'));
            
            // Tìm nút đầu tiên đang hiển thị thực tế (không bị ẩn)
            return candidates.find(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
            });
        });

        const btnElement = moreBtn.asElement();
        if (!btnElement) {
            console.log('ℹ️ Không thấy nút 3 chấm hiển thị -> Cần cuộn trang để load thêm bài...');
            return false;
        }

        // Scroll phần tử vào tầm nhìn & click
        await btnElement.evaluate(b => b.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await sleep(800);
        await btnElement.click();
        console.log('👉 Đã click nút 3 chấm');
        await sleep(2000);

        // 2. Tìm nút "Xóa" trong Menu vừa mở
        const deleteOption = await page.evaluateHandle(() => {
            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"], span'));
            return menuItems.find(item => {
                const text = item.innerText ? item.innerText.trim() : '';
                return text === 'Xóa' || text === 'Move to trash' || text === 'Chuyển vào thùng rác';
            });
        });

        const deleteElement = deleteOption.asElement();
        if (!deleteElement) {
            console.log('⚠️ Không thấy nút Xóa trong menu -> Bấm ESC đóng menu');
            await page.keyboard.press('Escape');
            await sleep(1000);
            return false;
        }

        await deleteElement.click();
        console.log('🗑️ Đã click nút Xóa');
        await sleep(2500);

        // 3. Xử lý Popup xác nhận "Xóa" (nếu có)
        const confirmBtn = await page.evaluateHandle(() => {
            const btns = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button'));
            return btns.find(b => {
                const text = b.innerText ? b.innerText.trim() : '';
                return text === 'Xóa' || text === 'Xác nhận' || text === 'Remove';
            });
        });

        const confirmElement = confirmBtn.asElement();
        if (confirmElement) {
            await confirmElement.click();
            console.log('✅ Đã xác nhận trên Popup');
            await sleep(3500);
        } else {
            console.log('✅ Xóa hoàn tất');
            await sleep(2000);
        }

        return true;

    } catch (err) {
        console.error('❌ Lỗi thao tác:', err.message);
        await page.keyboard.press('Escape').catch(() => {});
        return false;
    }
}

// ===== MAIN AUTOMATION FLOW =====
async function runDeleteProcess() {
    const { page } = await connectFacebook();
    await handleReloadDialog(page);

    console.log('🚀 Đang kiểm tra đăng nhập Facebook...');
    const isLogged = await checkLoginFacebook(page);

    if (!isLogged) {
        console.log('❌ FB chưa login → Vui lòng đăng nhập Chrome trước!');
        return;
    }

    const activityUrl = 'https://www.facebook.com/100007045638364/allactivity?activity_history=false&category_key=GROUPPOSTS&manage_mode=false&should_load_landing_page=false';
    console.log('📌 Đang truy cập trang Lịch sử hoạt động Group...');
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded' });
    await sleep(5000);

    let deletedCount = 0;
    let failCount = 0;

    while (true) {
        console.log(`\n------------------------------`);
        console.log(`🔄 Đang tìm bài số ${deletedCount + 1} để xóa...`);

        const success = await deleteOnePost(page);

        if (success) {
            deletedCount++;
            failCount = 0;
            console.log(`🎉 Đã xóa tổng cộng: ${deletedCount} bài`);
        } else {
            failCount++;
            console.log(`⏬ Cuộn trang xuống để load thêm dữ liệu... (Lần ${failCount})`);
            
            // Cuộn xuống dưới để Facebook load thêm bài cũ
            await page.evaluate(() => window.scrollBy(0, 800));
            await sleep(3000);

            // Nếu cuộn 4 lần liên tiếp vẫn không tìm thấy nút 3 chấm -> Refresh lại trang
            if (failCount >= 4) {
                console.log('🔄 Đang Refresh lại trang để cập nhật danh sách mới...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await sleep(5000);
                failCount = 0;
            }
        }
    }
}

// ===== CHẠY SCRIPT =====
(async () => {
    try {
        await runDeleteProcess();
    } catch (err) {
        console.error('❌ FATAL ERROR:', err.message);
        if (typeof errorSendMessenger === 'function') {
            await errorSendMessenger('BCT Facebook Auto Delete gặp lỗi fatal');
        }
    }
})();