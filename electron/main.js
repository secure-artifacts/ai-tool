const electron = require('electron');
console.log('[DEBUG] electron module:', typeof electron, electron);
console.log('[DEBUG] app:', typeof electron.app, electron.app);

const { app, BrowserWindow, ipcMain, session, shell, Menu } = electron;
const path = require('path');
const fs = require('fs');

// 缓存目录 - 延迟初始化（在 app ready 后）
let userDataPath;
let cachePath;

// 创建应用菜单（macOS 必须有菜单才能使用 Cmd+C/V 等快捷键）
function createMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        // macOS 应用菜单
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        // 编辑菜单 - 复制/粘贴等功能
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                ...(isMac ? [
                    { role: 'pasteAndMatchStyle', label: '粘贴并匹配格式' },
                    { role: 'delete', label: '删除' },
                    { role: 'selectAll', label: '全选' },
                ] : [
                    { role: 'delete', label: '删除' },
                    { type: 'separator' },
                    { role: 'selectAll', label: '全选' }
                ])
            ]
        },
        // 视图菜单
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '重新加载' },
                { role: 'forceReload', label: '强制重新加载' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '重置缩放' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' }
            ]
        },
        // 窗口菜单
        {
            label: '窗口',
            submenu: [
                { role: 'minimize', label: '最小化' },
                { role: 'zoom', label: '缩放' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front', label: '前置所有窗口' },
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close', label: '关闭' }
                ])
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

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

    // 处理文件下载（确保 blob URL 下载有正确文件名 + 弹出保存对话框）
    mainWindow.webContents.session.on('will-download', (event, item) => {
        const suggestedName = item.getFilename();
        // 如果文件名看起来像 UUID（blob URL 默认），尝试使用 Content-Disposition 的文件名
        if (suggestedName && !suggestedName.match(/^[0-9a-f]{8}-/)) {
            // 文件名正常，让用户选保存位置
            item.setSaveDialogOptions({
                defaultPath: suggestedName,
            });
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    initCachePath(); // 初始化缓存目录
    createMenu();    // 创建应用菜单（编辑菜单用于复制/粘贴）
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
