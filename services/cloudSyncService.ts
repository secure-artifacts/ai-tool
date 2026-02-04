/**
 * Cloud Sync Service - 基于邮箱的云同步服务
 * 
 * 功能：
 * - 使用邮箱作为同步密钥
 * - 支持 Firebase 和独立 K-V 模式
 * - 自动冲突合并（基于 updatedAt）
 * - 防抖推送
 */

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from '@/firebase/index';

// ============= 类型定义 =============

/**
 * 完整的可同步图片数据 - 包含所有必要字段以实现完整恢复
 * 注意：不包含 base64Data（太大），使用 gyazoUrl 来恢复图片
 */
export interface SyncableImageItem {
    id: string;
    sourceType: 'file' | 'url' | 'formula';
    originalInput: string;
    imageUrl?: string; // 可显示的 URL（可能是 blob URL，恢复时需要用 gyazoUrl）
    fetchUrl?: string;
    mimeType?: string;
    status: string;
    result?: string;
    errorMsg?: string;
    // 图片恢复关键字段 - Gyazo 永久链接
    gyazoUrl?: string;
    // 对话历史
    chatHistory?: Array<{
        id: string;
        role: 'user' | 'model';
        text: string;
        images?: string[];
        timestamp: number;
    }>;
    // 自定义提示词
    customPrompt?: string;
    useCustomPrompt?: boolean;
    // 创新相关
    customInnovationInstruction?: string;
    customInnovationCount?: number;
    customInnovationRounds?: number;
    customInnovationTemplateId?: string;
    innovationOutputs?: string[];
    innovationItems?: Array<{
        id: string;
        text: string;
        chatHistory: Array<{
            id: string;
            role: 'user' | 'model';
            text: string;
            images?: string[];
            timestamp: number;
        }>;
    }>;
    // 翻译缓存（与 Firebase 项目保持一致）
    translatedResult?: string;
    lastSelectedText?: string;
    lastTranslatedSelection?: string;
    // 时间戳用于冲突解决
    updatedAt?: number;
}

export interface SyncData {
    images: SyncableImageItem[];
    // 同步整个状态的关键配置
    prompt?: string;
    innovationInstruction?: string;
    globalInnovationTemplateId?: string;
    globalInnovationCount?: number;
    globalInnovationRounds?: number;
    copyMode?: string;
    viewMode?: string;
    autoUploadGyazo?: boolean;
    pureReplyMode?: boolean;

    // ============= 扩展同步数据 =============
    // 项目列表（简化版，只同步元数据）
    projects?: Array<{
        id: string;
        name: string;
        createdAt: number;
        updatedAt: number;
        isStarred?: boolean;
        isPinned?: boolean;
        tags?: string[];
        preview?: string;
        itemCount?: number;
        thumbnail?: string;
    }>;

    // 当前活跃项目 ID
    activeProjectId?: string;

    // 预设列表
    presets?: Array<{
        id: string;
        name: string;
        text: string;
        source?: string;
    }>;

    // 用户设置
    settings?: {
        language?: string;
        theme?: string;
        uiScale?: number;
        fontScale?: number;
        defaultModel?: string;
        autoUploadGyazo?: boolean;
        // 其他设置...
    };

    // API 密钥（加密存储）
    apiKeys?: string[];

    // 历史记录摘要（最近100条）
    recentHistory?: Array<{
        id: string;
        moduleId: string;
        title: string;
        timestamp: number;
        preview?: string;
        thumbnail?: string;
    }>;

    // 元数据
    lastSyncAt: number;
    version: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

export interface SyncState {
    status: SyncStatus;
    lastSyncAt: number | null;
    email: string | null;
    error?: string;
}

// ============= 常量 =============

const SYNC_COLLECTION = 'publicSync'; // 公开同步集合（无需登录）
const SYNC_DEBOUNCE_MS = 3000; // 3秒防抖
const SYNC_DATA_VERSION = 1;

// ============= 工具函数 =============

/**
 * 规范化邮箱（小写，去空格）
 */
export const normalizeEmail = (email: string): string => {
    return email.trim().toLowerCase();
};

/**
 * 验证邮箱格式
 */
export const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * 获取同步文档路径
 */
const getSyncDocRef = (email: string) => {
    const normalizedEmail = normalizeEmail(email);
    // 用邮箱的 hash 作为文档 ID（避免特殊字符问题）
    const docId = btoa(normalizedEmail).replace(/[^a-zA-Z0-9]/g, '_');
    return doc(db, SYNC_COLLECTION, docId);
};

// ============= 核心同步逻辑 =============

/**
 * 递归移除对象中的 undefined 值（Firestore 不支持 undefined）
 */
const removeUndefined = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) {
        return null;
    }
    if (Array.isArray(obj)) {
        return obj.map(removeUndefined).filter(item => item !== undefined);
    }
    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            if (value !== undefined) {
                result[key] = removeUndefined(value);
            }
        }
        return result;
    }
    return obj;
};

/**
 * 推送数据到云端
 * 如果文档太大，会自动裁剪数据并重试
 */
export const pushToCloud = async (email: string, data: Partial<SyncData>): Promise<void> => {
    if (!isValidEmail(email)) {
        throw new Error('无效的邮箱格式');
    }

    const docRef = getSyncDocRef(email);
    const now = Date.now();

    // Build sync data object, excluding undefined values
    let images = data.images || [];

    const buildSyncData = (imagesToSync: SyncableImageItem[]): Record<string, unknown> => {
        const syncData: Record<string, unknown> = {
            // 图片识别状态
            images: imagesToSync,
            // 元数据
            lastSyncAt: now,
            version: SYNC_DATA_VERSION
        };

        // Only include defined values (Firestore doesn't accept undefined)
        if (data.prompt !== undefined) syncData.prompt = data.prompt;
        if (data.innovationInstruction !== undefined) syncData.innovationInstruction = data.innovationInstruction;
        if (data.globalInnovationTemplateId !== undefined) syncData.globalInnovationTemplateId = data.globalInnovationTemplateId;
        if (data.globalInnovationCount !== undefined) syncData.globalInnovationCount = data.globalInnovationCount;
        if (data.globalInnovationRounds !== undefined) syncData.globalInnovationRounds = data.globalInnovationRounds;
        if (data.copyMode !== undefined) syncData.copyMode = data.copyMode;
        if (data.viewMode !== undefined) syncData.viewMode = data.viewMode;
        if (data.autoUploadGyazo !== undefined) syncData.autoUploadGyazo = data.autoUploadGyazo;
        if (data.pureReplyMode !== undefined) syncData.pureReplyMode = data.pureReplyMode;
        if (data.projects !== undefined) syncData.projects = data.projects;
        if (data.activeProjectId !== undefined) syncData.activeProjectId = data.activeProjectId;
        if (data.presets !== undefined) syncData.presets = data.presets;
        if (data.settings !== undefined) syncData.settings = data.settings;
        if (data.apiKeys !== undefined) syncData.apiKeys = data.apiKeys;
        if (data.recentHistory !== undefined) syncData.recentHistory = data.recentHistory;

        return syncData;
    };

    // 估算 JSON 大小的辅助函数
    const estimateSize = (obj: unknown): number => {
        try {
            return JSON.stringify(obj).length;
        } catch {
            return 0;
        }
    };

    // Firestore 限制是 1MB，保守估算 800KB 作为安全阈值
    const MAX_SAFE_SIZE = 800 * 1024;

    // 构建并裁剪最终要推送的数据
    const buildFinalSyncData = (): Record<string, unknown> => {
        let currentImages = [...images];
        let includeProjects = true;
        let includePresets = true;
        let includeHistory = true;

        // 构建完整数据
        const buildData = () => {
            const syncData: Record<string, unknown> = {
                images: currentImages,
                lastSyncAt: now,
                version: SYNC_DATA_VERSION
            };

            if (data.prompt !== undefined) syncData.prompt = data.prompt;
            if (data.innovationInstruction !== undefined) syncData.innovationInstruction = data.innovationInstruction;
            if (data.globalInnovationTemplateId !== undefined) syncData.globalInnovationTemplateId = data.globalInnovationTemplateId;
            if (data.globalInnovationCount !== undefined) syncData.globalInnovationCount = data.globalInnovationCount;
            if (data.globalInnovationRounds !== undefined) syncData.globalInnovationRounds = data.globalInnovationRounds;
            if (data.copyMode !== undefined) syncData.copyMode = data.copyMode;
            if (data.viewMode !== undefined) syncData.viewMode = data.viewMode;
            if (data.autoUploadGyazo !== undefined) syncData.autoUploadGyazo = data.autoUploadGyazo;
            if (data.pureReplyMode !== undefined) syncData.pureReplyMode = data.pureReplyMode;
            if (data.activeProjectId !== undefined) syncData.activeProjectId = data.activeProjectId;
            if (data.settings !== undefined) syncData.settings = data.settings;
            if (data.apiKeys !== undefined) syncData.apiKeys = data.apiKeys;

            // 可选的大数据字段
            if (includeProjects && data.projects !== undefined) syncData.projects = data.projects;
            if (includePresets && data.presets !== undefined) syncData.presets = data.presets;
            if (includeHistory && data.recentHistory !== undefined) syncData.recentHistory = data.recentHistory;

            return syncData;
        };

        // 第一次尝试：完整数据
        let syncData = buildData();
        let size = estimateSize(syncData);

        if (size <= MAX_SAFE_SIZE) {
            return syncData;
        }

        console.warn(`[CloudSync] ⚠️ 数据太大 (${(size / 1024).toFixed(0)}KB)，开始裁剪...`);

        // 第一轮：删除历史记录
        includeHistory = false;
        syncData = buildData();
        size = estimateSize(syncData);
        if (size <= MAX_SAFE_SIZE) {
            // console.log('[CloudSync] 删除 recentHistory 后符合限制');
            return syncData;
        }

        // 第二轮：减少图片数量
        while (currentImages.length > 0 && size > MAX_SAFE_SIZE) {
            currentImages = currentImages.slice(0, Math.floor(currentImages.length * 0.5));
            syncData = buildData();
            size = estimateSize(syncData);
        }

        if (size <= MAX_SAFE_SIZE) {
            // console.log(`[CloudSync] 裁剪图片到 ${currentImages.length} 张后符合限制`);
            return syncData;
        }

        // 第三轮：清空图片
        currentImages = [];
        syncData = buildData();
        size = estimateSize(syncData);
        if (size <= MAX_SAFE_SIZE) {
            console.warn('[CloudSync] ⚠️ 仅保存配置，不同步图片');
            return syncData;
        }

        // 第四轮：删除预设
        includePresets = false;
        syncData = buildData();
        size = estimateSize(syncData);
        if (size <= MAX_SAFE_SIZE) {
            // console.log('[CloudSync] 删除 presets 后符合限制');
            return syncData;
        }

        // 第五轮：删除项目
        includeProjects = false;
        syncData = buildData();
        size = estimateSize(syncData);
        if (size <= MAX_SAFE_SIZE) {
            // console.log('[CloudSync] 删除 projects 后符合限制');
            return syncData;
        }

        // 最后手段：只保存最基本的设置
        console.warn('[CloudSync] ⚠️ 只保存最基本的设置');
        return {
            lastSyncAt: now,
            version: SYNC_DATA_VERSION,
            settings: data.settings,
            activeProjectId: data.activeProjectId
        };
    };

    // 构建最终数据
    const finalSyncData = buildFinalSyncData();
    const finalSize = estimateSize(finalSyncData);
    // console.log(`[CloudSync] 最终数据大小: ${(finalSize / 1024).toFixed(0)}KB`);

    try {
        // 清理所有 undefined 值再写入 Firestore
        const cleanedData = removeUndefined({
            ...finalSyncData,
            email: normalizeEmail(email),
            updatedAt: serverTimestamp()
        }) as Record<string, unknown>;

        await setDoc(docRef, cleanedData, { merge: true });

        const imagesArr = finalSyncData.images as unknown[] | undefined;
        const projectsArr = finalSyncData.projects as unknown[] | undefined;
        // console.log(`[CloudSync] ✅ 推送成功: ${imagesArr?.length || 0} 张图片, ${projectsArr?.length || 0} 个项目`);

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // 如果还是太大，强制只保存元数据
        if (errorMessage.includes('exceeds the maximum allowed size')) {
            console.error('[CloudSync] ❌ 裁剪后仍然太大，放弃推送');
        }
        throw error;
    }
};


/**
 * 从云端拉取数据
 */
export const pullFromCloud = async (email: string): Promise<SyncData | null> => {
    if (!isValidEmail(email)) {
        throw new Error('无效的邮箱格式');
    }

    const docRef = getSyncDocRef(email);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        // console.log('[CloudSync] 云端无数据');
        return null;
    }

    const data = docSnap.data() as SyncData;
    // console.log(`[CloudSync] ✅ 拉取成功: ${data.images?.length || 0} 张图片`);
    return data;
};

/**
 * 合并本地和远程数据（冲突解决）
 */
export const mergeData = (local: SyncData, remote: SyncData): SyncData => {
    const merged: SyncData = {
        images: [],
        lastSyncAt: Date.now(),
        version: SYNC_DATA_VERSION
    };

    // 创建远程图片 Map
    const remoteMap = new Map(remote.images.map(img => [img.id, img]));
    const localMap = new Map(local.images.map(img => [img.id, img]));

    // 获取所有唯一 ID
    const allIds = new Set([...remoteMap.keys(), ...localMap.keys()]);

    for (const id of allIds) {
        const localItem = localMap.get(id);
        const remoteItem = remoteMap.get(id);

        if (!localItem) {
            // 只有远程有：使用远程
            merged.images.push(remoteItem!);
        } else if (!remoteItem) {
            // 只有本地有：使用本地
            merged.images.push(localItem);
        } else {
            // 都有：比较 updatedAt，保留最新的
            const winner = (localItem.updatedAt || 0) >= (remoteItem.updatedAt || 0)
                ? localItem
                : remoteItem;
            merged.images.push(winner);
        }
    }

    // 按 updatedAt 降序排序
    merged.images.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // console.log(`[CloudSync] 合并完成: ${merged.images.length} 张图片`);
    return merged;
};

// ============= 防抖同步管理 =============

let syncTimer: NodeJS.Timeout | null = null;
let pendingData: Partial<SyncData> | null = null;
let currentEmail: string | null = null;

/**
 * 防抖推送 - 避免频繁写入
 */
export const debouncedPush = (email: string, data: Partial<SyncData>): void => {
    currentEmail = email;
    pendingData = data;

    if (syncTimer) {
        clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(async () => {
        if (pendingData && currentEmail) {
            try {
                await pushToCloud(currentEmail, pendingData);
                window.dispatchEvent(new CustomEvent('cloudSyncStatus', {
                    detail: { status: 'success', lastSyncAt: Date.now() }
                }));
            } catch (error) {
                console.error('[CloudSync] 推送失败:', error);
                window.dispatchEvent(new CustomEvent('cloudSyncStatus', {
                    detail: { status: 'error', error: String(error) }
                }));
            }
            pendingData = null;
            syncTimer = null;
        }
    }, SYNC_DEBOUNCE_MS);

    // 立即通知正在同步
    window.dispatchEvent(new CustomEvent('cloudSyncStatus', {
        detail: { status: 'syncing' }
    }));
};

/**
 * 立即执行待处理的同步
 */
export const flushPendingSync = async (): Promise<void> => {
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }

    if (pendingData && currentEmail) {
        await pushToCloud(currentEmail, pendingData);
        pendingData = null;
    }
};

// ============= 本地存储辅助 =============

const SYNC_EMAIL_KEY = 'cloud_sync_email';
const SYNC_STATE_KEY = 'cloud_sync_state';

/**
 * 保存同步邮箱到本地
 */
export const saveSyncEmail = (email: string): void => {
    localStorage.setItem(SYNC_EMAIL_KEY, normalizeEmail(email));
};

/**
 * 获取保存的同步邮箱
 */
export const getSavedSyncEmail = (): string | null => {
    return localStorage.getItem(SYNC_EMAIL_KEY);
};

/**
 * 清除同步邮箱
 */
export const clearSyncEmail = (): void => {
    localStorage.removeItem(SYNC_EMAIL_KEY);
    localStorage.removeItem(SYNC_STATE_KEY);
};

/**
 * 保存同步状态到本地
 */
export const saveSyncState = (state: Partial<SyncState>): void => {
    const existing = getSyncState();
    const newState = { ...existing, ...state };
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(newState));
};

/**
 * 获取同步状态
 */
export const getSyncState = (): SyncState => {
    try {
        const stored = localStorage.getItem(SYNC_STATE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        // ignore
    }
    return {
        status: 'idle',
        lastSyncAt: null,
        email: getSavedSyncEmail()
    };
};

// ============= 图片数据转换 =============

/**
 * 从 ImageItem 提取可同步的完整元数据
 */
export const extractSyncableData = (images: any[]): SyncableImageItem[] => {
    return images.map(img => {
        // 清理 InnovationItems - 移除 UI 状态，只保留核心数据
        const cleanInnovationItems = img.innovationItems?.map((item: any) => ({
            id: item.id,
            text: item.text,
            chatHistory: item.chatHistory?.filter((msg: any) => msg.text) || []
        }));

        return {
            id: img.id,
            sourceType: img.sourceType || 'url',
            originalInput: img.originalInput || '',
            imageUrl: img.gyazoUrl || img.fetchUrl || '', // 优先用 gyazoUrl
            fetchUrl: img.fetchUrl,
            mimeType: img.mimeType,
            status: img.status,
            result: img.result,
            errorMsg: img.errorMsg,
            gyazoUrl: img.gyazoUrl, // 关键：图片恢复用
            chatHistory: img.chatHistory?.filter((msg: any) => msg.text) || [],
            customPrompt: img.customPrompt,
            useCustomPrompt: img.useCustomPrompt,
            customInnovationInstruction: img.customInnovationInstruction,
            customInnovationCount: img.customInnovationCount,
            customInnovationRounds: img.customInnovationRounds,
            customInnovationTemplateId: img.customInnovationTemplateId,
            innovationOutputs: img.innovationOutputs,
            innovationItems: cleanInnovationItems,
            // 翻译缓存（与 Firebase 项目保持一致）
            translatedResult: img.translatedResult,
            lastSelectedText: img.lastSelectedText,
            lastTranslatedSelection: img.lastTranslatedSelection,
            updatedAt: Date.now()
            // 注意：不包含 base64Data、isChatOpen、isChatLoading 等 UI 状态
        };
    });
};

/**
 * 将云端数据合并回本地图片列表
 * 确保完整恢复所有功能：图片显示、对话、创新
 */
export const mergeCloudDataToImages = (
    localImages: any[],
    cloudImages: SyncableImageItem[]
): any[] => {
    const localMap = new Map(localImages.map(img => [img.id, img]));
    const result: any[] = [];

    // 处理云端图片
    for (const cloudImg of cloudImages) {
        const localImg = localMap.get(cloudImg.id);

        if (localImg) {
            // 本地已有：合并（保留本地的 base64Data）
            const localUpdated = localImg.updatedAt || 0;
            const cloudUpdated = cloudImg.updatedAt || 0;

            if (cloudUpdated > localUpdated) {
                // 云端更新：用云端数据覆盖（但保留 base64Data）
                result.push({
                    ...localImg,
                    ...cloudImg,
                    base64Data: localImg.base64Data, // 保留本地图片
                    // 确保 UI 状态重置
                    isChatOpen: false,
                    isChatLoading: false,
                    isInnovationOpen: false,
                    isInnovating: false
                });
            } else {
                // 本地更新：保持本地数据
                result.push(localImg);
            }
            localMap.delete(cloudImg.id);
        } else {
            // 本地没有：从云端恢复
            // 使用 gyazoUrl 作为显示 URL（关键！）
            const displayUrl = cloudImg.gyazoUrl || cloudImg.fetchUrl || cloudImg.imageUrl || '';

            result.push({
                ...cloudImg,
                // 图片恢复：使用 gyazoUrl 作为显示 URL
                imageUrl: displayUrl,
                fetchUrl: displayUrl,
                base64Data: undefined, // 需要后续异步加载
                // 确保必要的数组字段存在
                chatHistory: cloudImg.chatHistory || [],
                innovationItems: cloudImg.innovationItems?.map(item => ({
                    ...item,
                    isChatOpen: false,
                    chatInput: '',
                    chatAttachments: [],
                    isChatLoading: false
                })) || [],
                innovationOutputs: cloudImg.innovationOutputs || [],
                // 翻译缓存（与 Firebase 项目保持一致）
                translatedResult: cloudImg.translatedResult,
                lastSelectedText: cloudImg.lastSelectedText,
                lastTranslatedSelection: cloudImg.lastTranslatedSelection,
                // 确保 UI 状态初始化
                isChatOpen: false,
                isChatLoading: false,
                chatInput: '',
                chatAttachments: [],
                isInnovationOpen: false,
                isInnovating: false,
                // 标记需要加载图片数据（用于对话和创新）
                needsImageRestore: !!displayUrl
            });
        }
    }

    // 添加只存在于本地的图片
    for (const localImg of localMap.values()) {
        result.push(localImg);
    }

    return result;
};
