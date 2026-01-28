/**
 * Workspace Service - 项目/工作区持久化服务
 * 类似 Google Flow 的项目管理模式
 * - 每个模块支持多个项目
 * - 项目数据实时云端保存
 * - 跨设备自动同步
 */

import {
    doc,
    collection,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    updateDoc,
    query,
    orderBy,
    where,
    Timestamp,
    serverTimestamp,
    limit,
    writeBatch
} from 'firebase/firestore';
import { db } from '@/firebase/index';
import { ModuleId } from './historyService';

// ============= 类型定义 =============

export interface WorkspacePreview {
    title: string;
    thumbnail?: string;
    itemCount: number;
}

export interface Workspace<T = any> {
    id: string;
    moduleId: ModuleId;
    name: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    isActive: boolean;

    // 模块特定状态
    state: T;

    // 列表预览
    preview: WorkspacePreview;
}

export interface CreateWorkspaceInput {
    moduleId: ModuleId;
    name: string;
    state?: any;
}

// ============= 工具函数 =============

// 生成唯一 ID
const generateId = (): string => {
    return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// 获取用户工作区集合路径
const getWorkspaceCollection = (userId: string, moduleId: ModuleId) => {
    return collection(db, 'users', userId, 'workspaces', moduleId, 'items');
};

// 获取工作区文档路径
const getWorkspaceDoc = (userId: string, moduleId: ModuleId, workspaceId: string) => {
    return doc(db, 'users', userId, 'workspaces', moduleId, 'items', workspaceId);
};

// ============= 防抖保存 =============

const saveTimers: Map<string, NodeJS.Timeout> = new Map();
const SAVE_DEBOUNCE_MS = 2000; // 2秒防抖

/**
 * 防抖保存状态 - 避免频繁写入
 */
export const debouncedSaveState = (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string,
    state: any,
    preview?: Partial<WorkspacePreview>
): void => {
    const key = `${userId}_${moduleId}_${workspaceId}`;

    // 清除之前的定时器
    const existingTimer = saveTimers.get(key);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    // 设置新的定时器
    const timer = setTimeout(async () => {
        try {
            await saveState(userId, moduleId, workspaceId, state, preview);
            saveTimers.delete(key);
        } catch (error) {
            console.error('[WorkspaceService] Debounced save failed:', error);
        }
    }, SAVE_DEBOUNCE_MS);

    saveTimers.set(key, timer);
};

/**
 * 立即保存所有待保存的状态
 */
export const flushPendingSaves = async (): Promise<void> => {
    // 清除所有定时器并立即执行
    for (const [key, timer] of saveTimers.entries()) {
        clearTimeout(timer);
        saveTimers.delete(key);
    }
};

// ============= 核心 API =============

/**
 * 创建新项目
 */
export const createWorkspace = async (
    userId: string,
    input: CreateWorkspaceInput
): Promise<string> => {
    const workspaceId = generateId();
    const docRef = getWorkspaceDoc(userId, input.moduleId, workspaceId);

    const workspace: Omit<Workspace, 'id'> = {
        moduleId: input.moduleId,
        name: input.name,
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
        isActive: true,
        state: input.state || {},
        preview: {
            title: input.name,
            itemCount: 0
        }
    };

    // 先将其他项目设为非活跃
    await deactivateAllWorkspaces(userId, input.moduleId);

    // 创建新项目
    await setDoc(docRef, workspace);

    console.log(`[WorkspaceService] Created workspace: ${workspaceId} for module: ${input.moduleId}`);
    return workspaceId;
};

/**
 * 获取模块的所有项目
 */
export const listWorkspaces = async (
    userId: string,
    moduleId: ModuleId,
    maxCount: number = 50
): Promise<Workspace[]> => {
    const collectionRef = getWorkspaceCollection(userId, moduleId);
    const q = query(
        collectionRef,
        orderBy('updatedAt', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as Workspace));
};

/**
 * 获取当前激活的项目
 */
export const getActiveWorkspace = async (
    userId: string,
    moduleId: ModuleId
): Promise<Workspace | null> => {
    const collectionRef = getWorkspaceCollection(userId, moduleId);
    const q = query(
        collectionRef,
        where('isActive', '==', true),
        limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        return null;
    }

    const doc = snapshot.docs[0];
    return {
        id: doc.id,
        ...doc.data()
    } as Workspace;
};

/**
 * 获取单个项目详情
 */
export const getWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string
): Promise<Workspace | null> => {
    const docRef = getWorkspaceDoc(userId, moduleId, workspaceId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    } as Workspace;
};

/**
 * 保存项目状态
 */
export const saveState = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string,
    state: any,
    preview?: Partial<WorkspacePreview>
): Promise<void> => {
    const docRef = getWorkspaceDoc(userId, moduleId, workspaceId);

    const updates: any = {
        state,
        updatedAt: serverTimestamp()
    };

    if (preview) {
        // 合并预览信息
        const existingDoc = await getDoc(docRef);
        const existingPreview = existingDoc.exists() ? existingDoc.data()?.preview || {} : {};
        updates.preview = { ...existingPreview, ...preview };
    }

    await updateDoc(docRef, updates);
    console.log(`[WorkspaceService] Saved state for workspace: ${workspaceId}`);
};

/**
 * 切换激活项目
 */
export const setActiveWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string
): Promise<void> => {
    // 先将所有项目设为非活跃
    await deactivateAllWorkspaces(userId, moduleId);

    // 设置目标项目为活跃
    const docRef = getWorkspaceDoc(userId, moduleId, workspaceId);
    await updateDoc(docRef, {
        isActive: true,
        updatedAt: serverTimestamp()
    });

    console.log(`[WorkspaceService] Activated workspace: ${workspaceId}`);
};

/**
 * 将所有项目设为非活跃
 */
const deactivateAllWorkspaces = async (
    userId: string,
    moduleId: ModuleId
): Promise<void> => {
    const collectionRef = getWorkspaceCollection(userId, moduleId);
    const q = query(collectionRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return;

    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { isActive: false });
    });
    await batch.commit();
};

/**
 * 重命名项目
 */
export const renameWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string,
    newName: string
): Promise<void> => {
    const docRef = getWorkspaceDoc(userId, moduleId, workspaceId);
    await updateDoc(docRef, {
        name: newName,
        'preview.title': newName,
        updatedAt: serverTimestamp()
    });
    console.log(`[WorkspaceService] Renamed workspace: ${workspaceId} to: ${newName}`);
};

/**
 * 删除项目
 */
export const deleteWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string
): Promise<void> => {
    const docRef = getWorkspaceDoc(userId, moduleId, workspaceId);
    await deleteDoc(docRef);
    console.log(`[WorkspaceService] Deleted workspace: ${workspaceId}`);
};

/**
 * 复制项目
 */
export const duplicateWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    workspaceId: string,
    newName?: string
): Promise<string> => {
    const original = await getWorkspace(userId, moduleId, workspaceId);
    if (!original) {
        throw new Error('Workspace not found');
    }

    return createWorkspace(userId, {
        moduleId,
        name: newName || `${original.name} (副本)`,
        state: original.state
    });
};

/**
 * 获取或创建默认项目
 * 如果没有任何项目，自动创建一个默认项目
 */
export const getOrCreateDefaultWorkspace = async (
    userId: string,
    moduleId: ModuleId,
    defaultName: string = '默认项目'
): Promise<Workspace> => {
    // 先尝试获取激活的项目
    let workspace = await getActiveWorkspace(userId, moduleId);
    if (workspace) {
        return workspace;
    }

    // 尝试获取任意项目
    const workspaces = await listWorkspaces(userId, moduleId, 1);
    if (workspaces.length > 0) {
        // 激活第一个项目
        await setActiveWorkspace(userId, moduleId, workspaces[0].id);
        return { ...workspaces[0], isActive: true };
    }

    // 创建默认项目
    const newId = await createWorkspace(userId, {
        moduleId,
        name: defaultName
    });

    return (await getWorkspace(userId, moduleId, newId))!;
};

// ============= 导出模块名称映射 =============

export const getModuleDefaultName = (moduleId: ModuleId): string => {
    const names: Record<ModuleId, string> = {
        'image-recognition': '图片识别项目',
        'smart-translate': '智能翻译项目',
        'desc-innovator': '描述创新项目'
    };
    return names[moduleId] || '默认项目';
};
