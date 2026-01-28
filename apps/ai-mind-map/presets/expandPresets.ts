// ============================================
// AI 预设扩展模式
// ============================================

export interface ExpandPreset {
    id: string;
    name: string;
    icon: string;
    description: string;
    promptTemplate: string;
    category: 'analysis' | 'creative' | 'structure' | 'deep';
}

export const EXPAND_PRESETS: ExpandPreset[] = [
    // ===== 分析维度 =====
    {
        id: 'timeline',
        name: '时间线分析',
        icon: '📅',
        description: '按时间顺序拆解发展阶段',
        category: 'analysis',
        promptTemplate: `请按时间线/发展阶段来分析"{topic}"，生成各阶段的关键节点。
包括：起始阶段、发展过程、当前状态、未来趋势等。
输出应该按时间顺序排列，每个阶段用简短的名词/动宾短语概括。`,
    },
    {
        id: 'cause-effect',
        name: '因果分析',
        icon: '🔗',
        description: '分析原因与结果的关系',
        category: 'analysis',
        promptTemplate: `请对"{topic}"进行因果分析：
1. 产生的原因有哪些？（根本原因、直接原因）
2. 导致的结果有哪些？（直接影响、间接影响）
3. 之间的逻辑链条是什么？
用简洁的关键词概括每个要点。`,
    },
    {
        id: 'compare',
        name: '对比分析',
        icon: '⚖️',
        description: '从多个维度进行比较',
        category: 'analysis',
        promptTemplate: `请对"{topic}"进行多维度对比分析：
可以从以下角度展开：优缺点、适用场景、成本效益、难易程度、与竞品的对比等。
每个维度用简短的名词概括，结论用一句话说明。`,
    },
    {
        id: 'five-why',
        name: '5 Why 追问',
        icon: '🤔',
        description: '连续追问找到根因',
        category: 'analysis',
        promptTemplate: `请对"{topic}"使用 5 Why 分析法：
从表面现象开始，连续追问"为什么"5次，深入挖掘根本原因。
每一层的答案都要具体且可追溯。`,
    },

    // ===== 创意发散 =====
    {
        id: 'brainstorm',
        name: '头脑风暴',
        icon: '💡',
        description: '天马行空发散创意',
        category: 'creative',
        promptTemplate: `请围绕"{topic}"进行头脑风暴，生成尽可能多的创意想法。
不要自我审查，越野越好，包括：常规方案、创新方案、疯狂方案。
每个想法用 2-6 字的短语概括。`,
    },
    {
        id: 'scenario',
        name: '场景发散',
        icon: '🎬',
        description: '设想不同使用场景',
        category: 'creative',
        promptTemplate: `请设想"{topic}"的各种应用场景：
包括：日常场景、工作场景、极端场景、未来场景等。
每个场景用一个具体的名词或短语描述。`,
    },
    {
        id: 'persona',
        name: '用户视角',
        icon: '👥',
        description: '从不同用户角度思考',
        category: 'creative',
        promptTemplate: `请从不同用户群体的视角来分析"{topic}"：
每个用户群体关注什么？痛点是什么？需求是什么？
用户群体可以包括：新手、专家、企业用户、个人用户等。`,
    },
    {
        id: 'reverse',
        name: '逆向思维',
        icon: '🔄',
        description: '反向思考找突破口',
        category: 'creative',
        promptTemplate: `请用逆向思维分析"{topic}"：
1. 如果要让它失败，需要做什么？
2. 最不应该做的事情是什么？
3. 竞争对手希望我们犯什么错？
从反面找到正确方向。`,
    },

    // ===== 结构拆解 =====
    {
        id: 'mece',
        name: 'MECE 分类',
        icon: '📊',
        description: '相互独立，完全穷尽',
        category: 'structure',
        promptTemplate: `请按 MECE 原则（相互独立，完全穷尽）对"{topic}"进行分类：
确保分类之间没有重叠，且覆盖所有方面。
每个分类用 2-6 字的名词概括。`,
    },
    {
        id: 'hierarchy',
        name: '层级分解',
        icon: '🏗️',
        description: '从大到小逐层拆解',
        category: 'structure',
        promptTemplate: `请对"{topic}"进行层级分解：
从宏观到微观，从整体到部分，逐层细化。
第一层是大类，第二层是子类，以此类推。`,
    },
    {
        id: 'process',
        name: '流程步骤',
        icon: '📋',
        description: '按操作顺序分解',
        category: 'structure',
        promptTemplate: `请将"{topic}"分解为执行步骤：
按照先后顺序，列出完成这件事需要的所有步骤。
每个步骤用"动词+宾语"的格式表达。`,
    },
    {
        id: 'components',
        name: '组成要素',
        icon: '🧩',
        description: '拆解为组成部分',
        category: 'structure',
        promptTemplate: `请分析"{topic}"由哪些要素组成：
包括核心要素、辅助要素、可选要素等。
每个要素用简短的名词表达。`,
    },

    // ===== 深度挖掘 =====
    {
        id: 'deep-dive',
        name: '深度研究',
        icon: '🔬',
        description: '专业角度深入分析',
        category: 'deep',
        promptTemplate: `请以专业研究的角度深入分析"{topic}"：
包括：定义与概念、理论基础、实践方法、常见误区、前沿动态。
内容要有深度和专业性。`,
    },
    {
        id: 'expert',
        name: '专家视角',
        icon: '🎓',
        description: '以领域专家身份分析',
        category: 'deep',
        promptTemplate: `假设你是"{topic}"领域的顶级专家：
请分享你认为最重要的insights、常见的认知误区、以及你的独到见解。
内容要有洞察力和实操性。`,
    },
    {
        id: 'trends',
        name: '趋势预测',
        icon: '📈',
        description: '分析未来发展趋势',
        category: 'deep',
        promptTemplate: `请分析"{topic}"的发展趋势：
包括：当前状态、短期趋势（1年内）、中期趋势（3-5年）、长期展望。
给出判断依据和可能的变量。`,
    },
    {
        id: 'controversy',
        name: '争议观点',
        icon: '⚡',
        description: '收集不同立场的观点',
        category: 'deep',
        promptTemplate: `请收集关于"{topic}"的不同观点和争议：
包括：主流观点、反对意见、中立分析、边缘观点。
客观呈现各方立场和论据。`,
    },
];

// 获取按分类分组的预设
export const getPresetsByCategory = () => {
    const categories = {
        analysis: { label: '📊 分析维度', presets: [] as ExpandPreset[] },
        creative: { label: '💡 创意发散', presets: [] as ExpandPreset[] },
        structure: { label: '🏗️ 结构拆解', presets: [] as ExpandPreset[] },
        deep: { label: '🔬 深度挖掘', presets: [] as ExpandPreset[] },
    };

    EXPAND_PRESETS.forEach(preset => {
        categories[preset.category].presets.push(preset);
    });

    return categories;
};

// 根据预设生成完整的 prompt
export const buildPresetPrompt = (preset: ExpandPreset, topic: string, context: string, rootTopic: string): string => {
    const basePrompt = preset.promptTemplate.replace(/{topic}/g, topic);

    return `# Role
你是一个极简主义的思维导图专家。

# Context Anchoring（锚点上下文）
根主题：${rootTopic}
完整路径：${context}
当前节点：${topic}

# 扩展模式
${preset.name}：${preset.description}

# Rules
1. 每个节点标签限制在 2-8 个字以内
2. 绝对不要使用标点符号
3. 输出必须是名词或动宾短语
4. 内容必须紧扣根主题「${rootTopic}」，不能跑题

# Task
${basePrompt}

# Output Format
只返回 JSON 数组：
[{"label": "关键词", "description": "一句话说明"}, ...]

生成 4-8 个高质量子节点。`;
};
