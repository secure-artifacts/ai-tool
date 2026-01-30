import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    MiniMap,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
    Handle,
    Position,
    MarkerType,
    NodeToolbar,
} from '@xyflow/react';
import type { Node, Edge, NodeProps, ReactFlowInstance } from '@xyflow/react';
// Note: @xyflow/react CSS is inlined in mind-map.css for AI Studio compatibility
import { useMindMapStore } from '../store/mindMapStore';
import { GeminiService } from '../services/geminiService';
import { getStoredApiKey, hasAiAccess } from '../services/aiAccess';
import { AIPromptModal } from './AIPromptModal';
import { AIResultModal } from './AIResultModal';
import { buildPlatformConstraints } from '../services/aiConstraints';
import type { MindMapNode as MindMapNodeType, LayoutDirection, NodeStyle, MapStyle } from '../types';
import dagre from 'dagre';
import {
    GitCommit,
    GitBranch,
    Sparkles,
    Link2,
    BoxSelect,
    Braces,
    Edit2,
    Trash2,
    ExternalLink,
} from 'lucide-react';

import { MARKER_GROUPS, NODE_TAG_CONFIG } from '../types';
import { StickerIcon } from './stickerData';
import { BoundaryLayer } from './BoundaryLayer';
import { SummaryLayer } from './SummaryLayer';
import { customEdgeTypes, getEdgeTypeByLayout } from './CustomEdges';
import { AISmartRefinePanel } from './AISmartRefinePanel';
import { MindMapAgent } from './MindMapAgent';

// Custom Node Component
const MindMapNodeComponent: React.FC<NodeProps> = ({ data, selected }) => {
    const isRoot = data.isRoot as boolean;
    const targetHandleId = (data.targetHandleId as string) || 'left';
    const sourceHandleId = (data.sourceHandleId as string) || 'right';
    const sourceHandles = (data.sourceHandles as string[]) || [];
    const markers = (data.markers as string[]) || [];
    const stickers = (data.stickers as string[]) || [];
    const tags = (data.tags as Array<keyof typeof NODE_TAG_CONFIG>) || [];
    const nodeStyle = data.style as NodeStyle | undefined;
    const nodeCollapsed = data.collapsed as boolean;
    const hasChildren = data.hasChildren as boolean;
    const nodeId = data.id as string;
    const { currentMap, addNode, selectNode, updateNode, openAiExpand, deleteNode, toggleCollapse } = useMindMapStore();
    const [isEditing, setIsEditing] = useState(false);
    const [localLabel, setLocalLabel] = useState((data.label as string) || '');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setLocalLabel((data.label as string) || '');
    }, [data.label]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleAddChild = () => {
        if (!currentMap) return;
        const newId = addNode(data.id as string, '新主题');
        if (newId) selectNode(newId);
    };

    const handleAddSibling = () => {
        if (!currentMap) return;
        const node = currentMap.nodes[data.id as string];
        const parentId = node?.parentId;
        if (parentId) {
            const newId = addNode(parentId, '新主题');
            if (newId) selectNode(newId);
        } else {
            handleAddChild();
        }
    };

    // 获取 marker 详情
    const markerItems = markers.map(id => {
        for (const group of MARKER_GROUPS) {
            const item = group.items.find(i => i.id === id);
            if (item) return item;
        }
        return null;
    }).filter(Boolean);

    const stickerItems = stickers;

    // Compute custom styles
    const customStyle: React.CSSProperties = {
        background: nodeStyle?.fill
            ? nodeStyle.fill
            : `linear-gradient(135deg, ${data.color || '#6366f1'}, ${adjustColor(data.color as string || '#6366f1', -20)})`,

        // Border
        borderColor: selected ? '#fff' : (nodeStyle?.borderColor || 'transparent'),
        borderWidth: nodeStyle?.borderWidth !== undefined ? `${nodeStyle.borderWidth}px` : undefined,
        borderStyle: nodeStyle?.borderStyle,

        // Font
        color: nodeStyle?.color || (nodeStyle?.fill ? '#111827' : '#ffffff'),
        fontSize: nodeStyle?.fontSize ? `${nodeStyle.fontSize}px` : undefined,
        fontWeight: nodeStyle?.fontWeight || (isRoot ? 600 : undefined),
        fontStyle: nodeStyle?.fontStyle,
        fontFamily: nodeStyle?.fontFamily,
        textDecoration: nodeStyle?.textDecoration,
    };

    const handleCommitLabel = () => {
        if (!localLabel.trim()) {
            setLocalLabel((data.label as string) || '');
        } else if (data.id) {
            updateNode(data.id as string, { label: localLabel.trim() });
        }
        setIsEditing(false);
    };

    const isOutlineHighlight = Boolean(data.outlineHighlight);

    return (
        <div
            className={`mind-map-node ${isRoot ? 'root-node' : ''} ${selected ? 'selected' : ''} ${isOutlineHighlight ? 'outline-highlight' : ''} ${nodeStyle?.shape ? `shape-${nodeStyle.shape}` : ''}`}
            style={customStyle}
            onDoubleClick={() => setIsEditing(true)}
        >
            {selected && !isEditing && (
                <NodeToolbar className="node-floating-toolbar-v2" position={Position.Top}>
                    {/* 话题 (Sibling) */}
                    {!isRoot && (
                        <button
                            className="toolbar-btn-v2"
                            onClick={(e) => { e.stopPropagation(); handleAddSibling(); }}
                            data-tip="添加话题 (Enter)" className="tooltip-bottom"
                        >
                            <GitCommit className="toolbar-icon rotate-90" size={16} />
                            <span className="toolbar-label">话题</span>
                        </button>
                    )}
                    {/* 子主题 (Child) */}
                    <button
                        className="toolbar-btn-v2"
                        onClick={(e) => { e.stopPropagation(); handleAddChild(); }}
                        data-tip="添加子主题 (Tab)" className="tooltip-bottom"
                    >
                        <GitBranch className="toolbar-icon" size={16} />
                        <span className="toolbar-label">子主题</span>
                    </button>
                    <div className="toolbar-divider" />
                    {/* 关系 */}
                    <button
                        className="toolbar-btn-v2"
                        onClick={(e) => {
                            e.stopPropagation();
                            // 简化：提示用户当前暂不支持关系连线的可视化
                            alert('关系连线功能已启用！\n使用方法：先添加关系，导出时会包含关系数据。\n可视化渲染正在开发中...');
                        }}
                        data-tip="关系连线（开发中）" className="tooltip-bottom"
                    >
                        <Link2 className="toolbar-icon" size={16} />
                        <span className="toolbar-label">关系</span>
                    </button>
                    {/* 边界 */}
                    <button
                        className="toolbar-btn-v2"
                        onClick={(e) => {
                            e.stopPropagation();
                            // 给当前节点及其子节点添加边界
                            const node = currentMap?.nodes[data.id as string];
                            if (node) {
                                const nodeIds = [node.id, ...(node.children || [])];
                                useMindMapStore.getState().addBoundary(nodeIds, `${node.label} 边界`);
                            }
                        }}
                        data-tip="添加边界" className="tooltip-bottom"
                    >
                        <BoxSelect className="toolbar-icon" size={16} />
                        <span className="toolbar-label">边界</span>
                    </button>
                    {/* 概括 */}
                    <button
                        className="toolbar-btn-v2"
                        onClick={(e) => {
                            e.stopPropagation();
                            // 给当前节点的子节点添加概括
                            const node = currentMap?.nodes[data.id as string];
                            if (node && node.children && node.children.length > 0) {
                                const summaryLabel = prompt('请输入概括内容：', '小结');
                                if (summaryLabel) {
                                    useMindMapStore.getState().addSummary(node.children, summaryLabel);
                                }
                            } else {
                                alert('需要先有子节点才能添加概括');
                            }
                        }}
                        data-tip="添加概括" className="tooltip-bottom"
                    >
                        <Braces className="toolbar-icon" size={16} />
                        <span className="toolbar-label">概括</span>
                    </button>
                    <div className="toolbar-divider" />
                    {/* AI 扩展 */}
                    <button
                        className="toolbar-btn-v2 ai-btn"
                        onClick={(e) => { e.stopPropagation(); openAiExpand(data.id as string); }}
                        data-tip="AI 扩展" className="tooltip-bottom"
                    >
                        <Sparkles className="toolbar-icon" size={16} />
                        <span className="toolbar-label">AI</span>
                    </button>
                    {/* 链接 */}
                    <button
                        className="toolbar-btn-v2"
                        onClick={(e) => {
                            e.stopPropagation();
                            const currentLink = (data.link as string) || '';
                            const newLink = prompt('请输入链接 URL：', currentLink);
                            if (newLink !== null) {
                                updateNode(data.id as string, { link: newLink.trim() || undefined });
                            }
                        }}
                        title={data.link ? `编辑链接: ${data.link}` : '添加链接'}
                    >
                        <ExternalLink className="toolbar-icon" size={16} />
                        <span className="toolbar-label">{data.link ? '🔗' : '链接'}</span>
                    </button>
                    {/* 编辑 */}
                    <button
                        className="toolbar-btn-v2 edit-btn"
                        onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                        data-tip="编辑文本 (F2)" className="tooltip-bottom"
                    >
                        <Edit2 className="toolbar-icon" size={16} />
                        <span className="toolbar-label">编辑</span>
                    </button>
                    {/* 删除 */}
                    {!isRoot && (
                        <button
                            className="toolbar-btn-v2 delete-btn"
                            onClick={(e) => { e.stopPropagation(); deleteNode(data.id as string); }}
                            data-tip="删除 (Delete)" className="tooltip-bottom"
                        >
                            <Trash2 className="toolbar-icon" size={16} />
                            <span className="toolbar-label">删除</span>
                        </button>
                    )}
                </NodeToolbar>
            )}
            {!isRoot && (
                <Handle
                    id={targetHandleId}
                    type="target"
                    position={handleIdToPosition(targetHandleId)}
                    className="node-handle"
                />
            )}
            <div className="node-content">
                {stickerItems.length > 0 && (
                    <div className="node-stickers">
                        {stickerItems.map((item, index) => (
                            <span key={`${item}-${index}`} className="node-sticker" title={item}>
                                <StickerIcon sticker={item} size={18} />
                            </span>
                        ))}
                    </div>
                )}
                {isEditing ? (
                    <input
                        ref={inputRef}
                        className="node-label-input"
                        value={localLabel}
                        onChange={(e) => setLocalLabel(e.target.value)}
                        onBlur={handleCommitLabel}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleCommitLabel();
                            }
                            if (e.key === 'Escape') {
                                setIsEditing(false);
                                setLocalLabel((data.label as string) || '');
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className="node-label">{data.label as string}</span>
                )}
                {(data.notes as string) && <span className="node-notes">{data.notes as string}</span>}
                {/* 节点链接显示 */}
                {(data.link as string) && (
                    <a
                        href={data.link as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="node-link"
                        title={`打开链接: ${data.link}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ExternalLink size={12} /> 链接
                    </a>
                )}
                {Array.isArray(data.sources) && data.sources.length > 0 && (
                    <div className="node-sources" title={data.sources.join('\n')}>
                        🔗 来源 ×{data.sources.length}
                    </div>
                )}
                {tags.length > 0 && (
                    <div className="node-tag-badges">
                        {tags.map((tag) => {
                            const config = NODE_TAG_CONFIG[tag];
                            if (!config) return null;
                            return (
                                <span
                                    key={tag}
                                    className="node-tag-badge"
                                    title={config.label}
                                    style={{ backgroundColor: config.color }}
                                >
                                    {config.icon}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* 渲染 Markers */}
                {markerItems.length > 0 && (
                    <div className="node-markers" style={{ display: 'flex', gap: '4px', marginTop: '4px', justifyContent: 'center' }}>
                        {markerItems.map((item, index) => (
                            <span
                                key={`${item!.id}-${index}`}
                                title={item!.label}
                                style={{
                                    fontSize: '14px',
                                    color: item!.type === 'color' ? item!.color : undefined
                                }}
                            >
                                {item!.type === 'color' ? '●' : (item!.content as string)}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {isRoot && sourceHandles.length > 0 ? (
                sourceHandles.map((handleId) => (
                    <Handle
                        key={handleId}
                        id={handleId}
                        type="source"
                        position={handleIdToPosition(handleId)}
                        className="node-handle"
                    />
                ))
            ) : (
                <Handle
                    id={sourceHandleId}
                    type="source"
                    position={handleIdToPosition(sourceHandleId)}
                    className="node-handle"
                />
            )}

            {/* 折叠/展开指示器 */}
            {hasChildren && (
                <button
                    className="collapse-indicator"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(nodeId);
                    }}
                    title={nodeCollapsed ? '展开子节点' : '收起子节点'}
                >
                    {nodeCollapsed ? '+' : '−'}
                </button>
            )}
        </div>
    );
};

function handleIdToPosition(id: string): Position {
    switch (id) {
        case 'right':
            return Position.Right;
        case 'top':
            return Position.Top;
        case 'bottom':
            return Position.Bottom;
        default:
            return Position.Left;
    }
}


// Helper to adjust color brightness
function adjustColor(color: string, amount: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const nodeTypes = {
    mindMapNode: MindMapNodeComponent,
};

const edgeTypes = {
    ...customEdgeTypes,
};

// Layout calculation
function calculateLayout(
    nodes: Record<string, MindMapNodeType>,
    rootId: string,
    direction: LayoutDirection,
    mapStyle?: MapStyle
): { nodes: Node[]; edges: Edge[] } {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    const NODE_WIDTH = 180;
    const NODE_HEIGHT = 50;
    const HORIZONTAL_GAP = 80;
    const VERTICAL_GAP = 40; // 增大间距防止节点重叠
    const nodeHeights: Record<string, number> = {};

    const getNodeHeight = (node: MindMapNodeType) => {
        if (nodeHeights[node.id]) return nodeHeights[node.id];
        const label = node.label || '';
        const notes = node.notes || '';
        // 改进：每行约 8 个中文字符（考虑 max-width: 360px 约能放 8-10 个中文字）
        const charsPerLine = 8;
        const labelLines = Math.max(1, Math.ceil(label.length / charsPerLine));
        const noteLines = notes ? Math.max(1, Math.ceil(notes.length / 12)) : 0;
        const stickersHeight = node.stickers && node.stickers.length > 0 ? 24 : 0;
        const tagsHeight = node.tags && node.tags.length > 0 ? 22 : 0;
        const markersHeight = node.markers && node.markers.length > 0 ? 20 : 0;
        const sourcesHeight = node.sources && node.sources.length > 0 ? 18 : 0;
        // 改进：增加基础高度和行高
        const base = 32 + labelLines * 22;
        const noteHeight = noteLines * 16 + (noteLines > 0 ? 10 : 0);
        const total = Math.max(
            NODE_HEIGHT,
            base + noteHeight + stickersHeight + tagsHeight + markersHeight + sourcesHeight + 16 // 额外边距
        );
        nodeHeights[node.id] = total;
        return total;
    };

    // Helper to get subtree size
    const subtreeSizes: Record<string, { width: number; height: number }> = {};

    function calculateSubtreeSize(nodeId: string, isHorizontal: boolean): { width: number; height: number } {
        if (subtreeSizes[nodeId]) return subtreeSizes[nodeId];

        const node = nodes[nodeId];
        // 如果节点被折叠或没有子节点，返回节点自身大小
        if (!node?.children || node.children.length === 0 || node.collapsed) {
            subtreeSizes[nodeId] = { width: NODE_WIDTH, height: getNodeHeight(node) };
            return subtreeSizes[nodeId];
        }

        let totalWidth = 0;
        let totalHeight = 0;

        node.children.forEach((childId) => {
            const size = calculateSubtreeSize(childId, isHorizontal);
            if (isHorizontal) {
                // Horizontal layout (Logic/Mindmap): children stack vertically
                totalHeight += size.height + VERTICAL_GAP;
                totalWidth = Math.max(totalWidth, size.width);
            } else {
                // Vertical layout (Org): children stack horizontally
                totalWidth += size.width + VERTICAL_GAP;
                totalHeight = Math.max(totalHeight, size.height);
            }
        });

        if (isHorizontal) {
            totalHeight -= VERTICAL_GAP; // Remove last gap
            // Ensure at least node height
            totalHeight = Math.max(totalHeight, getNodeHeight(node));
            subtreeSizes[nodeId] = {
                width: NODE_WIDTH + HORIZONTAL_GAP + totalWidth,
                height: totalHeight
            };
        } else {
            totalWidth -= VERTICAL_GAP; // Remove last gap
            // Ensure at least node width
            totalWidth = Math.max(totalWidth, NODE_WIDTH);
            subtreeSizes[nodeId] = {
                width: totalWidth,
                height: getNodeHeight(node) + HORIZONTAL_GAP + totalHeight
            };
        }

        return subtreeSizes[nodeId];
    }

    const resolveEdgeType = (depth: number) => {
        let edgeType = getEdgeTypeByLayout(direction, depth);
        if (mapStyle?.lineStyle === 'curve') edgeType = 'default';
        if (mapStyle?.lineStyle === 'straight') edgeType = 'straight';
        if (mapStyle?.lineStyle === 'step') edgeType = 'step';
        return edgeType;
    };

    const pushFlowNode = (
        nodeId: string,
        x: number,
        y: number,
        options?: {
            isRoot?: boolean;
            centerY?: boolean;
            targetHandleId?: string;
            sourceHandleId?: string;
            sourceHandles?: string[];
            draggable?: boolean;
        }
    ) => {
        const node = nodes[nodeId];
        if (!node) return 0;
        const nodeHeight = getNodeHeight(node);
        const centerY = options?.centerY ?? false;
        const handleConfig = options?.targetHandleId || options?.sourceHandleId || options?.sourceHandles
            ? {
                targetHandleId: options?.targetHandleId,
                sourceHandleId: options?.sourceHandleId,
                sourceHandles: options?.sourceHandles,
            }
            : getHandleConfig(direction, x, options?.isRoot === true);

        flowNodes.push({
            id: nodeId,
            type: 'mindMapNode',
            position: {
                x,
                y: centerY ? y - nodeHeight / 2 : y,
            },
            data: {
                label: node.label,
                color: node.color,
                notes: node.notes,
                link: node.link,
                tags: node.tags,
                markers: node.markers,
                stickers: node.stickers,
                style: node.style,
                targetHandleId: handleConfig?.targetHandleId,
                sourceHandleId: handleConfig?.sourceHandleId,
                sourceHandles: handleConfig?.sourceHandles,
                isRoot: options?.isRoot,
                collapsed: node.collapsed,
                hasChildren: node.children && node.children.length > 0,
                id: nodeId,
            },
            style: { width: NODE_WIDTH, height: nodeHeight },
            draggable: options?.draggable ?? false,
        });

        return nodeHeight;
    };

    // Generic Layout Function
    function layoutTree(
        nodeId: string,
        x: number,
        y: number,
        dir: 'left' | 'right' | 'up' | 'down',
        depth: number
    ) {
        const node = nodes[nodeId];
        if (!node) return;

        const isHorizontal = dir === 'left' || dir === 'right';
        // calculateSubtreeSize(nodeId, isHorizontal); // Ensure size is calculated/cached, but result unused here

        // Place current node
        // For horizontal layout, y is the center of the subtree area. We need to center the node vertically.
        // For vertical layout, x is the center of the subtree area. We need to center the node horizontally.

        // Visual adjustment: Align node to the "start" of its subtree area in the flow direction
        // But center it in the cross-axis

        // Not modifying x/y directly here as recursion handles "current cursor"

        const handleConfig = getHandleConfig(direction, x, depth === 0);
        const nodeHeight = getNodeHeight(node);
        flowNodes.push({
            id: nodeId,
            type: 'mindMapNode',
            position: {
                x: isHorizontal ? x : x - NODE_WIDTH / 2, // Center align in vertical
                y: isHorizontal ? y - nodeHeight / 2 : y // Center align in horizontal
            },
            data: {
                label: node.label,
                color: node.color,
                notes: node.notes,
                link: node.link,
                tags: node.tags,
                markers: node.markers,
                stickers: node.stickers,
                style: node.style, // Pass custom style
                targetHandleId: handleConfig.targetHandleId,
                sourceHandleId: handleConfig.sourceHandleId,
                sourceHandles: handleConfig.sourceHandles,
                isRoot: depth === 0,
                collapsed: node.collapsed,
                hasChildren: node.children && node.children.length > 0,
                id: nodeId,
            },
            style: { width: NODE_WIDTH, height: nodeHeight },
            draggable: false, // Auto layout prevents dragging
        });

        // 如果节点被折叠，不渲染子节点
        if (node.collapsed) return;

        if (node.children && node.children.length > 0) {
            let startCursor = 0;

            // Calculate starting cursor to center children block
            const totalChildrenSize = node.children.reduce((acc, childId) => {
                const childSize = subtreeSizes[childId];
                return acc + (isHorizontal ? childSize.height : childSize.width);
            }, 0) + (node.children.length - 1) * (isHorizontal ? VERTICAL_GAP : VERTICAL_GAP); // gap is same const for simplicity

            if (isHorizontal) {
                startCursor = y - totalChildrenSize / 2;
            } else {
                startCursor = x - totalChildrenSize / 2;
            }


            node.children.forEach((childId) => {
                const childSize = subtreeSizes[childId];

                let childX = 0;
                let childY = 0;

                if (dir === 'right') {
                    childX = x + NODE_WIDTH + HORIZONTAL_GAP;
                    childY = startCursor + childSize.height / 2;
                    layoutTree(childId, childX, childY, 'right', depth + 1);
                    startCursor += childSize.height + VERTICAL_GAP;
                } else if (dir === 'left') {
                    childX = x - NODE_WIDTH - HORIZONTAL_GAP;
                    childY = startCursor + childSize.height / 2;
                    layoutTree(childId, childX, childY, 'left', depth + 1);
                    startCursor += childSize.height + VERTICAL_GAP;
                } else if (dir === 'down') {
                    childX = startCursor + childSize.width / 2;
                    childY = y + nodeHeight + HORIZONTAL_GAP; // Vertical gap is larger for levels
                    layoutTree(childId, childX, childY, 'down', depth + 1);
                    startCursor += childSize.width + VERTICAL_GAP;
                } else if (dir === 'up') {
                    childX = startCursor + childSize.width / 2;
                    childY = y - nodeHeight - HORIZONTAL_GAP;
                    layoutTree(childId, childX, childY, 'up', depth + 1);
                    startCursor += childSize.width + VERTICAL_GAP;
                }

                // Add Edge
                let edgeType = resolveEdgeType(depth);

                const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                    ? mapStyle.lineColor
                    : (nodes[childId]?.color || '#6366f1');

                const edgeHandles = getEdgeHandlesByDir(dir);
                flowEdges.push({
                    id: `${nodeId}-${childId}`,
                    source: nodeId,
                    target: childId,
                    type: edgeType,
                    animated: false,
                    sourceHandle: edgeHandles.sourceHandleId,
                    targetHandle: edgeHandles.targetHandleId,
                    style: {
                        stroke: strokeColor,
                        strokeWidth: mapStyle?.lineWidth || 2,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: strokeColor,
                    },
                });
            });
        }
    }

    // Special Layout for Mind Map (Center Root, Split Children)
    function layoutMindMap(rootId: string) {
        const root = nodes[rootId];
        if (!root) return;

        // Split children into left and right
        const leftChildren: string[] = [];
        const rightChildren: string[] = [];

        root.children?.forEach((child, index) => {
            if (index % 2 === 0) rightChildren.push(child);
            else leftChildren.push(child);
        });

        // Place Root
        const rootHeight = getNodeHeight(root);
        flowNodes.push({
            id: rootId,
            type: 'mindMapNode',
            position: { x: 0, y: 0 }, // Center
            data: {
                label: root.label,
                color: root.color,
                notes: root.notes,
                link: root.link,
                tags: root.tags,
                markers: root.markers,
                stickers: root.stickers,
                style: root.style,
                sourceHandles: ['left', 'right'],
                isRoot: true,
                collapsed: root.collapsed,
                hasChildren: root.children && root.children.length > 0,
                id: rootId,
            },
            style: { width: NODE_WIDTH, height: rootHeight },
        });

        // 如果根节点被折叠，不渲染子节点
        if (root.collapsed) return;

        // Layout Right Side
        if (rightChildren.length > 0) {
            // Fake a node for right side calculation or just map them
            // Manually calculate stacked height of right children
            const isHorizontal = true;
            rightChildren.forEach(c => calculateSubtreeSize(c, isHorizontal)); // Pre-calc

            const totalRightHeight = rightChildren.reduce((acc, childId) => {
                return acc + subtreeSizes[childId].height;
            }, 0) + (rightChildren.length - 1) * VERTICAL_GAP;

            let startY = 0 - totalRightHeight / 2;

            rightChildren.forEach(childId => {
                const size = subtreeSizes[childId];
                const childY = startY + size.height / 2;
                layoutTree(childId, NODE_WIDTH + HORIZONTAL_GAP, childY, 'right', 1);

                // Add Edge Source->Child
                const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                    ? mapStyle.lineColor
                    : (nodes[childId]?.color || '#6366f1');

                flowEdges.push({
                    id: `${rootId}-${childId}`,
                    source: rootId,
                    target: childId,
                    type: mapStyle?.lineStyle === 'straight'
                        ? 'straight'
                        : mapStyle?.lineStyle === 'step'
                            ? 'step'
                            : 'default', // Bezier default for mindmap
                    sourceHandle: 'right',
                    targetHandle: 'left',
                    style: {
                        stroke: strokeColor,
                        strokeWidth: mapStyle?.lineWidth || 2
                    },
                });

                startY += size.height + VERTICAL_GAP;
            });
        }

        // Layout Left Side
        if (leftChildren.length > 0) {
            const isHorizontal = true;
            leftChildren.forEach(c => calculateSubtreeSize(c, isHorizontal)); // Pre-calc

            const totalLeftHeight = leftChildren.reduce((acc, childId) => {
                return acc + subtreeSizes[childId].height;
            }, 0) + (leftChildren.length - 1) * VERTICAL_GAP;

            let startY = 0 - totalLeftHeight / 2;

            leftChildren.forEach(childId => {
                const size = subtreeSizes[childId];
                const childY = startY + size.height / 2;
                layoutTree(childId, -(NODE_WIDTH + HORIZONTAL_GAP), childY, 'left', 1);

                // Add Edge Source->Child
                const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                    ? mapStyle.lineColor
                    : (nodes[childId]?.color || '#6366f1');

                flowEdges.push({
                    id: `${rootId}-${childId}`,
                    source: rootId,
                    target: childId,
                    type: mapStyle?.lineStyle === 'straight'
                        ? 'straight'
                        : mapStyle?.lineStyle === 'step'
                            ? 'step'
                            : 'default',
                    sourceHandle: 'left',
                    targetHandle: 'right',
                    style: {
                        stroke: strokeColor,
                        strokeWidth: mapStyle?.lineWidth || 2
                    },
                });

                startY += size.height + VERTICAL_GAP;
            });
        }
    }


    // Grid Layout Function - arranges first-level children in a grid
    function layoutGrid(rootId: string, cols: number = 4) {
        const root = nodes[rootId];
        if (!root) return;

        const rootHeight = getNodeHeight(root);
        // Place Root at top center
        flowNodes.push({
            id: rootId,
            type: 'mindMapNode',
            position: { x: 0, y: 0 },
            data: {
                label: root.label,
                color: root.color,
                notes: root.notes,
                link: root.link,
                tags: root.tags,
                markers: root.markers,
                stickers: root.stickers,
                style: root.style,
                sourceHandles: ['bottom'],
                isRoot: true,
                collapsed: root.collapsed,
                hasChildren: root.children && root.children.length > 0,
                id: rootId,
            },
            style: { width: NODE_WIDTH, height: rootHeight },
        });

        if (root.collapsed || !root.children || root.children.length === 0) return;

        // Calculate grid layout for first-level children
        const GRID_COLS = cols; // Number of columns based on parameter
        const CELL_WIDTH = NODE_WIDTH + HORIZONTAL_GAP;
        const CELL_HEIGHT = 120; // Fixed cell height for grid
        const GRID_START_Y = rootHeight + HORIZONTAL_GAP + 40;

        root.children.forEach((childId, index) => {
            const child = nodes[childId];
            if (!child) return;

            const col = index % GRID_COLS;
            const row = Math.floor(index / GRID_COLS);
            const gridWidth = Math.min(root.children!.length, GRID_COLS) * CELL_WIDTH;
            const startX = -gridWidth / 2 + CELL_WIDTH / 2;

            const childX = startX + col * CELL_WIDTH;
            const childY = GRID_START_Y + row * CELL_HEIGHT;

            const childHeight = getNodeHeight(child);
            flowNodes.push({
                id: childId,
                type: 'mindMapNode',
                position: { x: childX - NODE_WIDTH / 2, y: childY },
                data: {
                    label: child.label,
                    color: child.color,
                    notes: child.notes,
                    tags: child.tags,
                    markers: child.markers,
                    stickers: child.stickers,
                    style: child.style,
                    targetHandleId: 'top',
                    sourceHandleId: 'bottom',
                    sourceHandles: ['bottom'],
                    isRoot: false,
                    collapsed: child.collapsed,
                    hasChildren: child.children && child.children.length > 0,
                    id: childId,
                },
                style: { width: NODE_WIDTH, height: childHeight },
            });

            // Edge from root to child
            const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                ? mapStyle.lineColor
                : (child.color || '#6366f1');

            flowEdges.push({
                id: `${rootId}-${childId}`,
                source: rootId,
                target: childId,
                type: 'smoothstep',
                sourceHandle: 'bottom',
                targetHandle: 'top',
                style: {
                    stroke: strokeColor,
                    strokeWidth: mapStyle?.lineWidth || 2,
                },
            });

            // Layout sub-children below each grid item
            if (!child.collapsed && child.children && child.children.length > 0) {
                let subY = childY + childHeight + VERTICAL_GAP;
                child.children.forEach((subChildId) => {
                    const subChild = nodes[subChildId];
                    if (!subChild) return;

                    const subHeight = getNodeHeight(subChild);
                    flowNodes.push({
                        id: subChildId,
                        type: 'mindMapNode',
                        position: { x: childX - NODE_WIDTH / 2, y: subY },
                        data: {
                            label: subChild.label,
                            color: subChild.color,
                            notes: subChild.notes,
                            tags: subChild.tags,
                            markers: subChild.markers,
                            stickers: subChild.stickers,
                            style: subChild.style,
                            targetHandleId: 'top',
                            sourceHandleId: 'bottom',
                            sourceHandles: [],
                            isRoot: false,
                            collapsed: subChild.collapsed,
                            hasChildren: subChild.children && subChild.children.length > 0,
                            id: subChildId,
                        },
                        style: { width: NODE_WIDTH, height: subHeight },
                    });

                    const subStrokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                        ? mapStyle.lineColor
                        : (subChild.color || '#6366f1');

                    flowEdges.push({
                        id: `${childId}-${subChildId}`,
                        source: childId,
                        target: subChildId,
                        type: 'smoothstep',
                        sourceHandle: 'bottom',
                        targetHandle: 'top',
                        style: {
                            stroke: subStrokeColor,
                            strokeWidth: mapStyle?.lineWidth || 2,
                        },
                    });

                    subY += subHeight + VERTICAL_GAP;
                });
            }
        });
    }

    function layoutBracket(rootId: string, dir: 'left' | 'right') {
        const isHorizontal = true;
        const traverseCalc = (nid: string) => {
            calculateSubtreeSize(nid, isHorizontal);
            nodes[nid]?.children?.forEach(traverseCalc);
        };
        traverseCalc(rootId);
        layoutTree(rootId, 0, 0, dir, 0);
    }

    function layoutTreeMap(rootId: string, dir: 'left' | 'right') {
        const isHorizontal = true;
        const traverseCalc = (nid: string) => {
            calculateSubtreeSize(nid, isHorizontal);
            nodes[nid]?.children?.forEach(traverseCalc);
        };
        traverseCalc(rootId);
        layoutTree(rootId, 0, 0, dir, 0);
    }

    function layoutTimeline(rootId: string) {
        const root = nodes[rootId];
        if (!root) return;

        pushFlowNode(rootId, 0, 0, {
            isRoot: true,
            centerY: true,
            sourceHandles: ['right'],
            draggable: false,
        });

        if (root.collapsed || !root.children || root.children.length === 0) return;

        const gapX = NODE_WIDTH + HORIZONTAL_GAP + 60;
        const startX = NODE_WIDTH + HORIZONTAL_GAP;
        const branchGapX = Math.max(40, NODE_WIDTH * 0.4);
        const branchGapY = Math.max(36, VERTICAL_GAP);

        const addBranch = (parentId: string, parentX: number, parentY: number, dir: 'up' | 'down', depth: number) => {
            const parent = nodes[parentId];
            if (!parent || parent.collapsed || !parent.children?.length) return;

            const parentHeight = getNodeHeight(parent);
            let cursor = parentY + (dir === 'down'
                ? parentHeight / 2 + branchGapY
                : -(parentHeight / 2 + branchGapY));

            parent.children.forEach((childId) => {
                const child = nodes[childId];
                if (!child) return;
                const childHeight = getNodeHeight(child);
                const childX = parentX + branchGapX * depth;
                const childY = dir === 'down'
                    ? cursor + childHeight / 2
                    : cursor - childHeight / 2;

                pushFlowNode(childId, childX, childY, {
                    centerY: true,
                    targetHandleId: dir === 'down' ? 'top' : 'bottom',
                    sourceHandleId: dir === 'down' ? 'bottom' : 'top',
                    draggable: false,
                });

                // 垂直分支使用直线连接，避免渲染问题
                const edgeType = 'straight';
                const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                    ? mapStyle.lineColor
                    : (child.color || '#6366f1');

                flowEdges.push({
                    id: `${parentId}-${childId}`,
                    source: parentId,
                    target: childId,
                    type: edgeType,
                    animated: false,
                    sourceHandle: dir === 'down' ? 'bottom' : 'top',
                    targetHandle: dir === 'down' ? 'top' : 'bottom',
                    style: {
                        stroke: strokeColor,
                        strokeWidth: mapStyle?.lineWidth || 2,
                    },
                });

                addBranch(childId, childX, childY, dir, depth + 1);

                cursor = dir === 'down'
                    ? cursor + childHeight + branchGapY
                    : cursor - childHeight - branchGapY;
            });
        };

        root.children.forEach((childId, index) => {
            const child = nodes[childId];
            if (!child) return;
            const childHeight = getNodeHeight(child);
            const childX = startX + index * gapX;
            const childY = 0;
            const branchDir: 'up' | 'down' = index % 2 === 0 ? 'down' : 'up';

            pushFlowNode(childId, childX, childY, {
                centerY: true,
                targetHandleId: 'left',
                sourceHandleId: branchDir === 'down' ? 'bottom' : 'top',
                draggable: false,
            });

            const edgeType = 'straight';
            const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                ? mapStyle.lineColor
                : (child.color || '#6366f1');

            flowEdges.push({
                id: `${rootId}-${childId}`,
                source: rootId,
                target: childId,
                type: edgeType,
                animated: false,
                sourceHandle: 'right',
                targetHandle: 'left',
                style: {
                    stroke: strokeColor,
                    strokeWidth: mapStyle?.lineWidth || 2,
                },
            });

            addBranch(childId, childX, childY, branchDir, 1);
        });
    }

    function layoutFishbone(rootId: string) {
        const root = nodes[rootId];
        if (!root) return;

        pushFlowNode(rootId, 0, 0, {
            isRoot: true,
            centerY: true,
            sourceHandles: ['right'],
            draggable: false,
        });

        if (root.collapsed || !root.children || root.children.length === 0) return;

        const spineGapX = NODE_WIDTH + HORIZONTAL_GAP + 40;
        const branchBaseY = Math.max(70, NODE_HEIGHT + 20);
        const branchGapY = Math.max(50, VERTICAL_GAP + 10);
        const branchGapX = Math.max(60, NODE_WIDTH * 0.5);

        const addFishboneBranch = (parentId: string, parentX: number, parentY: number, dir: 'up' | 'down', depth: number) => {
            const parent = nodes[parentId];
            if (!parent || parent.collapsed || !parent.children?.length) return;

            let cursor = parentY + (dir === 'up' ? -branchGapY : branchGapY);
            parent.children.forEach((childId) => {
                const child = nodes[childId];
                if (!child) return;
                const childHeight = getNodeHeight(child);
                const childX = parentX + branchGapX * depth;
                const childY = dir === 'up'
                    ? cursor - childHeight / 2
                    : cursor + childHeight / 2;

                pushFlowNode(childId, childX, childY, {
                    centerY: true,
                    draggable: false,
                });

                const edgeType = 'fishbone';
                const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                    ? mapStyle.lineColor
                    : (child.color || '#6366f1');

                flowEdges.push({
                    id: `${parentId}-${childId}`,
                    source: parentId,
                    target: childId,
                    type: edgeType,
                    animated: false,
                    sourceHandle: 'right',
                    targetHandle: 'left',
                    style: {
                        stroke: strokeColor,
                        strokeWidth: mapStyle?.lineWidth || 2,
                    },
                });

                addFishboneBranch(childId, childX, childY, dir, depth + 1);

                cursor = dir === 'up'
                    ? cursor - (childHeight + branchGapY)
                    : cursor + (childHeight + branchGapY);
            });
        };

        root.children.forEach((childId, index) => {
            const child = nodes[childId];
            if (!child) return;
            const childHeight = getNodeHeight(child);
            const branchDir: 'up' | 'down' = index % 2 === 0 ? 'up' : 'down';
            const childX = spineGapX * (index + 1);
            const childY = branchDir === 'up'
                ? -branchBaseY - childHeight / 2
                : branchBaseY + childHeight / 2;

            pushFlowNode(childId, childX, childY, {
                centerY: true,
                draggable: false,
            });

            const strokeColor = (mapStyle?.lineColor && !mapStyle?.rainbowLines)
                ? mapStyle.lineColor
                : (child.color || '#6366f1');

            flowEdges.push({
                id: `${rootId}-${childId}`,
                source: rootId,
                target: childId,
                type: 'fishbone',
                animated: false,
                sourceHandle: 'right',
                targetHandle: 'left',
                style: {
                    stroke: strokeColor,
                    strokeWidth: mapStyle?.lineWidth || 2,
                },
            });

            addFishboneBranch(childId, childX, childY, branchDir, 1);
        });
    }

    const useDagreLayouts = new Set<LayoutDirection>([
        'logic-right',
        'logic-left',
        'org-down',
        'org-up',
    ]);

    // Switch based on Direction
    if (nodes[rootId]) {
        if (direction === 'mindmap' || direction === 'four-direction') {
            layoutMindMap(rootId);
        } else if (direction.startsWith('grid-')) {
            const cols = parseInt(direction.split('-')[1]) || 4;
            layoutGrid(rootId, cols);
        } else if (direction === 'bracket-right') {
            layoutBracket(rootId, 'right');
        } else if (direction === 'bracket-left') {
            layoutBracket(rootId, 'left');
        } else if (direction === 'tree-right') {
            layoutTreeMap(rootId, 'right');
        } else if (direction === 'tree-left') {
            layoutTreeMap(rootId, 'left');
        } else if (direction === 'timeline' || direction === 'horizontal-right') {
            layoutTimeline(rootId);
        } else if (direction === 'fishbone') {
            layoutFishbone(rootId);
        } else {
            // Common Tree Layouts (logic / org)
            let isHorizontal = true;
            let dir: 'right' | 'left' | 'down' | 'up' = 'right';

            switch (direction) {
                case 'logic-right':
                    dir = 'right'; isHorizontal = true; break;
                case 'logic-left':
                    dir = 'left'; isHorizontal = true; break;
                case 'org-down':
                    dir = 'down'; isHorizontal = false; break;
                case 'org-up':
                    dir = 'up'; isHorizontal = false; break;
                default:
                    dir = 'right'; isHorizontal = true; break;
            }

            // Pre-calculate all sizes
            const traverseCalc = (nid: string) => {
                calculateSubtreeSize(nid, isHorizontal);
                nodes[nid]?.children?.forEach(traverseCalc);
            };
            traverseCalc(rootId);

            layoutTree(rootId, 0, 0, dir, 0); // Start at 0,0
        }
    }

    if (useDagreLayouts.has(direction)) {
        const dagreResult = applyDagreLayout(flowNodes, flowEdges, direction);
        return { nodes: dagreResult.nodes, edges: dagreResult.edges };
    }

    return { nodes: flowNodes, edges: flowEdges };
}

function getEdgeHandlesByDir(dir: 'left' | 'right' | 'up' | 'down') {
    if (dir === 'up') {
        return { sourceHandleId: 'top', targetHandleId: 'bottom' };
    }
    if (dir === 'down') {
        return { sourceHandleId: 'bottom', targetHandleId: 'top' };
    }
    if (dir === 'left') {
        return { sourceHandleId: 'left', targetHandleId: 'right' };
    }
    return { sourceHandleId: 'right', targetHandleId: 'left' };
}

function applyDagreLayout(
    nodes: Node[],
    edges: Edge[],
    direction: LayoutDirection
): { nodes: Node[]; edges: Edge[] } {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));

    const rankdir = direction.includes('left')
        ? 'RL'
        : direction.includes('up')
            ? 'BT'
            : direction.includes('down')
                ? 'TB'
                : 'LR';

    graph.setGraph({ rankdir, ranksep: 180, nodesep: 60 });

    nodes.forEach((node) => {
        const height = (node.style as React.CSSProperties | undefined)?.height;
        const resolvedHeight = typeof height === 'number' ? height : 60;
        // 根据节点内容长度动态计算宽度
        const label = (node.data?.label as string) || '';
        const baseWidth = 180;
        const charWidth = 14; // 每个字符大约宽度
        const calculatedWidth = Math.min(360, Math.max(baseWidth, label.length * charWidth));
        graph.setNode(node.id, { width: calculatedWidth, height: resolvedHeight });
    });

    edges.forEach((edge) => {
        graph.setEdge(edge.source, edge.target);
    });

    dagre.layout(graph);

    const layoutedNodes = nodes.map((node) => {
        const pos = graph.node(node.id);
        if (!pos) return node;
        return {
            ...node,
            position: {
                x: pos.x - 90,
                y: pos.y - 30,
            },
        };
    });

    const edgeType =
        direction === 'timeline' || direction === 'fishbone'
            ? 'straight'
            : direction.includes('org') || direction.includes('logic')
                ? 'step'
                : 'smoothstep';

    const layoutedEdges = edges.map((edge) => ({
        ...edge,
        type: edgeType,
    }));

    return { nodes: layoutedNodes, edges: layoutedEdges };
}

function getHandleConfig(direction: LayoutDirection, x: number, isRoot: boolean) {
    if (isRoot && direction === 'mindmap') {
        return { targetHandleId: 'left', sourceHandleId: 'right', sourceHandles: ['left', 'right'] };
    }

    if (direction === 'mindmap') {
        if (x < 0) {
            return { targetHandleId: 'right', sourceHandleId: 'left', sourceHandles: [] };
        }
        return { targetHandleId: 'left', sourceHandleId: 'right', sourceHandles: [] };
    }

    if (direction.includes('up')) {
        return { targetHandleId: 'bottom', sourceHandleId: 'top', sourceHandles: [] };
    }

    if (direction.includes('down')) {
        return { targetHandleId: 'top', sourceHandleId: 'bottom', sourceHandles: [] };
    }

    if (direction.includes('left')) {
        return { targetHandleId: 'right', sourceHandleId: 'left', sourceHandles: [] };
    }

    return { targetHandleId: 'left', sourceHandleId: 'right', sourceHandles: [] };
}

function getLayoutKey(nodes: Record<string, MindMapNodeType>): string {
    const ids = Object.keys(nodes).sort();
    const parts = ids.map((id) => {
        const node = nodes[id];
        const tags = (node.tags || []).join(',');
        const markers = (node.markers || []).join(',');
        const stickers = (node.stickers || []).join(',');
        const notes = node.notes || '';
        return `${id}|${node.label}|${notes}|${tags}|${markers}|${stickers}`;
    });
    return parts.join('||');
}



export const MindMapCanvas: React.FC = () => {
    const {
        currentMap,
        selectedNodeId,
        selectNode,
        layoutDirection,
        themeMode,
        geminiApiKey,
        aiExpandNodeId,
        closeAiExpand,
        addStructureToNode,
        addNode,
        openAiExpand,
        deleteNode,
        updateNode,
        allowManualDrag,
        aiPlatform,
        aiGoal,
        aiAudience,
        aiScenario,
        addAiResult,
        removeBoundary,
        removeSummary,
        focusNodeId,
    } = useMindMapStore();

    const [isAiGenerating, setIsAiGenerating] = useState(false);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [aiResultModal, setAiResultModal] = useState<{ isOpen: boolean; title: string; content: string }>({
        isOpen: false,
        title: '',
        content: '',
    });
    const [isAiToolRunning, setIsAiToolRunning] = useState(false);
    const [outlineHighlightNodeId, setOutlineHighlightNodeId] = useState<string | null>(null);
    const dragStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
    const lastLayoutDirectionRef = useRef<LayoutDirection | null>(null);
    const lastLayoutKeyRef = useRef<string>('');
    const reactFlowRef = useRef<ReactFlowInstance | null>(null);
    const outlineHighlightTimerRef = useRef<number | null>(null);

    // 智能完善面板状态
    const [showSmartRefine, setShowSmartRefine] = useState(false);

    // Agent 面板状态
    const [showAgent, setShowAgent] = useState(false);

    // 监听智能完善面板打开事件
    useEffect(() => {
        const handleOpenSmartRefine = () => {
            setShowSmartRefine(true);
            setShowAgent(false); // 关闭 Agent
        };
        const handleOpenAgent = () => {
            setShowAgent(true);
            setShowSmartRefine(false); // 关闭智能完善
        };
        window.addEventListener('openSmartRefine', handleOpenSmartRefine);
        window.addEventListener('openMindMapAgent', handleOpenAgent);
        return () => {
            window.removeEventListener('openSmartRefine', handleOpenSmartRefine);
            window.removeEventListener('openMindMapAgent', handleOpenAgent);
        };
    }, []);

    // Recalculate layout when map changes
    useEffect(() => {
        if (currentMap) {
            // 聚焦模式：使用 focusNodeId，否则使用 rootId
            const effectiveRootId = focusNodeId || currentMap.rootId;
            const layout = calculateLayout(
                currentMap.nodes,
                effectiveRootId,
                layoutDirection,
                currentMap.style // Pass map style
            );
            const layoutKey = getLayoutKey(currentMap.nodes) + (focusNodeId || '');
            const layoutKeyChanged = layoutKey !== lastLayoutKeyRef.current;

            if (lastLayoutDirectionRef.current !== layoutDirection || layoutKeyChanged) {
                setNodes(layout.nodes.map((node) => ({
                    ...node,
                    draggable: true,
                })));
            } else {
                setNodes((prev) => {
                    const prevMap = new Map(prev.map((node) => [node.id, node]));
                    return layout.nodes.map((node) => {
                        const existing = prevMap.get(node.id);
                        return existing
                            ? { ...node, position: existing.position, draggable: true }
                            : { ...node, draggable: true };
                    });
                });
            }

            setEdges(layout.edges);
            lastLayoutDirectionRef.current = layoutDirection;
            lastLayoutKeyRef.current = layoutKey;
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [currentMap, layoutDirection, focusNodeId, setNodes, setEdges]);

    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            selectNode(node.id);
        },
        [selectNode]
    );

    const onPaneClick = useCallback(() => {
        setContextMenu(null);
    }, []);

    const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
        event.preventDefault();
        setContextMenu({ id: node.id, x: event.clientX, y: event.clientY });
    }, []);

    const handleAutoLayout = useCallback(() => {
        if (!currentMap) return;
        const layout = calculateLayout(
            currentMap.nodes,
            currentMap.rootId,
            layoutDirection,
            currentMap.style
        );
        setNodes(layout.nodes.map((node) => ({
            ...node,
            draggable: true,
        })));
        setEdges(layout.edges);
    }, [currentMap, layoutDirection, setNodes, setEdges]);

    const getDescendants = useCallback((nodeId: string) => {
        if (!currentMap) return [];
        const result: string[] = [];
        const visit = (id: string) => {
            const node = currentMap.nodes[id];
            if (!node?.children) return;
            node.children.forEach((childId) => {
                result.push(childId);
                visit(childId);
            });
        };
        visit(nodeId);
        return result;
    }, [currentMap]);

    const onNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
        if (!allowManualDrag) return;
        const targetIds = [node.id, ...getDescendants(node.id)];
        const positions: Record<string, { x: number; y: number }> = {};
        setNodes((prev) => {
            prev.forEach((item) => {
                if (targetIds.includes(item.id)) {
                    positions[item.id] = { ...item.position };
                }
            });
            return prev;
        });
        dragStartPositionsRef.current = positions;
    }, [allowManualDrag, getDescendants, setNodes]);

    const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
        if (!allowManualDrag) return;
        const start = dragStartPositionsRef.current[node.id];
        if (!start) return;
        const delta = {
            x: node.position.x - start.x,
            y: node.position.y - start.y,
        };

        const targetIds = [node.id, ...getDescendants(node.id)];
        setNodes((prev) =>
            prev.map((item) => {
                if (!targetIds.includes(item.id)) return item;
                const original = dragStartPositionsRef.current[item.id] || item.position;
                return {
                    ...item,
                    position: { x: original.x + delta.x, y: original.y + delta.y },
                };
            })
        );
    }, [allowManualDrag, getDescendants, setNodes]);

    const getNodeContextPath = useCallback((nodeId: string): string => {
        if (!currentMap) return '';
        const path: string[] = [];
        let currentId: string | null | undefined = nodeId;
        while (currentId) {
            const foundNode: MindMapNodeType | undefined = currentMap.nodes[currentId];
            if (!foundNode) break;
            path.unshift(foundNode.label);
            currentId = foundNode.parentId;
        }
        return path.join(' / ');
    }, [currentMap]);

    const handleGenerateAI = useCallback(async (instruction: string) => {
        if (!currentMap || !aiExpandNodeId) return;
        const node = currentMap.nodes[aiExpandNodeId];
        if (!node) return;

        const envApiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) as string | undefined;
        const storedApiKey = getStoredApiKey();
        const key = geminiApiKey || envApiKey || storedApiKey;
        if (!hasAiAccess(key)) {
            alert('未检测到主工具箱 API 密钥，请在右上角设置。');
            return;
        }

        setIsAiGenerating(true);
        try {
            const contextPath = getNodeContextPath(aiExpandNodeId);
            const service = new GeminiService(key);
            const children = await service.generateDeepSubtopics(node.label, contextPath, instruction);
            if (children.length > 0) {
                addStructureToNode(aiExpandNodeId, children);
            }
            closeAiExpand();
        } catch (err) {
            console.error('AI 扩展失败:', err);
        } finally {
            setIsAiGenerating(false);
        }
    }, [currentMap, aiExpandNodeId, geminiApiKey, addStructureToNode, closeAiExpand, getNodeContextPath]);

    const runAiTool = useCallback(async (
        action: 'cultivate' | 'wbs' | 'optimize' | 'regroup' | 'explain' | 'desensitize' | 'video_script',
        nodeId: string
    ) => {
        if (!currentMap) return;
        const node = currentMap.nodes[nodeId];
        if (!node) return;

        const envApiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) as string | undefined;
        const storedApiKey = getStoredApiKey();
        const key = geminiApiKey || envApiKey || storedApiKey;
        if (!hasAiAccess(key)) {
            alert('未检测到主工具箱 API 密钥，请在右上角设置。');
            return;
        }

        setIsAiToolRunning(true);
        try {
            const service = new GeminiService(key);
            const constraints = buildPlatformConstraints(aiPlatform, aiGoal, aiAudience, aiScenario);
            if (action === 'cultivate') {
                const suggestions = await service.cultivateIdeas(node.label, constraints);
                if (suggestions.length) addStructureToNode(nodeId, suggestions);
            }
            if (action === 'wbs') {
                const steps = await service.jobBreakdown(node.label, constraints);
                if (steps.length) addStructureToNode(nodeId, steps);
            }
            if (action === 'optimize') {
                const optimized = await service.optimizeLabel(node.label);
                if (optimized) updateNode(nodeId, { label: optimized });
            }
            if (action === 'regroup') {
                const regrouped = await service.regroup(node.label, constraints);
                if (regrouped.length) {
                    const wrapperId = addNode(nodeId, '改组建议');
                    addStructureToNode(wrapperId, regrouped);
                }
            }
            if (action === 'explain') {
                const explanation = await service.explainTerm(node.label);
                if (explanation) updateNode(nodeId, { notes: explanation });
            }
            if (action === 'desensitize') {
                const masked = await service.desensitizeText(node.label);
                if (masked) updateNode(nodeId, { label: masked });
            }
            if (action === 'video_script') {
                const content = await service.generateVideoScriptResult(node.label, constraints);
                if (content) {
                    setAiResultModal({
                        isOpen: true,
                        title: `🎬 视频脚本：${node.label}`,
                        content,
                    });
                    addNode(nodeId, '成片描述', undefined, content);
                    addAiResult(`视频脚本：${node.label}`, content);
                }
            }
        } catch (err) {
            console.error('AI 工具执行失败:', err);
        } finally {
            setIsAiToolRunning(false);
        }
    }, [currentMap, geminiApiKey, addStructureToNode, addNode, updateNode]);

    // =====================
    // Keyboard Shortcuts
    // =====================
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Ignore if typing in an input or textarea
            const target = event.target as HTMLElement;
            if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
                return;
            }

            if (!currentMap || !selectedNodeId) return;
            const selectedNode = currentMap.nodes[selectedNodeId];
            if (!selectedNode) return;

            switch (event.key) {
                case 'Tab':
                    // Add child node
                    event.preventDefault();
                    addNode(selectedNodeId, '新主题');
                    break;
                case 'Enter':
                    // Add sibling node
                    event.preventDefault();
                    if (selectedNode.parentId) {
                        const newId = addNode(selectedNode.parentId, '新主题');
                        if (newId) selectNode(newId);
                    } else {
                        addNode(selectedNodeId, '新主题');
                    }
                    break;
                case 'Backspace':
                case 'Delete':
                    // Delete node (except root)
                    if (selectedNodeId !== currentMap.rootId) {
                        deleteNode(selectedNodeId);
                    }
                    break;
                case 'F2':
                    // We can't directly enter edit mode from here,
                    // but we trigger a custom event that the node can listen to
                    // For now, just select the node to show toolbar
                    event.preventDefault();
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [currentMap, selectedNodeId, addNode, deleteNode, selectNode]);

    // Update selected state on nodes
    useEffect(() => {
        setNodes((nds) =>
            nds.map((node) => ({
                ...node,
                selected: node.id === selectedNodeId,
            }))
        );
    }, [selectedNodeId, setNodes]);

    useEffect(() => {
        setNodes((nds) =>
            nds.map((node) => ({
                ...node,
                data: {
                    ...node.data,
                    outlineHighlight: outlineHighlightNodeId === node.id,
                },
            }))
        );
    }, [outlineHighlightNodeId, setNodes]);

    useEffect(() => {
        (window as any).__mindMapGetFlowData = () => ({ nodes, edges });
        return () => {
            if ((window as any).__mindMapGetFlowData) {
                delete (window as any).__mindMapGetFlowData;
            }
        };
    }, [nodes, edges]);

    const fitViewToNodes = useCallback(() => {
        const instance = reactFlowRef.current;
        if (!instance) return;
        const currentNodes = instance.getNodes?.() || [];
        if (currentNodes.length === 0) return;
        instance.fitView({ padding: 0.2, duration: 300 });
    }, []);

    const navigateToNode = useCallback((nodeId: string) => {
        const instance = reactFlowRef.current;
        if (!instance) return;

        const getTarget = () =>
            instance.getNode?.(nodeId) || (instance.getNodes?.() || []).find((node) => node.id === nodeId) || null;

        const focusTarget = (target: Node) => {
            const position = target.positionAbsolute || target.position;
            const width = target.width ?? (target.style as { width?: number } | undefined)?.width ?? 180;
            const height = target.height ?? (target.style as { height?: number } | undefined)?.height ?? 50;
            const currentZoom = instance.getZoom?.() ?? 1;
            const zoom = Math.min(2, Math.max(currentZoom, 1.4));
            instance.setCenter(position.x + width / 2, position.y + height / 2, { zoom, duration: 300 });
        };

        const target = getTarget();
        if (target) {
            focusTarget(target);
        } else {
            window.setTimeout(() => {
                const retryTarget = getTarget();
                if (retryTarget) focusTarget(retryTarget);
            }, 80);
        }

        setOutlineHighlightNodeId(nodeId);
        if (outlineHighlightTimerRef.current) {
            window.clearTimeout(outlineHighlightTimerRef.current);
        }
        outlineHighlightTimerRef.current = window.setTimeout(() => {
            setOutlineHighlightNodeId(null);
        }, 1200);
    }, []);

    useEffect(() => {
        const handleFitView = () => fitViewToNodes();
        const handleNavigate = (event: Event) => {
            const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
            if (!detail?.nodeId) return;
            navigateToNode(detail.nodeId);
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                fitViewToNodes();
            }
        };

        // 添加整理布局事件监听
        const onAutoLayout = () => {
            if (!currentMap) return;
            const layout = calculateLayout(
                currentMap.nodes,
                currentMap.rootId,
                layoutDirection,
                currentMap.style
            );
            setNodes(layout.nodes.map((node) => ({
                ...node,
                draggable: true,
            })));
            setEdges(layout.edges);
        };

        window.addEventListener('mindmap-fit-view', handleFitView as EventListener);
        window.addEventListener('mindmap-auto-layout', onAutoLayout as EventListener);
        window.addEventListener('navigateToNode', handleNavigate as EventListener);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mindmap-fit-view', handleFitView as EventListener);
            window.removeEventListener('mindmap-auto-layout', onAutoLayout as EventListener);
            window.removeEventListener('navigateToNode', handleNavigate as EventListener);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [fitViewToNodes, navigateToNode, currentMap, layoutDirection, setNodes, setEdges]);

    if (!currentMap) {
        return (
            <div className="canvas-placeholder">
                <div className="placeholder-content">
                    <span className="material-icons placeholder-icon-material">tips_and_updates</span>
                    <h2>还没有选择思维导图</h2>
                    <p>点击「新建」创建一个新的思维导图，或「打开」已保存的导图</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className="mind-map-canvas"
            style={{ background: currentMap.style?.background || (themeMode === 'dark' ? '#0f0f23' : '#f8fafc') }}
        >
            <AIResultModal
                isOpen={aiResultModal.isOpen}
                onClose={() => setAiResultModal({ isOpen: false, title: '', content: '' })}
                title={aiResultModal.title}
                content={aiResultModal.content}
            />
            <AIPromptModal
                isOpen={Boolean(aiExpandNodeId)}
                onClose={closeAiExpand}
                onSubmit={handleGenerateAI}
                topic={aiExpandNodeId ? currentMap.nodes[aiExpandNodeId]?.label : undefined}
                isLoading={isAiGenerating}
            />
            {contextMenu && (
                <div className="node-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    <button onClick={() => { selectNode(contextMenu.id); setContextMenu(null); }}>选中</button>
                    <button onClick={() => { addNode(contextMenu.id, '新主题'); setContextMenu(null); }}>子主题</button>
                    <button onClick={() => {
                        const node = currentMap.nodes[contextMenu.id];
                        if (node?.parentId) {
                            addNode(node.parentId, '新主题');
                        }
                        setContextMenu(null);
                    }}>话题</button>
                    <button onClick={() => { openAiExpand(contextMenu.id); setContextMenu(null); }}>AI 扩展</button>
                    <div className="context-divider" />
                    <div className="context-section-title">AI 工具</div>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('cultivate', contextMenu.id); setContextMenu(null); }}>培养想法</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('wbs', contextMenu.id); setContextMenu(null); }}>工作分解</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('optimize', contextMenu.id); setContextMenu(null); }}>地图优化</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('regroup', contextMenu.id); setContextMenu(null); }}>改组</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('explain', contextMenu.id); setContextMenu(null); }}>解释</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('desensitize', contextMenu.id); setContextMenu(null); }}>数据脱敏</button>
                    <button disabled={isAiToolRunning} onClick={() => { runAiTool('video_script', contextMenu.id); setContextMenu(null); }}>视频脚本</button>
                    <button onClick={() => { handleAutoLayout(); setContextMenu(null); }}>整理布局</button>
                    <button onClick={() => {
                        if (contextMenu.id !== currentMap.rootId && confirm('确定要删除这个节点吗？')) {
                            deleteNode(contextMenu.id);
                        }
                        setContextMenu(null);
                    }}>删除</button>
                </div>
            )}

            {/* 智能完善面板 */}
            {showSmartRefine && (
                <div className="smart-refine-overlay">
                    <div className="smart-refine-container">
                        <AISmartRefinePanel onClose={() => setShowSmartRefine(false)} />
                    </div>
                </div>
            )}

            {/* AI Agent 面板 */}
            {showAgent && (
                <div className="smart-refine-overlay agent-overlay">
                    <div className="smart-refine-container agent-container">
                        <MindMapAgent onClose={() => setShowAgent(false)} />
                    </div>
                </div>
            )}

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={(instance) => {
                    reactFlowRef.current = instance;
                }}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                attributionPosition="bottom-left"
            >
                {/* 边界和概括可视化层 */}
                <BoundaryLayer
                    boundaries={currentMap.boundaries || []}
                    nodes={nodes}
                    onRemove={removeBoundary}
                />
                <SummaryLayer
                    summaries={currentMap.summaries || []}
                    nodes={nodes}
                    onRemove={removeSummary}
                />
                <Controls className="flow-controls" />
                <MiniMap
                    className="flow-minimap"
                    nodeColor={(node) => node.data?.color as string || '#6366f1'}
                    maskColor={themeMode === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'}
                />
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color={themeMode === 'dark' ? '#333' : '#ddd'}
                />
            </ReactFlow>
        </div>
    );
};
