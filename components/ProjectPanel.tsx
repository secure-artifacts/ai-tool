/**
 * ProjectPanel - 统一项目管理面板
 * 
 * 功能：
 * - 项目列表（卡片式 + 列表式切换）
 * - 版本历史管理
 * - 快速回滚
 * - 星标/固定
 * - 搜索筛选
 * - 标签管理
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import {
    ModuleId,
    Project,
    ProjectListItem,
    ProjectVersion,
    listProjects,
    getProject,
    createProject,
    deleteProject,
    renameProject,
    setActiveProject,
    toggleProjectStar,
    toggleProjectPin,
    duplicateProject,
    listVersions,
    restoreVersion,
    createVersion,
    deleteVersion,
    toggleVersionStar,
    updateVersionLabel,
    formatProjectTime,
    formatVersionTime,
    getModuleDisplayName
} from '../services/projectService';

// ============= 类型定义 =============

interface ProjectPanelProps {
    isOpen: boolean;
    onClose: () => void;
    moduleId: ModuleId;
    currentProjectId?: string;
    onProjectChange: (project: Project) => void;
    onCreateNew: () => void;
}

type ViewMode = 'grid' | 'list';
type TabMode = 'projects' | 'versions';

const normalizeTimestamp = (value: any): Timestamp => {
    if (value?.toDate) return value as Timestamp;
    if (typeof value === 'number') return Timestamp.fromMillis(value);
    return Timestamp.fromMillis(0);
};

const getTimestampMs = (value: any): number => {
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (typeof value === 'number') return value;
    return 0;
};

const dedupeProjects = (items: ProjectListItem[]): ProjectListItem[] => {
    const map = new Map<string, ProjectListItem>();
    for (const item of items) {
        const normalized = {
            ...item,
            createdAt: normalizeTimestamp(item.createdAt),
            updatedAt: normalizeTimestamp(item.updatedAt)
        } as ProjectListItem;
        const existing = map.get(normalized.id);
        if (!existing || getTimestampMs(normalized.updatedAt) >= getTimestampMs(existing.updatedAt)) {
            map.set(normalized.id, normalized);
        }
    }
    return Array.from(map.values());
};

// ============= 组件 =============

const ProjectPanel: React.FC<ProjectPanelProps> = ({
    isOpen,
    onClose,
    moduleId,
    currentProjectId,
    onProjectChange,
    onCreateNew
}) => {
    const { user } = useAuth();

    // 获取有效的用户ID（登录用户用uid，未登录用邮箱的Base64编码）
    const getEffectiveUserId = (): string | null => {
        if (user?.uid) return user.uid;

        // 尝试使用邮箱云同步的邮箱作为虚拟用户ID
        if (typeof window !== 'undefined') {
            const syncEmail = localStorage.getItem('cloud_sync_email');
            if (syncEmail) {
                // 使用邮箱的 Base64 编码作为虚拟用户ID（与 cloudSyncService 保持一致）
                return `email_${btoa(syncEmail.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '_')}`;
            }
        }
        return null;
    };

    const effectiveUserId = getEffectiveUserId();

    // 状态
    const [projects, setProjects] = useState<ProjectListItem[]>([]);
    const [versions, setVersions] = useState<ProjectVersion[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // UI 状态
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [tabMode, setTabMode] = useState<TabMode>('projects');
    const [searchText, setSearchText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');

    // 版本相关状态
    const [viewingVersionProject, setViewingVersionProject] = useState<ProjectListItem | null>(null);
    const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
    const [editVersionLabel, setEditVersionLabel] = useState('');
    const [isSwitchingProject, setIsSwitchingProject] = useState(false); // 切换项目时的加载状态
    const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);

    // 加载项目列表
    const loadProjects = useCallback(async () => {
        if (!effectiveUserId) {
            // 如果没有 effectiveUserId，尝试从邮箱云同步加载
            try {
                const { getSavedSyncEmail, pullFromCloud } = await import('@/services/cloudSyncService');
                const syncEmail = getSavedSyncEmail();
                if (syncEmail) {
                    setIsLoading(true);
                    const cloudData = await pullFromCloud(syncEmail);
                    if (cloudData?.projects && cloudData.projects.length > 0) {
                        // 过滤当前模块的项目
                        const moduleProjects = cloudData.projects
                            .filter((p: any) => p.moduleId === moduleId)
                            .map((p: any) => ({
                                id: p.id,
                                moduleId: p.moduleId,
                                name: p.name,
                                createdAt: p.createdAt,
                                updatedAt: p.updatedAt,
                                isStarred: p.isStarred || false,
                                isPinned: p.isPinned || false,
                                isActive: p.isActive || false,
                                versionCount: p.versionCount || 0,
                                tags: p.tags || [],
                                preview: p.preview || '',
                                itemCount: p.itemCount || 0,
                                thumbnail: p.thumbnail
                            }));
                        setProjects(dedupeProjects(moduleProjects));
                        console.log('[ProjectPanel] Loaded', moduleProjects.length, 'projects from email sync');
                    }
                    setIsLoading(false);
                }
            } catch (e) {
                console.error('[ProjectPanel] Failed to load from email sync:', e);
            }
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const data = await listProjects(effectiveUserId, moduleId, { maxCount: 100 });
            setProjects(dedupeProjects(data));

            // 如果没有 Firebase 项目，尝试从邮箱云同步加载
            if (data.length === 0) {
                try {
                    const { getSavedSyncEmail, pullFromCloud } = await import('@/services/cloudSyncService');
                    const syncEmail = getSavedSyncEmail();
                    if (syncEmail) {
                        const cloudData = await pullFromCloud(syncEmail);
                        if (cloudData?.projects && cloudData.projects.length > 0) {
                            const moduleProjects = cloudData.projects
                                .filter((p: any) => p.moduleId === moduleId)
                                .map((p: any) => ({
                                    id: p.id,
                                    moduleId: p.moduleId,
                                    name: p.name,
                                    createdAt: p.createdAt,
                                    updatedAt: p.updatedAt,
                                    isStarred: p.isStarred || false,
                                    isPinned: p.isPinned || false,
                                    isActive: p.isActive || false,
                                    versionCount: p.versionCount || 0,
                                    tags: p.tags || [],
                                    preview: p.preview || '',
                                    itemCount: p.itemCount || 0,
                                    thumbnail: p.thumbnail
                                }));
                            if (moduleProjects.length > 0) {
                                setProjects(dedupeProjects(moduleProjects));
                                console.log('[ProjectPanel] Loaded', moduleProjects.length, 'projects from email sync (fallback)');
                            }
                        }
                    }
                } catch (e) {
                    console.error('[ProjectPanel] Fallback email sync load failed:', e);
                }
            }
        } catch (err: any) {
            console.error('[ProjectPanel] Load error:', err);
            setError(err.message || '加载失败');
        } finally {
            setIsLoading(false);
        }
    }, [effectiveUserId, moduleId]);

    // 加载版本列表
    const loadVersions = useCallback(async (projectId: string) => {
        if (!effectiveUserId) return;

        setIsLoading(true);
        try {
            const data = await listVersions(effectiveUserId, moduleId, projectId, 50);
            setVersions(data);
        } catch (err: any) {
            console.error('[ProjectPanel] Load versions error:', err);
            setError(err.message || '加载版本失败');
        } finally {
            setIsLoading(false);
        }
    }, [effectiveUserId, moduleId]);

    // 打开时加载
    useEffect(() => {
        if (isOpen && effectiveUserId) {
            loadProjects();
            setTabMode('projects');
            setViewingVersionProject(null);
            setSearchText('');
        }
    }, [isOpen, effectiveUserId, loadProjects]);

    // 筛选项目
    const filteredProjects = useMemo(() => {
        if (!searchText.trim()) return projects;

        const query = searchText.toLowerCase();
        return projects.filter(p =>
            p.name.toLowerCase().includes(query) ||
            p.preview.toLowerCase().includes(query) ||
            p.tags.some(t => t.toLowerCase().includes(query))
        );
    }, [projects, searchText]);

    // 分组项目（固定 + 星标 + 普通）
    const groupedProjects = useMemo(() => {
        const pinned = filteredProjects.filter(p => p.isPinned);
        const starred = filteredProjects.filter(p => p.isStarred && !p.isPinned);
        const normal = filteredProjects.filter(p => !p.isStarred && !p.isPinned);

        return { pinned, starred, normal };
    }, [filteredProjects]);

    // 操作：切换项目
    const handleSwitchProject = async (project: ProjectListItem) => {
        console.log('[ProjectPanel] handleSwitchProject called for:', project.id, project.name);

        if (!effectiveUserId) {
            console.log('[ProjectPanel] No effectiveUserId, aborting');
            return;
        }

        // 防止重复点击
        if (isSwitchingProject) {
            console.log('[ProjectPanel] Already switching project, ignoring click');
            return;
        }

        console.log('[ProjectPanel] Starting project switch...');
        setSwitchingProjectId(project.id);
        setIsSwitchingProject(true);

        try {
            console.log('[ProjectPanel] Fetching full project data...');
            let fullProject = await getProject(effectiveUserId, moduleId, project.id);
            console.log('[ProjectPanel] getProject result:', fullProject ? 'success' : 'null');

            // 如果 Firebase 无法获取项目，尝试从云同步获取或构建项目
            if (!fullProject) {
                console.log('[ProjectPanel] Firebase project not found, trying cloud sync fallback...');
                try {
                    const { getSavedSyncEmail, pullFromCloud } = await import('@/services/cloudSyncService');
                    const syncEmail = getSavedSyncEmail();
                    if (syncEmail) {
                        const cloudData = await pullFromCloud(syncEmail);
                        if (cloudData) {
                            // 从云同步数据构建完整项目对象
                            console.log('[ProjectPanel] Cloud data found, constructing project from cloud sync...');

                            fullProject = {
                                id: project.id,
                                moduleId: moduleId,
                                name: project.name,
                                createdAt: project.createdAt ?? { seconds: Date.now() / 1000, nanoseconds: 0 },
                                updatedAt: project.updatedAt ?? { seconds: Date.now() / 1000, nanoseconds: 0 },
                                isActive: true,
                                isStarred: project.isStarred || false,
                                isPinned: project.isPinned || false,
                                tags: project.tags || [],
                                preview: project.preview || '',
                                itemCount: project.itemCount || 0,
                                thumbnail: project.thumbnail,
                                versionCount: 0,
                                // 使用云同步数据作为当前状态
                                currentState: {
                                    images: cloudData.images || [],
                                    prompt: cloudData.prompt || '',
                                    innovationInstruction: cloudData.innovationInstruction || '',
                                    copyMode: cloudData.copyMode || 'resultOnly',
                                    viewMode: cloudData.viewMode || 'list',
                                    autoUploadGyazo: cloudData.autoUploadGyazo ?? true,
                                    pureReplyMode: cloudData.pureReplyMode ?? false
                                }
                            } as any;
                            console.log('[ProjectPanel] Built project from cloud sync with', cloudData.images?.length || 0, 'images');
                        }
                    }
                } catch (cloudError) {
                    console.error('[ProjectPanel] Cloud sync fallback failed:', cloudError);
                }
            }

            if (fullProject) {
                console.log('[ProjectPanel] Setting active project...');
                // 只有当 Firebase 有这个项目时才设置激活状态
                try {
                    await setActiveProject(effectiveUserId, moduleId, project.id);
                } catch (e) {
                    console.log('[ProjectPanel] setActiveProject failed (may be cloud-only project):', e);
                }
                console.log('[ProjectPanel] Calling onProjectChange...');
                onProjectChange(fullProject);
                console.log('[ProjectPanel] Calling onClose...');
                onClose();
                console.log('[ProjectPanel] Switch complete!');
            } else {
                console.error('[ProjectPanel] fullProject is null, cannot switch');
                setError('无法加载项目数据');
            }
        } catch (err: any) {
            console.error('[ProjectPanel] Error switching project:', err);
            setError(err.message || '切换项目失败');
        } finally {
            setIsSwitchingProject(false);
            setSwitchingProjectId(null);
        }
    };

    // 操作：创建新项目
    const handleCreateProject = async () => {
        if (!effectiveUserId) return;

        const name = newProjectName.trim() || generateDefaultName();

        try {
            const projectId = await createProject(effectiveUserId, {
                moduleId,
                name
            });

            const newProject = await getProject(effectiveUserId, moduleId, projectId);
            if (newProject) {
                onProjectChange(newProject);
            }

            setShowCreateModal(false);
            setNewProjectName('');
            onClose();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：删除项目
    const handleDeleteProject = async (projectId: string) => {
        if (!effectiveUserId) return;

        try {
            await deleteProject(effectiveUserId, moduleId, projectId);
            setDeleteConfirmId(null);
            await loadProjects();

            // 如果删除的是当前项目，切换到第一个可用项目
            if (projectId === currentProjectId) {
                const remaining = projects.filter(p => p.id !== projectId);
                if (remaining.length > 0) {
                    await handleSwitchProject(remaining[0]);
                } else {
                    onCreateNew();
                }
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：重命名
    const handleRename = async () => {
        if (!effectiveUserId || !editingId || !editName.trim()) {
            setEditingId(null);
            return;
        }

        try {
            await renameProject(effectiveUserId, moduleId, editingId, editName.trim());
            setEditingId(null);
            await loadProjects();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：切换星标
    const handleToggleStar = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        if (!effectiveUserId) return;

        try {
            await toggleProjectStar(effectiveUserId, moduleId, projectId);
            await loadProjects();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：切换固定
    const handleTogglePin = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        if (!effectiveUserId) return;

        try {
            await toggleProjectPin(effectiveUserId, moduleId, projectId);
            await loadProjects();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：复制项目
    const handleDuplicate = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        if (!effectiveUserId) return;

        try {
            await duplicateProject(effectiveUserId, moduleId, projectId);
            await loadProjects();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：查看版本历史
    const handleViewVersions = async (e: React.MouseEvent, project: ProjectListItem) => {
        e.stopPropagation();
        if (!effectiveUserId) return;

        setViewingVersionProject(project);
        setTabMode('versions');
        await loadVersions(project.id);
    };

    // 操作：恢复版本
    const handleRestoreVersion = async (version: ProjectVersion) => {
        if (!effectiveUserId || !viewingVersionProject) return;

        try {
            await restoreVersion(effectiveUserId, moduleId, viewingVersionProject.id, version.id);

            // 重新加载项目
            const updatedProject = await getProject(effectiveUserId, moduleId, viewingVersionProject.id);
            if (updatedProject) {
                onProjectChange(updatedProject);
            }

            setTabMode('projects');
            setViewingVersionProject(null);
            onClose();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：切换版本星标
    const handleToggleVersionStar = async (e: React.MouseEvent, versionId: string) => {
        e.stopPropagation();
        if (!effectiveUserId || !viewingVersionProject) return;

        try {
            await toggleVersionStar(effectiveUserId, moduleId, viewingVersionProject.id, versionId);
            await loadVersions(viewingVersionProject.id);
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：更新版本标签
    const handleUpdateVersionLabel = async () => {
        if (!effectiveUserId || !viewingVersionProject || !editingVersionId) {
            setEditingVersionId(null);
            return;
        }

        try {
            await updateVersionLabel(effectiveUserId, moduleId, viewingVersionProject.id, editingVersionId, editVersionLabel);
            setEditingVersionId(null);
            await loadVersions(viewingVersionProject.id);
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 操作：删除版本
    const handleDeleteVersion = async (e: React.MouseEvent, versionId: string) => {
        e.stopPropagation();
        if (!effectiveUserId || !viewingVersionProject) return;

        if (!confirm('确定删除这个版本吗？')) return;

        try {
            await deleteVersion(effectiveUserId, moduleId, viewingVersionProject.id, versionId);
            await loadVersions(viewingVersionProject.id);
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 生成默认名称
    const generateDefaultName = () => {
        const now = new Date();
        return `项目 ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    };

    // 渲染项目卡片
    const renderProjectCard = (project: ProjectListItem) => {
        const isActive = project.id === currentProjectId;
        const isEditing = editingId === project.id;
        const isSwitchingThis = isSwitchingProject && switchingProjectId === project.id;

        return (
            <div
                key={project.id}
                className={`project-card ${isActive ? 'active' : ''} ${project.isStarred ? 'starred' : ''} ${project.isPinned ? 'pinned' : ''} ${isSwitchingThis ? 'switching' : ''}`}
                onClick={() => !isEditing && !isSwitchingProject && handleSwitchProject(project)}
                style={{ cursor: isSwitchingProject ? 'wait' : 'pointer' }}
            >
                {/* 缩略图 */}
                <div className="project-card-thumbnail">
                    {project.thumbnail ? (
                        <img src={project.thumbnail} alt="" onError={(e) => e.currentTarget.style.display = 'none'} />
                    ) : (
                        <div className="project-card-thumbnail-placeholder">
                            {moduleId === 'image-recognition' ? '🖼️' : moduleId === 'smart-translate' ? '🌐' : '✨'}
                        </div>
                    )}

                    {/* 状态角标 */}
                    <div className="project-card-badges">
                        {project.isPinned && <span className="badge pin">📌</span>}
                        {project.isStarred && <span className="badge star">⭐</span>}
                        {isActive && <span className="badge current">当前</span>}
                    </div>
                </div>

                {/* 信息 */}
                <div className="project-card-info">
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="project-card-name-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={handleRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename();
                                if (e.key === 'Escape') setEditingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                        />
                    ) : (
                        <h4 className="project-card-name">{project.name}</h4>
                    )}

                    <p className="project-card-preview">{project.preview || '空项目'}</p>

                    <div className="project-card-meta">
                        <span className="project-card-count">{project.itemCount} 项</span>
                        <span className="project-card-time">{formatProjectTime(project.updatedAt)}</span>
                    </div>

                    {/* 标签 */}
                    {project.tags.length > 0 && (
                        <div className="project-card-tags">
                            {project.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="project-tag">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* 操作按钮 */}
                <div className="project-card-actions">
                    <button
                        className="project-action-btn"
                        onClick={(e) => handleToggleStar(e, project.id)}
                        title={project.isStarred ? '取消星标' : '添加星标'}
                    >
                        {project.isStarred ? '⭐' : '☆'}
                    </button>
                    <button
                        className="project-action-btn"
                        onClick={(e) => handleTogglePin(e, project.id)}
                        title={project.isPinned ? '取消固定' : '固定'}
                    >
                        {project.isPinned ? '📌' : '📍'}
                    </button>
                    <button
                        className="project-action-btn"
                        onClick={(e) => handleViewVersions(e, project)}
                        title="版本历史"
                    >
                        🕐
                    </button>
                    <button
                        className="project-action-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(project.id);
                            setEditName(project.name);
                        }}
                        title="重命名"
                    >
                        ✏️
                    </button>
                    <button
                        className="project-action-btn"
                        onClick={(e) => handleDuplicate(e, project.id)}
                        title="复制"
                    >
                        📋
                    </button>
                    {deleteConfirmId === project.id ? (
                        <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleDeleteProject(project.id)}>确认</button>
                            <button onClick={() => setDeleteConfirmId(null)}>取消</button>
                        </div>
                    ) : (
                        <button
                            className="project-action-btn delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(project.id);
                            }}
                            title="删除"
                        >
                            🗑️
                        </button>
                    )}
                </div>

                {isSwitchingThis && (
                    <div className="project-card-switching-overlay">
                        <span className="switching-spinner" />
                        <span>正在切换…</span>
                    </div>
                )}
            </div>
        );
    };

    // 渲染版本项
    const renderVersionItem = (version: ProjectVersion) => {
        const isEditing = editingVersionId === version.id;

        return (
            <div
                key={version.id}
                className={`version-item ${version.isStarred ? 'starred' : ''} ${!version.isAutoSave ? 'manual' : ''}`}
                onClick={() => handleRestoreVersion(version)}
            >
                <div className="version-info">
                    <div className="version-header">
                        {isEditing ? (
                            <input
                                type="text"
                                className="version-label-input"
                                value={editVersionLabel}
                                onChange={(e) => setEditVersionLabel(e.target.value)}
                                onBlur={handleUpdateVersionLabel}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateVersionLabel();
                                    if (e.key === 'Escape') setEditingVersionId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="添加标签..."
                                autoFocus
                            />
                        ) : (
                            <span className="version-label">
                                {version.label || (version.isAutoSave ? '自动保存' : '手动保存')}
                            </span>
                        )}
                        <span className="version-time">{formatVersionTime(version.createdAt)}</span>
                    </div>

                    <p className="version-preview">{version.preview || '无预览'}</p>

                    <div className="version-meta">
                        <span>{version.itemCount} 项</span>
                        {version.isAutoSave && <span className="auto-save-badge">自动</span>}
                    </div>
                </div>

                <div className="version-actions">
                    <button
                        className="version-action-btn"
                        onClick={(e) => handleToggleVersionStar(e, version.id)}
                        title={version.isStarred ? '取消星标' : '保留此版本'}
                    >
                        {version.isStarred ? '⭐' : '☆'}
                    </button>
                    <button
                        className="version-action-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingVersionId(version.id);
                            setEditVersionLabel(version.label || '');
                        }}
                        title="编辑标签"
                    >
                        🏷️
                    </button>
                    <button
                        className="version-action-btn restore"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRestoreVersion(version);
                        }}
                        title="恢复到此版本"
                    >
                        ↩️
                    </button>
                    <button
                        className="version-action-btn delete"
                        onClick={(e) => handleDeleteVersion(e, version.id)}
                        title="删除"
                    >
                        🗑️
                    </button>
                </div>
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <>
            {/* 背景遮罩 */}
            <div
                className="project-panel-overlay"
                onClick={onClose}
            />

            {/* 主面板 */}
            <div className="project-panel">
                {/* 头部 */}
                <div className="project-panel-header">
                    <div className="project-panel-title-row">
                        <div>
                            <h2 className="project-panel-title">
                                {tabMode === 'versions' && viewingVersionProject
                                    ? `📜 ${viewingVersionProject.name} 的版本历史`
                                    : '📁 项目管理'
                                }
                            </h2>
                            <p className="project-panel-subtitle">
                                {getModuleDisplayName(moduleId)} · {projects.length} 个项目
                            </p>
                        </div>
                        <button className="project-panel-close" onClick={onClose}>✕</button>
                    </div>

                    {/* 工具栏 */}
                    <div className="project-panel-toolbar">
                        {tabMode === 'projects' ? (
                            <>
                                {/* 搜索 */}
                                <div className="project-search">
                                    <span className="project-search-icon">🔍</span>
                                    <input
                                        type="text"
                                        placeholder="搜索项目..."
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                    />
                                </div>

                                {/* 视图切换 */}
                                <div className="project-view-toggle">
                                    <button
                                        className={viewMode === 'grid' ? 'active' : ''}
                                        onClick={() => setViewMode('grid')}
                                        title="卡片视图"
                                    >
                                        ▦
                                    </button>
                                    <button
                                        className={viewMode === 'list' ? 'active' : ''}
                                        onClick={() => setViewMode('list')}
                                        title="列表视图"
                                    >
                                        ≡
                                    </button>
                                </div>

                                {isSwitchingProject && (
                                    <div className="project-switching-indicator">
                                        <span className="switching-spinner small" />
                                        <span>正在切换项目...</span>
                                    </div>
                                )}

                                {/* 新建 */}
                                <button
                                    className="project-create-btn"
                                    onClick={() => setShowCreateModal(true)}
                                >
                                    ➕ 新建项目
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    className="project-back-btn"
                                    onClick={() => {
                                        setTabMode('projects');
                                        setViewingVersionProject(null);
                                    }}
                                >
                                    ← 返回项目列表
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 内容区 */}
                <div className="project-panel-content">
                    {/* 未登录且无邮箱同步 */}
                    {!effectiveUserId && (
                        <div className="project-panel-empty">
                            <span className="empty-icon">🔒</span>
                            <h3>需要登录或配置云同步</h3>
                            <p>登录后即可访问您的项目</p>
                            <p style={{ fontSize: '0.85em', opacity: 0.7, marginTop: '8px' }}>
                                或点击 ☁️ 云同步按钮使用邮箱同步数据（无需登录）
                            </p>
                        </div>
                    )}

                    {/* 加载中 */}
                    {effectiveUserId && isLoading && (
                        <div className="project-panel-loading">
                            <div className="loading-spinner" />
                            <p>加载中...</p>
                        </div>
                    )}

                    {/* 错误提示 */}
                    {error && (
                        <div className="project-panel-error">
                            <span>❌ {error}</span>
                            <button onClick={() => setError(null)}>关闭</button>
                        </div>
                    )}

                    {/* 项目列表 */}
                    {effectiveUserId && !isLoading && tabMode === 'projects' && (
                        <>
                            {filteredProjects.length === 0 ? (
                                <div className="project-panel-empty">
                                    <span className="empty-icon">📂</span>
                                    <h3>{searchText ? '未找到项目' : '暂无项目'}</h3>
                                    <p>点击"新建项目"开始创作</p>
                                </div>
                            ) : (
                                <div className={`project-list ${viewMode}`}>
                                    {/* 固定项目 */}
                                    {groupedProjects.pinned.length > 0 && (
                                        <div className="project-group">
                                            <h3 className="project-group-title">
                                                📌 固定项目
                                                <span className="project-group-count">{groupedProjects.pinned.length}</span>
                                            </h3>
                                            <div className="project-group-items">
                                                {groupedProjects.pinned.map(renderProjectCard)}
                                            </div>
                                        </div>
                                    )}

                                    {/* 星标项目 */}
                                    {groupedProjects.starred.length > 0 && (
                                        <div className="project-group">
                                            <h3 className="project-group-title">
                                                ⭐ 星标项目
                                                <span className="project-group-count">{groupedProjects.starred.length}</span>
                                            </h3>
                                            <div className="project-group-items">
                                                {groupedProjects.starred.map(renderProjectCard)}
                                            </div>
                                        </div>
                                    )}

                                    {/* 普通项目 */}
                                    {groupedProjects.normal.length > 0 && (
                                        <div className="project-group">
                                            <h3 className="project-group-title">
                                                📁 全部项目
                                                <span className="project-group-count">{groupedProjects.normal.length}</span>
                                            </h3>
                                            <div className="project-group-items">
                                                {groupedProjects.normal.map(renderProjectCard)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* 版本历史 */}
                    {effectiveUserId && !isLoading && tabMode === 'versions' && (
                        <>
                            {versions.length === 0 ? (
                                <div className="project-panel-empty">
                                    <span className="empty-icon">📜</span>
                                    <h3>暂无版本历史</h3>
                                    <p>项目的版本快照会在这里显示</p>
                                </div>
                            ) : (
                                <div className="version-list">
                                    {versions.map(renderVersionItem)}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* 新建项目弹框 */}
            {showCreateModal && (
                <div className="project-modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="project-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>新建项目</h3>
                        <input
                            type="text"
                            placeholder={generateDefaultName()}
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateProject();
                                if (e.key === 'Escape') setShowCreateModal(false);
                            }}
                            autoFocus
                        />
                        <div className="project-modal-actions">
                            <button className="cancel" onClick={() => setShowCreateModal(false)}>取消</button>
                            <button className="confirm" onClick={handleCreateProject}>创建</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                /* ============= 面板基础 ============= */
                .project-panel-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }
                
                .project-panel {
                    position: fixed;
                    right: 0;
                    top: 0;
                    height: 100%;
                    width: 600px;
                    max-width: 95vw;
                    background: linear-gradient(135deg, #18181b 0%, #09090b 100%);
                    border-left: 1px solid rgba(255, 255, 255, 0.1);
                    z-index: 1001;
                    display: flex;
                    flex-direction: column;
                    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: -20px 0 60px rgba(0,0,0,0.5);
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                
                /* ============= 头部 ============= */
                .project-panel-header {
                    padding: 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    background: rgba(0, 0, 0, 0.3);
                }
                
                .project-panel-title-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 20px;
                }
                
                .project-panel-title {
                    font-size: 1.5rem;
                    font-weight: 700;
                    background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    margin: 0;
                }
                
                .project-panel-subtitle {
                    font-size: 0.75rem;
                    color: #71717a;
                    margin-top: 4px;
                }
                
                .project-panel-close {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    background: rgba(255, 255, 255, 0.05);
                    color: #71717a;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .project-panel-close:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                
                /* ============= 工具栏 ============= */
                .project-panel-toolbar {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }

                .project-switching-indicator {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 10px;
                    border-radius: 10px;
                    background: rgba(245, 158, 11, 0.12);
                    color: #f59e0b;
                    font-size: 12px;
                    white-space: nowrap;
                }

                .switching-spinner {
                    width: 14px;
                    height: 14px;
                    border: 2px solid rgba(245, 158, 11, 0.3);
                    border-top-color: #f59e0b;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                .switching-spinner.small {
                    width: 12px;
                    height: 12px;
                    border-width: 2px;
                }
                
                .project-search {
                    flex: 1;
                    position: relative;
                }
                
                .project-search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 14px;
                    opacity: 0.5;
                }
                
                .project-search input {
                    width: 100%;
                    height: 40px;
                    padding: 0 12px 0 36px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    color: #fff;
                    font-size: 14px;
                    transition: all 0.2s;
                }
                
                .project-search input:focus {
                    outline: none;
                    border-color: #f59e0b;
                    background: rgba(245, 158, 11, 0.05);
                }
                
                .project-view-toggle {
                    display: flex;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    padding: 2px;
                }
                
                .project-view-toggle button {
                    width: 36px;
                    height: 36px;
                    border: none;
                    background: transparent;
                    color: #71717a;
                    cursor: pointer;
                    border-radius: 6px;
                    font-size: 16px;
                    transition: all 0.2s;
                }
                
                .project-view-toggle button.active {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                }
                
                .project-create-btn {
                    height: 40px;
                    padding: 0 16px;
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    border: none;
                    border-radius: 10px;
                    color: #000;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }
                
                .project-create-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
                }
                
                .project-back-btn {
                    height: 40px;
                    padding: 0 16px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    color: #fff;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .project-back-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                }
                
                /* ============= 内容区 ============= */
                .project-panel-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                }
                
                .project-panel-content::-webkit-scrollbar {
                    width: 6px;
                }
                
                .project-panel-content::-webkit-scrollbar-track {
                    background: transparent;
                }
                
                .project-panel-content::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 3px;
                }
                
                /* ============= 空状态 ============= */
                .project-panel-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    text-align: center;
                }
                
                .project-panel-empty .empty-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                    opacity: 0.3;
                }
                
                .project-panel-empty h3 {
                    color: #a1a1aa;
                    font-size: 16px;
                    margin: 0 0 8px;
                }
                
                .project-panel-empty p {
                    color: #52525b;
                    font-size: 13px;
                    margin: 0;
                }
                
                /* ============= 加载 & 错误 ============= */
                .project-panel-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px;
                }
                
                .loading-spinner {
                    width: 32px;
                    height: 32px;
                    border: 2px solid rgba(255, 255, 255, 0.1);
                    border-top-color: #f59e0b;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                .project-panel-error {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    border-radius: 10px;
                    margin-bottom: 16px;
                    color: #f87171;
                    font-size: 13px;
                }
                
                .project-panel-error button {
                    background: transparent;
                    border: none;
                    color: #f87171;
                    cursor: pointer;
                    opacity: 0.7;
                }
                
                /* ============= 项目列表 ============= */
                .project-list {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                
                .project-group-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    color: #52525b;
                    margin: 0 0 12px;
                }
                
                .project-group-count {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 10px;
                }
                
                .project-group-items {
                    display: grid;
                    gap: 12px;
                }
                
                .project-list.grid .project-group-items {
                    grid-template-columns: repeat(2, 1fr);
                }
                
                .project-list.list .project-group-items {
                    grid-template-columns: 1fr;
                }
                
                /* ============= 项目卡片 ============= */
                .project-card {
                    position: relative;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 16px;
                    cursor: pointer;
                    transition: all 0.2s;
                    overflow: hidden;
                }
                
                .project-card:hover {
                    background: rgba(255, 255, 255, 0.06);
                    border-color: rgba(255, 255, 255, 0.15);
                    transform: translateY(-2px);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
                }
                
                .project-card.active {
                    border-color: rgba(245, 158, 11, 0.4);
                    background: rgba(245, 158, 11, 0.05);
                }
                
                .project-card.starred {
                    border-color: rgba(250, 204, 21, 0.3);
                }
                
                .project-card.pinned {
                    border-color: rgba(59, 130, 246, 0.3);
                }
                
                .project-card.switching {
                    opacity: 0.6;
                    pointer-events: none;
                }

                .project-card-switching-overlay {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    background: rgba(9, 9, 11, 0.55);
                    color: #f59e0b;
                    font-size: 12px;
                    font-weight: 600;
                    z-index: 3;
                }
                
                .project-card-thumbnail {
                    position: relative;
                    height: 100px;
                    background: rgba(0, 0, 0, 0.3);
                    overflow: hidden;
                }
                
                .project-list.list .project-card-thumbnail {
                    display: none;
                }
                
                .project-card-thumbnail img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                
                .project-card-thumbnail-placeholder {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 32px;
                    opacity: 0.2;
                }
                
                .project-card-badges {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    display: flex;
                    gap: 4px;
                }
                
                .project-card-badges .badge {
                    padding: 2px 6px;
                    border-radius: 6px;
                    font-size: 10px;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                }
                
                .project-card-badges .badge.current {
                    background: rgba(245, 158, 11, 0.8);
                    color: #000;
                }
                
                .project-card-info {
                    padding: 16px;
                }
                
                .project-card-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin: 0 0 6px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .project-card-name-input {
                    width: 100%;
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(245, 158, 11, 0.5);
                    border-radius: 6px;
                    padding: 4px 8px;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 600;
                }
                
                .project-card-preview {
                    font-size: 12px;
                    color: #71717a;
                    margin: 0 0 8px;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    line-height: 1.4;
                }
                
                .project-card-meta {
                    display: flex;
                    gap: 12px;
                    font-size: 11px;
                    color: #52525b;
                }
                
                .project-card-tags {
                    display: flex;
                    gap: 4px;
                    flex-wrap: wrap;
                    margin-top: 8px;
                }
                
                .project-tag {
                    padding: 2px 8px;
                    background: rgba(245, 158, 11, 0.1);
                    color: #f59e0b;
                    border-radius: 6px;
                    font-size: 10px;
                }
                
                .project-card-actions {
                    display: none;
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    padding: 12px;
                    background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%);
                    gap: 4px;
                    justify-content: flex-end;
                }
                
                .project-card:hover .project-card-actions {
                    display: flex;
                }
                
                .project-action-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    border: none;
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .project-action-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
                
                .project-action-btn.delete:hover {
                    background: rgba(239, 68, 68, 0.3);
                }
                
                .delete-confirm {
                    display: flex;
                    gap: 4px;
                    background: rgba(239, 68, 68, 0.1);
                    padding: 4px;
                    border-radius: 6px;
                }
                
                .delete-confirm button {
                    padding: 4px 8px;
                    border: none;
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                }
                
                .delete-confirm button:first-child {
                    background: #ef4444;
                    color: #fff;
                }
                
                .delete-confirm button:last-child {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                
                /* ============= 版本列表 ============= */
                .version-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .version-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .version-item:hover {
                    background: rgba(255, 255, 255, 0.06);
                    border-color: rgba(255, 255, 255, 0.15);
                }
                
                .version-item.starred {
                    border-color: rgba(250, 204, 21, 0.3);
                }
                
                .version-item.manual {
                    border-left: 3px solid #3b82f6;
                }
                
                .version-info {
                    flex: 1;
                    min-width: 0;
                }
                
                .version-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 4px;
                }
                
                .version-label {
                    font-size: 14px;
                    font-weight: 500;
                    color: #fff;
                }
                
                .version-label-input {
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(245, 158, 11, 0.5);
                    border-radius: 4px;
                    padding: 2px 6px;
                    color: #fff;
                    font-size: 14px;
                }
                
                .version-time {
                    font-size: 11px;
                    color: #52525b;
                }
                
                .version-preview {
                    font-size: 12px;
                    color: #71717a;
                    margin: 0 0 6px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .version-meta {
                    display: flex;
                    gap: 8px;
                    font-size: 11px;
                    color: #52525b;
                }
                
                .auto-save-badge {
                    background: rgba(107, 114, 128, 0.2);
                    padding: 1px 6px;
                    border-radius: 4px;
                }
                
                .version-actions {
                    display: flex;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                
                .version-item:hover .version-actions {
                    opacity: 1;
                }
                
                .version-action-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    border: none;
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .version-action-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
                
                .version-action-btn.restore {
                    background: rgba(34, 197, 94, 0.2);
                    color: #22c55e;
                }
                
                .version-action-btn.restore:hover {
                    background: rgba(34, 197, 94, 0.3);
                }
                
                .version-action-btn.delete:hover {
                    background: rgba(239, 68, 68, 0.3);
                }
                
                /* ============= 新建弹框 ============= */
                .project-modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.8);
                    z-index: 1100;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.2s ease-out;
                }
                
                .project-modal {
                    background: #18181b;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    padding: 24px;
                    width: 400px;
                    max-width: 90vw;
                    animation: scaleIn 0.2s ease-out;
                }
                
                @keyframes scaleIn {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                
                .project-modal h3 {
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    margin: 0 0 16px;
                }
                
                .project-modal input {
                    width: 100%;
                    height: 44px;
                    padding: 0 16px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    color: #fff;
                    font-size: 14px;
                    margin-bottom: 20px;
                }
                
                .project-modal input:focus {
                    outline: none;
                    border-color: #f59e0b;
                }
                
                .project-modal-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }
                
                .project-modal-actions button {
                    padding: 10px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .project-modal-actions .cancel {
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    color: #a1a1aa;
                }
                
                .project-modal-actions .cancel:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                
                .project-modal-actions .confirm {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    border: none;
                    color: #000;
                }
                
                .project-modal-actions .confirm:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
                }
            `}</style>
        </>
    );
};

export default ProjectPanel;
