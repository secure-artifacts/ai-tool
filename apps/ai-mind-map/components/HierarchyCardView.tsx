import React, { useState, useRef, useEffect } from 'react';
import type { MindMapNode } from '../types';
import { Plus, Sparkles, Copy, Trash2, PlusCircle, CornerDownRight } from 'lucide-react';

interface HierarchyCardViewProps {
    nodes: Record<string, MindMapNode>;
    rootId: string;
    onNodeClick?: (nodeId: string) => void;
    onAddNode?: (parentId: string) => void;
    onAddSibling?: (nodeId: string) => void;
    onDeleteNode?: (nodeId: string) => void;
    onAiExpand?: (nodeId: string) => void;
    selectedNodeId?: string | null;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
}

/**
 * 层级卡片视图 - 垂直排列的卡片，内部保留树状连线
 * 类似 Mapify 的垂直区块样式
 */
export const HierarchyCardView: React.FC<HierarchyCardViewProps> = ({
    nodes,
    rootId,
    onNodeClick,
    onAddNode,
    onAddSibling,
    onDeleteNode,
    onAiExpand,
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

    const topLevelChildren = root.children || [];

    // 渲染带连线的树节点
    const renderTreeBranch = (nodeId: string, parentColor: string, isLast: boolean): React.ReactNode => {
        const node = nodes[nodeId];
        if (!node) return null;

        const children = node.children || [];
        const hasChildren = children.length > 0;
        const isSelected = selectedNodeId === nodeId;

        return (
            <div key={nodeId} className="hierarchy-branch">
                {/* 连线 */}
                <div className="hierarchy-connector">
                    <svg className="hierarchy-line" viewBox="0 0 40 100" preserveAspectRatio="none">
                        <path
                            d="M 0 50 Q 20 50 40 50"
                            fill="none"
                            stroke={parentColor}
                            strokeWidth="2"
                        />
                    </svg>
                </div>

                {/* 节点及其子节点 */}
                <div className="hierarchy-branch-content">
                    <div
                        className={`hierarchy-node ${isSelected ? 'selected' : ''}`}
                        style={{ '--node-color': parentColor } as React.CSSProperties}
                        onClick={() => onNodeClick?.(nodeId)}
                        onContextMenu={(e) => handleContextMenu(e, nodeId)}
                    >
                        <span className="hierarchy-node-text">{node.label}</span>
                    </div>

                    {/* 子节点 */}
                    {hasChildren && (
                        <div className="hierarchy-children">
                            {children.map((childId, idx) => (
                                <div key={childId} className="hierarchy-child-row">
                                    {/* 子节点连线 */}
                                    <div className="hierarchy-child-connector">
                                        <svg className="hierarchy-child-line" viewBox="0 0 40 60" preserveAspectRatio="none">
                                            <path
                                                d="M 0 30 C 20 30 20 30 40 30"
                                                fill="none"
                                                stroke={parentColor}
                                                strokeWidth="2"
                                            />
                                        </svg>
                                    </div>
                                    <div
                                        className={`hierarchy-child-node ${selectedNodeId === childId ? 'selected' : ''}`}
                                        style={{ borderLeftColor: parentColor }}
                                        onClick={() => onNodeClick?.(childId)}
                                        onContextMenu={(e) => handleContextMenu(e, childId)}
                                    >
                                        {nodes[childId]?.label}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="hierarchy-card-view">
            {/* 根节点标题 */}
            <div className="hierarchy-root-title">
                <span
                    className={`hierarchy-root-label ${selectedNodeId === rootId ? 'selected' : ''}`}
                    onClick={() => onNodeClick?.(rootId)}
                    onContextMenu={(e) => handleContextMenu(e, rootId)}
                >
                    {root.label}
                </span>
            </div>

            {/* 卡片列表 */}
            <div className="hierarchy-cards">
                {topLevelChildren.map((cardId) => {
                    const card = nodes[cardId];
                    if (!card) return null;

                    const branches = card.children || [];
                    const isCardSelected = selectedNodeId === cardId;

                    return (
                        <div key={cardId} className="hierarchy-card">
                            {/* 彩色标题栏 */}
                            <div
                                className={`hierarchy-card-header ${isCardSelected ? 'selected' : ''}`}
                                style={{ backgroundColor: card.color }}
                                onClick={() => onNodeClick?.(cardId)}
                                onContextMenu={(e) => handleContextMenu(e, cardId)}
                            >
                                <span className="hierarchy-card-title">{card.label}</span>
                                <button
                                    className="hierarchy-add-btn"
                                    onClick={(e) => { e.stopPropagation(); onAddNode?.(cardId); }}
                                >
                                    <Plus size={16} />
                                </button>
                            </div>

                            {/* 卡片内容 - 树状分支 */}
                            <div className="hierarchy-card-body">
                                {branches.map((branchId, idx) => {
                                    const branch = nodes[branchId];
                                    if (!branch) return null;

                                    const leaves = branch.children || [];
                                    const isBranchSelected = selectedNodeId === branchId;

                                    return (
                                        <div key={branchId} className="hierarchy-tree-row">
                                            {/* 左侧标签 */}
                                            <div
                                                className={`hierarchy-branch-label ${isBranchSelected ? 'selected' : ''}`}
                                                onClick={() => onNodeClick?.(branchId)}
                                                onContextMenu={(e) => handleContextMenu(e, branchId)}
                                            >
                                                {branch.label}
                                            </div>

                                            {/* 连线区域 */}
                                            <div className="hierarchy-tree-connector">
                                                <svg viewBox="0 0 60 100" preserveAspectRatio="none" className="hierarchy-curve">
                                                    <path
                                                        d={`M 0 50 C 30 50, 30 50, 60 50`}
                                                        fill="none"
                                                        stroke={card.color}
                                                        strokeWidth="2"
                                                    />
                                                    {leaves.length > 0 && (
                                                        <>
                                                            {leaves.map((_, i) => {
                                                                const yPos = 20 + (i * 60 / Math.max(leaves.length - 1, 1));
                                                                return (
                                                                    <path
                                                                        key={i}
                                                                        d={`M 30 50 Q 45 50, 60 ${yPos}`}
                                                                        fill="none"
                                                                        stroke={card.color}
                                                                        strokeWidth="2"
                                                                    />
                                                                );
                                                            })}
                                                        </>
                                                    )}
                                                </svg>
                                            </div>

                                            {/* 右侧叶子节点 */}
                                            <div className="hierarchy-leaves">
                                                {leaves.map((leafId) => {
                                                    const leaf = nodes[leafId];
                                                    if (!leaf) return null;
                                                    const isLeafSelected = selectedNodeId === leafId;

                                                    return (
                                                        <div
                                                            key={leafId}
                                                            className={`hierarchy-leaf ${isLeafSelected ? 'selected' : ''}`}
                                                            style={{ borderLeftColor: card.color }}
                                                            onClick={() => onNodeClick?.(leafId)}
                                                            onContextMenu={(e) => handleContextMenu(e, leafId)}
                                                        >
                                                            {leaf.label}
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
                })}
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
