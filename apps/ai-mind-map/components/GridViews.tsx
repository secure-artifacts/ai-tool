import React, { useState, useRef, useEffect } from 'react';
import type { MindMapNode, LayoutDirection } from '../types';
import { Plus, Sparkles, Copy, Trash2, PlusCircle, CornerDownRight, ChevronDown, ChevronRight } from 'lucide-react';

interface GridViewsProps {
    nodes: Record<string, MindMapNode>;
    rootId: string;
    layoutType: LayoutDirection;
    onNodeClick?: (nodeId: string) => void;
    onAddNode?: (parentId: string) => void;
    onAddSibling?: (nodeId: string) => void;
    onDeleteNode?: (nodeId: string) => void;
    onAiExpand?: (nodeId: string) => void;
    onToggleCollapse?: (nodeId: string) => void;
    selectedNodeId?: string | null;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
}

/**
 * 统一的网格视图组件 - 支持6种网格布局样式
 * 所有视图都支持：右键菜单、添加节点按钮
 */
export const GridViews: React.FC<GridViewsProps> = ({
    nodes,
    rootId,
    layoutType,
    onNodeClick,
    onAddNode,
    onAddSibling,
    onDeleteNode,
    onAiExpand,
    onToggleCollapse,
    selectedNodeId,
}) => {
    const root = nodes[rootId];
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false, x: 0, y: 0, nodeId: null,
    });
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu(prev => ({ ...prev, visible: false }));
            }
        };
        if (contextMenu.visible) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [contextMenu.visible]);

    if (!root) return null;

    const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId });
    };

    const handleMenuAction = (action: string) => {
        const nodeId = contextMenu.nodeId;
        if (!nodeId) return;
        switch (action) {
            case 'ai-expand': onAiExpand?.(nodeId); break;
            case 'add-child': onAddNode?.(nodeId); break;
            case 'add-sibling': onAddSibling?.(nodeId); break;
            case 'delete': onDeleteNode?.(nodeId); break;
        }
        setContextMenu(prev => ({ ...prev, visible: false }));
    };

    const topChildren = root.children || [];

    // 通用添加按钮组件
    const AddButton: React.FC<{ parentId: string; className?: string }> = ({ parentId, className = '' }) => (
        <button
            className={`gv-add-btn ${className}`}
            onClick={(e) => {
                e.stopPropagation();
                onAddNode?.(parentId);
            }}
            data-tip="添加子节点" className="tooltip-bottom"
        >
            <Plus size={14} />
        </button>
    );

    // 渲染右键菜单
    const renderContextMenu = () => (
        contextMenu.visible && (
            <div
                ref={menuRef}
                className="grid-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
            >
                <div className="context-menu-group">
                    <button className="context-menu-item ai-item" onClick={() => handleMenuAction('ai-expand')}>
                        <Sparkles size={16} className="menu-icon ai" />
                        <span>生成更多想法</span>
                    </button>
                </div>
                <div className="context-menu-divider" />
                <div className="context-menu-group">
                    <button className="context-menu-item" onClick={() => handleMenuAction('add-child')}>
                        <PlusCircle size={16} className="menu-icon" />
                        <span>添加子节点</span>
                    </button>
                    <button className="context-menu-item" onClick={() => handleMenuAction('add-sibling')}>
                        <CornerDownRight size={16} className="menu-icon" />
                        <span>添加同级</span>
                    </button>
                </div>
                <div className="context-menu-divider" />
                <div className="context-menu-group">
                    <button className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
                        <Trash2 size={16} className="menu-icon" />
                        <span>删除</span>
                    </button>
                </div>
            </div>
        )
    );

    // ========== 表格视图 ==========
    const renderTableView = () => (
        <div className="gv-table-view">
            <div className="gv-table-header" onClick={() => onNodeClick?.(rootId)} onContextMenu={(e) => handleContextMenu(e, rootId)}>
                <h2>{root.label}</h2>
                <AddButton parentId={rootId} />
            </div>
            <div className="gv-table-body">
                {topChildren.map(l1Id => {
                    const l1 = nodes[l1Id];
                    if (!l1) return null;
                    const l2Children = l1.children || [];
                    return (
                        <div key={l1Id} className="gv-table-row">
                            <div
                                className={`gv-table-label ${selectedNodeId === l1Id ? 'selected' : ''}`}
                                style={{ borderLeftColor: l1.color }}
                                onClick={() => onNodeClick?.(l1Id)}
                                onContextMenu={(e) => handleContextMenu(e, l1Id)}
                            >
                                {l1.label}
                                <AddButton parentId={l1Id} />
                            </div>
                            <div className="gv-table-bracket">{'{'}</div>
                            <div className="gv-table-content">
                                {l2Children.map(l2Id => {
                                    const l2 = nodes[l2Id];
                                    if (!l2) return null;
                                    return (
                                        <div
                                            key={l2Id}
                                            className={`gv-table-item ${selectedNodeId === l2Id ? 'selected' : ''}`}
                                            onClick={() => onNodeClick?.(l2Id)}
                                            onContextMenu={(e) => handleContextMenu(e, l2Id)}
                                        >
                                            {l2.label}
                                            <AddButton parentId={l2Id} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ========== 大纲视图 ==========
    const renderOutlineView = () => {
        const renderOutlineItem = (nodeId: string, depth: number): React.ReactNode => {
            const node = nodes[nodeId];
            if (!node) return null;
            const children = node.children || [];
            return (
                <div key={nodeId} className="gv-outline-item" style={{ paddingLeft: depth * 20 }}>
                    <div
                        className={`gv-outline-label ${selectedNodeId === nodeId ? 'selected' : ''}`}
                        onClick={() => onNodeClick?.(nodeId)}
                        onContextMenu={(e) => handleContextMenu(e, nodeId)}
                    >
                        {children.length > 0 && (
                            <span className="gv-outline-bullet">•</span>
                        )}
                        <span>{node.label}</span>
                        <AddButton parentId={nodeId} />
                    </div>
                    {children.map(childId => renderOutlineItem(childId, depth + 1))}
                </div>
            );
        };

        return (
            <div className="gv-outline-view">
                <div className="gv-outline-header" onClick={() => onNodeClick?.(rootId)} onContextMenu={(e) => handleContextMenu(e, rootId)}>
                    <h2>{root.label}</h2>
                    <AddButton parentId={rootId} />
                </div>
                <div className="gv-outline-body">
                    {topChildren.map(childId => renderOutlineItem(childId, 0))}
                </div>
            </div>
        );
    };

    // ========== 矩阵括号视图 ==========
    const renderMatrixBracket = () => (
        <div className="gv-matrix-bracket">
            <div className="gv-matrix-header" onClick={() => onNodeClick?.(rootId)} onContextMenu={(e) => handleContextMenu(e, rootId)}>
                <h2>{root.label}</h2>
                <AddButton parentId={rootId} />
            </div>
            <div className="gv-matrix-columns">
                {topChildren.map(l1Id => {
                    const l1 = nodes[l1Id];
                    if (!l1) return null;
                    const l2Children = l1.children || [];
                    return (
                        <div key={l1Id} className="gv-matrix-column">
                            <div
                                className={`gv-matrix-col-header ${selectedNodeId === l1Id ? 'selected' : ''}`}
                                style={{ backgroundColor: l1.color }}
                                onClick={() => onNodeClick?.(l1Id)}
                                onContextMenu={(e) => handleContextMenu(e, l1Id)}
                            >
                                {l1.label}
                                <AddButton parentId={l1Id} className="on-color" />
                            </div>
                            <div className="gv-matrix-col-body">
                                <div className="gv-matrix-bracket-left">{'{'}</div>
                                <div className="gv-matrix-items">
                                    {l2Children.map(l2Id => {
                                        const l2 = nodes[l2Id];
                                        if (!l2) return null;
                                        return (
                                            <div
                                                key={l2Id}
                                                className={`gv-matrix-item ${selectedNodeId === l2Id ? 'selected' : ''}`}
                                                onClick={() => onNodeClick?.(l2Id)}
                                                onContextMenu={(e) => handleContextMenu(e, l2Id)}
                                            >
                                                {l2.label}
                                                <AddButton parentId={l2Id} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ========== 笔记本视图 ==========
    const renderNotebookView = () => (
        <div className="gv-notebook-view">
            <div className="gv-notebook-header" onClick={() => onNodeClick?.(rootId)} onContextMenu={(e) => handleContextMenu(e, rootId)}>
                <h2>{root.label}</h2>
                <AddButton parentId={rootId} />
            </div>
            <div className="gv-notebook-pages">
                {topChildren.map(l1Id => {
                    const l1 = nodes[l1Id];
                    if (!l1) return null;
                    const l2Children = l1.children || [];
                    return (
                        <div key={l1Id} className="gv-notebook-page">
                            <div
                                className={`gv-notebook-page-header ${selectedNodeId === l1Id ? 'selected' : ''}`}
                                style={{ borderTopColor: l1.color }}
                                onClick={() => onNodeClick?.(l1Id)}
                                onContextMenu={(e) => handleContextMenu(e, l1Id)}
                            >
                                {l1.label}
                                <AddButton parentId={l1Id} />
                            </div>
                            <div className="gv-notebook-page-content">
                                {l2Children.map(l2Id => {
                                    const l2 = nodes[l2Id];
                                    if (!l2) return null;
                                    const l3Children = l2.children || [];
                                    return (
                                        <div key={l2Id} className="gv-notebook-section">
                                            <div
                                                className={`gv-notebook-section-title ${selectedNodeId === l2Id ? 'selected' : ''}`}
                                                onClick={() => onNodeClick?.(l2Id)}
                                                onContextMenu={(e) => handleContextMenu(e, l2Id)}
                                            >
                                                {l2.label}
                                                <AddButton parentId={l2Id} />
                                            </div>
                                            {l3Children.map(l3Id => {
                                                const l3 = nodes[l3Id];
                                                if (!l3) return null;
                                                return (
                                                    <div
                                                        key={l3Id}
                                                        className={`gv-notebook-line ${selectedNodeId === l3Id ? 'selected' : ''}`}
                                                        onClick={() => onNodeClick?.(l3Id)}
                                                        onContextMenu={(e) => handleContextMenu(e, l3Id)}
                                                    >
                                                        {l3.label}
                                                        <AddButton parentId={l3Id} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ========== 组织矩阵视图 ==========
    const renderOrgMatrix = () => (
        <div className="gv-org-matrix">
            <div className="gv-org-header" onClick={() => onNodeClick?.(rootId)} onContextMenu={(e) => handleContextMenu(e, rootId)}>
                <h2>{root.label}</h2>
                <AddButton parentId={rootId} />
            </div>
            <div className="gv-org-columns">
                {topChildren.map(l1Id => {
                    const l1 = nodes[l1Id];
                    if (!l1) return null;
                    const l2Children = l1.children || [];
                    return (
                        <div key={l1Id} className="gv-org-column">
                            <div
                                className={`gv-org-col-header ${selectedNodeId === l1Id ? 'selected' : ''}`}
                                style={{ borderBottomColor: l1.color }}
                                onClick={() => onNodeClick?.(l1Id)}
                                onContextMenu={(e) => handleContextMenu(e, l1Id)}
                            >
                                {l1.label}
                                <AddButton parentId={l1Id} />
                            </div>
                            <div className="gv-org-cards">
                                {l2Children.map(l2Id => {
                                    const l2 = nodes[l2Id];
                                    if (!l2) return null;
                                    const l3Children = l2.children || [];
                                    return (
                                        <div
                                            key={l2Id}
                                            className={`gv-org-card ${selectedNodeId === l2Id ? 'selected' : ''}`}
                                            onClick={() => onNodeClick?.(l2Id)}
                                            onContextMenu={(e) => handleContextMenu(e, l2Id)}
                                        >
                                            <div className="gv-org-card-title">
                                                {l2.label}
                                                <AddButton parentId={l2Id} />
                                            </div>
                                            {l3Children.length > 0 && (
                                                <div className="gv-org-card-items">
                                                    {l3Children.map(l3Id => {
                                                        const l3 = nodes[l3Id];
                                                        if (!l3) return null;
                                                        return (
                                                            <div
                                                                key={l3Id}
                                                                className={`gv-org-card-item ${selectedNodeId === l3Id ? 'selected' : ''}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onNodeClick?.(l3Id);
                                                                }}
                                                                onContextMenu={(e) => handleContextMenu(e, l3Id)}
                                                            >
                                                                • {l3.label}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // 根据布局类型选择渲染
    const renderContent = () => {
        switch (layoutType) {
            case 'table-view':
                return renderTableView();
            case 'outline-view':
                return renderOutlineView();
            case 'matrix-bracket':
                return renderMatrixBracket();
            case 'notebook-view':
                return renderNotebookView();
            case 'org-matrix':
                return renderOrgMatrix();
            default:
                return renderOutlineView();
        }
    };

    return (
        <div className="grid-views-container">
            {renderContent()}
            {renderContextMenu()}
        </div>
    );
};
