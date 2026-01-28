// ============================================
// AI 思维导图 - 模板库
// ============================================

import type { MindMapData, MindMapNode } from '../types';

export interface MindMapTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: 'business' | 'creative' | 'learning' | 'productivity';
    preview?: string; // 预览图路径
    data: MindMapData;
}

// 生成唯一ID
const genId = () => `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ============================================
// 项目规划模板
// ============================================
const projectPlanningTemplate: MindMapTemplate = {
    id: 'project-planning',
    name: '项目规划',
    description: '使用 WBS 分解法规划项目任务',
    icon: '📋',
    category: 'business',
    data: {
        id: 'tpl-project',
        name: '项目规划',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '项目名称',
                color: '#8b5cf6',
                parentId: null,
                children: ['phase1', 'phase2', 'phase3', 'phase4'],
            },
            'phase1': {
                id: 'phase1',
                label: '📋 规划阶段',
                color: '#3b82f6',
                parentId: 'root',
                children: ['p1-1', 'p1-2', 'p1-3'],
            },
            'p1-1': { id: 'p1-1', label: '需求分析', color: '#60a5fa', parentId: 'phase1', children: [] },
            'p1-2': { id: 'p1-2', label: '资源评估', color: '#60a5fa', parentId: 'phase1', children: [] },
            'p1-3': { id: 'p1-3', label: '时间排期', color: '#60a5fa', parentId: 'phase1', children: [] },
            'phase2': {
                id: 'phase2',
                label: '🚀 执行阶段',
                color: '#22c55e',
                parentId: 'root',
                children: ['p2-1', 'p2-2', 'p2-3'],
            },
            'p2-1': { id: 'p2-1', label: '任务分配', color: '#4ade80', parentId: 'phase2', children: [] },
            'p2-2': { id: 'p2-2', label: '进度跟踪', color: '#4ade80', parentId: 'phase2', children: [] },
            'p2-3': { id: 'p2-3', label: '风险管控', color: '#4ade80', parentId: 'phase2', children: [] },
            'phase3': {
                id: 'phase3',
                label: '✅ 验收阶段',
                color: '#f59e0b',
                parentId: 'root',
                children: ['p3-1', 'p3-2'],
            },
            'p3-1': { id: 'p3-1', label: '质量检查', color: '#fbbf24', parentId: 'phase3', children: [] },
            'p3-2': { id: 'p3-2', label: '交付确认', color: '#fbbf24', parentId: 'phase3', children: [] },
            'phase4': {
                id: 'phase4',
                label: '📊 复盘阶段',
                color: '#ec4899',
                parentId: 'root',
                children: ['p4-1', 'p4-2'],
            },
            'p4-1': { id: 'p4-1', label: '经验总结', color: '#f472b6', parentId: 'phase4', children: [] },
            'p4-2': { id: 'p4-2', label: '优化建议', color: '#f472b6', parentId: 'phase4', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 读书笔记模板
// ============================================
const bookNotesTemplate: MindMapTemplate = {
    id: 'book-notes',
    name: '读书笔记',
    description: '结构化记录书籍要点与心得',
    icon: '📚',
    category: 'learning',
    data: {
        id: 'tpl-book',
        name: '读书笔记',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '《书名》',
                color: '#8b5cf6',
                parentId: null,
                children: ['info', 'summary', 'keypoints', 'quotes', 'action'],
            },
            'info': {
                id: 'info',
                label: '📖 基本信息',
                color: '#64748b',
                parentId: 'root',
                children: ['info-1', 'info-2', 'info-3'],
            },
            'info-1': { id: 'info-1', label: '作者', color: '#94a3b8', parentId: 'info', children: [] },
            'info-2': { id: 'info-2', label: '出版年份', color: '#94a3b8', parentId: 'info', children: [] },
            'info-3': { id: 'info-3', label: '阅读时间', color: '#94a3b8', parentId: 'info', children: [] },
            'summary': {
                id: 'summary',
                label: '📝 内容概要',
                color: '#3b82f6',
                parentId: 'root',
                children: ['sum-1', 'sum-2'],
            },
            'sum-1': { id: 'sum-1', label: '主要论点', color: '#60a5fa', parentId: 'summary', children: [] },
            'sum-2': { id: 'sum-2', label: '核心逻辑', color: '#60a5fa', parentId: 'summary', children: [] },
            'keypoints': {
                id: 'keypoints',
                label: '⭐ 关键要点',
                color: '#f59e0b',
                parentId: 'root',
                children: ['kp-1', 'kp-2', 'kp-3'],
            },
            'kp-1': { id: 'kp-1', label: '要点一', color: '#fbbf24', parentId: 'keypoints', children: [] },
            'kp-2': { id: 'kp-2', label: '要点二', color: '#fbbf24', parentId: 'keypoints', children: [] },
            'kp-3': { id: 'kp-3', label: '要点三', color: '#fbbf24', parentId: 'keypoints', children: [] },
            'quotes': {
                id: 'quotes',
                label: '💡 精彩摘录',
                color: '#22c55e',
                parentId: 'root',
                children: ['q-1', 'q-2'],
            },
            'q-1': { id: 'q-1', label: '金句一', color: '#4ade80', parentId: 'quotes', children: [] },
            'q-2': { id: 'q-2', label: '金句二', color: '#4ade80', parentId: 'quotes', children: [] },
            'action': {
                id: 'action',
                label: '🎯 行动计划',
                color: '#ec4899',
                parentId: 'root',
                children: ['act-1', 'act-2'],
            },
            'act-1': { id: 'act-1', label: '实践应用', color: '#f472b6', parentId: 'action', children: [] },
            'act-2': { id: 'act-2', label: '后续阅读', color: '#f472b6', parentId: 'action', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 头脑风暴模板
// ============================================
const brainstormTemplate: MindMapTemplate = {
    id: 'brainstorm',
    name: '头脑风暴',
    description: '发散思维，快速收集创意灵感',
    icon: '💡',
    category: 'creative',
    data: {
        id: 'tpl-brainstorm',
        name: '头脑风暴',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '核心主题',
                color: '#f59e0b',
                parentId: null,
                children: ['what', 'why', 'how', 'who', 'when'],
            },
            'what': {
                id: 'what',
                label: '❓ 是什么',
                color: '#3b82f6',
                parentId: 'root',
                children: ['what-1', 'what-2'],
            },
            'what-1': { id: 'what-1', label: '定义', color: '#60a5fa', parentId: 'what', children: [] },
            'what-2': { id: 'what-2', label: '特征', color: '#60a5fa', parentId: 'what', children: [] },
            'why': {
                id: 'why',
                label: '🎯 为什么',
                color: '#22c55e',
                parentId: 'root',
                children: ['why-1', 'why-2'],
            },
            'why-1': { id: 'why-1', label: '目的', color: '#4ade80', parentId: 'why', children: [] },
            'why-2': { id: 'why-2', label: '价值', color: '#4ade80', parentId: 'why', children: [] },
            'how': {
                id: 'how',
                label: '🔧 怎么做',
                color: '#8b5cf6',
                parentId: 'root',
                children: ['how-1', 'how-2'],
            },
            'how-1': { id: 'how-1', label: '方法', color: '#a78bfa', parentId: 'how', children: [] },
            'how-2': { id: 'how-2', label: '步骤', color: '#a78bfa', parentId: 'how', children: [] },
            'who': {
                id: 'who',
                label: '👥 谁参与',
                color: '#ec4899',
                parentId: 'root',
                children: ['who-1', 'who-2'],
            },
            'who-1': { id: 'who-1', label: '目标用户', color: '#f472b6', parentId: 'who', children: [] },
            'who-2': { id: 'who-2', label: '利益相关者', color: '#f472b6', parentId: 'who', children: [] },
            'when': {
                id: 'when',
                label: '⏰ 何时',
                color: '#06b6d4',
                parentId: 'root',
                children: ['when-1', 'when-2'],
            },
            'when-1': { id: 'when-1', label: '时机', color: '#22d3ee', parentId: 'when', children: [] },
            'when-2': { id: 'when-2', label: '周期', color: '#22d3ee', parentId: 'when', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// SWOT 分析模板
// ============================================
const swotTemplate: MindMapTemplate = {
    id: 'swot-analysis',
    name: 'SWOT 分析',
    description: '优势劣势机会威胁全面分析',
    icon: '📈',
    category: 'business',
    data: {
        id: 'tpl-swot',
        name: 'SWOT 分析',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '分析主题',
                color: '#8b5cf6',
                parentId: null,
                children: ['s', 'w', 'o', 't'],
            },
            's': {
                id: 's',
                label: '💪 优势 Strengths',
                color: '#22c55e',
                parentId: 'root',
                children: ['s-1', 's-2', 's-3'],
            },
            's-1': { id: 's-1', label: '核心优势一', color: '#4ade80', parentId: 's', children: [] },
            's-2': { id: 's-2', label: '核心优势二', color: '#4ade80', parentId: 's', children: [] },
            's-3': { id: 's-3', label: '核心优势三', color: '#4ade80', parentId: 's', children: [] },
            'w': {
                id: 'w',
                label: '⚠️ 劣势 Weaknesses',
                color: '#f59e0b',
                parentId: 'root',
                children: ['w-1', 'w-2', 'w-3'],
            },
            'w-1': { id: 'w-1', label: '待改进一', color: '#fbbf24', parentId: 'w', children: [] },
            'w-2': { id: 'w-2', label: '待改进二', color: '#fbbf24', parentId: 'w', children: [] },
            'w-3': { id: 'w-3', label: '待改进三', color: '#fbbf24', parentId: 'w', children: [] },
            'o': {
                id: 'o',
                label: '🚀 机会 Opportunities',
                color: '#3b82f6',
                parentId: 'root',
                children: ['o-1', 'o-2', 'o-3'],
            },
            'o-1': { id: 'o-1', label: '市场机会一', color: '#60a5fa', parentId: 'o', children: [] },
            'o-2': { id: 'o-2', label: '市场机会二', color: '#60a5fa', parentId: 'o', children: [] },
            'o-3': { id: 'o-3', label: '市场机会三', color: '#60a5fa', parentId: 'o', children: [] },
            't': {
                id: 't',
                label: '🛡️ 威胁 Threats',
                color: '#ef4444',
                parentId: 'root',
                children: ['t-1', 't-2', 't-3'],
            },
            't-1': { id: 't-1', label: '潜在风险一', color: '#f87171', parentId: 't', children: [] },
            't-2': { id: 't-2', label: '潜在风险二', color: '#f87171', parentId: 't', children: [] },
            't-3': { id: 't-3', label: '潜在风险三', color: '#f87171', parentId: 't', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// OKR 目标模板
// ============================================
const okrTemplate: MindMapTemplate = {
    id: 'okr-goals',
    name: 'OKR 目标',
    description: '目标与关键结果设定',
    icon: '🎯',
    category: 'productivity',
    data: {
        id: 'tpl-okr',
        name: 'OKR 目标',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '年度 OKR',
                color: '#8b5cf6',
                parentId: null,
                children: ['o1', 'o2', 'o3'],
            },
            'o1': {
                id: 'o1',
                label: '🎯 目标一',
                color: '#3b82f6',
                parentId: 'root',
                children: ['kr1-1', 'kr1-2', 'kr1-3'],
            },
            'kr1-1': { id: 'kr1-1', label: 'KR1: 关键结果', color: '#60a5fa', parentId: 'o1', children: [] },
            'kr1-2': { id: 'kr1-2', label: 'KR2: 关键结果', color: '#60a5fa', parentId: 'o1', children: [] },
            'kr1-3': { id: 'kr1-3', label: 'KR3: 关键结果', color: '#60a5fa', parentId: 'o1', children: [] },
            'o2': {
                id: 'o2',
                label: '🎯 目标二',
                color: '#22c55e',
                parentId: 'root',
                children: ['kr2-1', 'kr2-2', 'kr2-3'],
            },
            'kr2-1': { id: 'kr2-1', label: 'KR1: 关键结果', color: '#4ade80', parentId: 'o2', children: [] },
            'kr2-2': { id: 'kr2-2', label: 'KR2: 关键结果', color: '#4ade80', parentId: 'o2', children: [] },
            'kr2-3': { id: 'kr2-3', label: 'KR3: 关键结果', color: '#4ade80', parentId: 'o2', children: [] },
            'o3': {
                id: 'o3',
                label: '🎯 目标三',
                color: '#f59e0b',
                parentId: 'root',
                children: ['kr3-1', 'kr3-2', 'kr3-3'],
            },
            'kr3-1': { id: 'kr3-1', label: 'KR1: 关键结果', color: '#fbbf24', parentId: 'o3', children: [] },
            'kr3-2': { id: 'kr3-2', label: 'KR2: 关键结果', color: '#fbbf24', parentId: 'o3', children: [] },
            'kr3-3': { id: 'kr3-3', label: 'KR3: 关键结果', color: '#fbbf24', parentId: 'o3', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 会议纪要模板
// ============================================
const meetingNotesTemplate: MindMapTemplate = {
    id: 'meeting-notes',
    name: '会议纪要',
    description: '记录会议要点和行动项',
    icon: '📝',
    category: 'productivity',
    data: {
        id: 'tpl-meeting',
        name: '会议纪要',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '会议主题',
                color: '#8b5cf6',
                parentId: null,
                children: ['info', 'agenda', 'decisions', 'actions', 'followup'],
            },
            'info': {
                id: 'info',
                label: '📋 会议信息',
                color: '#64748b',
                parentId: 'root',
                children: ['info-1', 'info-2', 'info-3'],
            },
            'info-1': { id: 'info-1', label: '日期时间', color: '#94a3b8', parentId: 'info', children: [] },
            'info-2': { id: 'info-2', label: '参会人员', color: '#94a3b8', parentId: 'info', children: [] },
            'info-3': { id: 'info-3', label: '会议地点', color: '#94a3b8', parentId: 'info', children: [] },
            'agenda': {
                id: 'agenda',
                label: '📌 议程要点',
                color: '#3b82f6',
                parentId: 'root',
                children: ['ag-1', 'ag-2', 'ag-3'],
            },
            'ag-1': { id: 'ag-1', label: '议题一', color: '#60a5fa', parentId: 'agenda', children: [] },
            'ag-2': { id: 'ag-2', label: '议题二', color: '#60a5fa', parentId: 'agenda', children: [] },
            'ag-3': { id: 'ag-3', label: '议题三', color: '#60a5fa', parentId: 'agenda', children: [] },
            'decisions': {
                id: 'decisions',
                label: '✅ 决议事项',
                color: '#22c55e',
                parentId: 'root',
                children: ['dec-1', 'dec-2'],
            },
            'dec-1': { id: 'dec-1', label: '决议一', color: '#4ade80', parentId: 'decisions', children: [] },
            'dec-2': { id: 'dec-2', label: '决议二', color: '#4ade80', parentId: 'decisions', children: [] },
            'actions': {
                id: 'actions',
                label: '🎯 行动项',
                color: '#f59e0b',
                parentId: 'root',
                children: ['act-1', 'act-2'],
            },
            'act-1': { id: 'act-1', label: '待办一 @负责人', color: '#fbbf24', parentId: 'actions', children: [] },
            'act-2': { id: 'act-2', label: '待办二 @负责人', color: '#fbbf24', parentId: 'actions', children: [] },
            'followup': {
                id: 'followup',
                label: '📅 后续安排',
                color: '#ec4899',
                parentId: 'root',
                children: ['fu-1'],
            },
            'fu-1': { id: 'fu-1', label: '下次会议时间', color: '#f472b6', parentId: 'followup', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 视频脚本模板（特色功能）
// ============================================
const videoScriptTemplate: MindMapTemplate = {
    id: 'video-script',
    name: '视频脚本',
    description: '短视频创意与脚本规划',
    icon: '🎬',
    category: 'creative',
    data: {
        id: 'tpl-video',
        name: '视频脚本',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '视频主题',
                color: '#ec4899',
                parentId: null,
                children: ['hook', 'content', 'cta', 'production'],
            },
            'hook': {
                id: 'hook',
                label: '🎣 开场钩子',
                color: '#f59e0b',
                parentId: 'root',
                children: ['hook-1', 'hook-2', 'hook-3'],
            },
            'hook-1': { id: 'hook-1', label: '痛点切入', color: '#fbbf24', parentId: 'hook', children: [] },
            'hook-2': { id: 'hook-2', label: '悬念开场', color: '#fbbf24', parentId: 'hook', children: [] },
            'hook-3': { id: 'hook-3', label: '冲突对比', color: '#fbbf24', parentId: 'hook', children: [] },
            'content': {
                id: 'content',
                label: '📝 主体内容',
                color: '#3b82f6',
                parentId: 'root',
                children: ['c-1', 'c-2', 'c-3'],
            },
            'c-1': { id: 'c-1', label: '要点一', color: '#60a5fa', parentId: 'content', children: [] },
            'c-2': { id: 'c-2', label: '要点二', color: '#60a5fa', parentId: 'content', children: [] },
            'c-3': { id: 'c-3', label: '要点三', color: '#60a5fa', parentId: 'content', children: [] },
            'cta': {
                id: 'cta',
                label: '🎯 行动号召',
                color: '#22c55e',
                parentId: 'root',
                children: ['cta-1', 'cta-2'],
            },
            'cta-1': { id: 'cta-1', label: '关注引导', color: '#4ade80', parentId: 'cta', children: [] },
            'cta-2': { id: 'cta-2', label: '互动引导', color: '#4ade80', parentId: 'cta', children: [] },
            'production': {
                id: 'production',
                label: '🎥 拍摄要点',
                color: '#8b5cf6',
                parentId: 'root',
                children: ['prod-1', 'prod-2', 'prod-3'],
            },
            'prod-1': { id: 'prod-1', label: '镜头运动', color: '#a78bfa', parentId: 'production', children: [] },
            'prod-2': { id: 'prod-2', label: '字幕设计', color: '#a78bfa', parentId: 'production', children: [] },
            'prod-3': { id: 'prod-3', label: '配乐风格', color: '#a78bfa', parentId: 'production', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 内容策划模板
// ============================================
const contentPlanTemplate: MindMapTemplate = {
    id: 'content-plan',
    name: '内容策划',
    description: '内容营销策略与规划',
    icon: '📱',
    category: 'creative',
    data: {
        id: 'tpl-content',
        name: '内容策划',
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root',
                label: '内容主题',
                color: '#8b5cf6',
                parentId: null,
                children: ['audience', 'format', 'channel', 'calendar'],
            },
            'audience': {
                id: 'audience',
                label: '👥 目标受众',
                color: '#ec4899',
                parentId: 'root',
                children: ['aud-1', 'aud-2'],
            },
            'aud-1': { id: 'aud-1', label: '用户画像', color: '#f472b6', parentId: 'audience', children: [] },
            'aud-2': { id: 'aud-2', label: '痛点需求', color: '#f472b6', parentId: 'audience', children: [] },
            'format': {
                id: 'format',
                label: '🎨 内容形式',
                color: '#3b82f6',
                parentId: 'root',
                children: ['fmt-1', 'fmt-2', 'fmt-3'],
            },
            'fmt-1': { id: 'fmt-1', label: '图文内容', color: '#60a5fa', parentId: 'format', children: [] },
            'fmt-2': { id: 'fmt-2', label: '短视频', color: '#60a5fa', parentId: 'format', children: [] },
            'fmt-3': { id: 'fmt-3', label: '直播互动', color: '#60a5fa', parentId: 'format', children: [] },
            'channel': {
                id: 'channel',
                label: '📢 发布渠道',
                color: '#22c55e',
                parentId: 'root',
                children: ['ch-1', 'ch-2', 'ch-3'],
            },
            'ch-1': { id: 'ch-1', label: '抖音', color: '#4ade80', parentId: 'channel', children: [] },
            'ch-2': { id: 'ch-2', label: '小红书', color: '#4ade80', parentId: 'channel', children: [] },
            'ch-3': { id: 'ch-3', label: '视频号', color: '#4ade80', parentId: 'channel', children: [] },
            'calendar': {
                id: 'calendar',
                label: '📅 发布计划',
                color: '#f59e0b',
                parentId: 'root',
                children: ['cal-1', 'cal-2'],
            },
            'cal-1': { id: 'cal-1', label: '周发布频率', color: '#fbbf24', parentId: 'calendar', children: [] },
            'cal-2': { id: 'cal-2', label: '最佳发布时间', color: '#fbbf24', parentId: 'calendar', children: [] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
};

// ============================================
// 导出所有模板
// ============================================
export const MIND_MAP_TEMPLATES: MindMapTemplate[] = [
    projectPlanningTemplate,
    bookNotesTemplate,
    brainstormTemplate,
    swotTemplate,
    okrTemplate,
    meetingNotesTemplate,
    videoScriptTemplate,
    contentPlanTemplate,
];

// 按分类获取模板
export const getTemplatesByCategory = (category: MindMapTemplate['category']): MindMapTemplate[] => {
    return MIND_MAP_TEMPLATES.filter(t => t.category === category);
};

// 获取模板分类信息
export const TEMPLATE_CATEGORIES = [
    { id: 'business', label: '商务', icon: '💼' },
    { id: 'creative', label: '创意', icon: '🎨' },
    { id: 'learning', label: '学习', icon: '📚' },
    { id: 'productivity', label: '效率', icon: '⚡' },
] as const;

// 克隆模板数据（生成新ID避免冲突）
export const cloneTemplateData = (template: MindMapTemplate): MindMapData => {
    const idMap = new Map<string, string>();
    const now = Date.now();

    // 生成新ID映射
    Object.keys(template.data.nodes).forEach(oldId => {
        idMap.set(oldId, genId());
    });

    // 克隆节点，替换所有ID
    const newNodes: Record<string, MindMapNode> = {};
    Object.entries(template.data.nodes).forEach(([oldId, node]) => {
        const newId = idMap.get(oldId)!;
        newNodes[newId] = {
            ...node,
            id: newId,
            parentId: node.parentId ? idMap.get(node.parentId) ?? null : null,
            children: node.children.map(childId => idMap.get(childId)!).filter(Boolean),
        };
    });

    const newRootId = idMap.get(template.data.rootId)!;

    return {
        id: genId(),
        name: template.name,
        rootId: newRootId,
        nodes: newNodes,
        createdAt: now,
        updatedAt: now,
        sourceType: 'blank',
    };
};
