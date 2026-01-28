/**
 * Opal 批量生图自动化模块
 * 使用 Puppeteer 控制 Chrome 实现 Opal 网页自动化
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// 输出目录
const BASE_OUTPUT_DIR = 'opal_results';

// 查找 Chrome 可执行文件路径
function findChrome() {
    const possiblePaths = {
        darwin: [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ],
        win32: [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
        ],
        linux: [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
        ]
    };

    const platform = process.platform;
    const paths = possiblePaths[platform] || [];

    for (const p of paths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    throw new Error('未找到 Chrome 浏览器，请安装 Chrome');
}

class OpalAutomation {
    constructor(profileName, userDataPath, options = {}) {
        this.profileName = profileName || 'default';
        this.userDataDir = path.join(userDataPath, 'opal-profiles', this.profileName);
        this.browser = null;
        this.page = null;
        this.onLog = options.onLog || console.log;
        this.onProgress = options.onProgress || (() => { });
        this.outputDir = options.outputDir || BASE_OUTPUT_DIR;
        this.stopRequested = false;

        // 确保目录存在
        if (!fs.existsSync(this.userDataDir)) {
            fs.mkdirSync(this.userDataDir, { recursive: true });
        }
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.onLog({ message: `[${timestamp}] ${message}`, level });
    }

    // 启动浏览器
    async launch(headless = false) {
        try {
            const chromePath = findChrome();
            this.log(`使用浏览器: ${chromePath}`);

            this.browser = await puppeteer.launch({
                headless: headless ? 'new' : false,
                executablePath: chromePath,
                userDataDir: this.userDataDir,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--start-maximized'
                ],
                defaultViewport: null
            });

            const pages = await this.browser.pages();
            this.page = pages[0] || await this.browser.newPage();

            // 隐藏自动化特征
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            this.log('浏览器启动成功', 'success');
            return true;
        } catch (error) {
            this.log(`浏览器启动失败: ${error.message}`, 'danger');
            throw error;
        }
    }

    // 关闭浏览器
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    // 打开 Opal 并检查登录状态
    async checkLogin(url = 'https://opal.google/') {
        try {
            this.log(`打开: ${url}`);
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(5000);

            const currentUrl = this.page.url();
            if (currentUrl.includes('accounts.google.com')) {
                this.log('检测到未登录，请先手动登录', 'warning');
                return false;
            }

            this.log('登录状态正常', 'success');
            return true;
        } catch (error) {
            this.log(`检查登录失败: ${error.message}`, 'danger');
            return false;
        }
    }

    // 智能点击 - 在页面和 iframe 中查找元素
    async smartClick(selectorId, textContent = null) {
        const selectors = [];
        if (selectorId) {
            selectors.push(`#${selectorId}`);
            selectors.push(`button[id='${selectorId}']`);
        }
        if (textContent) {
            selectors.push(`button:has-text("${textContent}")`);
            selectors.push(`span:has-text("${textContent}")`);
        }

        for (const selector of selectors) {
            try {
                // 先在主页面查找
                const element = await this.page.$(selector);
                if (element) {
                    const isVisible = await element.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });
                    if (isVisible) {
                        await element.click();
                        return true;
                    }
                }
            } catch (e) { /* 继续尝试 */ }

            // 在 iframe 中查找
            try {
                const frames = this.page.frames();
                for (const frame of frames) {
                    try {
                        const element = await frame.$(selector);
                        if (element) {
                            await element.click();
                            return true;
                        }
                    } catch (e) { /* 继续尝试 */ }
                }
            } catch (e) { /* 继续尝试 */ }
        }

        // 使用 XPath 查找包含文本的元素
        if (textContent) {
            try {
                const elements = await this.page.$x(`//*[contains(text(), '${textContent}')]`);
                for (const element of elements) {
                    const isVisible = await element.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });
                    if (isVisible) {
                        await element.click();
                        return true;
                    }
                }
            } catch (e) { /* 继续尝试 */ }
        }

        return false;
    }

    // 输入文本
    async inputText(text) {
        const selectors = [
            '#text-input',
            'textarea[placeholder*="Type or upload"]',
            'textarea[placeholder*="type"]',
            'textarea'
        ];

        for (let attempt = 0; attempt < 3; attempt++) {
            for (const selector of selectors) {
                try {
                    // 主页面
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        await element.evaluate(el => el.value = '');
                        await element.type(text);
                        return true;
                    }
                } catch (e) { /* 继续尝试 */ }

                // iframe
                try {
                    const frames = this.page.frames();
                    for (const frame of frames) {
                        try {
                            const element = await frame.$(selector);
                            if (element) {
                                await element.click();
                                await frame.evaluate((sel) => {
                                    const el = document.querySelector(sel);
                                    if (el) el.value = '';
                                }, selector);
                                await element.type(text);
                                return true;
                            }
                        } catch (e) { /* 继续尝试 */ }
                    }
                } catch (e) { /* 继续尝试 */ }
            }
            await this.page.waitForTimeout(1000);
        }

        this.log('警告: 未找到输入框', 'warning');
        return false;
    }

    // 上传图片
    async uploadImage(imagePath) {
        try {
            this.log(`准备上传图片: ${path.basename(imagePath)}`);

            // 1. 点击 + 号按钮
            const plusClicked = await this.smartClick('add-asset', 'Add Assets') ||
                await this.smartClick(null, 'add_circle');

            if (!plusClicked) {
                throw new Error('找不到 + 号按钮');
            }

            await this.page.waitForTimeout(1000);

            // 2. 设置文件选择器监听
            const [fileChooser] = await Promise.all([
                this.page.waitForFileChooser({ timeout: 5000 }),
                this.smartClick(null, 'Upload from Device') ||
                this.smartClick(null, 'Upload')
            ]);

            await fileChooser.accept([imagePath]);
            this.log('图片上传成功', 'success');
            return true;
        } catch (error) {
            this.log(`图片上传失败 (跳过): ${error.message}`, 'warning');
            return false;
        }
    }

    // 发送请求
    async sendRequest() {
        // 尝试点击 Submit 或 Continue 按钮
        let sent = await this.smartClick('continue', 'Submit');

        if (!sent) {
            // 尝试点击发送图标
            try {
                const sendIcons = await this.page.$$('button .g-icon');
                for (const icon of sendIcons) {
                    const text = await icon.evaluate(el => el.textContent);
                    if (text && text.includes('send')) {
                        await icon.click();
                        sent = true;
                        break;
                    }
                }
            } catch (e) { /* 继续尝试 */ }
        }

        if (!sent) {
            // 最后尝试按 Enter
            await this.page.keyboard.press('Enter');
        }

        return true;
    }

    // 提取生成的图片
    async extractImages() {
        const findImagesJS = `
      (() => {
        function traverse(root) {
          let collectedImages = [];
          if (!root) return collectedImages;
          try {
            const imgs = root.querySelectorAll('img');
            imgs.forEach(img => {
              if (img.src && (img.src.includes('blobs') || img.src.includes('opal') || img.src.includes('googleusercontent'))) {
                collectedImages.push(img.src);
              }
            });
          } catch (e) {}
          const allElements = root.querySelectorAll('*');
          allElements.forEach(el => {
            if (el.shadowRoot) collectedImages = collectedImages.concat(traverse(el.shadowRoot));
            if (el.tagName === 'IFRAME') {
              try {
                const iframeDoc = el.contentDocument || el.contentWindow.document;
                if (iframeDoc) collectedImages = collectedImages.concat(traverse(iframeDoc.body));
              } catch (err) {}
            }
          });
          return collectedImages;
        }
        const allUrls = traverse(document.body);
        return [...new Set(allUrls)];
      })()
    `;

        try {
            const urls = await this.page.evaluate(findImagesJS);
            return urls || [];
        } catch (error) {
            this.log(`提取图片失败: ${error.message}`, 'warning');
            return [];
        }
    }

    // 下载图片
    async downloadImages(urls, prefix = 'img') {
        const downloaded = [];

        for (const url of urls) {
            try {
                const filename = `${prefix}_${Date.now()}.png`;
                const filepath = path.join(this.outputDir, filename);

                await new Promise((resolve, reject) => {
                    const protocol = url.startsWith('https') ? https : http;
                    const file = fs.createWriteStream(filepath);

                    protocol.get(url, (response) => {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            downloaded.push(filepath);
                            resolve();
                        });
                    }).on('error', (err) => {
                        fs.unlink(filepath, () => { });
                        reject(err);
                    });
                });
            } catch (error) {
                this.log(`下载失败: ${error.message}`, 'warning');
            }
        }

        return downloaded;
    }

    // 执行单个任务
    async runTask(prompt, imagePath, waitMinutes = 3) {
        try {
            // 1. 点击 Start
            await this.page.waitForTimeout(1000);
            this.log('1. 点击 Start...');
            await this.smartClick('run', 'Start');
            await this.page.waitForTimeout(2000);

            // 2. 输入 Prompt
            const displayPrompt = prompt ? prompt.substring(0, 30) + '...' : '[空格]';
            this.log(`2. 输入文本: ${displayPrompt}`);
            await this.inputText(prompt || ' ');

            // 3. 上传图片 (可选)
            if (imagePath && fs.existsSync(imagePath)) {
                this.log(`3. 上传图片: ${path.basename(imagePath)}`);
                await this.page.waitForTimeout(1000);
                await this.uploadImage(imagePath);
            } else if (imagePath) {
                this.log(`3. 图片不存在 (跳过): ${imagePath}`, 'warning');
            } else {
                this.log('3. 无图片，跳过上传');
            }

            // 4. 发送
            await this.page.waitForTimeout(2000);
            this.log('4. 点击发送...');
            await this.sendRequest();

            // 5. 等待生成
            const waitSec = Math.round(waitMinutes * 60);
            this.log(`5. 生成中 (${waitSec}s)...`, 'warning');
            await this.page.waitForTimeout(waitSec * 1000);

            // 6. 下载图片
            this.log('6. 下载结果...');
            const imageUrls = await this.extractImages();

            if (imageUrls.length > 0) {
                const downloaded = await this.downloadImages(imageUrls, `${this.profileName}_task`);
                this.log(`成功下载 ${downloaded.length} 张图片`, 'success');
                return { success: true, images: downloaded };
            } else {
                this.log('未提取到图片', 'warning');
                return { success: true, images: [] };
            }
        } catch (error) {
            this.log(`任务失败: ${error.message}`, 'danger');
            return { success: false, error: error.message };
        }
    }

    // 停止任务
    stop() {
        this.stopRequested = true;
        this.log('正在停止...', 'warning');
    }

    // 批量执行任务
    async runBatch(tasks, waitMinutes = 3, opalUrl = 'https://opal.google/') {
        const results = [];
        this.stopRequested = false;

        // 先打开 Opal 页面
        await this.page.goto(opalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(5000);

        for (let i = 0; i < tasks.length; i++) {
            if (this.stopRequested) {
                this.log('任务已停止', 'warning');
                break;
            }

            const task = tasks[i];
            this.log(`--- 任务 ${i + 1}/${tasks.length} ---`, 'primary');
            this.onProgress({ current: i + 1, total: tasks.length, task });

            try {
                const result = await this.runTask(task.prompt, task.imagePath, waitMinutes);
                results.push({ ...result, task });

                // 刷新页面准备下一个任务
                if (i < tasks.length - 1 && !this.stopRequested) {
                    this.log('刷新页面...');
                    await this.page.reload({ waitUntil: 'domcontentloaded' });
                    await this.page.waitForTimeout(3000);
                }
            } catch (error) {
                this.log(`任务 ${i + 1} 严重错误: ${error.message}`, 'danger');
                results.push({ success: false, error: error.message, task });

                // 尝试刷新继续
                try {
                    await this.page.reload({ waitUntil: 'domcontentloaded' });
                    await this.page.waitForTimeout(5000);
                } catch (e) { /* 忽略 */ }
            }
        }

        this.log('所有任务完成', 'success');
        return results;
    }
}

module.exports = { OpalAutomation, findChrome };
