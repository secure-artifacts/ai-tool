import React, { useState, useRef, useEffect } from 'react';
import type { MindMapNode } from '../types';
import { Plus, ChevronDown, ChevronRight, Sparkles, Copy, Scissors, Clipboard, Trash2, Image, Smile, PlusCircle, CornerDownRight } from 'lucide-react';

interface OutlineCardViewProps {
    nodes: Record<string, MindMapNode>;
    rootId: string;
    onNodeClick?: (nodeId: string) => void;
    onAddNode?: (parentId: string) => void;
    onAddSibling?: (nodeId: string) => void;
    onToggleCollapse?: (nodeId: string) => void;
    onDeleteNode?: (nodeId: string) => void;
    onAiExpand?: (nodeId: string) => void;
    onCopyNode?: (nodeId: string) => void;
    selectedNodeId?: string | null;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
}

/**
 * 网格/矩阵视图 - 类似 Mapify/XMind 的 Grid 结构
 */
export const OutlineCardView: React.FC<OutlineCardViewProps> = ({
    nodes,
    rootId,
    onNodeClick,
    onAddNode,
    onAddSibling,
    onToggleCollapse,
    onDeleteNode,
    onAiExpand,
    onCopyNode,
    selectedNodeId,
}) => {
    const root = nodes[rootId];
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        nodeId: null,
    });
    const menuRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭菜单
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

    // 右键菜单处理
    const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            nodeId,
        });
    };

    // 菜单项点击
    const handleMenuAction = (action: string) => {
        const nodeId = contextMenu.nodeId;
        if (!nodeId) return;

        switch (action) {
            case 'ai-expand':
                onAiExpand?.(nodeId);
                break;
            case 'add-child':
                onAddNode?.(nodeId);
                break;
            case 'add-sibling':
                onAddSibling?.(nodeId);
                break;
            case 'copy':
                onCopyNode?.(nodeId);
                break;
            case 'delete':
                onDeleteNode?.(nodeId);
                break;
        }

        setContextMenu(prev => ({ ...prev, visible: false }));
    };

    // 一级分支作为列
    const columns = root.children || [];

    // 递归渲染子节点
    const renderSubItems = (nodeId: string, color: string): React.ReactNode => {
        const node = nodes[nodeId];
        if (!node) return null;

        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = !node.collapsed;
        const isSelected = selectedNodeId === nodeId;

        return (
            <li key={nodeId} className="grid-sub-item-wrapper">
                <div
                    className={`grid-sub-item ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onNodeClick?.(nodeId);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, nodeId)}
                >
                    {hasChildren && (
                        <button
                            className="grid-collapse-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleCollapse?.(nodeId);
                            }}
                        >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                    )}
                    <span className="grid-sub-bullet" style={{ backgroundColor: color }} />
                    <span className="grid-sub-text">{node.label}</span>
                    <button
                        className="grid-add-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddNode?.(nodeId);
                        }}
                        title="添加子节点"
                    >
                        <Plus size={12} />
                    </button>
                </div>
                {hasChildren && isExpanded && (
                    <ul className="grid-sub-list">
                        {node.children!.map((childId) => renderSubItems(childId, color))}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <div className="grid-matrix-view">
            {/* 根节点标题 */}
            <div
                className={`grid-matrix-title ${selectedNodeId === rootId ? 'selected' : ''}`}
                onClick={() => onNodeClick?.(rootId)}
                onContextMenu={(e) => handleContextMenu(e, rootId)}
            >
                <h2>{root.label}</h2>
                <button
                    className="grid-add-column-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddNode?.(rootId);
                    }}
                    title="添加新列"
                >
                    <Plus size={16} /> 添加列
                </button>
            </div>

            {/* 列容器 */}
            <div className="grid-matrix-columns">
                {columns.map((columnId) => {
                    const column = nodes[columnId];
                    if (!column) return null;

                    const cells = column.children || [];
                    const isColumnSelected = selectedNodeId === columnId;

                    return (
                        <div key={columnId} className="grid-matrix-column">
                            {/* 列头 */}
                            <div
                                className={`grid-column-header ${isColumnSelected ? 'selected' : ''}`}
                                style={{ backgroundColor: column.color }}
                                onClick={() => onNodeClick?.(columnId)}
                                onContextMenu={(e) => handleContextMenu(e, columnId)}
                            >
                                <span className="grid-column-title">{column.label}</span>
                                <button
                                    className="grid-add-cell-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAddNode?.(columnId);
                                    }}
                                    title="添加单元格"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>

                            {/* 单元格容器 */}
                            <div className="grid-column-cells">
                                {cells.map((cellId) => {
                                    const cell = nodes[cellId];
                                    if (!cell) return null;

                                    const subItems = cell.children || [];
                                    const hasSubItems = subItems.length > 0;
                                    const isCellExpanded = !cell.collapsed;
                                    const isCellSelected = selectedNodeId === cellId;

                                    return (
                                        <div
                                            key={cellId}
                                            className={`grid-cell ${isCellSelected ? 'selected' : ''}`}
                                            style={{ '--cell-color': column.color } as React.CSSProperties}
                                            onClick={() => onNodeClick?.(cellId)}
                                            onContextMenu={(e) => handleContextMenu(e, cellId)}
                                        >
                                            <div className="grid-cell-title">
                                                {hasSubItems && (
                                                    <button
                                                        className="grid-collapse-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onToggleCollapse?.(cellId);
                                                        }}
                                                    >
                                                        {isCellExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                )}
                                                <span
                                                    className="grid-cell-indicator"
                                                    style={{ backgroundColor: column.color }}
                                                />
                                                <span className="grid-cell-text">{cell.label}</span>
                                                <button
                                                    className="grid-add-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onAddNode?.(cellId);
                                                    }}
                                                    title="添加子项"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>

                                            {hasSubItems && isCellExpanded && (
                                                <ul className="grid-cell-list">
                                                    {subItems.map((subId) =>
                                                        renderSubItems(subId, column.color)
                                                    )}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                })}

                                <button
                                    className="grid-add-cell-footer"
                                    onClick={() => onAddNode?.(columnId)}
                                >
                                    <Plus size={14} /> 添加项目
                                </button>
                            </div>
                        </div>
                    );
                })}

                {/* 添加新列 */}
                <div className="grid-add-column">
                    <button
                        className="grid-add-column-card"
                        onClick={() => onAddNode?.(rootId)}
                    >
                        <Plus size={20} />
                        <span>添加新列</span>
                    </button>
                </div>
            </div>

            {/* 右键菜单 */}
            {contextMenu.visible && (
                <div
                    ref={menuRef}
                    className="grid-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <div className="context-menu-group">
                        <button className="context-menu-item ai-item" onClick={() => handleMenuAction('ai-expand')}>
                            <Sparkles size={16} className="menu-icon ai" />
                            <span>生成更多想法</span>
                            <span className="menu-shortcut">⌘⇧G</span>
                        </button>
                    </div>
                    <div className="context-menu-divider" />
                    <div className="context-menu-group">
                        <button className="context-menu-item" onClick={() => handleMenuAction('add-child')}>
                            <PlusCircle size={16} className="menu-icon" />
                            <span>添加细分主题</span>
                            <span className="menu-shortcut">Tab</span>
                        </button>
                        <button className="context-menu-item" onClick={() => handleMenuAction('add-sibling')}>
                            <CornerDownRight size={16} className="menu-icon" />
                            <span>添加并列主题</span>
                            <span className="menu-shortcut">↵</span>
                        </button>
                    </div>
                    <div className="context-menu-divider" />
                    <div className="context-menu-group">
                        <button className="context-menu-item" onClick={() => handleMenuAction('copy')}>
                            <Copy size={16} className="menu-icon" />
                            <span>复制</span>
                            <span className="menu-shortcut">⌘C</span>
                        </button>
                        <button className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
                            <Trash2 size={16} className="menu-icon" />
                            <span>删除</span>
                            <span className="menu-shortcut">⌫</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
