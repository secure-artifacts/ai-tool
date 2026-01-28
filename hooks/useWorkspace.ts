/**
 * useWorkspace Hook - 工作区状态管理
 * 简化组件与 WorkspaceService 的集成
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    Workspace,
    getOrCreateDefaultWorkspace,
    debouncedSaveState,
    saveState,
    getModuleDefaultName
} from '../services/workspaceService';
import { compressStateImages } from '../services/imageCompressionService';
import { ModuleId } from '../services/historyService';

interface UseWorkspaceOptions<T> {
    moduleId: ModuleId;
    defaultState: T;
    // 可选：自定义如何从工作区恢复状态
    onRestore?: (state: T) => void;
    // 可选：自定义如何生成预览
    getPreview?: (state: T) => { title?: string; itemCount?: number; thumbnail?: string };
    // 可选：是否压缩图片
    compressImages?: boolean;
}

interface UseWorkspaceResult<T> {
    // 当前工作区
    workspace: Workspace<T> | null;
    // 是否正在加载
    isLoading: boolean;
    // 保存状态（自动防抖）
    saveWorkspaceState: (state: T) => void;
    // 立即保存状态
    saveWorkspaceStateNow: (state: T) => Promise<void>;
    // 切换工作区后的回调
    handleWorkspaceChange: (workspace: Workspace<T>) => void;
    // 是否已初始化
    isInitialized: boolean;
}

export function useWorkspace<T>(options: UseWorkspaceOptions<T>): UseWorkspaceResult<T> {
    const { moduleId, defaultState, onRestore, getPreview, compressImages = true } = options;
    const { user } = useAuth();

    const [workspace, setWorkspace] = useState<Workspace<T> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialized, setIsInitialized] = useState(false);

    // 用于跟踪是否已从工作区恢复过状态
    const hasRestoredRef = useRef(false);

    // 初始化工作区
    useEffect(() => {
        if (!user?.uid) {
            setIsLoading(false);
            return;
        }

        const init = async () => {
            try {
                setIsLoading(true);
                const ws = await getOrCreateDefaultWorkspace(
                    user.uid,
                    moduleId,
                    getModuleDefaultName(moduleId)
                );
                setWorkspace(ws);

                // 如果工作区有保存的状态，恢复它
                if (ws.state && Object.keys(ws.state).length > 0 && !hasRestoredRef.current) {
                    hasRestoredRef.current = true;
                    console.log(`[useWorkspace] Restoring state for ${moduleId}:`, ws.state);
                    onRestore?.(ws.state as T);
                }

                setIsInitialized(true);
            } catch (error) {
                console.error('[useWorkspace] Failed to initialize:', error);
            } finally {
                setIsLoading(false);
            }
        };

        init();
    }, [user?.uid, moduleId, onRestore]);

    // 保存状态（防抖）
    const saveWorkspaceState = useCallback((state: T) => {
        if (!user?.uid || !workspace?.id) {
            console.warn('[useWorkspace] Cannot save: no user or workspace');
            return;
        }

        const preview = getPreview?.(state);

        // 异步压缩并保存
        const saveAsync = async () => {
            let stateToSave = state;

            if (compressImages) {
                try {
                    stateToSave = await compressStateImages(state);
                } catch (error) {
                    console.warn('[useWorkspace] Image compression failed, saving original:', error);
                }
            }

            debouncedSaveState(user.uid, moduleId, workspace.id, stateToSave, preview);
        };

        saveAsync();
    }, [user?.uid, workspace?.id, moduleId, getPreview, compressImages]);

    // 立即保存状态
    const saveWorkspaceStateNow = useCallback(async (state: T) => {
        if (!user?.uid || !workspace?.id) {
            console.warn('[useWorkspace] Cannot save: no user or workspace');
            return;
        }

        const preview = getPreview?.(state);

        let stateToSave = state;
        if (compressImages) {
            try {
                stateToSave = await compressStateImages(state);
            } catch (error) {
                console.warn('[useWorkspace] Image compression failed, saving original:', error);
            }
        }

        await saveState(user.uid, moduleId, workspace.id, stateToSave, preview);
    }, [user?.uid, workspace?.id, moduleId, getPreview, compressImages]);

    // 切换工作区
    const handleWorkspaceChange = useCallback((newWorkspace: Workspace<T>) => {
        setWorkspace(newWorkspace);

        // 恢复新工作区的状态
        if (newWorkspace.state && Object.keys(newWorkspace.state).length > 0) {
            console.log(`[useWorkspace] Switching to workspace: ${newWorkspace.name}`);
            onRestore?.(newWorkspace.state as T);
        } else {
            // 新工作区没有状态，使用默认状态
            console.log(`[useWorkspace] New workspace, using default state`);
            onRestore?.(defaultState);
        }
    }, [onRestore, defaultState]);

    return {
        workspace,
        isLoading,
        saveWorkspaceState,
        saveWorkspaceStateNow,
        handleWorkspaceChange,
        isInitialized
    };
}

export default useWorkspace;
