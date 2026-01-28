/**
 * 文案相似度检查 - Google Sheets 库管理服务
 * 
 * 支持四种认证模式：
 * 1. API Key（默认）- 只读公开表格
 * 2. 服务账号 - 可读写，需要分享给服务账号邮箱
 * 3. OAuth - 可读写私有表格，1小时过期
 * 4. GAS - 通过 Google Apps Script Web App 读写
 * 
 * 表格结构：
 * - 每个 Sheet 就是一个分类
 * - A列英文，B列中文
 */

import { getGoogleAccessToken, isGoogleTokenExpiringSoon } from '@/services/authService';

// ==================== 类型定义 ====================

export type AuthMode = 'apiKey' | 'serviceAccount' | 'oauth' | 'gas';

export interface SheetLibraryConfig {
    spreadsheetId: string;
    configSheetName: string;  // 默认"配置"
    authMode: AuthMode;
    gasWebAppUrl?: string;    // GAS Web App URL
}

export interface CategoryItem {
    id: string;
    text: string;           // 英文
    chineseText?: string;   // 中文
    category: string;       // 所属分类
    similarCount?: number;  // 该行有多少条相似文案（C列开始算）
    isPrimary?: boolean;    // 是否为 A 列主文案
}

// ==================== API 配置 ====================

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const API_KEY = 'AIzaSyBsSspB57hO83LQhAGZ_71cJeOouZzONsQ';  // 公用 API Key
const SERVICE_ACCOUNT_EMAIL = 'ai-257@ai-toolkit-b2b78.iam.gserviceaccount.com';

// 获取服务账号邮箱（供外部调用显示）
export function getServiceAccountEmail(): string {
    return SERVICE_ACCOUNT_EMAIL;
}

// ==================== 工具函数 ====================

/**
 * 从 Google Sheets URL 提取 spreadsheet ID
 */
export function extractSpreadsheetId(urlOrId: string): string | null {
    // 已经是 ID
    if (/^[a-zA-Z0-9_-]{30,}$/.test(urlOrId)) {
        return urlOrId;
    }

    // 从 URL 提取
    const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// ==================== 服务类 ====================

export class SheetLibraryService {
    private config: SheetLibraryConfig;
    private categories: string[] = [];
    private libraryCache: Map<string, CategoryItem[]> = new Map();

    constructor(spreadsheetId: string, authMode: AuthMode = 'apiKey', gasWebAppUrl?: string) {
        this.config = {
            spreadsheetId,
            configSheetName: '配置',
            authMode,
            gasWebAppUrl
        };
    }

    /**
     * 获取当前认证模式
     */
    getAuthMode(): AuthMode {
        return this.config.authMode;
    }

    /**
     * 设置认证模式
     */
    setAuthMode(mode: AuthMode): void {
        this.config.authMode = mode;
    }

    /**
     * 设置 GAS Web App URL
     */
    setGasWebAppUrl(url: string): void {
        this.config.gasWebAppUrl = url;
    }

    /**
     * 构建 API 请求 URL（带认证）
     */
    private buildUrl(endpoint: string): string {
        const url = `${SHEETS_API_BASE}/${this.config.spreadsheetId}${endpoint}`;

        // API Key 模式：URL 参数认证
        if (this.config.authMode === 'apiKey') {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}key=${API_KEY}`;
        }

        return url;
    }

    /**
     * 获取请求头（带认证）
     */
    private async getHeaders(): Promise<HeadersInit> {
        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        if (this.config.authMode === 'oauth') {
            const token = getGoogleAccessToken();
            if (!token) {
                throw new Error('请先登录 Google 账号');
            }
            if (isGoogleTokenExpiringSoon()) {
                throw new Error('Google 登录已过期，请重新登录');
            }
            headers['Authorization'] = `Bearer ${token}`;
        } else if (this.config.authMode === 'serviceAccount') {
            // 服务账号模式：通过 Cloud Function 获取 token
            const response = await fetch('https://us-central1-ai-toolkit-b2b78.cloudfunctions.net/getServiceAccountToken');
            if (!response.ok) {
                throw new Error('服务账号认证失败');
            }
            const { token } = await response.json();
            headers['Authorization'] = `Bearer ${token}`;
        }
        // API Key 和 GAS 模式不需要 Authorization header

        return headers;
    }

    /**
     * GAS 请求封装
     */
    private async gasRequest(action: string, data?: Record<string, unknown>): Promise<any> {
        if (!this.config.gasWebAppUrl) {
            throw new Error('请先配置 GAS Web App URL');
        }

        const url = this.config.gasWebAppUrl;

        if (data) {
            // POST 请求
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...data })
            });
            if (!response.ok) {
                throw new Error('GAS 请求失败');
            }
            return response.json();
        } else {
            // GET 请求
            const response = await fetch(`${url}?action=${action}`);
            if (!response.ok) {
                throw new Error('GAS 请求失败');
            }
            return response.json();
        }
    }

    /**
     * 检查是否可以写入（API Key 模式不支持写入，GAS 模式支持）
     */
    canWrite(): boolean {
        return this.config.authMode !== 'apiKey';
    }


    /**
     * 加载分类列表（每个 Sheet 就是一个分类）
     */
    async loadCategories(): Promise<string[]> {
        try {
            // GAS 模式
            if (this.config.authMode === 'gas') {
                const result = await this.gasRequest('list');
                if (!result.success) {
                    throw new Error(result.error || '加载分类失败');
                }
                this.categories = (result.data?.sheets || [])
                    .map((s: { name: string }) => s.name)
                    .filter((name: string) => name && !['配置', '设置', 'config', 'settings'].includes(name.toLowerCase()));
                return this.categories;
            }

            // 其他模式
            const url = this.buildUrl('?fields=sheets.properties.title');
            const headers = await this.getHeaders();

            const response = await fetch(url, { headers });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '加载分类失败');
            }

            const data = await response.json();
            const sheets = data.sheets || [];

            // 每个 Sheet 名就是分类（排除可能的配置类 Sheet）
            this.categories = sheets
                .map((s: any) => s.properties?.title)
                .filter((name: string) => name && !['配置', '设置', 'config', 'settings'].includes(name.toLowerCase()));

            return this.categories;
        } catch (e) {
            console.error('加载分类失败:', e);
            throw e;
        }
    }

    /**
     * 获取已加载的分类列表
     */
    getCategories(): string[] {
        return this.categories;
    }

    /**
     * 加载指定分类的文案
     */
    async loadCategory(category: string): Promise<CategoryItem[]> {
        try {
            // 读取整个 sheet（不限制列范围）
            const range = encodeURIComponent(category);
            const url = this.buildUrl(`/values/${range}`);
            const headers = await this.getHeaders();

            const response = await fetch(url, { headers });

            if (!response.ok) {
                // Sheet 可能不存在
                console.warn(`分类 "${category}" 的 Sheet 不存在或为空`);
                return [];
            }

            const data = await response.json();
            const values = data.values || [];

            const items: CategoryItem[] = [];

            values.slice(1).forEach((row: string[], rowIndex: number) => {
                // A 列主文案
                const mainText = row[0]?.trim() || '';
                const mainChinese = row[1]?.trim() || undefined;

                if (mainText) {
                    // 计算相似文案数量：从 C 列开始
                    let similarCount = 0;
                    for (let i = 2; i < row.length; i += 2) {
                        if (row[i]?.trim()) {
                            similarCount++;
                        }
                    }

                    // 添加主文案
                    items.push({
                        id: `${category}-${rowIndex}-0`,
                        text: mainText,
                        chineseText: mainChinese,
                        category,
                        similarCount,
                        isPrimary: true
                    });

                    // 添加该行的所有相似文案（C/D/E... 列）
                    for (let i = 2; i < row.length; i += 2) {
                        const similarText = row[i]?.trim() || '';
                        const similarChinese = row[i + 1]?.trim() || undefined;

                        if (similarText) {
                            items.push({
                                id: `${category}-${rowIndex}-${(i - 2) / 2 + 1}`,
                                text: similarText,
                                chineseText: similarChinese,
                                category,
                                similarCount: 0,  // 相似文案本身不再有附属相似
                                isPrimary: false
                            });
                        }
                    }
                }
            });

            this.libraryCache.set(category, items);
            return items;
        } catch (e) {
            console.error(`加载分类 "${category}" 失败:`, e);
            return [];
        }
    }

    /**
     * 加载全部分类（用于全库查重）
     */
    async loadAllCategories(): Promise<CategoryItem[]> {
        if (this.categories.length === 0) {
            await this.loadCategories();
        }

        const allItems: CategoryItem[] = [];

        for (const category of this.categories) {
            const items = await this.loadCategory(category);
            allItems.push(...items);
        }

        return allItems;
    }

    /**
     * 获取缓存的全部文案
     */
    getAllCachedItems(): CategoryItem[] {
        const allItems: CategoryItem[] = [];
        this.libraryCache.forEach(items => allItems.push(...items));
        return allItems;
    }

    /**
     * 添加文案到指定分类
     */
    async addToCategory(category: string, items: Array<{ text: string; chineseText?: string }>): Promise<boolean> {
        if (!this.canWrite()) {
            throw new Error('API Key 模式不支持写入，请切换到服务账号或 OAuth 模式');
        }
        try {
            const headers = await this.getHeaders();

            // 先检查是否有表头
            const checkRange = encodeURIComponent(`${category}!A1:B1`);
            const checkUrl = this.buildUrl(`/values/${checkRange}`);
            const checkResponse = await fetch(checkUrl, { headers });

            let needsHeader = true;
            if (checkResponse.ok) {
                const checkData = await checkResponse.json();
                // 如果第一行有数据且看起来像表头
                if (checkData.values && checkData.values.length > 0) {
                    const firstRow = checkData.values[0];
                    // 检查是否已经是表头
                    if (firstRow[0] === '英文' || firstRow[0] === '外文' || firstRow[0] === 'English') {
                        needsHeader = false;
                    } else if (firstRow[0] && firstRow[0].length > 50) {
                        // 第一行是很长的文本，可能是数据，需要添加表头
                        needsHeader = true;
                    } else {
                        needsHeader = false; // 有内容就假设有表头
                    }
                }
            }

            // 如果需要表头，先添加表头
            if (needsHeader) {
                const headerRange = encodeURIComponent(`${category}!A1:B1`);
                const headerUrl = this.buildUrl(`/values/${headerRange}?valueInputOption=USER_ENTERED`);
                await fetch(headerUrl, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ values: [['英文', '中文']] })
                });
            }

            // 追加数据
            const range = encodeURIComponent(`${category}!A:B`);
            const url = this.buildUrl(`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`);

            const values = items.map(item => [item.text, item.chineseText || '']);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ values })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '添加失败');
            }

            // 更新缓存
            const cached = this.libraryCache.get(category) || [];
            const newItems: CategoryItem[] = items.map((item, i) => ({
                id: `${category}-new-${Date.now()}-${i}`,
                text: item.text,
                chineseText: item.chineseText,
                category,
                isPrimary: true
            }));
            this.libraryCache.set(category, [...cached, ...newItems]);

            return true;
        } catch (e) {
            console.error('添加文案失败:', e);
            throw e;
        }
    }

    /**
     * 添加多列行数据到指定分类
     * 格式: [保留英文, 保留中文, 相似1英文, 相似1中文, ...]
     */
    async addToCategoryRows(category: string, rows: string[][]): Promise<boolean> {
        if (!this.canWrite()) {
            throw new Error('API Key 模式不支持写入，请切换到服务账号或 OAuth 模式');
        }
        try {
            const headers = await this.getHeaders();

            // 先检查是否有表头
            const checkRange = encodeURIComponent(`${category}!A1:B1`);
            const checkUrl = this.buildUrl(`/values/${checkRange}`);
            const checkResponse = await fetch(checkUrl, { headers });

            let needsHeader = true;
            if (checkResponse.ok) {
                const checkData = await checkResponse.json();
                if (checkData.values && checkData.values.length > 0) {
                    const firstRow = checkData.values[0];
                    if (firstRow[0] === '保留英文' || firstRow[0] === '英文' || firstRow[0] === '外文') {
                        needsHeader = false;
                    } else if (firstRow[0] && firstRow[0].length > 50) {
                        needsHeader = true;
                    } else {
                        needsHeader = false;
                    }
                }
            }

            // 如果需要表头，先添加表头
            if (needsHeader) {
                // 计算最大列数
                const maxCols = Math.max(...rows.map(r => r.length));
                const headerRow: string[] = ['保留英文', '保留中文'];
                for (let i = 1; i <= (maxCols - 2) / 2; i++) {
                    headerRow.push(`相似${i}英文`, `相似${i}中文`);
                }
                const headerRange = encodeURIComponent(`${category}!A1`);
                const headerUrl = this.buildUrl(`/values/${headerRange}?valueInputOption=USER_ENTERED`);
                await fetch(headerUrl, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ values: [headerRow] })
                });
            }

            // 追加数据
            const range = encodeURIComponent(`${category}!A:Z`);
            const url = this.buildUrl(`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ values: rows })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '添加失败');
            }

            // 更新缓存（只缓存 A、B 列）
            const cached = this.libraryCache.get(category) || [];
            const newItems: CategoryItem[] = rows.map((row, i) => ({
                id: `${category}-new-${Date.now()}-${i}`,
                text: row[0] || '',
                chineseText: row[1],
                category,
                isPrimary: true
            }));
            this.libraryCache.set(category, [...cached, ...newItems]);

            return true;
        } catch (e) {
            console.error('添加文案失败:', e);
            throw e;
        }
    }

    /**
     * 获取表格元数据（检查连接）
     */
    async checkConnection(): Promise<{ title: string; sheets: string[] }> {
        try {
            // GAS 模式
            if (this.config.authMode === 'gas') {
                const result = await this.gasRequest('info');
                if (!result.success) {
                    throw new Error(result.error || '连接失败');
                }
                return {
                    title: result.data?.name || 'GAS 连接',
                    sheets: result.data?.sheets || []
                };
            }

            // 其他模式
            const url = this.buildUrl('?fields=properties.title,sheets.properties.title');
            const headers = await this.getHeaders();

            const response = await fetch(url, { headers });

            if (!response.ok) {
                const error = await response.json();
                const errorMsg = error.error?.message || '';

                // Token 过期或无效
                if (response.status === 401 || errorMsg.includes('invalid') || errorMsg.includes('expired')) {
                    throw new Error('OAuth Token 已过期，请重新登录授权');
                }
                // 权限不足
                if (response.status === 403) {
                    throw new Error('没有访问权限，请检查表格共享设置');
                }
                throw new Error(errorMsg || '连接失败');
            }

            const data = await response.json();

            return {
                title: data.properties?.title || '未命名表格',
                sheets: data.sheets?.map((s: any) => s.properties?.title) || []
            };
        } catch (e) {
            console.error('检查连接失败:', e);
            throw e;
        }
    }

    /**
     * 创建新分类（新增一个 Sheet）
     */
    async createCategory(categoryName: string): Promise<boolean> {
        if (!this.canWrite()) {
            throw new Error('API Key 模式不支持写入，请切换到服务账号或 OAuth 模式');
        }
        try {
            const url = this.buildUrl(':batchUpdate');
            const headers = await this.getHeaders();

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    requests: [{
                        addSheet: {
                            properties: {
                                title: categoryName
                            }
                        }
                    }]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '创建分类失败');
            }

            // 自动添加表头
            try {
                const headerUrl = this.buildUrl(`/values/${encodeURIComponent(categoryName)}!A1:B1?valueInputOption=RAW`);
                await fetch(headerUrl, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({
                        values: [['英文', '中文']]
                    })
                });
            } catch (headerError) {
                console.warn('添加表头失败，但分类已创建:', headerError);
            }

            // 更新本地缓存
            this.categories.push(categoryName);
            this.libraryCache.set(categoryName, []);

            return true;
        } catch (e) {
            console.error('创建分类失败:', e);
            throw e;
        }
    }

    /**
     * 重命名分类（重命名 Sheet）
     */
    async renameCategory(oldName: string, newName: string): Promise<boolean> {
        if (!this.canWrite()) {
            throw new Error('API Key 模式不支持写入，请切换到服务账号或 OAuth 模式');
        }
        try {
            const headers = await this.getHeaders();

            // 首先获取 Sheet ID
            const metaUrl = this.buildUrl('?fields=sheets.properties');
            const metaResponse = await fetch(metaUrl, { headers });

            if (!metaResponse.ok) {
                throw new Error('获取表格信息失败');
            }

            const metaData = await metaResponse.json();
            const sheet = metaData.sheets?.find((s: any) => s.properties?.title === oldName);

            if (!sheet) {
                throw new Error(`分类 "${oldName}" 不存在`);
            }

            const sheetId = sheet.properties.sheetId;

            // 执行重命名
            const url = this.buildUrl(':batchUpdate');
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    requests: [{
                        updateSheetProperties: {
                            properties: {
                                sheetId: sheetId,
                                title: newName
                            },
                            fields: 'title'
                        }
                    }]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '重命名失败');
            }

            // 更新本地缓存
            const idx = this.categories.indexOf(oldName);
            if (idx !== -1) {
                this.categories[idx] = newName;
            }

            // 更新库缓存的key
            const oldItems = this.libraryCache.get(oldName);
            if (oldItems) {
                this.libraryCache.delete(oldName);
                this.libraryCache.set(newName, oldItems.map(item => ({ ...item, category: newName })));
            }

            return true;
        } catch (e) {
            console.error('重命名分类失败:', e);
            throw e;
        }
    }

    /**
     * 删除分类（删除 Sheet）
     */
    async deleteCategory(categoryName: string): Promise<boolean> {
        if (!this.canWrite()) {
            throw new Error('API Key 模式不支持写入，请切换到服务账号或 OAuth 模式');
        }
        try {
            const headers = await this.getHeaders();

            // 首先获取 Sheet ID
            const metaUrl = this.buildUrl('?fields=sheets.properties');
            const metaResponse = await fetch(metaUrl, { headers });

            if (!metaResponse.ok) {
                throw new Error('获取表格信息失败');
            }

            const metaData = await metaResponse.json();
            const sheet = metaData.sheets?.find((s: any) => s.properties?.title === categoryName);

            if (!sheet) {
                throw new Error(`分类 "${categoryName}" 不存在`);
            }

            const sheetId = sheet.properties.sheetId;

            // 执行删除
            const url = this.buildUrl(':batchUpdate');
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    requests: [{
                        deleteSheet: {
                            sheetId: sheetId
                        }
                    }]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '删除失败');
            }

            // 更新本地缓存
            this.categories = this.categories.filter(c => c !== categoryName);
            this.libraryCache.delete(categoryName);

            return true;
        } catch (e) {
            console.error('删除分类失败:', e);
            throw e;
        }
    }
}

// ==================== 单例 ====================

let serviceInstance: SheetLibraryService | null = null;

export function getSheetLibraryService(spreadsheetId?: string, authMode?: AuthMode): SheetLibraryService | null {
    if (spreadsheetId) {
        serviceInstance = new SheetLibraryService(spreadsheetId, authMode);
    }
    return serviceInstance;
}

export function setSheetLibraryService(service: SheetLibraryService | null): void {
    serviceInstance = service;
}

export function clearSheetLibraryService(): void {
    serviceInstance = null;
}
