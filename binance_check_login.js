const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { sendPhoto, sendMessage, sendMessageEndProcess } = require('./telegramBot');

const COOKIE_PATH = path.join(__dirname, "/cookies", 'binance.json');

async function loadCookies(page) {
    if (fs.existsSync(COOKIE_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
        await page.setCookie(...cookies);
        return true;
    } else {
        return false;
    }
}

async function saveCookies(page) {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies), 'utf-8');
    console.log('Cookies đã được lưu.');
}

async function checkLogin() {
    console.log('restart checklogin');
    const maxWaitTime = 60000;
    while (true) {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-first-run",
                "--no-zygote",
                "--start-maximized", // Mở trình duyệt ở chế độ toàn màn hình
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            ],
            defaultViewport: null,
        });

        const [page] = await browser.pages(); 

        try {
            // await page.goto('https://binance.com/');
            await loadCookies(page);
            await page.goto('https://www.binance.com/en/my/dashboard?type=checkLogin', { waitUntil: 'networkidle0', timeout: 120000 });

            if (page.url().includes('dashboard')) {
                console.log("[CHECKLOGIN] Đăng nhập thành công!");

                // Lưu lại cookies sau khi đăng nhập
                await saveCookies(page);
            } else {
                console.log('[CHECKLOGIN] chưa đăng nhập => chụp ảnh và gửi thông báo...');

                try {
                    // Click vào Accept Cookies & Continue nếu có
                    const acceptCookies = await page.$("button#onetrust-accept-btn-handler", { timeout: 5000 });
                    if (acceptCookies) {
                        await acceptCookies.click();
                        console.log('[CHECKLOGIN] Đã click vào Accept Cookies & Continue.');
                    } else {
                        console.log('[CHECKLOGIN] Không tìm thấy Accept Cookies & Continue.');
                    }
                    // Đợi phần tử qr-login-icon xuất hiện
                    await page.waitForSelector('div.qr-login-icon', { timeout: maxWaitTime, visible: true });
                    console.log('[CHECKLOGIN] Phát hiện icon QR đăng nhập.');
                    const qrLoginIcon = await page.$('div.qr-login-icon');
                    await qrLoginIcon.click();
                    console.log('[CHECKLOGIN] Đã click vào icon QR đăng nhập.');

                    await page.waitForSelector('.qrcode-login-popup div.bn-loading.bn-loading__secondary', { timeout: maxWaitTime});

                    console.log("[CHECKLOGIN] loading QR đang chạy...");

                    // Sử dụng waitForFunction để chờ cho phần tử biến mất
                    await page.waitForFunction(() => {
                      const element = document.querySelector('.qrcode-login-popup div.bn-loading.bn-loading__secondary');
                      return !element; // Chờ cho đến khi element là null hoặc undefined
                    }, { timeout: maxWaitTime });

                    console.log("[CHECKLOGIN] loading QR đã tắt");

                    // Scroll xuống để QR xuất hiện hoàn toàn
                    await page.evaluate(() => window.scrollTo(0, 100));

                    const screenshotPath = path.join(__dirname, 'screen_shot', 'login_screenshot.png');
                    await page.screenshot({ path: screenshotPath });
                    await sendPhoto(screenshotPath, '⚠️ Tài khoản Binance đã bị đăng xuất. Vui lòng đăng nhập lại.');
                    console.log('[CHECKLOGIN] Đã chụp ảnh và gửi thông báo.');

                    try {
                        try {
                            await page.waitForSelector('.content-layout .bn-checkbox.stay-signed-in-checkbox', { timeout: maxWaitTime });
                            const checkbox = await page.$('.content-layout .bn-checkbox.stay-signed-in-checkbox', { visible: true });
                            await sleep(1000);
                            await checkbox.click();
                            console.log('đã click vào checkbox');
    
                            const buttonYes = await page.$('.content-layout .bn-button.bn-button__primary');
                            await buttonYes.click();
                            console.log('đã click vào yes');
                        } catch (e) {
                            console.log('không xuất hiện box confirm');
                        }
 
                        await page.waitForSelector('.header-account-icon', { timeout: maxWaitTime });
                        console.log("[CHECKLOGIN] Đăng nhập thành công!");

                        // Lưu lại cookies sau khi đăng nhập
                        await saveCookies(page);
                        await sendMessage('Binance login thành công.');
                    } catch (err) {
                        console.log('detail: ', err);
                        console.log('[CHECKLOGIN] Đăng nhập thất bại trong vòng 1 phút');
                        await sendMessage('QR Binance đã hết hạn, vui lòng đợi lần tới.');
                    }
                } catch (qrErr) {
                    console.log('[CHECKLOGIN] error', qrErr);
                }
            }
        } catch (err) {
            console.error('Đã xảy ra lỗi:', err);
        } finally {
            await browser.close();
        }
        await sleep(120000);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    await checkLogin();
}

main().catch(console.error);
