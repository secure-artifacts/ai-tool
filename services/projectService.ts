/**
 * Project Service - 统一项目管理服务
 * 
 * 设计理念：
 * - 每个模块有多个"项目"
 * - 每个项目有多个"版本"（自动保存点 + 手动创建）
 * - 项目支持星标、标签、搜索
 * - 取代原有的 workspaceService + historyService 分离模式
 */

import {
    doc,
    collection,
    getDoc,
    getDocFromServer,
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

// ============= 类型定义 =============

export type ModuleId = 'image-recognition' | 'desc-innovator' | 'desc-chat' | 'smart-translate' | 'smart-translate-instant';

// 版本快照
export interface ProjectVersion {
    id: string;
    createdAt: Timestamp;
    label?: string;           // 用户自定义标签，如 "重要版本"
    isAutoSave: boolean;      // 是否为自动保存点
    isStarred: boolean;       // 是否星标
    preview: string;          // 预览文本（前100字）
    itemCount: number;        // 项目数量
    state: any;               // 完整状态数据
}

// 项目
export interface Project {
    id: string;
    moduleId: ModuleId;
    name: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;

    // 状态标记
    isActive: boolean;        // 是否为当前激活项目
    isStarred: boolean;       // 是否星标/置顶
    isPinned: boolean;        // 是否固定

    // 分类
    tags: string[];           // 标签列表
    color?: string;           // 项目颜色标记

    // 预览信息
    thumbnail?: string;       // 缩略图 URL
    preview: string;          // 预览文本
    itemCount: number;        // 项目数量

    // 当前状态（最新版本）
    currentState: any;

    // 版本数量（不存储完整版本列表，需要时单独查询）
    versionCount: number;
}

// 项目列表项（轻量版，用于列表展示）
export interface ProjectListItem {
    id: string;
    moduleId: ModuleId;
    name: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    isActive: boolean;
    isStarred: boolean;
    isPinned: boolean;
    tags: string[];
    color?: string;
    thumbnail?: string;
    preview: string;
    itemCount: number;
    versionCount: number;
}

// 创建项目输入
export interface CreateProjectInput {
    moduleId: ModuleId;
    name: string;
    state?: any;
    thumbnail?: string;
    preview?: string;
    itemCount?: number;
}

// ============= 工具函数 =============

const generateId = (): string => {
    return `proj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const generateVersionId = (): string => {
    return `ver_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
};

// Firestore 路径
const getProjectsCollection = (userId: string, moduleId: ModuleId) => {
    return collection(db, 'users', userId, 'projects', moduleId, 'items');
};

const getProjectDoc = (userId: string, moduleId: ModuleId, projectId: string) => {
    return doc(db, 'users', userId, 'projects', moduleId, 'items', projectId);
};

const getVersionsCollection = (userId: string, moduleId: ModuleId, projectId: string) => {
    return collection(db, 'users', userId, 'projects', moduleId, 'items', projectId, 'versions');
};

const getVersionDoc = (userId: string, moduleId: ModuleId, projectId: string, versionId: string) => {
    return doc(db, 'users', userId, 'projects', moduleId, 'items', projectId, 'versions', versionId);
};

// ============= 防抖保存 =============

type PendingSave = {
    userId: string;
    moduleId: ModuleId;
    projectId: string;
    state: any;
    options?: {
        preview?: string;
        itemCount?: number;
        thumbnail?: string;
        createVersion?: boolean;
    };
    timer?: NodeJS.Timeout;
};

const pendingSaves: Map<string, PendingSave> = new Map();
const SAVE_DEBOUNCE_MS = 2000; // 2秒防抖

/**
 * 防抖保存状态
 */
export const debouncedSaveProject = (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    state: any,
    options?: {
        preview?: string;
        itemCount?: number;
        thumbnail?: string;
        createVersion?: boolean;  // 是否同时创建版本快照
    }
): void => {
    const key = `${userId}_${moduleId}_${projectId}`;

    const existing = pendingSaves.get(key);
    if (existing?.timer) {
        clearTimeout(existing.timer);
    }

    const pending: PendingSave = { userId, moduleId, projectId, state, options };
    const timer = setTimeout(async () => {
        const latest = pendingSaves.get(key);
        if (!latest) return;
        try {
            await saveProjectState(latest.userId, latest.moduleId, latest.projectId, latest.state, latest.options);
        } catch (error) {
            console.error('[ProjectService] Debounced save failed:', error);
        } finally {
            pendingSaves.delete(key);
        }
    }, SAVE_DEBOUNCE_MS);

    pending.timer = timer;
    pendingSaves.set(key, pending);
};

/**
 * 立即保存所有待保存的状态
 */
export const flushPendingSaves = async (): Promise<void> => {
    const entries = Array.from(pendingSaves.entries());
    pendingSaves.clear();

    await Promise.all(entries.map(async ([_, pending]) => {
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        try {
            await saveProjectState(pending.userId, pending.moduleId, pending.projectId, pending.state, pending.options);
        } catch (error) {
            console.error('[ProjectService] Flush save failed:', error);
        }
    }));
};

// ============= 核心 API =============

/**
 * 创建新项目
 */
export const createProject = async (
    userId: string,
    input: CreateProjectInput
): Promise<string> => {
    const projectId = generateId();
    const docRef = getProjectDoc(userId, input.moduleId, projectId);
    const now = serverTimestamp() as Timestamp;

    // 清理状态数据
    const cleanedState = cleanStateData(input.state || {});

    // 构建项目数据，确保没有 undefined 字段
    const project: Record<string, any> = {
        moduleId: input.moduleId,
        name: input.name,
        createdAt: now,
        updatedAt: now,
        isActive: true,
        isStarred: false,
        isPinned: false,
        tags: [],
        preview: input.preview || '',
        itemCount: input.itemCount || 0,
        currentState: cleanedState,
        versionCount: 0
    };

    // 只有存在时才添加 thumbnail
    if (input.thumbnail) {
        project.thumbnail = input.thumbnail;
    }

    // 先将其他项目设为非激活
    await deactivateAllProjects(userId, input.moduleId);

    // 创建项目
    await setDoc(docRef, project);

    // console.log(`[ProjectService] Created project: ${projectId} for module: ${input.moduleId}`);
    return projectId;
};

/**
 * 获取项目列表
 */
export const listProjects = async (
    userId: string,
    moduleId: ModuleId,
    options?: {
        maxCount?: number;
        includeStarredFirst?: boolean;
    }
): Promise<ProjectListItem[]> => {
    const { maxCount = 50, includeStarredFirst = true } = options || {};
    const collectionRef = getProjectsCollection(userId, moduleId);

    // 查询所有项目
    const q = query(
        collectionRef,
        orderBy('updatedAt', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);
    let projects = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as ProjectListItem));

    // 按星标和固定排序
    if (includeStarredFirst) {
        projects.sort((a, b) => {
            // 固定的在最前
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            // 然后是星标
            if (a.isStarred && !b.isStarred) return -1;
            if (!a.isStarred && b.isStarred) return 1;
            // 最后按更新时间
            return 0;
        });
    }

    return projects;
};

/**
 * 获取当前激活的项目
 */
export const getActiveProject = async (
    userId: string,
    moduleId: ModuleId
): Promise<Project | null> => {
    const collectionRef = getProjectsCollection(userId, moduleId);
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
    } as Project;
};

/**
 * 获取单个项目详情
 */
export const getProject = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string
): Promise<Project | null> => {
    const docRef = getProjectDoc(userId, moduleId, projectId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    } as Project;
};

/**
 * 保存项目状态
 */
export const saveProjectState = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    state: any,
    options?: {
        preview?: string;
        itemCount?: number;
        thumbnail?: string;
        createVersion?: boolean;
    }
): Promise<void> => {
    const docRef = getProjectDoc(userId, moduleId, projectId);

    // 清理状态数据
    const cleanedState = cleanStateData(state);

    const updates: Record<string, any> = {
        currentState: cleanedState,
        updatedAt: serverTimestamp()
    };

    if (options?.preview !== undefined) {
        updates.preview = options.preview.slice(0, 200);
    }
    if (options?.itemCount !== undefined) {
        updates.itemCount = options.itemCount;
    }
    // 只有当 thumbnail 有值时才更新，避免设置为 undefined
    if (options?.thumbnail) {
        updates.thumbnail = options.thumbnail;
    }

    // 使用 setDoc with merge 确保文档不存在时也能保存
    await setDoc(docRef, updates, { merge: true });

    // 如果需要创建版本快照
    if (options?.createVersion) {
        await createVersion(userId, moduleId, projectId, {
            state: cleanedState,
            preview: options?.preview || '',
            itemCount: options?.itemCount || 0,
            isAutoSave: true
        });
    }

    // console.log(`[ProjectService] Saved state for project: ${projectId}`);
};

/**
 * 切换激活项目
 */
export const setActiveProject = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string
): Promise<void> => {
    await deactivateAllProjects(userId, moduleId);

    const docRef = getProjectDoc(userId, moduleId, projectId);
    await updateDoc(docRef, {
        isActive: true,
        updatedAt: serverTimestamp()
    });

    // console.log(`[ProjectService] Activated project: ${projectId}`);
};

/**
 * 将所有项目设为非激活
 */
const deactivateAllProjects = async (
    userId: string,
    moduleId: ModuleId
): Promise<void> => {
    const collectionRef = getProjectsCollection(userId, moduleId);
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
export const renameProject = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    newName: string
): Promise<void> => {
    const docRef = getProjectDoc(userId, moduleId, projectId);
    await updateDoc(docRef, {
        name: newName,
        updatedAt: serverTimestamp()
    });
    // console.log(`[ProjectService] Renamed project: ${projectId} to: ${newName}`);
};

/**
 * 切换星标状态
 */
export const toggleProjectStar = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string
): Promise<boolean> => {
    const project = await getProject(userId, moduleId, projectId);
    if (!project) throw new Error('Project not found');

    const newStarred = !project.isStarred;
    const docRef = getProjectDoc(userId, moduleId, projectId);
    await updateDoc(docRef, {
        isStarred: newStarred,
        updatedAt: serverTimestamp()
    });

    // console.log(`[ProjectService] Toggled star for project: ${projectId}, now: ${newStarred}`);
    return newStarred;
};

/**
 * 切换固定状态
 */
export const toggleProjectPin = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string
): Promise<boolean> => {
    const project = await getProject(userId, moduleId, projectId);
    if (!project) throw new Error('Project not found');

    const newPinned = !project.isPinned;
    const docRef = getProjectDoc(userId, moduleId, projectId);
    await updateDoc(docRef, {
        isPinned: newPinned,
        updatedAt: serverTimestamp()
    });

    // console.log(`[ProjectService] Toggled pin for project: ${projectId}, now: ${newPinned}`);
    return newPinned;
};

/**
 * 更新项目标签
 */
export const updateProjectTags = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    tags: string[]
): Promise<void> => {
    const docRef = getProjectDoc(userId, moduleId, projectId);
    await updateDoc(docRef, {
        tags,
        updatedAt: serverTimestamp()
    });
    // console.log(`[ProjectService] Updated tags for project: ${projectId}`);
};

/**
 * 删除项目
 */
export const deleteProject = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string
): Promise<void> => {
    // 先删除所有版本
    const versionsRef = getVersionsCollection(userId, moduleId, projectId);
    const versionsSnapshot = await getDocs(versionsRef);

    const batch = writeBatch(db);
    versionsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    // 删除项目
    const docRef = getProjectDoc(userId, moduleId, projectId);
    batch.delete(docRef);

    await batch.commit();
    // console.log(`[ProjectService] Deleted project: ${projectId}`);
};

/**
 * 复制项目
 */
export const duplicateProject = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    newName?: string
): Promise<string> => {
    const original = await getProject(userId, moduleId, projectId);
    if (!original) {
        throw new Error('Project not found');
    }

    return createProject(userId, {
        moduleId,
        name: newName || `${original.name} (副本)`,
        state: original.currentState,
        thumbnail: original.thumbnail,
        preview: original.preview,
        itemCount: original.itemCount
    });
};

// ============= 版本管理 =============

/**
 * 创建版本快照
 */
export const createVersion = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    input: {
        state: any;
        preview?: string;
        itemCount?: number;
        label?: string;
        isAutoSave?: boolean;
    }
): Promise<string> => {
    const versionId = generateVersionId();
    const versionRef = getVersionDoc(userId, moduleId, projectId, versionId);

    const project = await getProject(userId, moduleId, projectId);
    const trimmedLabel = input.label?.trim();
    const label = trimmedLabel || (project
        ? ((project.versionCount || 0) === 0 ? '原版' : `修改版${project.versionCount || 0}`)
        : undefined);

    // 清理状态数据
    const cleanedState = cleanStateData(input.state);

    const version: Omit<ProjectVersion, 'id'> = {
        createdAt: serverTimestamp() as Timestamp,
        label,
        isAutoSave: input.isAutoSave ?? true,
        isStarred: false,
        preview: input.preview?.slice(0, 200) || '',
        itemCount: input.itemCount || 0,
        state: cleanedState
    };

    await setDoc(versionRef, version);

    // 更新项目的版本计数
    const projectRef = getProjectDoc(userId, moduleId, projectId);
    if (project) {
        await updateDoc(projectRef, {
            versionCount: (project.versionCount || 0) + 1
        });
    }

    // 清理旧的自动保存版本（保留最近10个）
    await cleanupOldAutoSaveVersions(userId, moduleId, projectId);

    // console.log(`[ProjectService] Created version: ${versionId} for project: ${projectId}`);
    return versionId;
};

/**
 * 获取项目的版本列表
 */
export const listVersions = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    maxCount: number = 20
): Promise<ProjectVersion[]> => {
    const versionsRef = getVersionsCollection(userId, moduleId, projectId);
    const q = query(
        versionsRef,
        orderBy('createdAt', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as ProjectVersion));
};

/**
 * 获取单个版本
 */
export const getVersion = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    versionId: string
): Promise<ProjectVersion | null> => {
    const versionRef = getVersionDoc(userId, moduleId, projectId, versionId);
    const snapshot = await getDoc(versionRef);

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    } as ProjectVersion;
};

/**
 * 恢复到指定版本
 */
export const restoreVersion = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    versionId: string
): Promise<void> => {
    const version = await getVersion(userId, moduleId, projectId, versionId);
    if (!version) {
        throw new Error('Version not found');
    }

    // 保存当前状态为新版本（备份）
    const project = await getProject(userId, moduleId, projectId);
    if (project && project.currentState) {
        await createVersion(userId, moduleId, projectId, {
            state: project.currentState,
            preview: project.preview,
            itemCount: project.itemCount,
            label: '恢复前备份',
            isAutoSave: false
        });
    }

    // 恢复到目标版本
    await saveProjectState(userId, moduleId, projectId, version.state, {
        preview: version.preview,
        itemCount: version.itemCount
    });

    // console.log(`[ProjectService] Restored to version: ${versionId}`);
};

/**
 * 切换版本星标
 */
export const toggleVersionStar = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    versionId: string
): Promise<boolean> => {
    const version = await getVersion(userId, moduleId, projectId, versionId);
    if (!version) throw new Error('Version not found');

    const newStarred = !version.isStarred;
    const versionRef = getVersionDoc(userId, moduleId, projectId, versionId);
    await updateDoc(versionRef, { isStarred: newStarred });

    return newStarred;
};

/**
 * 更新版本标签
 */
export const updateVersionLabel = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    versionId: string,
    label: string
): Promise<void> => {
    const versionRef = getVersionDoc(userId, moduleId, projectId, versionId);
    await updateDoc(versionRef, { label });
};

/**
 * 删除版本
 */
export const deleteVersion = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    versionId: string
): Promise<void> => {
    const versionRef = getVersionDoc(userId, moduleId, projectId, versionId);
    await deleteDoc(versionRef);

    // 更新项目的版本计数
    const projectRef = getProjectDoc(userId, moduleId, projectId);
    const project = await getProject(userId, moduleId, projectId);
    if (project) {
        await updateDoc(projectRef, {
            versionCount: Math.max(0, (project.versionCount || 1) - 1)
        });
    }

    // console.log(`[ProjectService] Deleted version: ${versionId}`);
};

/**
 * 清理旧的自动保存版本
 */
const cleanupOldAutoSaveVersions = async (
    userId: string,
    moduleId: ModuleId,
    projectId: string,
    keepCount: number = 10
): Promise<void> => {
    const versionsRef = getVersionsCollection(userId, moduleId, projectId);
    const q = query(
        versionsRef,
        where('isAutoSave', '==', true),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(q);
    const autoSaveVersions = snapshot.docs;

    if (autoSaveVersions.length <= keepCount) return;

    // 删除超出保留数量的旧版本
    const versionsToDelete = autoSaveVersions.slice(keepCount);
    const batch = writeBatch(db);

    versionsToDelete.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    // console.log(`[ProjectService] Cleaned up ${versionsToDelete.length} old auto-save versions`);
};

// ============= 数据清理 =============

/**
 * 清理状态数据（移除 base64、blob、undefined 等）
 */
const cleanStateData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(cleanStateData);

    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
        // 跳过这些字段
        if (key === 'base64Data' || key === 'fileObj' || key === 'blob') continue;
        if (value instanceof Blob || value instanceof File) continue;
        if (value === undefined) continue;

        // 处理字符串
        if (typeof value === 'string') {
            if (value.length > 100000) {
                // 大字符串截断
                if (value.startsWith('data:image')) {
                    cleaned[key] = '[base64-image]';
                } else {
                    cleaned[key] = value.slice(0, 2000) + '...[truncated]';
                }
            } else if (value.startsWith('blob:')) {
                // 跳过 blob URL
                continue;
            } else {
                cleaned[key] = value;
            }
        } else if (typeof value === 'object') {
            cleaned[key] = cleanStateData(value);
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned;
};

// ============= 获取或创建默认项目 =============

/**
 * 获取或创建默认项目
 */
export const getOrCreateDefaultProject = async (
    userId: string,
    moduleId: ModuleId,
    defaultName: string = '默认项目'
): Promise<Project> => {
    // 先尝试获取激活的项目
    let project = await getActiveProject(userId, moduleId);
    if (project) {
        return project;
    }

    // 尝试获取任意项目
    const projects = await listProjects(userId, moduleId, { maxCount: 1 });
    if (projects.length > 0) {
        await setActiveProject(userId, moduleId, projects[0].id);
        return (await getProject(userId, moduleId, projects[0].id))!;
    }

    // 创建默认项目
    const newId = await createProject(userId, {
        moduleId,
        name: defaultName
    });

    return (await getProject(userId, moduleId, newId))!;
};

// 获取或创建共享项目（所有记录都保存到同一个项目中）
// 用于即时翻译等需要累积记录的场景
// 使用固定的项目 ID 确保保存和加载用的是同一个项目
export const getOrCreateSharedProject = async (
    userId: string,
    moduleId: ModuleId,
    sharedName: string = '即时翻译记录'
): Promise<Project> => {
    // 使用固定的项目 ID（基于 moduleId 和 sharedName 生成）
    const fixedProjectId = `shared_${moduleId}_${sharedName.replace(/\s+/g, '_')}`;

    try {
        // 直接尝试获取固定 ID 的项目（使用与 getProjectDoc 相同的路径）
        const projectRef = doc(db, 'users', userId, 'projects', moduleId, 'items', fixedProjectId);
        let projectSnap;
        try {
            projectSnap = await getDocFromServer(projectRef);
        } catch (e) {
            // 离线时 fallback 到缓存
            projectSnap = await getDoc(projectRef);
        }

        if (projectSnap.exists()) {
            // console.log('[ProjectService] Found shared project:', fixedProjectId, 'has currentState:', !!projectSnap.data().currentState);
            return { id: projectSnap.id, ...projectSnap.data() } as Project;
        }

        // 不存在则创建（使用固定 ID）
        // console.log('[ProjectService] Creating shared project:', fixedProjectId);
        const now = serverTimestamp();
        const projectData = {
            moduleId,
            name: sharedName,
            createdAt: now,
            updatedAt: now,
            isActive: true,
            isStarred: false,
            isPinned: false,
            tags: [],
            preview: '',
            itemCount: 0,
            currentState: {},
            versionCount: 0
        };

        await setDoc(projectRef, projectData);

        // 返回创建的项目
        return {
            id: fixedProjectId,
            ...projectData,
            createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
            updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any
        } as Project;
    } catch (error) {
        console.error('[ProjectService] Error getting shared project:', error);
        throw error;
    }
};

// ============= 模块名称 =============

export const getModuleDefaultName = (moduleId: ModuleId): string => {
    const names: Record<ModuleId, string> = {
        'image-recognition': '图片识别项目',
        'smart-translate': '智能翻译项目',
        'smart-translate-instant': '即时翻译记录',
        'desc-innovator': '描述创新项目',
        'desc-chat': '普通对话项目'
    };
    return names[moduleId] || '默认项目';
};

export const getModuleDisplayName = (moduleId: ModuleId): string => {
    const names: Record<ModuleId, string> = {
        'image-recognition': 'AI 图片识别',
        'smart-translate': '智能翻译',
        'smart-translate-instant': '即时翻译',
        'desc-innovator': '提示词工具',
        'desc-chat': '普通对话'
    };
    return names[moduleId] || moduleId;
};

// ============= 时间格式化 =============

export const formatProjectTime = (timestamp: Timestamp): string => {
    if (!timestamp?.toDate) return '';

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

export const formatVersionTime = (timestamp: Timestamp): string => {
    if (!timestamp?.toDate) return '';

    const date = timestamp.toDate();
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
        return `今天 ${timeStr}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `昨天 ${timeStr}`;
    }

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
};
