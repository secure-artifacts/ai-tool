/**
 * Preset Cloud Service - AI 图片识别预设的自动云端同步服务
 * 
 * 功能：
 * - 用户登录后自动从 Firestore 加载预设
 * - 预设变更时自动同步到云端（防抖）
 * - 自动合并默认预设与用户预设
 * - 本地 localStorage 作为缓存
 */

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/firebase/index';

// ============= 类型定义 =============

export interface CloudPreset {
    id: string;
    name: string;
    text: string;
    isDefault?: boolean; // 标记是否为系统默认预设
    createdAt?: number;
    updatedAt?: number;
}

interface CloudPresetData {
    presets: CloudPreset[];
    updatedAt: any;
    version: number;
}

// ============= 常量 =============

const PRESET_COLLECTION = 'userPresets';
const PRESET_DOC_TYPE = 'ai-image-recognition';
const SYNC_DEBOUNCE_MS = 2000; // 2秒防抖
const LOCAL_STORAGE_KEY = 'ai-classifier-presets';
const PRESET_VERSION = 1;

// ============= 私有变量 =============

let syncTimer: NodeJS.Timeout | null = null;
let pendingPresets: CloudPreset[] | null = null;

// ============= 核心函数 =============

/**
 * 获取用户预设文档引用
 */
const getPresetDocRef = (userId: string) => {
    return doc(db, PRESET_COLLECTION, userId, 'modules', PRESET_DOC_TYPE);
};

/**
 * 从云端加载用户预设
 */
export const loadPresetsFromCloud = async (
    userId: string,
    defaultPresets: CloudPreset[]
): Promise<CloudPreset[]> => {
    try {
        const docRef = getPresetDocRef(userId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data() as CloudPresetData;
            const cloudPresets = data.presets || [];

            // 合并默认预设（根据名称去重）
            const existingNames = new Set(cloudPresets.map(p => p.name));
            const newDefaults = defaultPresets.filter(dp => !existingNames.has(dp.name));

            if (newDefaults.length > 0) {
                // 有新的默认预设，合并并保存
                const merged = [...newDefaults.map(p => ({ ...p, isDefault: true })), ...cloudPresets];
                // console.log(`[PresetCloud] 合并了 ${newDefaults.length} 个新默认预设`);

                // 异步保存到云端
                savePresetsToCloud(userId, merged);
                // 同时更新本地缓存
                savePresetsToLocal(merged);

                return merged;
            }

            // 更新本地缓存
            savePresetsToLocal(cloudPresets);
            return cloudPresets;
        } else {
            // 用户没有云端数据，使用默认预设
            // console.log('[PresetCloud] 用户无云端数据，使用默认预设');
            const defaultsWithFlag = defaultPresets.map(p => ({ ...p, isDefault: true }));

            // 保存到云端
            savePresetsToCloud(userId, defaultsWithFlag);
            savePresetsToLocal(defaultsWithFlag);

            return defaultsWithFlag;
        }
    } catch (error) {
        console.error('[PresetCloud] 加载云端预设失败:', error);
        // 降级到本地
        return loadPresetsFromLocal(defaultPresets);
    }
};

/**
 * 保存预设到云端
 */
export const savePresetsToCloud = async (
    userId: string,
    presets: CloudPreset[]
): Promise<void> => {
    try {
        const docRef = getPresetDocRef(userId);
        const data: CloudPresetData = {
            presets: presets.map(p => ({
                id: p.id,
                name: p.name,
                text: p.text,
                isDefault: p.isDefault,
                createdAt: p.createdAt || Date.now(),
                updatedAt: Date.now(),
            })),
            updatedAt: serverTimestamp(),
            version: PRESET_VERSION,
        };

        await setDoc(docRef, data, { merge: false });
        // console.log(`[PresetCloud] 已保存 ${presets.length} 个预设到云端`);

        // 同时更新本地缓存
        savePresetsToLocal(presets);
    } catch (error) {
        console.error('[PresetCloud] 保存云端预设失败:', error);
        throw error;
    }
};

/**
 * 防抖保存预设到云端
 */
export const debouncedSaveToCloud = (
    userId: string | null | undefined,
    presets: CloudPreset[]
): void => {
    // 无论是否登录，都先保存到本地
    savePresetsToLocal(presets);

    if (!userId) {
        // console.log('[PresetCloud] 用户未登录，仅保存到本地');
        return;
    }

    // 防抖保存到云端
    pendingPresets = presets;

    if (syncTimer) {
        clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(async () => {
        if (pendingPresets && userId) {
            try {
                await savePresetsToCloud(userId, pendingPresets);
            } catch (error) {
                console.error('[PresetCloud] 防抖保存失败:', error);
            }
            pendingPresets = null;
        }
        syncTimer = null;
    }, SYNC_DEBOUNCE_MS);
};

/**
 * 立即刷新待同步的预设
 */
export const flushPendingPresets = async (userId: string): Promise<void> => {
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }

    if (pendingPresets) {
        await savePresetsToCloud(userId, pendingPresets);
        pendingPresets = null;
    }
};

// ============= 本地存储 =============

/**
 * 保存预设到本地 localStorage
 */
export const savePresetsToLocal = (presets: CloudPreset[]): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
        console.warn('[PresetCloud] 保存本地预设失败:', e);
    }
};

/**
 * 从本地 localStorage 加载预设
 */
export const loadPresetsFromLocal = (defaultPresets: CloudPreset[]): CloudPreset[] => {
    if (typeof window === 'undefined') return defaultPresets;
    try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // 合并默认预设
                const existingNames = new Set(parsed.map((p: CloudPreset) => p.name));
                const newDefaults = defaultPresets.filter(dp => !existingNames.has(dp.name));

                if (newDefaults.length > 0) {
                    const merged = [...newDefaults.map(p => ({ ...p, isDefault: true })), ...parsed];
                    savePresetsToLocal(merged);
                    // console.log(`[PresetCloud] 本地合并了 ${newDefaults.length} 个新默认预设`);
                    return merged;
                }
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[PresetCloud] 加载本地预设失败:', e);
    }
    return defaultPresets.map(p => ({ ...p, isDefault: true }));
};

/**
 * 清除本地预设缓存
 */
export const clearLocalPresets = (): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (e) {
        console.warn('[PresetCloud] 清除本地预设失败:', e);
    }
};
