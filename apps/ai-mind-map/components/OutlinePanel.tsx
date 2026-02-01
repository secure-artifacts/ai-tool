// ============================================
// OutlinePanel - 大纲视图组件
// ============================================

import React, { useState, useMemo } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { X, ChevronRight, ChevronDown, Focus, Eye, Search, ChevronsDown, ChevronsUp } from 'lucide-react';

interface OutlineItemProps {
    nodeId: string;
    depth: number;
    searchQuery: string;
    matchedIds: Set<string>;
}

const OutlineItem: React.FC<OutlineItemProps> = ({ nodeId, depth, searchQuery, matchedIds }) => {
    const { currentMap, selectedNodeId, selectNode, toggleCollapse, setFocusNode } = useMindMapStore();

    if (!currentMap) return null;
    const node = currentMap.nodes[nodeId];
    if (!node) return null;

    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedNodeId === nodeId;
    const isCollapsed = node.collapsed;
    const isMatched = matchedIds.has(nodeId);

    // 如果有搜索词但当前节点和子节点都不匹配，则隐藏
    if (searchQuery && !isMatched) {
        return null;
    }

    // 高亮匹配的文本
    const highlightText = (text: string) => {
        if (!searchQuery) return text;
        const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        const parts = text.split(regex);
        return parts.map((part, i) =>
            regex.test(part) ? <mark key={i} className="outline-highlight">{part}</mark> : part
        );
    };

    return (
        <div className="outline-item-wrapper">
            <div
                className={`outline-item ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => {
                    selectNode(nodeId);
                    window.dispatchEvent(new CustomEvent('navigateToNode', { detail: { nodeId } }));
                }}
            >
                {hasChildren ? (
                    <button
                        className="outline-toggle"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(nodeId);
                        }}
                    >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                ) : (
                    <span className="outline-toggle-placeholder" />
                )}
                <span
                    className="outline-color-dot"
                    style={{ backgroundColor: node.color }}
                />
                <span className="outline-label">{highlightText(node.label)}</span>
                <button
                    className="outline-focus-btn tooltip-bottom"
                    onClick={(e) => {
                        e.stopPropagation();
                        setFocusNode(nodeId);
                    }}
                    data-tip="聚焦此节点（仅显示该分支）"
                >
                    <Focus size={12} />
                </button>
            </div>

            {/* 递归渲染子节点 */}
            {hasChildren && !isCollapsed && (
                <div className="outline-children">
                    {node.children.map((childId) => (
                        <OutlineItem
                            key={childId}
                            nodeId={childId}
                            depth={depth + 1}
                            searchQuery={searchQuery}
                            matchedIds={matchedIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const OutlinePanel: React.FC = () => {
    const { currentMap, showOutline, toggleOutline, focusNodeId, setFocusNode, expandAll, collapseAll } = useMindMapStore();
    const [searchQuery, setSearchQuery] = useState('');

    // 计算匹配的节点ID（包含匹配节点的所有祖先）
    const matchedIds = useMemo(() => {
        if (!currentMap || !searchQuery.trim()) {
            return new Set<string>();
        }

        const query = searchQuery.toLowerCase();
        const matched = new Set<string>();

        // 找出所有匹配的节点及其祖先路径
        const findMatches = (nodeId: string, ancestors: string[]) => {
            const node = currentMap.nodes[nodeId];
            if (!node) return;

            const isMatch = node.label.toLowerCase().includes(query) ||
                (node.notes && node.notes.toLowerCase().includes(query));

            if (isMatch) {
                // 添加匹配节点和所有祖先
                matched.add(nodeId);
                ancestors.forEach(id => matched.add(id));
            }

            // 递归子节点
            if (node.children) {
                node.children.forEach(childId => {
                    findMatches(childId, [...ancestors, nodeId]);
                });
            }
        };

        const rootId = focusNodeId || currentMap.rootId;
        findMatches(rootId, []);

        return matched;
    }, [currentMap, searchQuery, focusNodeId]);

    if (!showOutline || !currentMap) return null;

    const rootId = focusNodeId || currentMap.rootId;
    const rootNode = currentMap.nodes[rootId];

    return (
        <div className="outline-panel">
            <div className="outline-header">
                <h3>
                    <Eye size={16} />
                    大纲视图
                </h3>
                <div className="outline-actions">
                    <button
                        className="outline-expand-btn"
                        onClick={expandAll}
                        data-tooltip="全部展开"
                    >
                        <ChevronsDown size={14} />
                    </button>
                    <button
                        className="outline-expand-btn"
                        onClick={collapseAll}
                        data-tooltip="全部收起"
                    >
                        <ChevronsUp size={14} />
                    </button>
                    {focusNodeId && (
                        <button
                            className="outline-back-btn tooltip-bottom"
                            onClick={() => setFocusNode(null)}
                            data-tip="返回全图"
                        >
                            ← 全图
                        </button>
                    )}
                    <button className="outline-close-btn" onClick={toggleOutline}>
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* 搜索框 */}
            <div className="outline-search">
                <Search size={14} className="outline-search-icon" />
                <input
                    type="text"
                    placeholder="搜索节点..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="outline-search-input"
                />
                {searchQuery && (
                    <button
                        className="outline-search-clear"
                        onClick={() => setSearchQuery('')}
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            <div className="outline-content">
                {focusNodeId && (
                    <div className="outline-focus-hint">
                        聚焦于: <strong>{rootNode?.label}</strong>
                    </div>
                )}
                {searchQuery && matchedIds.size === 0 ? (
                    <div className="outline-no-results">
                        未找到匹配的节点
                    </div>
                ) : (
                    <OutlineItem
                        nodeId={rootId}
                        depth={0}
                        searchQuery={searchQuery}
                        matchedIds={matchedIds}
                    />
                )}
            </div>
        </div>
    );
};

export default OutlinePanel;

