// ============================================
// AI Mind Map - Type Definitions
// ============================================

// Node Tags for content markers
export type NodeTag =
    | 'key-point'
    | 'action-item'
    | 'question'
    | 'idea'
    | 'warning'
    | 'reference';

export const NODE_TAG_CONFIG: Record<NodeTag, { label: string; icon: string; color: string }> = {
    'key-point': { label: '关键点', icon: '⭐', color: '#f59e0b' },
    'action-item': { label: '行动项', icon: '✅', color: '#22c55e' },
    'question': { label: '待确认', icon: '❓', color: '#3b82f6' },
    'idea': { label: '创意', icon: '💡', color: '#a855f7' },
    'warning': { label: '风险', icon: '⚠️', color: '#ef4444' },
    'reference': { label: '参考', icon: '📎', color: '#64748b' },
};

// Node Style for individual node customization
export interface NodeStyle {
    shape?: 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'underline';
    fill?: string;
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    color?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    fontFamily?: string;
    textDecoration?: 'none' | 'underline' | 'line-through';
}

// Mind Map Node
export interface MindMapNode {
    id: string;
    label: string;
    notes?: string;
    link?: string; // 节点链接 URL
    color: string;
    parentId: string | null;
    children: string[];
    markers?: string[];
    stickers?: string[];
    tags?: NodeTag[];
    style?: NodeStyle;
    sources?: string[];
    sourceType?: 'manual' | 'ai' | 'ocr';
    collapsed?: boolean; // 是否折叠子节点
}

// Map Style for global canvas styling
export interface MapStyle {
    background?: string;
    lineStyle?: 'curve' | 'straight' | 'step';
    lineColor?: string;
    lineWidth?: number;
    rainbowLines?: boolean;
}

// Mind Map Data
export interface MindMapData {
    id: string;
    name: string;
    rootId: string;
    nodes: Record<string, MindMapNode>;
    createdAt: number;
    updatedAt: number;
    style?: MapStyle;
    sourceType?: 'text' | 'image' | 'document' | 'youtube' | 'webpage' | 'audio' | 'blank';
    sourceText?: string;
    sourceImage?: string;
    sourceContent?: string;
    sourceUrl?: string;
    // 新增：关系连线
    relationships?: Relationship[];
    // 新增：边界/包围框
    boundaries?: Boundary[];
    // 新增：概括/摘要
    summaries?: Summary[];
}

// 关系连线：两个不相邻节点之间的逻辑关联
export interface Relationship {
    id: string;
    sourceId: string;
    targetId: string;
    label?: string;
    style?: 'solid' | 'dashed' | 'dotted';
    color?: string;
}

// 边界：将一组节点包围起来
export interface Boundary {
    id: string;
    nodeIds: string[];
    label?: string;
    color?: string;
    style?: 'solid' | 'dashed';
}

// 概括：多个子节点的摘要
export interface Summary {
    id: string;
    nodeIds: string[];  // 被概括的节点
    label: string;      // 摘要文字
    parentId: string;   // 父节点ID
    color?: string;
}

// Marker Types
export interface MarkerItem {
    id: string;
    type: 'color' | 'icon';
    label: string;
    content?: string;
    color?: string;
}

export interface MarkerGroup {
    id: string;
    label: string;
    items: MarkerItem[];
}

export const MARKER_GROUPS: MarkerGroup[] = [
    {
        id: 'priority',
        label: '优先级',
        items: [
            { id: 'priority-1', type: 'icon', label: '最高', content: '🔴' },
            { id: 'priority-2', type: 'icon', label: '高', content: '🟠' },
            { id: 'priority-3', type: 'icon', label: '中', content: '🟡' },
            { id: 'priority-4', type: 'icon', label: '低', content: '🟢' },
        ],
    },
    {
        id: 'progress',
        label: '进度',
        items: [
            { id: 'progress-todo', type: 'icon', label: '待办', content: '⬜' },
            { id: 'progress-doing', type: 'icon', label: '进行中', content: '🔄' },
            { id: 'progress-done', type: 'icon', label: '完成', content: '✅' },
            { id: 'progress-cancel', type: 'icon', label: '取消', content: '❌' },
        ],
    },
    {
        id: 'emotion',
        label: '表情',
        items: [
            { id: 'emo-like', type: 'icon', label: '点赞', content: '👍' },
            { id: 'emo-dislike', type: 'icon', label: '反对', content: '👎' },
            { id: 'emo-question', type: 'icon', label: '疑问', content: '❓' },
            { id: 'emo-fire', type: 'icon', label: '热门', content: '🔥' },
            { id: 'emo-star', type: 'icon', label: '收藏', content: '⭐' },
        ],
    },
    {
        id: 'colors',
        label: '颜色',
        items: [
            { id: 'color-red', type: 'color', label: '红色', color: '#ef4444' },
            { id: 'color-orange', type: 'color', label: '橙色', color: '#f97316' },
            { id: 'color-yellow', type: 'color', label: '黄色', color: '#eab308' },
            { id: 'color-green', type: 'color', label: '绿色', color: '#22c55e' },
            { id: 'color-blue', type: 'color', label: '蓝色', color: '#3b82f6' },
            { id: 'color-purple', type: 'color', label: '紫色', color: '#a855f7' },
        ],
    },
];

// Sticker Types
export interface StickerItem {
    id: string;
    emoji: string;
    label: string;
}

export interface StickerCategory {
    id: string;
    label: string;
    items: StickerItem[];
}

export const STICKER_GROUPS: StickerCategory[] = [
    {
        id: 'business',
        label: '商务',
        items: [
            { id: 'stk-chart', emoji: '📊', label: '图表' },
            { id: 'stk-target', emoji: '🎯', label: '目标' },
            { id: 'stk-money', emoji: '💰', label: '金钱' },
            { id: 'stk-rocket', emoji: '🚀', label: '增长' },
        ],
    },
    {
        id: 'emotions',
        label: '表情',
        items: [
            { id: 'stk-smile', emoji: '😊', label: '开心' },
            { id: 'stk-think', emoji: '🤔', label: '思考' },
            { id: 'stk-celebrate', emoji: '🎉', label: '庆祝' },
            { id: 'stk-warning', emoji: '⚠️', label: '警告' },
        ],
    },
];

// AI Related Types
export interface AIExpandSuggestion {
    id: string;
    label: string;
    description?: string;
}

export interface AIExpandResult {
    suggestions?: AIExpandSuggestion[];
    nodes?: AIGeneratedNode[];
    error?: string;
}

export interface AIGeneratedNode {
    label: string;
    description?: string;
    suggestedTags?: NodeTag[];
    sources?: string[];
    logicType?: string;
    children?: AIGeneratedNode[];
}

export interface AIGeneratedStructure {
    title: string;
    children: AIGeneratedNode[];
    missingHints?: string[];
}

export interface ImageRecognitionResult {
    success: boolean;
    rawText?: string;
    structure?: AIGeneratedStructure;
    error?: string;
    imageType?: 'text' | 'poster' | 'diagram' | 'photo' | 'unknown';
    confidence?: number;
}

// Input Types
export type InputType = 'text' | 'image' | 'document' | 'youtube' | 'webpage' | 'audio';

export interface UserInput {
    type: InputType;
    content: string;
    imageData?: string;
    audioData?: string;
    url?: string;
}

// Theme
export type ThemeMode = 'light' | 'dark';

// Layout Direction
export type LayoutDirection =
    | 'mindmap'
    | 'logic-right'
    | 'logic-left'
    | 'bracket-right'
    | 'bracket-left'
    | 'org-down'
    | 'org-up'
    | 'tree-right'
    | 'tree-left'
    | 'timeline'
    | 'fishbone'
    | 'grid'
    | 'hierarchy-card'
    | 'horizontal-right'
    | 'four-direction'
    | 'table-view'
    | 'outline-view'
    | 'matrix-bracket'
    | 'notebook-view'
    | 'org-matrix';

export interface LayoutConfig {
    type: LayoutDirection;
    label: string;
    icon: string;
    description: string;
}

export interface LayoutGroup {
    label: string;
    layouts: LayoutConfig[];
}

export const LAYOUT_CONFIGS: Record<LayoutDirection, LayoutConfig> = {
    mindmap: { type: 'mindmap', label: '中心发散', icon: '🎯', description: '四周曲线发散' },
    'logic-right': { type: 'logic-right', label: '右向层级', icon: '📊', description: '直角折线向右' },
    'logic-left': { type: 'logic-left', label: '左向层级', icon: '📊', description: '直角折线向左' },
    'bracket-right': { type: 'bracket-right', label: '括号图', icon: '〕', description: '大括号连线' },
    'bracket-left': { type: 'bracket-left', label: '括号图(左)', icon: '〔', description: '左侧括号' },
    'org-down': { type: 'org-down', label: '组织架构', icon: '⬇️', description: '自上而下展开' },
    'org-up': { type: 'org-up', label: '组织架构(上)', icon: '⬆️', description: '向上层级' },
    'tree-right': { type: 'tree-right', label: '曲线向右', icon: '🌊', description: '柔和曲线向右' },
    'tree-left': { type: 'tree-left', label: '曲线左向', icon: '🌊', description: '柔和曲线向左' },
    timeline: { type: 'timeline', label: '时间线', icon: '📅', description: '水平时间轴' },
    fishbone: { type: 'fishbone', label: '鱼骨图', icon: '🐟', description: '因果分析' },
    grid: { type: 'grid', label: '网格看板', icon: '▦', description: '矩阵看板' },
    'hierarchy-card': { type: 'hierarchy-card', label: '层级卡片', icon: '📋', description: '卡片树状' },
    'horizontal-right': { type: 'horizontal-right', label: '水平时间线', icon: '📏', description: '水平右向展开' },
    'four-direction': { type: 'four-direction', label: '四向发散', icon: '✴️', description: '上下左右发散' },
    // 6个网格样式
    'table-view': { type: 'table-view', label: '表格视图', icon: '📑', description: '表格括号展示' },
    'outline-view': { type: 'outline-view', label: '大纲视图', icon: '📝', description: '简洁列表大纲' },
    'matrix-bracket': { type: 'matrix-bracket', label: '矩阵括号', icon: '🗂️', description: '多列括号矩阵' },
    'notebook-view': { type: 'notebook-view', label: '笔记本视图', icon: '📓', description: '多页分栏布局' },
    'org-matrix': { type: 'org-matrix', label: '组织矩阵', icon: '🏢', description: '多列层级结构' },
};

export const LAYOUT_GROUPS: LayoutGroup[] = [
    {
        label: '通用样式',
        layouts: [
            LAYOUT_CONFIGS.mindmap,
            LAYOUT_CONFIGS['bracket-right'],
            LAYOUT_CONFIGS['tree-right'],
            LAYOUT_CONFIGS['org-down'],
            LAYOUT_CONFIGS['horizontal-right'],
        ],
    },
    {
        label: '网格视图',
        layouts: [
            LAYOUT_CONFIGS.grid,
            LAYOUT_CONFIGS['hierarchy-card'],
            LAYOUT_CONFIGS['table-view'],
            LAYOUT_CONFIGS['outline-view'],
            LAYOUT_CONFIGS['matrix-bracket'],
            LAYOUT_CONFIGS['notebook-view'],
            LAYOUT_CONFIGS['org-matrix'],
        ],
    },
    {
        label: '方向变体',
        layouts: [
            LAYOUT_CONFIGS['logic-left'],
            LAYOUT_CONFIGS['bracket-left'],
            LAYOUT_CONFIGS['tree-left'],
            LAYOUT_CONFIGS['org-up'],
        ],
    },
    {
        label: '专业图表',
        layouts: [LAYOUT_CONFIGS.timeline, LAYOUT_CONFIGS.fishbone],
    },
];

// Content Mode
export type ContentMode =
    | 'general'
    | 'content-planning'
    | 'video-script'
    | 'article'
    | 'video-creative';

export interface ContentModeConfig {
    mode: ContentMode;
    label: string;
    description: string;
    isNew?: boolean;
    requiresPlatform?: boolean;
}

export const CONTENT_MODES: ContentModeConfig[] = [
    { mode: 'general', label: '通用模式', description: '自由结构，适合各类主题' },
    { mode: 'content-planning', label: '内容策划', description: '选题→观点→论据→形式' },
    { mode: 'video-script', label: '视频脚本', description: '开场→展开→转化→结尾' },
    { mode: 'article', label: '文章结构', description: '标题→开头→正文→结尾' },
    { mode: 'video-creative', label: '短视频创意共创', description: '生成可落地的视频创意方案', isNew: true, requiresPlatform: true },
];

// Video Platform
export type VideoPlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'shipinhao';

export interface VideoPlatformConfig {
    id: VideoPlatform;
    label: string;
    emoji: string;
}

export const VIDEO_PLATFORMS: VideoPlatformConfig[] = [
    { id: 'douyin', label: '抖音', emoji: '🎵' },
    { id: 'kuaishou', label: '快手', emoji: '⚡' },
    { id: 'xiaohongshu', label: '小红书', emoji: '📕' },
    { id: 'shipinhao', label: '视频号', emoji: '📱' },
];

// AI Result History
export interface AIResultItem {
    id: string;
    title: string;
    content: string;
    timestamp: number;
}

// ============================================
// AI 智能完善相关类型
// ============================================

// AI 创建历史记录 - 记录每次 AI 操作的请求和响应
export interface AICreationRecord {
    id: string;
    timestamp: number;
    type: 'create' | 'expand' | 'refine' | 'chat';
    userInput: string;                    // 用户原始输入
    systemPrompt?: string;                // 使用的系统提示词（可选）
    aiResponse: string;                   // AI 原始响应
    sourceType?: InputType;               // 输入类型
    contentMode?: ContentMode;            // 内容模式
    platform?: VideoPlatform;             // 目标平台
    nodeId?: string;                      // 相关节点ID（如果是节点级操作）
    nodeLabel?: string;                   // 相关节点标签
    resultSummary?: string;               // 操作结果摘要
}

// 智能完善对话消息
export interface RefineMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    // AI 建议的操作
    suggestedActions?: RefineAction[];
    // 是否正在加载
    isLoading?: boolean;
}

// 智能完善操作类型
export type RefineActionType =
    | 'add_node'      // 添加节点
    | 'delete_node'   // 删除节点
    | 'update_node'   // 修改节点
    | 'move_node'     // 移动节点
    | 'regroup'       // 重组结构
    | 'expand'        // 扩展分支
    | 'summarize';    // 总结/压缩

// 智能完善操作
export interface RefineAction {
    id: string;
    type: RefineActionType;
    description: string;           // 操作描述
    targetNodeId?: string;         // 目标节点
    targetNodeLabel?: string;      // 目标节点标签
    parentNodeId?: string;         // 父节点ID（用于添加）
    parentNodeLabel?: string;      // 父节点标签（用于添加）
    newLabel?: string;             // 新标签（用于添加/修改）
    newNotes?: string;             // 新备注
    children?: Array<{             // 子节点（用于批量添加）
        label: string;
        notes?: string;
        children?: Array<{ label: string; notes?: string }>;
    }>;
    applied?: boolean;             // 是否已应用
}

// 智能完善会话
export interface RefineSession {
    id: string;
    mapId: string;
    startedAt: number;
    messages: RefineMessage[];
    appliedActions: RefineAction[];
}
