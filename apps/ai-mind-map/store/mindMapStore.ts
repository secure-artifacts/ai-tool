import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { MARKER_GROUPS } from '../types';
import type {
    MindMapNode,
    MindMapData,
    ThemeMode,
    LayoutDirection,
    ContentMode,
    NodeTag,
    AIGeneratedStructure,
    AIGeneratedNode,
    MapStyle,
    AICreationRecord,
    RefineSession,
} from '../types';

interface MindMapState {
    // ... (keep existing)
    // 当前导图数据
    currentMap: MindMapData | null;
    savedMaps: MindMapData[];

    // 历史记录（撤销/重做）
    history: MindMapData[];
    historyIndex: number;
    canUndo: boolean;
    canRedo: boolean;

    // UI 状态
    selectedNodeId: string | null;
    focusNodeId: string | null; // 聚焦模式：只显示该节点的子树
    showOutline: boolean; // 大纲视图开关
    themeMode: ThemeMode;
    layoutDirection: LayoutDirection;
    contentMode: ContentMode;
    aiExpandNodeId: string | null;
    allowManualDrag: boolean;
    aiPlatform: 'tiktok' | 'facebook' | 'instagram';
    aiGoal: 'completion' | 'engagement' | 'conversion' | 'follow';
    aiAudience: string;
    aiScenario: string;
    aiResults: Array<{ id: string; title: string; content: string; createdAt: number }>;

    // AI 创建历史（记录原始对话）
    aiCreationHistory: AICreationRecord[];
    // 当前智能完善会话
    currentRefineSession: RefineSession | null;

    // 缺失提示
    missingHints: string[];

    // Gemini API
    geminiApiKey: string;
    aiMaxDepth: number;
    aiDetailLevel: 'brief' | 'standard' | 'detailed' | 'extreme';

    // 文件操作
    createNewMap: (name: string) => void;
    createDemoMap: () => void;
    createFromStructure: (structure: AIGeneratedStructure, sourceType?: 'text' | 'image' | 'document' | 'youtube' | 'webpage' | 'audio', sourceContent?: string, sourceImage?: string) => void;
    loadMap: (id: string) => void;
    loadMapData: (mapData: MindMapData) => void;
    saveCurrentMap: () => void;
    deleteMap: (id: string) => void;

    // 节点操作
    addNode: (parentId: string, label: string, color?: string, notes?: string, sources?: string[]) => string;
    updateNode: (nodeId: string, updates: Partial<MindMapNode>) => void;
    deleteNode: (nodeId: string) => void;
    selectNode: (nodeId: string | null) => void;
    moveNode: (nodeId: string, newParentId: string) => void;

    // 标记操作
    addTag: (nodeId: string, tag: NodeTag) => void;
    removeTag: (nodeId: string, tag: NodeTag) => void;
    // 新增：可视化标记操作
    toggleMarker: (nodeId: string, markerId: string) => void;
    // 新增：贴纸操作
    toggleSticker: (nodeId: string, stickerId: string) => void;

    // 新增：更新全局样式
    updateMapStyle: (style: Partial<MapStyle>) => void;
    applyTheme: (colors: string[]) => void;
    applyVisualTheme: (theme: {
        colors: string[];
        lineStyle: 'curve' | 'straight' | 'step';
        nodeShape: 'rounded' | 'rectangle' | 'ellipse' | 'diamond' | 'underline';
        background: string;
    }) => void;

    // 新增：关系连线操作
    addRelationship: (sourceId: string, targetId: string, label?: string) => string;
    removeRelationship: (relationshipId: string) => void;

    // 新增：边界操作
    addBoundary: (nodeIds: string[], label?: string) => string;
    removeBoundary: (boundaryId: string) => void;

    // 新增：概括操作
    addSummary: (nodeIds: string[], label: string) => string;
    removeSummary: (summaryId: string) => void;

    // 批量操作
    addMultipleNodes: (parentId: string, labels: string[]) => void;
    addStructureToNode: (parentId: string, children: AIGeneratedNode[]) => void;

    // 折叠/展开操作
    toggleCollapse: (nodeId: string) => void;
    collapseAll: () => void;
    expandAll: () => void;
    collapseToLevel: (level: number) => void;

    // 聚焦模式 & 大纲视图
    setFocusNode: (nodeId: string | null) => void;
    toggleOutline: () => void;

    // 设置
    setThemeMode: (mode: ThemeMode) => void;
    setLayoutDirection: (direction: LayoutDirection) => void;
    setContentMode: (mode: ContentMode) => void;
    setGeminiApiKey: (key: string) => void;
    setAiMaxDepth: (depth: number) => void;
    setAiDetailLevel: (level: 'brief' | 'standard' | 'detailed' | 'extreme') => void;
    // AI Prompt 模式配置
    aiPromptMode: 'mapify' | 'simple' | 'custom';
    setAiPromptMode: (mode: 'mapify' | 'simple' | 'custom') => void;
    aiCustomPrompt: string;
    setAiCustomPrompt: (prompt: string) => void;
    openAiExpand: (nodeId: string) => void;
    closeAiExpand: () => void;
    setAllowManualDrag: (allow: boolean) => void;
    setAiPlatform: (platform: 'tiktok' | 'facebook' | 'instagram') => void;
    setAiGoal: (goal: 'completion' | 'engagement' | 'conversion' | 'follow') => void;
    setAiAudience: (audience: string) => void;
    setAiScenario: (scenario: string) => void;
    addAiResult: (title: string, content: string) => void;
    removeAiResult: (id: string) => void;
    setMissingHints: (hints: string[]) => void;

    // AI 创建历史操作
    addCreationRecord: (record: Omit<AICreationRecord, 'id' | 'timestamp'>) => void;
    clearCreationHistory: () => void;
    getCreationHistoryForCurrentMap: () => AICreationRecord[];

    // 智能完善会话操作
    startRefineSession: () => void;
    endRefineSession: () => void;

    // 历史记录操作
    undo: () => void;
    redo: () => void;
    pushHistory: () => void;
    clearHistory: () => void;

    // 导出
    getMapAsJSON: () => string;
    getMapAsMarkdown: () => string;
    getMapAsOutline: () => string;
    importFromJSON: (json: string) => boolean;
}



const NODE_COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#f97316', '#eab308',
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

const createEmptyMap = (name: string): MindMapData => {
    const rootId = uuidv4();
    return {
        id: uuidv4(),
        name,
        rootId,
        nodes: {
            [rootId]: {
                id: rootId,
                label: name,
                children: [],
                parentId: null,
                color: '#6366f1',
                sourceType: 'manual',
            },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceType: 'blank',
    };
};

const createDemoMap = (): MindMapData => {
    const rootId = uuidv4();
    const nodes: Record<string, MindMapNode> = {};
    const now = Date.now();

    const root: MindMapNode = {
        id: rootId,
        label: '演示模板：短视频脚本',
        children: [],
        parentId: null,
        color: NODE_COLORS[0],
        sourceType: 'manual',
    };
    nodes[rootId] = root;

    const addChild = (parentId: string, label: string, notes?: string) => {
        const newId = uuidv4();
        const depth = getNodeDepth(nodes, parentId);
        nodes[newId] = {
            id: newId,
            label,
            notes,
            children: [],
            parentId,
            color: NODE_COLORS[(depth + 1) % NODE_COLORS.length],
            sourceType: 'manual',
        };
        nodes[parentId].children!.push(newId);
        return newId;
    };

    const hook = addChild(rootId, '黄金三秒原则', '前三秒必须抓住注意力，设置强钩子。');
    addChild(hook, '视觉冲击', '色彩对比、快节奏、强主体。');
    addChild(hook, '悬念提问', '用问题引导观众继续看。');
    addChild(hook, '情绪共鸣', '用情绪词触发共情。');

    const story = addChild(rootId, '故事线', '起承转合清晰，节奏紧凑。');
    addChild(story, '开场', '一句话定位主题与冲突。');
    addChild(story, '发展', '三段推进信息量。');
    addChild(story, '反转', '制造惊喜或认知差。');
    addChild(story, '收束', '落点与行动指引。');

    const visuals = addChild(rootId, '镜头与画面', '镜头语言+节奏剪辑。');
    addChild(visuals, '远景/中景/特写', '不同景别控制情绪。');
    addChild(visuals, '转场节奏', '2-3秒一转场保持密度。');
    addChild(visuals, '字幕设计', '关键词加粗+高亮色。');

    const optimize = addChild(rootId, '优化与迭代', '数据驱动改进。');
    addChild(optimize, '完播率', '低于 35% 需要重做开场。');
    addChild(optimize, '互动率', '评论与分享引导点。');
    addChild(optimize, '标题A/B', '对比两个标题。');

    nodes[rootId].stickers = ['biz-chart'];
    nodes[hook].markers = ['priority-1'];
    nodes[story].stickers = ['emo-smile'];
    nodes[visuals].markers = ['color-blue'];

    return {
        id: uuidv4(),
        name: '演示模板：短视频脚本',
        rootId,
        nodes,
        createdAt: now,
        updatedAt: now,
        sourceType: 'blank',
    };
};

// 从 AI 生成的结构创建导图
function createMapFromStructure(
    structure: AIGeneratedStructure,
    sourceType?: 'text' | 'image' | 'document' | 'youtube' | 'webpage' | 'audio',
    sourceContent?: string,
    sourceImage?: string
): MindMapData {
    const rootId = uuidv4();
    const nodes: Record<string, MindMapNode> = {};

    // 创建根节点
    nodes[rootId] = {
        id: rootId,
        label: structure.title,
        children: [],
        parentId: null,
        color: NODE_COLORS[0],
        sourceType: sourceType === 'image' ? 'ocr' : 'ai',
    };

    // 递归创建子节点
    function createChildNodes(
        parentId: string,
        children: AIGeneratedNode[],
        depth: number
    ) {
        children.forEach((child, index) => {
            const nodeId = uuidv4();
            const color = NODE_COLORS[(depth + index) % NODE_COLORS.length];

            nodes[nodeId] = {
                id: nodeId,
                label: child.label,
                notes: child.description,
                sources: child.sources,
                children: [],
                parentId,
                color,
                tags: child.suggestedTags,
                sourceType: sourceType === 'image' ? 'ocr' : 'ai',
            };

            nodes[parentId].children!.push(nodeId);

            if (child.children && child.children.length > 0) {
                createChildNodes(nodeId, child.children, depth + 1);
            }
        });
    }

    if (structure.children) {
        createChildNodes(rootId, structure.children, 1);
    }

    return {
        id: uuidv4(),
        name: structure.title,
        rootId,
        nodes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceType,
        sourceContent,
        sourceImage,
    };
}

function getNodeDepth(nodes: Record<string, MindMapNode>, nodeId: string): number {
    let depth = 0;
    let currentId: string | null | undefined = nodeId;
    while (currentId && nodes[currentId]?.parentId) {
        depth++;
        currentId = nodes[currentId].parentId;
    }
    return depth;
}

export const useMindMapStore = create<MindMapState>()(
    persist(
        (set, get) => ({
            currentMap: null,
            savedMaps: [],
            selectedNodeId: null,
            focusNodeId: null,
            showOutline: false,
            themeMode: 'dark',
            layoutDirection: 'mindmap',
            contentMode: 'general',
            missingHints: [],
            geminiApiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '',
            aiMaxDepth: 3,
            aiDetailLevel: 'standard',
            aiExpandNodeId: null,
            allowManualDrag: true,
            aiPlatform: 'tiktok',
            aiGoal: 'completion',
            aiAudience: '',
            aiScenario: '',
            aiResults: [],

            // AI Prompt 模式
            aiPromptMode: 'mapify' as const,
            aiCustomPrompt: '',

            // AI 创建历史
            aiCreationHistory: [],
            currentRefineSession: null,

            // 历史记录状态
            history: [],
            historyIndex: -1,
            canUndo: false,
            canRedo: false,

            // 推入历史记录
            pushHistory: () => {
                const { currentMap, history, historyIndex } = get();
                if (!currentMap) return;

                // 深拷贝当前状态
                const snapshot = JSON.parse(JSON.stringify(currentMap)) as MindMapData;

                // 如果在历史中间位置，截断后面的记录
                const newHistory = history.slice(0, historyIndex + 1);
                newHistory.push(snapshot);

                // 限制历史记录数量为50
                const MAX_HISTORY = 50;
                if (newHistory.length > MAX_HISTORY) {
                    newHistory.shift();
                }

                set({
                    history: newHistory,
                    historyIndex: newHistory.length - 1,
                    canUndo: newHistory.length > 1,
                    canRedo: false,
                });
            },

            // 撤销
            undo: () => {
                const { history, historyIndex } = get();
                if (historyIndex <= 0) return;

                const newIndex = historyIndex - 1;
                const prevState = JSON.parse(JSON.stringify(history[newIndex])) as MindMapData;

                set({
                    currentMap: prevState,
                    historyIndex: newIndex,
                    canUndo: newIndex > 0,
                    canRedo: true,
                });
            },

            // 重做
            redo: () => {
                const { history, historyIndex } = get();
                if (historyIndex >= history.length - 1) return;

                const newIndex = historyIndex + 1;
                const nextState = JSON.parse(JSON.stringify(history[newIndex])) as MindMapData;

                set({
                    currentMap: nextState,
                    historyIndex: newIndex,
                    canUndo: true,
                    canRedo: newIndex < history.length - 1,
                });
            },

            // 清空历史
            clearHistory: () => {
                set({
                    history: [],
                    historyIndex: -1,
                    canUndo: false,
                    canRedo: false,
                });
            },

            createNewMap: (name: string) => {
                const newMap = createEmptyMap(name);
                set((state) => ({
                    currentMap: newMap,
                    savedMaps: [...state.savedMaps, newMap],
                    selectedNodeId: newMap.rootId,
                    missingHints: [],
                    // 重置历史
                    history: [JSON.parse(JSON.stringify(newMap))],
                    historyIndex: 0,
                    canUndo: false,
                    canRedo: false,
                }));
            },

            createDemoMap: () => {
                const demoMap = createDemoMap();
                set((state) => ({
                    currentMap: demoMap,
                    savedMaps: [...state.savedMaps, demoMap],
                    selectedNodeId: demoMap.rootId,
                    missingHints: [],
                }));
            },

            createFromStructure: (structure, sourceType, sourceContent, sourceImage) => {
                const newMap = createMapFromStructure(structure, sourceType, sourceContent, sourceImage);
                set((state) => ({
                    currentMap: newMap,
                    savedMaps: [...state.savedMaps, newMap],
                    selectedNodeId: newMap.rootId,
                    missingHints: structure.missingHints || [],
                }));
            },

            loadMap: (id: string) => {
                const map = get().savedMaps.find((m) => m.id === id);
                if (map) {
                    set({ currentMap: { ...map }, selectedNodeId: map.rootId, missingHints: [] });
                }
            },

            loadMapData: (mapData: MindMapData) => {
                set((state) => ({
                    currentMap: mapData,
                    savedMaps: [...state.savedMaps, mapData],
                    selectedNodeId: mapData.rootId,
                    missingHints: [],
                }));
            },

            saveCurrentMap: () => {
                const { currentMap, savedMaps } = get();
                if (!currentMap) return;

                const updatedMap = { ...currentMap, updatedAt: Date.now() };
                const index = savedMaps.findIndex((m) => m.id === currentMap.id);

                if (index >= 0) {
                    const newMaps = [...savedMaps];
                    newMaps[index] = updatedMap;
                    set({ currentMap: updatedMap, savedMaps: newMaps });
                } else {
                    set({ currentMap: updatedMap, savedMaps: [...savedMaps, updatedMap] });
                }
            },

            deleteMap: (id: string) => {
                set((state) => ({
                    savedMaps: state.savedMaps.filter((m) => m.id !== id),
                    currentMap: state.currentMap?.id === id ? null : state.currentMap,
                }));
            },

            addNode: (parentId: string, label: string, color?: string, notes?: string, sources?: string[]) => {
                const { currentMap, pushHistory } = get();
                if (!currentMap) return '';

                // 记录历史
                pushHistory();

                const newNodeId = uuidv4();
                const parentNode = currentMap.nodes[parentId];
                if (!parentNode) return '';

                const depth = getNodeDepth(currentMap.nodes, parentId);
                const nodeColor = color || NODE_COLORS[(depth + 1) % NODE_COLORS.length];

                const newNode: MindMapNode = {
                    id: newNodeId,
                    label,
                    notes,
                    sources,
                    children: [],
                    parentId,
                    color: nodeColor,
                    sourceType: 'manual',
                };

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [newNodeId]: newNode,
                            [parentId]: {
                                ...parentNode,
                                children: [...(parentNode.children || []), newNodeId],
                            },
                        },
                        updatedAt: Date.now(),
                    },
                });

                return newNodeId;
            },

            updateNode: (nodeId: string, updates: Partial<MindMapNode>) => {
                const { currentMap, pushHistory } = get();
                if (!currentMap || !currentMap.nodes[nodeId]) return;

                // 记录历史
                pushHistory();

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: { ...currentMap.nodes[nodeId], ...updates },
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            deleteNode: (nodeId: string) => {
                const { currentMap, pushHistory } = get();
                if (!currentMap || nodeId === currentMap.rootId) return;

                const node = currentMap.nodes[nodeId];
                if (!node) return;

                // 记录历史
                pushHistory();

                const nodesToDelete = new Set<string>();
                const collectDescendants = (id: string) => {
                    nodesToDelete.add(id);
                    const n = currentMap.nodes[id];
                    if (n?.children) {
                        n.children.forEach(collectDescendants);
                    }
                };
                collectDescendants(nodeId);

                const newNodes = { ...currentMap.nodes };
                if (node.parentId && newNodes[node.parentId]) {
                    newNodes[node.parentId] = {
                        ...newNodes[node.parentId],
                        children: newNodes[node.parentId].children?.filter((id) => id !== nodeId),
                    };
                }

                nodesToDelete.forEach((id) => delete newNodes[id]);

                set({
                    currentMap: { ...currentMap, nodes: newNodes, updatedAt: Date.now() },
                    selectedNodeId: node.parentId || currentMap.rootId,
                });
            },

            selectNode: (nodeId: string | null) => {
                set({ selectedNodeId: nodeId });
            },

            moveNode: (nodeId: string, newParentId: string) => {
                const { currentMap, pushHistory } = get();
                if (!currentMap || nodeId === currentMap.rootId) return;
                if (nodeId === newParentId) return;

                const node = currentMap.nodes[nodeId];
                if (!node || !node.parentId) return;

                // 记录历史
                pushHistory();

                // 检查是否会形成循环
                let checkId: string | null | undefined = newParentId;
                while (checkId) {
                    if (checkId === nodeId) return;
                    checkId = currentMap.nodes[checkId]?.parentId;
                }

                const newNodes = { ...currentMap.nodes };

                // 从旧父节点移除
                const oldParent = newNodes[node.parentId];
                if (oldParent) {
                    newNodes[node.parentId] = {
                        ...oldParent,
                        children: oldParent.children?.filter((id) => id !== nodeId),
                    };
                }

                // 添加到新父节点
                const newParent = newNodes[newParentId];
                if (newParent) {
                    newNodes[newParentId] = {
                        ...newParent,
                        children: [...(newParent.children || []), nodeId],
                    };
                }

                // 更新节点的父节点
                newNodes[nodeId] = { ...node, parentId: newParentId };

                set({
                    currentMap: { ...currentMap, nodes: newNodes, updatedAt: Date.now() },
                });
            },

            addTag: (nodeId: string, tag: NodeTag) => {
                const { currentMap } = get();
                if (!currentMap || !currentMap.nodes[nodeId]) return;

                const node = currentMap.nodes[nodeId];
                const tags = node.tags || [];
                if (tags.includes(tag)) return;

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: { ...node, tags: [...tags, tag] },
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            removeTag: (nodeId: string, tag: NodeTag) => {
                const { currentMap } = get();
                if (!currentMap || !currentMap.nodes[nodeId]) return;

                const node = currentMap.nodes[nodeId];
                if (!node.tags) return;

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: { ...node, tags: node.tags.filter((t) => t !== tag) },
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            toggleMarker: (nodeId: string, markerId: string) => {
                const { currentMap } = get();
                if (!currentMap || !currentMap.nodes[nodeId]) return;

                const node = currentMap.nodes[nodeId];
                const currentMarkers = node.markers || [];

                // 1. 找到该 marker 所属的 group
                const group = MARKER_GROUPS.find((g) => g.items.some((i) => i.id === markerId));

                let newMarkers = [...currentMarkers];

                // 检查是否已经存在
                if (currentMarkers.includes(markerId)) {
                    // 如果存在，则移除
                    newMarkers = newMarkers.filter(m => m !== markerId);
                } else {
                    // 如果不存在，添加
                    // 如果是同组标记，先移除同组的其他 marker
                    if (group) {
                        const groupMarkerIds = group.items.map((i) => i.id);
                        newMarkers = newMarkers.filter(m => !groupMarkerIds.includes(m));
                    }
                    newMarkers.push(markerId);
                }

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: { ...node, markers: newMarkers },
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            toggleSticker: (nodeId: string, stickerId: string) => {
                const { currentMap } = get();
                if (!currentMap || !currentMap.nodes[nodeId]) return;

                const node = currentMap.nodes[nodeId];
                const currentStickers = node.stickers || [];

                const newStickers = currentStickers.includes(stickerId)
                    ? currentStickers.filter((id) => id !== stickerId)
                    : [...currentStickers, stickerId];

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: { ...node, stickers: newStickers },
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            updateMapStyle: (style: Partial<MapStyle>) => {
                const { currentMap } = get();
                if (!currentMap) return;

                set({
                    currentMap: {
                        ...currentMap,
                        style: { ...currentMap.style, ...style },
                        updatedAt: Date.now(),
                    },
                });
            },

            applyTheme: (colors: string[]) => {
                const { currentMap } = get();
                if (!currentMap || colors.length === 0) return;

                const newNodes: Record<string, MindMapNode> = {};
                Object.entries(currentMap.nodes).forEach(([id, node]) => {
                    const depth = getNodeDepth(currentMap.nodes, id);
                    const color = colors[depth % colors.length];
                    newNodes[id] = { ...node, color };
                });

                set({
                    currentMap: { ...currentMap, nodes: newNodes, updatedAt: Date.now() },
                });
            },

            applyVisualTheme: (theme) => {
                const { currentMap } = get();
                if (!currentMap || theme.colors.length === 0) return;

                // 应用颜色到所有节点，并设置节点形状
                const newNodes: Record<string, MindMapNode> = {};
                Object.entries(currentMap.nodes).forEach(([id, node]) => {
                    const depth = getNodeDepth(currentMap.nodes, id);
                    const color = theme.colors[depth % theme.colors.length];
                    newNodes[id] = {
                        ...node,
                        color,
                        style: {
                            ...node.style,
                            shape: theme.nodeShape,
                        },
                    };
                });

                // 同时更新地图样式（连线样式和背景）
                set({
                    currentMap: {
                        ...currentMap,
                        nodes: newNodes,
                        style: {
                            ...currentMap.style,
                            lineStyle: theme.lineStyle,
                            background: theme.background,
                            rainbowLines: true, // 使用彩虹线条
                        },
                        updatedAt: Date.now(),
                    },
                });
            },

            // ============ 关系连线操作 ============
            addRelationship: (sourceId: string, targetId: string, label?: string) => {
                const { currentMap } = get();
                if (!currentMap) return '';

                const newId = uuidv4();
                const newRelationship = {
                    id: newId,
                    sourceId,
                    targetId,
                    label,
                    style: 'dashed' as const,
                    color: '#64748b',
                };

                set({
                    currentMap: {
                        ...currentMap,
                        relationships: [...(currentMap.relationships || []), newRelationship],
                        updatedAt: Date.now(),
                    },
                });

                return newId;
            },

            removeRelationship: (relationshipId: string) => {
                const { currentMap } = get();
                if (!currentMap) return;

                set({
                    currentMap: {
                        ...currentMap,
                        relationships: (currentMap.relationships || []).filter(r => r.id !== relationshipId),
                        updatedAt: Date.now(),
                    },
                });
            },

            // ============ 边界操作 ============
            addBoundary: (nodeIds: string[], label?: string) => {
                const { currentMap } = get();
                if (!currentMap || nodeIds.length === 0) return '';

                const newId = uuidv4();
                const newBoundary = {
                    id: newId,
                    nodeIds,
                    label,
                    color: '#6366f1',
                    style: 'dashed' as const,
                };

                set({
                    currentMap: {
                        ...currentMap,
                        boundaries: [...(currentMap.boundaries || []), newBoundary],
                        updatedAt: Date.now(),
                    },
                });

                return newId;
            },

            removeBoundary: (boundaryId: string) => {
                const { currentMap } = get();
                if (!currentMap) return;

                set({
                    currentMap: {
                        ...currentMap,
                        boundaries: (currentMap.boundaries || []).filter(b => b.id !== boundaryId),
                        updatedAt: Date.now(),
                    },
                });
            },

            // ============ 概括操作 ============
            addSummary: (nodeIds: string[], label: string) => {
                const { currentMap } = get();
                if (!currentMap || nodeIds.length === 0) return '';

                // 找到这些节点的共同父节点
                const firstNode = currentMap.nodes[nodeIds[0]];
                const parentId = firstNode?.parentId || currentMap.rootId;

                const newId = uuidv4();
                const newSummary = {
                    id: newId,
                    nodeIds,
                    label,
                    parentId,
                    color: '#f59e0b',
                };

                set({
                    currentMap: {
                        ...currentMap,
                        summaries: [...(currentMap.summaries || []), newSummary],
                        updatedAt: Date.now(),
                    },
                });

                return newId;
            },

            removeSummary: (summaryId: string) => {
                const { currentMap } = get();
                if (!currentMap) return;

                set({
                    currentMap: {
                        ...currentMap,
                        summaries: (currentMap.summaries || []).filter(s => s.id !== summaryId),
                        updatedAt: Date.now(),
                    },
                });
            },


            addMultipleNodes: (parentId: string, labels: string[]) => {
                labels.forEach((label) => get().addNode(parentId, label));
            },

            addStructureToNode: (parentId: string, children: AIGeneratedNode[]) => {
                const { currentMap, addNode } = get();
                if (!currentMap) return;

                function addChildren(pId: string, nodes: AIGeneratedNode[], depth: number) {
                    nodes.forEach((node) => {
                        const newId = addNode(pId, node.label, undefined, node.description, node.sources);
                        if (newId && node.children && node.children.length > 0) {
                            addChildren(newId, node.children, depth + 1);
                        }
                    });
                }

                addChildren(parentId, children, 0);
            },

            // 折叠/展开操作
            toggleCollapse: (nodeId: string) => {
                const { currentMap } = get();
                if (!currentMap) return;
                const node = currentMap.nodes[nodeId];
                if (!node || node.children.length === 0) return;

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: {
                            ...currentMap.nodes,
                            [nodeId]: {
                                ...node,
                                collapsed: !node.collapsed,
                            },
                        },
                    },
                });
            },

            collapseAll: () => {
                const { currentMap } = get();
                if (!currentMap) return;

                const updatedNodes = { ...currentMap.nodes };
                Object.keys(updatedNodes).forEach((id) => {
                    const node = updatedNodes[id];
                    if (node.children.length > 0) {
                        updatedNodes[id] = { ...node, collapsed: true };
                    }
                });

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: updatedNodes,
                    },
                });
            },

            expandAll: () => {
                const { currentMap } = get();
                if (!currentMap) return;

                const updatedNodes = { ...currentMap.nodes };
                Object.keys(updatedNodes).forEach((id) => {
                    const node = updatedNodes[id];
                    if (node.collapsed) {
                        updatedNodes[id] = { ...node, collapsed: false };
                    }
                });

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: updatedNodes,
                    },
                });
            },

            collapseToLevel: (level: number) => {
                const { currentMap } = get();
                if (!currentMap) return;

                // 计算每个节点的层级
                const nodeDepths: Record<string, number> = {};
                function calcDepth(nodeId: string, depth: number) {
                    nodeDepths[nodeId] = depth;
                    const node = currentMap.nodes[nodeId];
                    if (node) {
                        node.children.forEach((childId) => calcDepth(childId, depth + 1));
                    }
                }
                calcDepth(currentMap.rootId, 0);

                const updatedNodes = { ...currentMap.nodes };
                Object.keys(updatedNodes).forEach((id) => {
                    const node = updatedNodes[id];
                    const nodeDepth = nodeDepths[id] || 0;
                    if (node.children.length > 0) {
                        // 如果节点层级 >= level，折叠；否则展开
                        updatedNodes[id] = { ...node, collapsed: nodeDepth >= level };
                    }
                });

                set({
                    currentMap: {
                        ...currentMap,
                        nodes: updatedNodes,
                    },
                });
            },

            // 聚焦模式
            setFocusNode: (nodeId: string | null) => set({ focusNodeId: nodeId }),

            // 大纲视图切换
            toggleOutline: () => set((state) => ({ showOutline: !state.showOutline })),

            setThemeMode: (mode: ThemeMode) => set({ themeMode: mode }),
            setLayoutDirection: (direction: LayoutDirection) => set({ layoutDirection: direction }),
            setContentMode: (mode: ContentMode) => set({ contentMode: mode }),
            setGeminiApiKey: (key: string) => set({ geminiApiKey: key }),
            setAiMaxDepth: (depth: number) => set({ aiMaxDepth: depth }),
            setAiDetailLevel: (level) => set({ aiDetailLevel: level }),
            setAiPromptMode: (mode) => set({ aiPromptMode: mode }),
            setAiCustomPrompt: (prompt) => set({ aiCustomPrompt: prompt }),
            setMissingHints: (hints: string[]) => set({ missingHints: hints }),
            openAiExpand: (nodeId: string) => set({ aiExpandNodeId: nodeId }),
            closeAiExpand: () => set({ aiExpandNodeId: null }),
            setAllowManualDrag: (allow: boolean) => set({ allowManualDrag: allow }),
            setAiPlatform: (platform) => set({ aiPlatform: platform }),
            setAiGoal: (goal) => set({ aiGoal: goal }),
            setAiAudience: (audience) => set({ aiAudience: audience }),
            setAiScenario: (scenario) => set({ aiScenario: scenario }),
            addAiResult: (title: string, content: string) =>
                set((state) => ({
                    aiResults: [
                        { id: uuidv4(), title, content, createdAt: Date.now() },
                        ...state.aiResults,
                    ],
                })),
            removeAiResult: (id: string) =>
                set((state) => ({
                    aiResults: state.aiResults.filter((item) => item.id !== id),
                })),

            // ============ AI 创建历史操作 ============
            addCreationRecord: (record) => {
                const { currentMap } = get();
                const newRecord: AICreationRecord = {
                    ...record,
                    id: uuidv4(),
                    timestamp: Date.now(),
                };
                set((state) => ({
                    aiCreationHistory: [...state.aiCreationHistory, newRecord],
                }));
                // 同时将记录关联到当前导图
                if (currentMap) {
                    const updatedMap = {
                        ...currentMap,
                        updatedAt: Date.now(),
                    };
                    set({ currentMap: updatedMap });
                }
            },

            clearCreationHistory: () => set({ aiCreationHistory: [] }),

            getCreationHistoryForCurrentMap: () => {
                const { currentMap, aiCreationHistory } = get();
                if (!currentMap) return [];
                // 返回所有记录（后续可以根据 mapId 过滤）
                return aiCreationHistory;
            },

            // ============ 智能完善会话操作 ============
            startRefineSession: () => {
                const { currentMap } = get();
                if (!currentMap) return;

                const newSession: RefineSession = {
                    id: uuidv4(),
                    mapId: currentMap.id,
                    startedAt: Date.now(),
                    messages: [],
                    appliedActions: [],
                };
                set({ currentRefineSession: newSession });
            },

            endRefineSession: () => set({ currentRefineSession: null }),

            getMapAsJSON: () => {
                const { currentMap } = get();
                return currentMap ? JSON.stringify(currentMap, null, 2) : '';
            },

            getMapAsMarkdown: () => {
                const { currentMap } = get();
                if (!currentMap) return '';

                const lines: string[] = [];
                const renderNode = (nodeId: string, depth: number) => {
                    const node = currentMap.nodes[nodeId];
                    if (!node) return;

                    const indent = '  '.repeat(depth);
                    const prefix = depth === 0 ? '# ' : `${indent}- `;
                    let line = `${prefix}${node.label}`;

                    // 添加标记
                    if (node.tags && node.tags.length > 0) {
                        const tagStr = node.tags.map((t) => `[${t}]`).join(' ');
                        line += ` ${tagStr}`;
                    }

                    lines.push(line);

                    if (node.notes) {
                        lines.push(`${indent}  > ${node.notes}`);
                    }
                    if (node.sources && node.sources.length > 0) {
                        lines.push(`${indent}  > 来源: ${node.sources.join(' | ')}`);
                    }

                    node.children?.forEach((childId) => renderNode(childId, depth + 1));
                };

                renderNode(currentMap.rootId, 0);
                return lines.join('\n');
            },

            getMapAsOutline: () => {
                const { currentMap } = get();
                if (!currentMap) return '';

                const lines: string[] = [];
                const renderNode = (nodeId: string, depth: number, prefix: string) => {
                    const node = currentMap.nodes[nodeId];
                    if (!node) return;

                    const indent = '  '.repeat(depth);
                    lines.push(`${indent}${prefix}${node.label}`);

                    node.children?.forEach((childId, index) => {
                        const childPrefix = depth === 0 ? `${index + 1}. ` : `${index + 1}) `;
                        renderNode(childId, depth + 1, childPrefix);
                    });
                };

                renderNode(currentMap.rootId, 0, '');
                return lines.join('\n');
            },

            importFromJSON: (json: string) => {
                try {
                    const data = JSON.parse(json) as MindMapData;
                    if (data.id && data.rootId && data.nodes) {
                        const newMap = { ...data, id: uuidv4(), updatedAt: Date.now() };
                        set((state) => ({
                            currentMap: newMap,
                            savedMaps: [...state.savedMaps, newMap],
                        }));
                        return true;
                    }
                    return false;
                } catch {
                    return false;
                }
            },
        }),
        {
            name: 'ai-mind-map-storage',
            partialize: (state) => ({
                savedMaps: state.savedMaps,
                themeMode: state.themeMode,
                layoutDirection: state.layoutDirection,
                contentMode: state.contentMode,
                geminiApiKey: state.geminiApiKey,
                aiMaxDepth: state.aiMaxDepth,
                aiDetailLevel: state.aiDetailLevel,
                allowManualDrag: state.allowManualDrag,
                aiPlatform: state.aiPlatform,
                aiGoal: state.aiGoal,
                aiAudience: state.aiAudience,
                aiScenario: state.aiScenario,
                aiResults: state.aiResults,
                aiCreationHistory: state.aiCreationHistory,
            }),
        }
    )
);
