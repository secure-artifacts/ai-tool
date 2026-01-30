/**
 * History Service - Firebase 历史记录服务
 * 用于保存和管理用户在各模块的操作历史
 */

import {
    doc,
    collection,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    orderBy,
    where,
    Timestamp,
    serverTimestamp,
    limit
} from 'firebase/firestore';
import { db } from '@/firebase/index';

// 模块 ID 类型
export type ModuleId = 'image-recognition' | 'desc-innovator' | 'smart-translate';

// 历史会话基础接口
export interface HistorySession {
    id: string;
    moduleId: ModuleId;
    title: string;
    preview: string;          // 结果预览 (前100字)
    itemCount: number;        // 项目数量
    createdAt: Timestamp;
    updatedAt: Timestamp;
    data: any;                // 模块特定数据
}

// 创建会话的输入
export interface CreateSessionInput {
    moduleId: ModuleId;
    title: string;
    preview: string;
    itemCount: number;
    data: any;
}

/**
 * 生成唯一 ID
 */
const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 获取用户历史集合路径
 */
const getHistoryCollection = (userId: string, moduleId: ModuleId) => {
    return collection(db, 'users', userId, 'history', moduleId, 'sessions');
};

/**
 * 保存会话到历史
 */
export const saveSession = async (
    userId: string,
    input: CreateSessionInput
): Promise<string> => {
    // console.log(`[HistoryService] Starting save for ${input.moduleId}, userId: ${userId}`);

    if (!userId) {
        console.error('[HistoryService] No userId provided!');
        throw new Error('User ID is required');
    }

    try {
        const sessionId = generateId();
        const now = Timestamp.now();

        // 清理数据中的大型内容（base64 图片等）
        const cleanData = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(cleanData);

            const cleaned: any = {};
            for (const [key, value] of Object.entries(obj)) {
                // 完全跳过这些字段
                if (key === 'base64Data' || key === 'fileObj' || key === 'blob') continue;
                if (value instanceof Blob || value instanceof File) continue;

                // 处理字符串
                if (typeof value === 'string') {
                    if (value.length > 50000) {
                        // 大字符串截断
                        if (value.startsWith('data:image')) {
                            cleaned[key] = '[base64-image]';
                        } else {
                            cleaned[key] = value.slice(0, 1000) + '...[truncated]';
                        }
                    } else {
                        cleaned[key] = value;
                    }
                } else if (typeof value === 'object') {
                    cleaned[key] = cleanData(value);
                } else {
                    cleaned[key] = value;
                }
            }
            return cleaned;
        };

        const session: HistorySession = {
            id: sessionId,
            moduleId: input.moduleId,
            title: input.title,
            preview: input.preview.slice(0, 100),
            itemCount: input.itemCount,
            createdAt: now,
            updatedAt: now,
            data: cleanData(input.data)  // 清理后的数据
        };

        const docRef = doc(db, 'users', userId, 'history', input.moduleId, 'sessions', sessionId);
        // console.log(`[HistoryService] Saving to path: users/${userId}/history/${input.moduleId}/sessions/${sessionId}`);

        await setDoc(docRef, session);

        // console.log(`[HistoryService] ✅ Successfully saved session ${sessionId} for ${input.moduleId}`);
        return sessionId;
    } catch (error: any) {
        console.error(`[HistoryService] ❌ Failed to save session:`, error);
        console.error(`[HistoryService] Error code:`, error.code);
        console.error(`[HistoryService] Error message:`, error.message);
        throw error;
    }
};

/**
 * 更新现有会话
 */
export const updateSession = async (
    userId: string,
    moduleId: ModuleId,
    sessionId: string,
    updates: Partial<Pick<HistorySession, 'title' | 'preview' | 'itemCount' | 'data'>>
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'history', moduleId, 'sessions', sessionId);
    await setDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * 获取模块的所有历史会话
 */
export const loadSessions = async (
    userId: string,
    moduleId: ModuleId,
    maxCount: number = 100
): Promise<HistorySession[]> => {
    const col = getHistoryCollection(userId, moduleId);
    const now = Timestamp.now();

    // 简单查询：按 createdAt 降序排列
    const q = query(
        col,
        orderBy('createdAt', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => doc.data() as HistorySession);
};

/**
 * 获取单个会话详情
 */
export const loadSession = async (
    userId: string,
    moduleId: ModuleId,
    sessionId: string
): Promise<HistorySession | null> => {
    const docRef = doc(db, 'users', userId, 'history', moduleId, 'sessions', sessionId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data() as HistorySession;
    }
    return null;
};

/**
 * 删除会话
 */
export const deleteSession = async (
    userId: string,
    moduleId: ModuleId,
    sessionId: string
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'history', moduleId, 'sessions', sessionId);
    await deleteDoc(docRef);
    // console.log(`[HistoryService] Deleted session ${sessionId}`);
};

/**
 * 清理过期会话（已废弃 - 现在永久保存）
 */
export const cleanupExpiredSessions = async (
    userId: string,
    moduleId: ModuleId
): Promise<number> => {
    return 0;
};

/**
 * 清空所有历史记录
 */
export const clearAllSessions = async (
    userId: string,
    moduleId: ModuleId
): Promise<number> => {
    const col = getHistoryCollection(userId, moduleId);
    const snapshot = await getDocs(col);

    let deleted = 0;
    for (const doc of snapshot.docs) {
        await deleteDoc(doc.ref);
        deleted++;
    }

    // console.log(`[HistoryService] Cleared ${deleted} sessions for ${moduleId}`);
    return deleted;
};

/**
 * 导出会话为 JSON
 */
export const exportSessionAsJson = (session: HistorySession): string => {
    return JSON.stringify({
        title: session.title,
        moduleId: session.moduleId,
        createdAt: session.createdAt.toDate().toISOString(),
        itemCount: session.itemCount,
        data: session.data
    }, null, 2);
};

/**
 * 导出会话为文本
 */
export const exportSessionAsText = (session: HistorySession): string => {
    let text = `# ${session.title}\n`;
    text += `模块: ${getModuleName(session.moduleId)}\n`;
    text += `时间: ${session.createdAt.toDate().toLocaleString()}\n`;
    text += `项目数: ${session.itemCount}\n`;
    text += `\n${'='.repeat(50)}\n\n`;

    // 根据模块类型格式化数据
    switch (session.moduleId) {
        case 'image-recognition':
            if (session.data?.images) {
                session.data.images.forEach((img: any, i: number) => {
                    text += `## 图片 ${i + 1}\n`;
                    text += `来源: ${img.originalInput}\n`;
                    text += `结果: ${img.result || '无'}\n\n`;
                });
            }
            break;
        case 'desc-innovator':
            if (session.data?.entries) {
                session.data.entries.forEach((entry: any, i: number) => {
                    text += `## 任务 ${i + 1}\n`;
                    text += `原文: ${entry.source}\n`;
                    text += `创新结果:\n`;
                    entry.outputs?.forEach((out: any, j: number) => {
                        text += `  ${j + 1}. ${out.en || out.zh || ''}\n`;
                    });
                    text += '\n';
                });
            }
            break;
        case 'smart-translate':
            if (session.data?.items) {
                session.data.items.forEach((item: any, i: number) => {
                    text += `## 翻译 ${i + 1}\n`;
                    text += `原文: ${item.original}\n`;
                    text += `译文: ${item.translated}\n\n`;
                });
            }
            break;
    }

    return text;
};

/**
 * 获取模块显示名称
 */
export const getModuleName = (moduleId: ModuleId): string => {
    const names: Record<ModuleId, string> = {
        'image-recognition': 'AI 图片识别',
        'desc-innovator': '提示词工具',
        'smart-translate': '智能翻译'
    };
    return names[moduleId] || moduleId;
};

/**
 * 格式化时间显示
 */
export const formatSessionTime = (timestamp: Timestamp): string => {
    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};
