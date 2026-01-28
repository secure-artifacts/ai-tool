const electron = require('electron');
console.log('[DEBUG] electron module:', typeof electron, electron);
console.log('[DEBUG] app:', typeof electron.app, electron.app);

const { app, BrowserWindow, ipcMain, session, shell } = electron;
const path = require('path');
const fs = require('fs');

// 缓存目录 - 延迟初始化（在 app ready 后）
let userDataPath;
let cachePath;

// 初始化缓存目录
function initCachePath() {
    userDataPath = app.getPath('userData');
    cachePath = path.join(userDataPath, 'sheetmind-cache');

    // 确保缓存目录存在
    if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
    }
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        show: true, // 立即显示窗口
        backgroundColor: '#1a1a2e', // 深色背景，加载时不刺眼
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            // 持久化 session，保持登录状态
            partition: 'persist:main'
        },
        // 使用默认标题栏，确保窗口可拖动
        title: 'AI 创作工具包 - 桌面版',
        icon: path.join(__dirname, 'icon.png')
    });

    // 开发模式加载本地服务器，生产模式启动本地HTTP服务
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        // 生产模式：启动本地 HTTP 服务器，使 Google OAuth 能够工作
        // Firebase 已将 localhost 添加到授权域名
        const http = require('http');
        const PORT = 51789; // 使用不常见的端口避免冲突
        const appDir = path.join(process.resourcesPath, 'app');

        // 创建简单的静态文件服务器
        const server = http.createServer((req, res) => {
            let filePath = path.join(appDir, req.url === '/' ? 'index.html' : req.url);

            // 处理 URL 中的查询参数
            if (filePath.includes('?')) {
                filePath = filePath.split('?')[0];
            }

            // 获取文件扩展名
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
                '.ico': 'image/x-icon'
            };

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    // 文件不存在时返回 index.html (SPA 路由)
                    fs.readFile(path.join(appDir, 'index.html'), (err2, data2) => {
                        if (err2) {
                            res.writeHead(404);
                            res.end('Not Found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(data2);
                        }
                    });
                } else {
                    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                    res.end(data);
                }
            });
        });

        server.listen(PORT, '127.0.0.1', () => {
            console.log(`[Electron] Local server running at http://localhost:${PORT}`);
            mainWindow.loadURL(`http://localhost:${PORT}`);
        });

        // 窗口关闭时关闭服务器
        mainWindow.on('closed', () => {
            server.close();
        });
    }

    // 🔗 使用 Chrome 打开外部链接
    const openInChrome = (url) => {
        const { exec } = require('child_process');
        if (process.platform === 'darwin') {
            // macOS: 用 Chrome 打开
            exec(`open -a "Google Chrome" "${url}"`, (err) => {
                if (err) {
                    // Chrome 不可用时，回退到默认浏览器
                    console.warn('[Electron] Chrome not found, using default browser');
                    shell.openExternal(url);
                }
            });
        } else if (process.platform === 'win32') {
            // Windows: 用 Chrome 打开
            exec(`start chrome "${url}"`, (err) => {
                if (err) shell.openExternal(url);
            });
        } else {
            // 其他系统：使用默认浏览器
            shell.openExternal(url);
        }
    };

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // 允许 Firebase/Google 认证弹窗在 Electron 中打开
        if (url.includes('accounts.google.com') ||
            url.includes('firebaseapp.com') ||
            url.includes('googleapis.com/identitytoolkit')) {
            return { action: 'allow' }; // 允许认证弹窗
        }

        // 其他链接用 Chrome 打开
        openInChrome(url);
        return { action: 'deny' };
    });

    // 拦截页面内的链接点击
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const appUrl = isDev ? 'http://localhost:3000' : 'file://';

        // 允许 Firebase/Google 认证页面导航
        if (url.includes('accounts.google.com') ||
            url.includes('firebaseapp.com') ||
            url.includes('googleapis.com')) {
            return; // 不拦截
        }

        // 如果不是应用内部链接，在 Chrome 中打开
        if (!url.startsWith(appUrl)) {
            event.preventDefault();
            openInChrome(url);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    initCachePath(); // 初始化缓存目录
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ==================== IPC 处理：打开外部链接 ====================

// 在 Chrome 中打开外部链接
const openInChromeGlobal = (url) => {
    const { exec } = require('child_process');
    if (process.platform === 'darwin') {
        exec(`open -a "Google Chrome" "${url}"`, (err) => {
            if (err) {
                console.warn('[Electron] Chrome not found, using default browser');
                shell.openExternal(url);
            }
        });
    } else if (process.platform === 'win32') {
        exec(`start chrome "${url}"`, (err) => {
            if (err) shell.openExternal(url);
        });
    } else {
        shell.openExternal(url);
    }
};

ipcMain.handle('shell:openExternal', async (event, { url }) => {
    try {
        openInChromeGlobal(url);
        return { success: true };
    } catch (error) {
        console.error('[Shell] Open external failed:', error);
        return { success: false, error: error.message };
    }
});

// ==================== IPC 处理：本地缓存 ====================

// 保存大数据到本地文件
ipcMain.handle('cache:save', async (event, { key, data }) => {
    try {
        const filePath = path.join(cachePath, `${key}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
        console.log(`[Cache] Saved: ${key} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)}MB)`);
        return { success: true };
    } catch (error) {
        console.error('[Cache] Save failed:', error);
        return { success: false, error: error.message };
    }
});

// 读取本地缓存
ipcMain.handle('cache:load', async (event, { key }) => {
    try {
        const filePath = path.join(cachePath, `${key}.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            console.log(`[Cache] Loaded: ${key}`);
            return { success: true, data };
        }
        return { success: false, error: 'Not found' };
    } catch (error) {
        console.error('[Cache] Load failed:', error);
        return { success: false, error: error.message };
    }
});

// 删除缓存
ipcMain.handle('cache:delete', async (event, { key }) => {
    try {
        const filePath = path.join(cachePath, `${key}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[Cache] Deleted: ${key}`);
        }
        return { success: true };
    } catch (error) {
        console.error('[Cache] Delete failed:', error);
        return { success: false, error: error.message };
    }
});

// 列出所有缓存
ipcMain.handle('cache:list', async () => {
    try {
        const files = fs.readdirSync(cachePath)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const filePath = path.join(cachePath, f);
                const stats = fs.statSync(filePath);
                return {
                    key: f.replace('.json', ''),
                    size: stats.size,
                    modifiedAt: stats.mtime.toISOString()
                };
            });
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取缓存目录大小
ipcMain.handle('cache:stats', async () => {
    try {
        let totalSize = 0;
        const files = fs.readdirSync(cachePath);
        for (const file of files) {
            const stats = fs.statSync(path.join(cachePath, file));
            totalSize += stats.size;
        }
        return {
            success: true,
            totalSize,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            path: cachePath
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== Opal 功能已移除 ====================
// Opal 批量生图功能仅在独立版本中可用
