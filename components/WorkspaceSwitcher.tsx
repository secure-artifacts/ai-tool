/**
 * WorkspaceSwitcher - 项目切换器组件
 * 类似 Google Flow 的项目管理 UI
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
    Workspace,
    listWorkspaces,
    createWorkspace,
    deleteWorkspace,
    renameWorkspace,
    setActiveWorkspace,
    getOrCreateDefaultWorkspace,
    getModuleDefaultName
} from '../services/workspaceService';
import { ModuleId } from '../services/historyService';
import './WorkspaceSwitcher.css';

interface WorkspaceSwitcherProps {
    moduleId: ModuleId;
    onWorkspaceChange: (workspace: Workspace) => void;
    currentState?: any;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
    moduleId,
    onWorkspaceChange,
    currentState
}) => {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // 创建本地默认工作区（未登录时使用）
    const createLocalWorkspace = useCallback((): Workspace => {
        return {
            id: 'local_default',
            moduleId,
            name: '本地项目',
            createdAt: { toDate: () => new Date() } as any,
            updatedAt: { toDate: () => new Date() } as any,
            isActive: true,
            state: {},
            preview: { title: '本地项目', itemCount: 0 }
        };
    }, [moduleId]);

    // 加载工作区列表
    const loadWorkspaces = useCallback(async () => {
        setIsLoading(true);

        // 未登录时使用本地模式
        if (!user?.uid) {
            const localWs = createLocalWorkspace();
            setActiveWorkspaceState(localWs);
            setWorkspaces([localWs]);
            setIsLoading(false);
            return;
        }

        try {
            // 获取或创建默认工作区
            const defaultWs = await getOrCreateDefaultWorkspace(
                user.uid,
                moduleId,
                getModuleDefaultName(moduleId)
            );
            setActiveWorkspaceState(defaultWs);
            onWorkspaceChange(defaultWs);

            // 加载所有工作区
            const list = await listWorkspaces(user.uid, moduleId);
            setWorkspaces(list);
        } catch (error) {
            console.error('[WorkspaceSwitcher] Failed to load workspaces:', error);
            // 出错时使用本地模式
            const localWs = createLocalWorkspace();
            setActiveWorkspaceState(localWs);
            setWorkspaces([localWs]);
        } finally {
            setIsLoading(false);
        }
    }, [user?.uid, moduleId, onWorkspaceChange, createLocalWorkspace]);

    useEffect(() => {
        loadWorkspaces();
    }, [loadWorkspaces]);

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsCreating(false);
                setEditingId(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 生成默认项目名称
    const generateDefaultName = () => {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const hour = now.getHours();
        const minute = now.getMinutes();
        return `项目 ${month}/${day} ${hour}:${minute.toString().padStart(2, '0')}`;
    };

    // 创建新项目（直接使用默认名称）
    const handleCreate = async () => {
        if (!user?.uid) return;

        const defaultName = generateDefaultName();

        // 立即关闭菜单并创建临时项目显示
        setIsOpen(false);
        const tempWorkspace: Workspace = {
            id: 'temp_' + Date.now(),
            moduleId,
            name: defaultName,
            createdAt: { toDate: () => new Date() } as any,
            updatedAt: { toDate: () => new Date() } as any,
            isActive: true,
            state: {},
            preview: { title: defaultName, itemCount: 0 }
        };
        setActiveWorkspaceState(tempWorkspace);
        onWorkspaceChange(tempWorkspace);  // 清空当前状态

        try {
            // 后台创建真正的工作区
            const id = await createWorkspace(user.uid, {
                moduleId,
                name: defaultName
            });

            // 更新工作区列表
            const list = await listWorkspaces(user.uid, moduleId);
            setWorkspaces(list);

            // 找到新创建的工作区并更新
            const newWorkspace = list.find(w => w.id === id);
            if (newWorkspace) {
                setActiveWorkspaceState(newWorkspace);
            }
        } catch (error) {
            console.error('[WorkspaceSwitcher] Failed to create workspace:', error);
        }
    };

    // 切换项目
    const handleSwitch = async (workspace: Workspace) => {
        if (!user?.uid || workspace.id === activeWorkspace?.id) {
            setIsOpen(false);
            return;
        }

        // 立即关闭菜单和更新UI状态，避免卡顿
        setIsOpen(false);
        setActiveWorkspaceState(workspace);

        try {
            // 获取完整的工作区数据（包含 state）
            const { getWorkspace } = await import('../services/workspaceService');
            const fullWorkspace = await getWorkspace(user.uid, moduleId, workspace.id);

            if (fullWorkspace) {
                console.log('[WorkspaceSwitcher] Loaded full workspace:', fullWorkspace.name, 'state:', !!fullWorkspace.state);
                onWorkspaceChange(fullWorkspace);
            } else {
                // 如果获取失败，使用列表中的工作区
                onWorkspaceChange(workspace);
            }

            // 后台更新激活状态（不阻塞）
            setActiveWorkspace(user.uid, moduleId, workspace.id).catch(err => {
                console.error('[WorkspaceSwitcher] Failed to set active:', err);
            });
        } catch (error) {
            console.error('[WorkspaceSwitcher] Failed to switch workspace:', error);
            // 出错时仍然尝试使用列表中的工作区
            onWorkspaceChange(workspace);
        }
    };

    // 删除项目
    const handleDelete = async (e: React.MouseEvent, workspaceId: string) => {
        e.stopPropagation();
        if (!user?.uid) return;

        if (!confirm('确定删除这个项目吗？此操作无法撤销。')) return;

        try {
            await deleteWorkspace(user.uid, moduleId, workspaceId);
            await loadWorkspaces();
        } catch (error) {
            console.error('[WorkspaceSwitcher] Failed to delete workspace:', error);
        }
    };

    // 开始重命名
    const startRename = (e: React.MouseEvent, workspace: Workspace) => {
        e.stopPropagation();
        setEditingId(workspace.id);
        setEditName(workspace.name);
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    // 保存重命名
    const saveRename = async () => {
        if (!user?.uid || !editingId || !editName.trim()) {
            setEditingId(null);
            return;
        }

        try {
            await renameWorkspace(user.uid, moduleId, editingId, editName.trim());
            setEditingId(null);
            await loadWorkspaces();
        } catch (error) {
            console.error('[WorkspaceSwitcher] Failed to rename workspace:', error);
        }
    };

    // 格式化时间
    const formatTime = (timestamp: any): string => {
        if (!timestamp?.toDate) return '';

        const date = timestamp.toDate();
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        } else if (diffDays === 1) {
            return '昨天';
        } else if (diffDays < 7) {
            return `${diffDays}天前`;
        } else {
            return `${date.getMonth() + 1}月${date.getDate()}日`;
        }
    };

    // 是否为本地模式（未登录）
    const isLocalMode = !user?.uid;

    return (
        <div className="workspace-switcher" ref={dropdownRef}>
            {/* 触发按钮 */}
            <button
                className="workspace-switcher-trigger"
                onClick={() => setIsOpen(!isOpen)}
                disabled={isLoading}
            >
                <span className="workspace-icon">📁</span>
                <span className="workspace-name">
                    {isLoading ? '加载中...' : (activeWorkspace?.name || '选择项目')}
                </span>
                <span className={`workspace-arrow ${isOpen ? 'open' : ''}`}>▼</span>
            </button>

            {/* 下拉菜单 */}
            {isOpen && (
                <div className="workspace-dropdown">
                    <div className="workspace-list">
                        {workspaces.map(workspace => (
                            <div
                                key={workspace.id}
                                className={`workspace-item ${workspace.id === activeWorkspace?.id ? 'active' : ''}`}
                                onClick={() => handleSwitch(workspace)}
                            >
                                {editingId === workspace.id ? (
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        className="workspace-edit-input"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={saveRename}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveRename();
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <>
                                        <span className="workspace-item-icon">📁</span>
                                        <span className="workspace-item-name">{workspace.name}</span>
                                        {workspace.id === activeWorkspace?.id && (
                                            <span className="workspace-item-check">✓</span>
                                        )}
                                        <span className="workspace-item-time">
                                            {formatTime(workspace.updatedAt)}
                                        </span>
                                        <div className="workspace-item-actions">
                                            <button
                                                className="workspace-action-btn"
                                                onClick={(e) => startRename(e, workspace)}
                                                title="重命名"
                                            >
                                                ✏️
                                            </button>
                                            {workspaces.length > 1 && (
                                                <button
                                                    className="workspace-action-btn delete"
                                                    onClick={(e) => handleDelete(e, workspace.id)}
                                                    title="删除"
                                                >
                                                    🗑️
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="workspace-divider" />

                    {/* 新建项目 - 直接使用日期作为默认名称 */}
                    <button
                        className="workspace-add-btn"
                        onClick={handleCreate}
                    >
                        <span>➕</span>
                        <span>新建项目</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default WorkspaceSwitcher;
