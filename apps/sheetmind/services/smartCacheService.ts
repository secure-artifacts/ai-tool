/**
 * 智能缓存服务
 * - 在 Electron 环境中使用本地文件系统（支持 GB 级数据）
 * - 在网页环境中使用 localStorage（有大小限制）
 */

// 检测是否在 Electron 环境中
export const isElectron = (): boolean => {
    return !!(window.electronCache?.isElectron);
};

// 获取环境信息
export const getEnvInfo = (): { isElectron: boolean; platform?: string } => {
    if (isElectron()) {
        return {
            isElectron: true,
            platform: window.electronInfo?.platform
        };
    }
    return { isElectron: false };
};

// 生成缓存键（基于数据源 URL 的哈希）
export const getCacheKey = (url: string): string => {
    // 简单哈希函数
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `sheetmind_data_${Math.abs(hash)}`;
};

const WEB_DB_NAME = 'sheetmind_cache';
const WEB_DB_VERSION = 1;
const WEB_STORE_NAME = 'workbooks';

const openWebCacheDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(WEB_DB_NAME, WEB_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(WEB_STORE_NAME)) {
                db.createObjectStore(WEB_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const webCacheSet = async (key: string, value: unknown): Promise<void> => {
    const db = await openWebCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(WEB_STORE_NAME);
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

const webCacheGet = async (key: string): Promise<unknown | undefined> => {
    const db = await openWebCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readonly');
        const store = tx.objectStore(WEB_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const webCacheDelete = async (key: string): Promise<void> => {
    const db = await openWebCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(WEB_STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

// 保存工作簿数据
export const saveWorkbookCache = async (
    sourceUrl: string,
    workbook: unknown,
    metadata: {
        fileName: string;
        currentSheetName: string;
        lastRefreshedAt: number;
    },
    parsedData?: unknown,
    parsedCacheKey?: string
): Promise<boolean> => {
    const key = getCacheKey(sourceUrl);
    const cacheData = {
        workbook,
        ...metadata,
        sourceUrl,
        cachedAt: Date.now(),
        parsedData,
        parsedCacheKey
    };

    try {
        if (isElectron() && window.electronCache) {
            // Electron: 保存到本地文件（无大小限制）
            const result = await window.electronCache.save(key, cacheData);
            if (result.success) {
                return true;
            }
            console.error('[SmartCache] Failed to save to local file:', result.error);
            return false;
        } else {
            // 网页版: 使用 IndexedDB 保存完整数据
            await webCacheSet(key, cacheData);
            return true;
        }
    } catch (error) {
        console.error('[SmartCache] Save failed:', error);
        return false;
    }
};

// 加载工作簿缓存
export const loadWorkbookCache = async (sourceUrl: string, sourceId?: string): Promise<{
    success: boolean;
    data?: {
        workbook: unknown;
        fileName: string;
        currentSheetName: string;
        lastRefreshedAt: number;
        cachedAt: number;
        parsedData?: unknown; // 🚀 预解析的数据，可以跳过解析步骤
        parsedCacheKey?: string;
    };
    needsReload?: boolean;
}> => {
    try {
        if (isElectron() && window.electronCache) {
            // Electron: 优先尝试从 datasource_{id} 格式加载（DataSourceManager 缓存的数据）
            // 这个格式的数据是用户手动缓存的，应该优先使用

            // 1. 如果提供了 sourceId，直接尝试加载
            if (sourceId) {
                const dsKey = `datasource_${sourceId}`;
                const dsResult = await window.electronCache.load(dsKey);
                const dsData = dsResult.data as any;
                if (dsResult.success && dsData && dsData.workbook) {
                    const ds = dsData;
                    return {
                        success: true,
                        data: {
                            workbook: ds.workbook,
                            fileName: ds.source?.name || 'Google Sheet',
                            currentSheetName: ds.workbook?.SheetNames?.[0] || '',
                            lastRefreshedAt: ds.cachedAt,
                            cachedAt: ds.cachedAt,
                            parsedData: ds.parsedData, // 🚀 返回预解析数据
                            parsedCacheKey: ds.parsedCacheKey
                        }
                    };
                }
            }

            // 2. 遍历查找匹配 URL 的 datasource 缓存
            const listResult = await window.electronCache.list();
            if (listResult.success && listResult.files) {
                for (const file of listResult.files) {
                    if (file.key.startsWith('datasource_')) {
                        const cacheResult = await window.electronCache.load(file.key);
                        if (cacheResult.success && cacheResult.data) {
                            const cachedData = cacheResult.data as any;
                            // 匹配 URL
                            if (cachedData.source?.url === sourceUrl && cachedData.workbook) {
                                return {
                                    success: true,
                                    data: {
                                        workbook: cachedData.workbook,
                                        fileName: cachedData.source?.name || 'Google Sheet',
                                        currentSheetName: cachedData.workbook?.SheetNames?.[0] || '',
                                        lastRefreshedAt: cachedData.cachedAt,
                                        cachedAt: cachedData.cachedAt,
                                        parsedData: cachedData.parsedData,
                                        parsedCacheKey: cachedData.parsedCacheKey
                                    }
                                };
                            }
                        }
                    }
                }
            }

            // 3. 尝试原来的 sheetmind_data_ 格式
            const key = getCacheKey(sourceUrl);
            const result = await window.electronCache.load(key);
            if (result.success && result.data) {
                return { success: true, data: result.data as any };
            }
            return { success: false };
        } else {
            // 网页版: 从 IndexedDB 加载
            const key = getCacheKey(sourceUrl);
            const cached = await webCacheGet(key);
            if (cached) {
                return { success: true, data: cached as any };
            }
            // 兼容旧版 localStorage 缓存
            const legacy = localStorage.getItem(key);
            if (legacy) {
                const data = JSON.parse(legacy);
                if (data && data.workbook) {
                    await webCacheSet(key, data);
                    return { success: true, data };
                }
            }
            return { success: false };
        }
    } catch (error) {
        console.error('[SmartCache] Load failed:', error);
        return { success: false };
    }
};

// 删除缓存
export const deleteWorkbookCache = async (sourceUrl: string): Promise<boolean> => {
    const key = getCacheKey(sourceUrl);

    try {
        if (isElectron() && window.electronCache) {
            const result = await window.electronCache.delete(key);
            return result.success;
        } else {
            await webCacheDelete(key);
            return true;
        }
    } catch (error) {
        console.error('[SmartCache] Delete failed:', error);
        return false;
    }
};

// 获取缓存统计信息
export const getCacheStats = async (): Promise<{
    isElectron: boolean;
    totalSizeMB?: string;
    path?: string;
    files?: Array<{ key: string; size: number; modifiedAt: string }>;
}> => {
    if (isElectron() && window.electronCache) {
        const stats = await window.electronCache.stats();
        const list = await window.electronCache.list();
        return {
            isElectron: true,
            totalSizeMB: stats.totalSizeMB,
            path: stats.path,
            files: list.files
        };
    } else {
        // 网页版：估算 localStorage 使用量
        let totalSize = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('sheetmind_')) {
                totalSize += localStorage.getItem(key)?.length || 0;
            }
        }
        return {
            isElectron: false,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
        };
    }
};
