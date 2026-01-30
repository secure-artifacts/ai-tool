/**
 * ProjectSwitcher - 简化的项目切换器
 * 
 * 在工具栏中显示的紧凑组件，用于快速切换项目
 * 点击展开可以打开完整的 ProjectPanel
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, LayoutList, Folder, Pin, Star, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
    ModuleId,
    Project,
    ProjectListItem,
    listProjects,
    getProject,
    createProject,
    setActiveProject,
    getOrCreateDefaultProject,
    getModuleDefaultName,
    formatProjectTime
} from '../services/projectService';

interface ProjectSwitcherProps {
    moduleId: ModuleId;
    currentProject: Project | null;
    onProjectChange: (project: Project) => void;
    onOpenFullPanel: () => void;
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
    moduleId,
    currentProject,
    onProjectChange,
    onOpenFullPanel
}) => {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [projects, setProjects] = useState<ProjectListItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // 加载项目列表
    const loadProjects = useCallback(async () => {
        if (!user?.uid) return;

        setIsLoading(true);
        try {
            const data = await listProjects(user.uid, moduleId, { maxCount: 10 });
            setProjects(data);
        } catch (error) {
            console.error('[ProjectSwitcher] Failed to load projects:', error);
        } finally {
            setIsLoading(false);
        }
    }, [user?.uid, moduleId]);

    // 打开时加载
    useEffect(() => {
        if (isOpen) {
            loadProjects();
        }
    }, [isOpen, loadProjects]);

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 切换项目
    const handleSwitch = async (project: ProjectListItem) => {
        if (!user?.uid || project.id === currentProject?.id) {
            setIsOpen(false);
            return;
        }

        setIsOpen(false);

        try {
            const fullProject = await getProject(user.uid, moduleId, project.id);
            if (fullProject) {
                await setActiveProject(user.uid, moduleId, project.id);
                onProjectChange(fullProject);
            }
        } catch (error) {
            console.error('[ProjectSwitcher] Failed to switch project:', error);
        }
    };

    // 快速新建项目
    const handleQuickCreate = async () => {
        if (!user?.uid) return;

        const now = new Date();
        const name = `项目 ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

        try {
            const projectId = await createProject(user.uid, {
                moduleId,
                name
            });

            const newProject = await getProject(user.uid, moduleId, projectId);
            if (newProject) {
                onProjectChange(newProject);
            }

            setIsOpen(false);
        } catch (error) {
            console.error('[ProjectSwitcher] Failed to create project:', error);
        }
    };

    // 未登录时显示
    if (!user) {
        return (
            <div className="project-switcher disabled">
                <span className="project-switcher-icon">⋮</span>
                <span className="project-switcher-name">请先登录</span>
            </div>
        );
    }

    return (
        <div className="project-switcher" ref={dropdownRef}>
            {/* 触发按钮 */}
            <button
                className="project-switcher-trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="project-switcher-icon">
                    {currentProject?.isStarred ? '⭐' : currentProject?.isPinned ? '📌' : '📁'}
                </span>
                <span className="project-switcher-name">
                    {isLoading ? '加载中...' : (currentProject?.name || '选择项目')}
                </span>
                <span className="project-switcher-count">
                    {currentProject?.itemCount || 0} 项
                </span>
                <span className={`project-switcher-arrow ${isOpen ? 'open' : ''}`}>
                    ▼
                </span>
            </button>

            {/* 下拉菜单 */}
            {isOpen && (
                <div className="project-switcher-dropdown">
                    {/* 项目列表 */}
                    <div className="project-switcher-list">
                        {projects.map(project => (
                            <div
                                key={project.id}
                                className={`project-switcher-item ${project.id === currentProject?.id ? 'active' : ''}`}
                                onClick={() => handleSwitch(project)}
                            >
                                <span className="item-icon">
                                    {project.isPinned ? '📌' : project.isStarred ? '⭐' : '📁'}
                                </span>
                                <div className="item-info">
                                    <span className="item-name">{project.name}</span>
                                    <span className="item-meta">
                                        {project.itemCount} 项 · {formatProjectTime(project.updatedAt)}
                                    </span>
                                </div>
                                {project.id === currentProject?.id && (
                                    <span className="item-check">✓</span>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="project-switcher-divider" />

                    {/* 快捷操作 */}
                    <div className="project-switcher-actions">
                        <button
                            className="project-switcher-action"
                            onClick={handleQuickCreate}
                        >
                            <Plus size={14} />
                            <span>新建项目</span>
                        </button>
                        <button
                            className="project-switcher-action manage"
                            onClick={() => {
                                setIsOpen(false);
                                onOpenFullPanel();
                            }}
                        >
                            <LayoutList size={14} />
                            <span>管理所有项目</span>
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                .project-switcher {
                    position: relative;
                    z-index: 100;
                }
                
                .project-switcher.disabled {
                    opacity: 0.5;
                    pointer-events: none;
                }
                
                .project-switcher-trigger {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    height: 36px;
                    padding: 0 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    color: #fff;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 13px;
                }
                
                .project-switcher-trigger:hover {
                    background: rgba(255, 255, 255, 0.08);
                    border-color: rgba(255, 255, 255, 0.15);
                }
                
                .project-switcher-icon {
                    font-size: 14px;
                }
                
                .project-switcher-name {
                    font-weight: 500;
                    max-width: 150px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .project-switcher-count {
                    font-size: 11px;
                    color: #71717a;
                    padding: 2px 6px;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 4px;
                }
                
                .project-switcher-arrow {
                    font-size: 8px;
                    color: #71717a;
                    transition: transform 0.2s;
                }
                
                .project-switcher-arrow.open {
                    transform: rotate(180deg);
                }
                
                .project-switcher-dropdown {
                    position: absolute;
                    top: calc(100% + 8px);
                    left: 0;
                    min-width: 280px;
                    background: #18181b;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                    animation: dropdownIn 0.2s ease-out;
                }
                
                @keyframes dropdownIn {
                    from {
                        opacity: 0;
                        transform: translateY(-8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                .project-switcher-list {
                    max-height: 300px;
                    overflow-y: auto;
                    padding: 8px;
                }
                
                .project-switcher-list::-webkit-scrollbar {
                    width: 4px;
                }
                
                .project-switcher-list::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 2px;
                }
                
                .project-switcher-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                
                .project-switcher-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                
                .project-switcher-item.active {
                    background: rgba(245, 158, 11, 0.1);
                    border: 1px solid rgba(245, 158, 11, 0.2);
                }
                
                .project-switcher-item .item-icon {
                    font-size: 14px;
                }
                
                .project-switcher-item .item-info {
                    flex: 1;
                    min-width: 0;
                }
                
                .project-switcher-item .item-name {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    color: #fff;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .project-switcher-item .item-meta {
                    display: block;
                    font-size: 11px;
                    color: #52525b;
                    margin-top: 2px;
                }
                
                .project-switcher-item .item-check {
                    color: #f59e0b;
                    font-weight: 600;
                }
                
                .project-switcher-divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.08);
                    margin: 4px 0;
                }
                
                .project-switcher-actions {
                    padding: 8px;
                }
                
                .project-switcher-action {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 10px 12px;
                    background: transparent;
                    border: none;
                    border-radius: 8px;
                    color: #a1a1aa;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.15s;
                    text-align: left;
                }
                
                .project-switcher-action:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: #fff;
                }
                
                .project-switcher-action.manage {
                    color: #f59e0b;
                }
                
                .project-switcher-action.manage:hover {
                    background: rgba(245, 158, 11, 0.1);
                }
            `}</style>
        </div>
    );
};

export default ProjectSwitcher;
