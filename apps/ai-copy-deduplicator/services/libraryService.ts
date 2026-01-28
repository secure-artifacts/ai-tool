// 文案库管理服务
import { CopyItem } from '../types';

const STORAGE_KEY = 'copy_dedup_library';

/**
 * 从 localStorage 加载文案库
 */
export function loadLibrary(): CopyItem[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        return parsed;
    } catch (error) {
        console.error('加载文案库失败:', error);
        return [];
    }
}

/**
 * 保存文案库到 localStorage
 */
export function saveLibrary(library: CopyItem[]): void {
    try {
        // 为了节省空间，保存时不存储 embedding（可以重新生成）
        const toSave = library.map(item => ({
            ...item,
            embedding: undefined, // 不保存 embedding
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
        console.error('保存文案库失败:', error);
        // 如果存储空间不足，尝试清理旧数据
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            console.warn('存储空间不足，尝试清理...');
            // 只保留最新的一半
            const halfLength = Math.floor(library.length / 2);
            const trimmed = library.slice(-halfLength);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.map(item => ({
                    ...item,
                    embedding: undefined,
                }))));
            } catch {
                console.error('清理后仍无法保存');
            }
        }
    }
}

/**
 * 添加文案到库
 */
export function addToLibrary(library: CopyItem[], items: CopyItem[]): CopyItem[] {
    const newLibrary = [...library, ...items];
    saveLibrary(newLibrary);
    return newLibrary;
}

/**
 * 从库中删除文案
 */
export function removeFromLibrary(library: CopyItem[], ids: string[]): CopyItem[] {
    const idSet = new Set(ids);
    const newLibrary = library.filter(item => !idSet.has(item.id));
    saveLibrary(newLibrary);
    return newLibrary;
}

/**
 * 清空文案库
 */
export function clearLibrary(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * 获取库统计信息
 */
export function getLibraryStats(library: CopyItem[]): {
    totalCount: number;
    oldestDate: Date | null;
    newestDate: Date | null;
    averageLength: number;
} {
    if (library.length === 0) {
        return {
            totalCount: 0,
            oldestDate: null,
            newestDate: null,
            averageLength: 0,
        };
    }

    const timestamps = library.map(item => item.addedAt);
    const totalLength = library.reduce((sum, item) => sum + item.originalText.length, 0);

    return {
        totalCount: library.length,
        oldestDate: new Date(Math.min(...timestamps)),
        newestDate: new Date(Math.max(...timestamps)),
        averageLength: Math.round(totalLength / library.length),
    };
}

/**
 * 导出库为 JSON
 */
export function exportLibraryAsJson(library: CopyItem[]): string {
    return JSON.stringify(library.map(item => ({
        id: item.id,
        text: item.originalText,
        addedAt: new Date(item.addedAt).toISOString(),
        source: item.source,
    })), null, 2);
}

/**
 * 从 JSON 导入库
 */
export function importLibraryFromJson(json: string): CopyItem[] {
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) {
            throw new Error('Invalid format: expected array');
        }

        return parsed.map(item => ({
            id: item.id || crypto.randomUUID(),
            originalText: item.text || item.originalText || '',
            processedText: item.text || item.originalText || '',
            addedAt: item.addedAt ? new Date(item.addedAt).getTime() : Date.now(),
            source: item.source || 'imported',
        }));
    } catch (error) {
        console.error('导入失败:', error);
        throw new Error('JSON 格式无效');
    }
}
