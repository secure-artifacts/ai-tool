/**
 * API Key Management Service
 * 管理用户的API密钥 - 优先使用 Firebase，回退到 Google Sheets
 */

import { auth } from '@/firebase/index';
import { loadUserApiPool, saveUserApiPool, UserApiKeyEntry } from './userApiPoolService';

export interface ApiKeyRow {
    user: string;
    apiKey: string;
    status: string;
    nickname: string;
}

// 检查用户是否已登录 Firebase
export const getFirebaseUserId = (): string | null => {
    return auth.currentUser?.uid || null;
};

const DEFAULT_SHEET_ID = '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0';
const DEFAULT_SHEET_NAME = 'ApiKeys';
const SUBMIT_URL = 'https://script.google.com/macros/s/AKfycbw9isNUlIuSST9DxOV-d8hfpfp85_fMJnRLJJRBcNPVMvw5ut83ShNGS-S8Fht99nKvsg/exec';

const getSafeString = (value: any): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const isLikelyHeaderValue = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'apikey' || normalized === 'api key' || normalized === 'key';
};

/**
 * 解析CSV行，处理引号包裹的字段
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // 转义的引号
                current += '"';
                i++;
            } else {
                // 切换引号状态
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // 字段分隔符
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    // 添加最后一个字段
    result.push(current);

    return result;
}

/**
 * 从用户存储读取API密钥列表
 * 优先使用 Firebase，回退到 Google Sheets
 */
export async function fetchUserApiKeys(userName: string): Promise<ApiKeyRow[]> {
    const normalizedUser = getSafeString(userName).toLowerCase();
    if (!normalizedUser) return [];

    // 优先检查 Firebase
    const firebaseUserId = getFirebaseUserId();
    if (firebaseUserId) {
        try {
            console.log('[ApiKeyService] 尝试从 Firebase 读取...');
            const firebaseKeys = await loadUserApiPool(firebaseUserId);
            if (firebaseKeys.length > 0) {
                console.log('[ApiKeyService] 从 Firebase 读取到', firebaseKeys.length, '个密钥');
                return firebaseKeys.map(k => ({
                    user: normalizedUser,
                    apiKey: k.apiKey,
                    status: k.status || 'active',
                    nickname: k.nickname || ''
                }));
            } else {
                // Firebase 没有数据，尝试从 Google Sheets 迁移
                console.log('[ApiKeyService] Firebase 无数据，检查 Google Sheets 是否有数据需要迁移...');
            }
        } catch (firebaseError) {
            console.warn('[ApiKeyService] Firebase 读取失败，回退到 Google Sheets:', firebaseError);
        }
    }

    // 回退到 Google Sheets
    const csvUrl = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DEFAULT_SHEET_NAME)}&_=${Date.now()}`;

    try {
        console.log('[ApiKeyService] 使用CSV方式读取 Google Sheets');
        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`读取API密钥失败: ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log('[ApiKeyService] CSV前200字符:', csvText.substring(0, 200));

        // 解析CSV
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length <= 1) {
            console.warn('[ApiKeyService] CSV只有表头或为空');
            return [];
        }

        // 跳过表头，解析数据行
        const rows: ApiKeyRow[] = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            // 简单的CSV解析（处理带引号的字段）
            const fields = parseCSVLine(line);

            console.log(`[ApiKeyService] 第${i}行解析:`, fields);

            if (fields.length >= 2) {
                const user = getSafeString(fields[0]).toLowerCase();
                let apiKey = getSafeString(fields[1]);

                // 去掉自动添加的单引号前缀（如果存在）
                if (apiKey.startsWith("'")) {
                    apiKey = apiKey.substring(1);
                }

                const status = getSafeString(fields[2]) || 'active';
                const nickname = getSafeString(fields[3]);

                console.log(`[ApiKeyService] 用户: "${user}", 密钥: "${apiKey}", 状态: "${status}"`);

                // 只返回匹配当前用户的密钥
                if (user === normalizedUser && apiKey && !isLikelyHeaderValue(apiKey)) {
                    rows.push({
                        user: fields[0],
                        apiKey,
                        status,
                        nickname
                    });
                }
            }
        }

        console.log('[ApiKeyService] 最终解析的密钥数量:', rows.length);

        // 自动迁移到 Firebase（如果用户已登录且 Firebase 无数据）
        if (rows.length > 0 && firebaseUserId) {
            try {
                console.log('[ApiKeyService] 🔄 自动迁移 Google Sheets 数据到 Firebase...');
                const keysToMigrate: UserApiKeyEntry[] = rows.map(r => ({
                    apiKey: r.apiKey,
                    nickname: r.nickname,
                    status: (r.status as 'active' | 'disabled' | 'quota_exceeded') || 'active'
                }));
                await saveUserApiPool(firebaseUserId, keysToMigrate);
                console.log('[ApiKeyService] ✅ 自动迁移完成！已将', rows.length, '个密钥迁移到 Firebase');
            } catch (migrateError) {
                console.warn('[ApiKeyService] 自动迁移失败:', migrateError);
            }
        }

        const unique = new Map<string, ApiKeyRow>();
        for (const row of rows) {
            if (!unique.has(row.apiKey)) {
                unique.set(row.apiKey, row);
            }
        }
        return Array.from(unique.values());
    } catch (error) {
        console.error('[ApiKeyService] 读取API密钥失败:', error);
        return [];
    }
}

/**
 * 读取共享 API 密钥列表（不过滤用户）
 */
export async function fetchSharedApiKeys(): Promise<ApiKeyRow[]> {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DEFAULT_SHEET_NAME)}&_=${Date.now()}`;

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`读取API密钥失败: ${response.statusText}`);
        }

        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length <= 1) {
            return [];
        }

        const rows: ApiKeyRow[] = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const fields = parseCSVLine(line);

            if (fields.length >= 2) {
                const user = getSafeString(fields[0]).toLowerCase();
                let apiKey = getSafeString(fields[1]);
                if (apiKey.startsWith("'")) {
                    apiKey = apiKey.substring(1);
                }
                const status = (getSafeString(fields[2]) || 'active').toLowerCase();
                const nickname = getSafeString(fields[3]);

                if (apiKey && status !== 'disabled' && !isLikelyHeaderValue(apiKey)) {
                    rows.push({
                        user,
                        apiKey,
                        status,
                        nickname
                    });
                }
            }
        }

        const unique = new Map<string, ApiKeyRow>();
        for (const row of rows) {
            if (!unique.has(row.apiKey)) {
                unique.set(row.apiKey, row);
            }
        }
        return Array.from(unique.values());
    } catch (error) {
        console.error('[ApiKeyService] 读取共享API密钥失败:', error);
        return [];
    }
}

/**
 * 保存API密钥
 * 优先保存到 Firebase，成功后后台异步同步到 Google Sheets
 */
export async function saveApiKeys(userName: string, apiKeys: Omit<ApiKeyRow, 'user'>[]): Promise<void> {
    const normalizedUser = getSafeString(userName).toLowerCase();
    if (!normalizedUser) {
        throw new Error('未提供有效的用户名');
    }
    // Note: Empty apiKeys array is allowed - means deleting all keys

    // 后台同步到 Google Sheets 的函数（不阻塞）
    const syncToGoogleSheets = () => {
        const payload = {
            action: 'saveApiKeys',
            sheetId: DEFAULT_SHEET_ID,
            sheetName: DEFAULT_SHEET_NAME,
            ensureHeaderRow: true,
            replaceUserRows: true,  // 替换该用户的所有行，而不是追加
            rows: apiKeys.map((key) => ({
                user: normalizedUser,
                apiKey: `'${key.apiKey}`,
                status: key.status || 'active',
                nickname: key.nickname || ''
            }))
        };

        // 使用 setTimeout 确保不阻塞
        setTimeout(async () => {
            try {
                // 发送同步开始事件
                window.dispatchEvent(new CustomEvent('sheetSyncStatus', { detail: 'syncing' }));
                console.log('[ApiKeyService] 🔄 后台同步到 Google Sheets...');

                await fetch(SUBMIT_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                console.log('[ApiKeyService] ✅ 后台同步到 Google Sheets 完成');
                // 发送同步完成事件
                window.dispatchEvent(new CustomEvent('sheetSyncStatus', { detail: 'done' }));

                // 3秒后重置状态
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('sheetSyncStatus', { detail: 'idle' }));
                }, 3000);
            } catch (error) {
                console.warn('[ApiKeyService] ⚠️ 后台同步到 Google Sheets 失败:', error);
                window.dispatchEvent(new CustomEvent('sheetSyncStatus', { detail: 'error' }));
            }
        }, 100);
    };

    // 优先保存到 Firebase
    const firebaseUserId = getFirebaseUserId();

    if (firebaseUserId) {
        try {
            console.log('[ApiKeyService] 保存到 Firebase...');
            const firebaseKeys: UserApiKeyEntry[] = apiKeys.map(k => ({
                apiKey: k.apiKey,
                nickname: k.nickname,
                status: (k.status as 'active' | 'disabled' | 'quota_exceeded') || 'active'
            }));
            await saveUserApiPool(firebaseUserId, firebaseKeys);
            console.log('[ApiKeyService] ✅ 已保存到 Firebase');

            // 后台异步同步到 Google Sheets（不阻塞用户操作）
            syncToGoogleSheets();
            return;
        } catch (firebaseError) {
            console.warn('[ApiKeyService] Firebase 保存失败，回退到 Google Sheets:', firebaseError);
        }
    }

    // 仅在 Firebase 失败或未登录时，才同步保存到 Google Sheets
    console.log('[saveApiKeys] 保存到 Google Sheets，用户:', normalizedUser, '密钥数量:', apiKeys.length);

    try {
        const payload = {
            action: 'saveApiKeys',
            sheetId: DEFAULT_SHEET_ID,
            sheetName: DEFAULT_SHEET_NAME,
            ensureHeaderRow: true,
            replaceUserRows: true,  // 替换该用户的所有行
            rows: apiKeys.map((key) => ({
                user: normalizedUser,
                apiKey: `'${key.apiKey}`,
                status: key.status || 'active',
                nickname: key.nickname || ''
            }))
        };

        await fetch(SUBMIT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('[saveApiKeys] ✅ 请求已发送到 Google Sheets');

    } catch (error) {
        console.error('[saveApiKeys] 保存API密钥失败:', error);
        throw error instanceof Error ? error : new Error('保存失败，请稍后重试');
    }
}

/**
 * 添加单个API密钥
 */
export async function addApiKey(
    userName: string,
    apiKey: string,
    nickname: string = '',
    status: string = 'active'
): Promise<void> {
    // 先读取现有密钥
    const existingKeys = await fetchUserApiKeys(userName);

    // 检查是否已存在
    if (existingKeys.some(k => k.apiKey === apiKey)) {
        throw new Error('该API密钥已存在');
    }

    // 添加新密钥
    const allKeys = [
        ...existingKeys.map(k => ({ apiKey: k.apiKey, status: k.status, nickname: k.nickname })),
        { apiKey, status, nickname }
    ];

    await saveApiKeys(userName, allKeys);
}

/**
 * 更新API密钥
 */
export async function updateApiKey(
    userName: string,
    oldApiKey: string,
    newData: { apiKey?: string; nickname?: string; status?: string }
): Promise<void> {
    const existingKeys = await fetchUserApiKeys(userName);

    const updatedKeys = existingKeys.map(k => {
        if (k.apiKey === oldApiKey) {
            return {
                apiKey: newData.apiKey || k.apiKey,
                status: newData.status || k.status,
                nickname: newData.nickname !== undefined ? newData.nickname : k.nickname
            };
        }
        return { apiKey: k.apiKey, status: k.status, nickname: k.nickname };
    });

    await saveApiKeys(userName, updatedKeys);
}

/**
 * 删除API密钥
 */
export async function deleteApiKey(userName: string, apiKey: string): Promise<void> {
    const existingKeys = await fetchUserApiKeys(userName);

    const filteredKeys = existingKeys
        .filter(k => k.apiKey !== apiKey)
        .map(k => ({ apiKey: k.apiKey, status: k.status, nickname: k.nickname }));

    if (filteredKeys.length === existingKeys.length) {
        throw new Error('未找到要删除的API密钥');
    }

    // 如果删除后没有密钥了，直接清空 Firebase
    if (filteredKeys.length === 0) {
        const firebaseUserId = getFirebaseUserId();
        if (firebaseUserId) {
            await saveUserApiPool(firebaseUserId, []);
            console.log('[ApiKeyService] ✅ 已清空所有 API 密钥');
            return;
        }
    }

    await saveApiKeys(userName, filteredKeys);
}
