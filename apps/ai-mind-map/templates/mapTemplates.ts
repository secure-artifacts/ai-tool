import type { AIGeneratedNode, AIGeneratedStructure, ContentMode } from '../types';

export interface MapTemplate {
    id: string;
    label: string;
    description: string;
    keywords: string[];
    contentModes?: ContentMode[];
    structure: AIGeneratedStructure;
}

const cloneNode = (node: AIGeneratedNode, topic: string): AIGeneratedNode => {
    const replaceText = (value?: string) => value?.replace(/\{\{topic\}\}/g, topic);
    return {
        label: replaceText(node.label) || node.label,
        description: replaceText(node.description),
        suggestedTags: node.suggestedTags,
        sources: node.sources,
        logicType: node.logicType,
        children: node.children?.map((child) => cloneNode(child, topic)),
    };
};

export const buildTemplateStructure = (template: MapTemplate, topic: string): AIGeneratedStructure => {
    const normalizedTopic = topic.trim() || template.label;
    return {
        title: template.structure.title.replace(/\{\{topic\}\}/g, normalizedTopic),
        children: template.structure.children.map((child) => cloneNode(child, normalizedTopic)),
    };
};

export const MAP_TEMPLATES: MapTemplate[] = [
    {
        id: 'video-script',
        label: '短视频脚本',
        description: '用于短视频内容策划与分镜拆解',
        keywords: ['视频', '脚本', '分镜', '口播', '剧情'],
        contentModes: ['video-script', 'video-creative'],
        structure: {
            title: '{{topic}}',
            children: [
                {
                    label: '目标受众',
                    description: '核心人群画像与观看动机',
                    children: [
                        { label: '人群画像', description: '年龄、性别、兴趣、痛点' },
                        { label: '观看场景', description: '浏览场景与时间' },
                        { label: '情绪预期', description: '希望获得的情绪价值' },
                    ],
                },
                {
                    label: '开场钩子',
                    description: '前 3 秒强吸引点',
                    children: [
                        { label: '冲突/反差', description: '制造反差或悬念' },
                        { label: '问题抛出', description: '直击痛点的提问' },
                        { label: '承诺收益', description: '明确观众能获得什么' },
                    ],
                },
                {
                    label: '内容展开',
                    description: '核心观点与过程',
                    children: [
                        { label: '主线观点', description: '视频核心结论' },
                        { label: '关键步骤', description: '步骤/要点清单' },
                        { label: '案例佐证', description: '真实案例/数据' },
                    ],
                },
                {
                    label: '镜头设计',
                    description: '镜头节奏与视觉安排',
                    children: [
                        { label: '镜头节奏', description: '快慢交替，节奏控制' },
                        { label: '视觉元素', description: '字幕、转场、贴纸' },
                        { label: '景别组合', description: '远景/中景/特写切换' },
                    ],
                },
                {
                    label: '脚本台词',
                    description: '旁白/对话与行动指令',
                    children: [
                        { label: '核心台词', description: '爆点金句' },
                        { label: '行动提示', description: '让观众跟随的动作' },
                        { label: '语气控制', description: '口吻与语速' },
                    ],
                },
                {
                    label: '转化引导',
                    description: '点赞、评论、转化策略',
                    children: [
                        { label: '互动话术', description: '评论引导问题' },
                        { label: '行动号召', description: '关注/私信/下单' },
                        { label: '结尾记忆点', description: '强化品牌/主题' },
                    ],
                },
            ],
        },
    },
    {
        id: 'marketing-plan',
        label: '营销策划',
        description: '适用于营销方案、活动策划与增长规划',
        keywords: ['营销', '推广', '活动', '增长', '投放', '转化'],
        contentModes: ['content-planning'],
        structure: {
            title: '{{topic}}',
            children: [
                {
                    label: '目标与指标',
                    description: '明确目标与 KPI',
                    children: [
                        { label: '业务目标', description: '增长/转化/品牌曝光' },
                        { label: '关键指标', description: 'GMV/线索/转化率' },
                        { label: '时间周期', description: '阶段目标与节点' },
                    ],
                },
                {
                    label: '用户与洞察',
                    description: '用户画像与痛点',
                    children: [
                        { label: '核心人群', description: '年龄、兴趣、消费力' },
                        { label: '需求痛点', description: '核心需求/阻力' },
                        { label: '竞品对比', description: '差异化切入' },
                    ],
                },
                {
                    label: '内容与渠道',
                    description: '内容矩阵与渠道策略',
                    children: [
                        { label: '内容主题', description: '话题与素材方向' },
                        { label: '渠道组合', description: '私域+公域搭配' },
                        { label: '节奏排期', description: '投放节奏规划' },
                    ],
                },
                {
                    label: '创意与执行',
                    description: '创意形式与执行细节',
                    children: [
                        { label: '创意概念', description: '核心创意点' },
                        { label: '执行清单', description: '素材、人员、资源' },
                        { label: '风险预案', description: '应急处理' },
                    ],
                },
                {
                    label: '复盘与优化',
                    description: '数据复盘与迭代',
                    children: [
                        { label: '数据看板', description: '关键指标监测' },
                        { label: '优化动作', description: 'A/B 测试' },
                        { label: '经验沉淀', description: '复盘输出' },
                    ],
                },
            ],
        },
    },
    {
        id: 'product-plan',
        label: '产品规划',
        description: '用于产品功能规划与需求梳理',
        keywords: ['产品', '功能', '需求', '版本', '路线图'],
        structure: {
            title: '{{topic}}',
            children: [
                {
                    label: '用户问题',
                    description: '核心需求与痛点',
                    children: [
                        { label: '核心场景', description: '高频使用场景' },
                        { label: '关键痛点', description: '阻碍与机会' },
                        { label: '需求优先级', description: '重要程度排序' },
                    ],
                },
                {
                    label: '功能设计',
                    description: '功能结构与交互',
                    children: [
                        { label: '核心功能', description: '基础能力' },
                        { label: '增强功能', description: '差异化能力' },
                        { label: '体验流程', description: '关键路径' },
                    ],
                },
                {
                    label: '实施计划',
                    description: '版本节奏与里程碑',
                    children: [
                        { label: 'MVP 范围', description: '最小可行版本' },
                        { label: '里程碑', description: '阶段节点' },
                        { label: '资源配置', description: '人力与成本' },
                    ],
                },
                {
                    label: '风险与指标',
                    description: '风险识别与衡量指标',
                    children: [
                        { label: '主要风险', description: '依赖与风险点' },
                        { label: '验证指标', description: '使用率与留存' },
                        { label: '迭代策略', description: '优化路径' },
                    ],
                },
            ],
        },
    },
    {
        id: 'competitive-analysis',
        label: '竞品分析',
        description: '适用于竞品对比与市场分析',
        keywords: ['竞品', '对标', '分析', '市场', '对手'],
        structure: {
            title: '{{topic}}',
            children: [
                {
                    label: '竞品清单',
                    description: '主要对手与替代品',
                    children: [
                        { label: '直接竞品', description: '同类产品' },
                        { label: '间接竞品', description: '替代方案' },
                        { label: '市场定位', description: '定位区间' },
                    ],
                },
                {
                    label: '能力对比',
                    description: '功能、体验、定价',
                    children: [
                        { label: '功能矩阵', description: '功能差异点' },
                        { label: '体验对比', description: '易用性与流程' },
                        { label: '定价策略', description: '价格与促销' },
                    ],
                },
                {
                    label: '优势与机会',
                    description: '可利用的市场机会',
                    children: [
                        { label: '优势总结', description: '自身优势' },
                        { label: '差距分析', description: '短板' },
                        { label: '机会点', description: '突破方向' },
                    ],
                },
            ],
        },
    },
    {
        id: 'research-plan',
        label: '用户调研',
        description: '适用于用户研究与访谈计划',
        keywords: ['调研', '访谈', '用户', '研究', '洞察'],
        structure: {
            title: '{{topic}}',
            children: [
                {
                    label: '调研目标',
                    description: '需要验证的核心问题',
                    children: [
                        { label: '关键假设', description: '要验证的假设' },
                        { label: '研究问题', description: '具体问题清单' },
                    ],
                },
                {
                    label: '样本与方法',
                    description: '样本范围与方法选择',
                    children: [
                        { label: '样本画像', description: '用户属性' },
                        { label: '方法选择', description: '访谈/问卷/观察' },
                        { label: '样本数量', description: '样本规模' },
                    ],
                },
                {
                    label: '执行与分析',
                    description: '执行流程与分析框架',
                    children: [
                        { label: '访谈提纲', description: '问题结构' },
                        { label: '数据整理', description: '整理归类' },
                        { label: '洞察输出', description: '关键结论' },
                    ],
                },
                {
                    label: '行动建议',
                    description: '转化为行动方案',
                    children: [
                        { label: '行动清单', description: '产品/运营动作' },
                        { label: '优先级', description: '排序建议' },
                    ],
                },
            ],
        },
    },
];

export const autoPickTemplate = (input: string, mode: ContentMode): MapTemplate | null => {
    const normalized = input.trim();
    if (!normalized) {
        return MAP_TEMPLATES.find((t) => t.contentModes?.includes(mode)) || MAP_TEMPLATES[0] || null;
    }

    const lower = normalized.toLowerCase();
    const directMatch = MAP_TEMPLATES.find((template) =>
        template.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))
    );
    if (directMatch) return directMatch;

    return MAP_TEMPLATES.find((t) => t.contentModes?.includes(mode)) || MAP_TEMPLATES[0] || null;
};
