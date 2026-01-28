/**
 * AI 思维导图生成提示词预设
 * 参考 Mapify AI 的 Prompt 注入策略
 */

export type PromptMode = 'mapify' | 'simple' | 'custom';

export interface PromptPreset {
    id: PromptMode;
    label: string;
    description: string;
    icon: string;
}

// 可选的 Prompt 预设
export const PROMPT_PRESETS: PromptPreset[] = [
    {
        id: 'mapify',
        label: 'Mapify 风格',
        description: '深层结构 + Few-Shot示例 + MECE原则，生成专业思维导图',
        icon: '🚀',
    },
    {
        id: 'simple',
        label: '极简模式',
        description: '快速生成，适合简单主题，速度快但结构较浅',
        icon: '⚡',
    },
    {
        id: 'custom',
        label: '自定义 Prompt',
        description: '使用你自己的 Prompt 模板',
        icon: '✏️',
    },
];

// 默认自定义 Prompt 模板
export const DEFAULT_CUSTOM_PROMPT = `你是一个思维导图生成助手。
请根据用户输入的内容，生成结构化的思维导图。

要求：
- 标题简洁（2-8字）
- 层级清晰
- 内容具体

请返回JSON格式：
{
  "title": "根节点标题",
  "children": [
    {
      "label": "分支名",
      "description": "说明",
      "children": [...]
    }
  ],
  "missingHints": []
}`;

/**
 * 🚀 Mapify 风格 Prompt - 深度结构 + Few-Shot
 * 核心特点：
 * 1. 强制性深度结构（一级/二级/三级节点数量硬性要求）
 * 2. Few-Shot 示例引导输出风格
 * 3. MECE 原则确保内容完整不重叠
 * 4. 禁止空泛概括，要求具体案例和数据
 */
export function buildMapifyPrompt(
    userInput: string,
    modeInstructions: string,
    targetNodes: { l1: number; l2: number; l3: number }
): string {
    return `# Role
你是一个专业思维导图生成引擎，像 Mapify AI 一样生成结构完整、内容丰富的思维导图。

# User Input
"""
${userInput}
"""

${modeInstructions ? `# Content Mode\n${modeInstructions}\n` : ''}
# 🚨 CRITICAL REQUIREMENTS (必须严格遵守)

## 结构数量要求（硬性指标）
- 一级分支：**必须 ${targetNodes.l1}-${targetNodes.l1 + 2} 个**（不得少于 ${targetNodes.l1} 个）
- 每个一级分支下：**必须 ${targetNodes.l2}-${targetNodes.l2 + 2} 个二级节点**
- 每个二级节点下：**必须 ${targetNodes.l3}-${targetNodes.l3 + 1} 个三级节点**
- 总节点数目标：**至少 ${targetNodes.l1 * targetNodes.l2 * targetNodes.l3} 个节点**

## 内容质量要求（关键差异）
1. **禁止空泛概括**：每个节点必须包含具体、可操作的内容
2. **必须有实例**：至少 30% 的节点要有案例、数据或具体步骤
3. **MECE 原则**：同级节点相互独立、完全穷尽，不能有概念重叠
4. **层级递进**：从抽象到具体，每深一层内容更细化

## 节点格式规范
- label：2-8 个字的关键词短语，不要句子
- description：详细说明、例子、数据、步骤（15-50字）
- 不要使用标点符号作为 label

# Few-Shot Examples（学习这个风格）

## 示例输入：「如何学好英语」

## 示例输出格式：
{
  "title": "英语学习完全指南",
  "children": [
    {
      "label": "听力突破",
      "description": "从听懂到会说的关键技能",
      "logicType": "progressive",
      "children": [
        {
          "label": "材料选择",
          "description": "根据水平选择合适的听力材料",
          "children": [
            { "label": "初级: VOA慢速", "description": "语速60-90词/分钟，适合入门，配有文本对照" },
            { "label": "中级: TED演讲", "description": "真实语境，主题丰富，有字幕辅助" },
            { "label": "高级: NPR新闻", "description": "原速新闻，锻炼真实场景理解能力" }
          ]
        },
        {
          "label": "训练方法",
          "description": "科学有效的听力训练技巧",
          "children": [
            { "label": "精听法", "description": "逐句暂停、跟读、复述，每天30分钟" },
            { "label": "泛听法", "description": "睡前/通勤时大量浸泡，培养语感" },
            { "label": "影子跟读", "description": "同步跟读法，0.5秒延迟复述" }
          ]
        },
        {
          "label": "阶段目标",
          "description": "可量化的进步指标",
          "children": [
            { "label": "1-3月", "description": "能听懂VOA慢速80%以上内容" },
            { "label": "4-6月", "description": "能看懂无字幕美剧50%剧情" },
            { "label": "7-12月", "description": "能听懂真人对话和新闻" }
          ]
        }
      ]
    },
    {
      "label": "口语表达",
      "description": "从开口到流利的实战技巧",
      "logicType": "progressive",
      "children": [
        {
          "label": "发音基础",
          "description": "音标、连读、弱读等核心发音技能",
          "children": [
            { "label": "国际音标", "description": "48个音标精准掌握，推荐BBC发音教程" },
            { "label": "连读规则", "description": "辅音+元音连读，如 pick it up" },
            { "label": "弱读还原", "description": "and→'n，to→ta，常见弱读识别" }
          ]
        },
        {
          "label": "实战场景",
          "description": "高频场景的口语模板",
          "children": [
            { "label": "自我介绍", "description": "30秒电梯演讲模板：背景+优势+目标" },
            { "label": "商务沟通", "description": "会议、邮件、电话的常用句型" },
            { "label": "日常对话", "description": "购物、问路、点餐等生活场景" }
          ]
        }
      ]
    }
  ],
  "missingHints": ["应试技巧", "工具推荐", "学习计划表"]
}

# 🎯 Now Generate for User's Input

基于用户输入「${userInput.slice(0, 100)}${userInput.length > 100 ? '...' : ''}」生成完整思维导图。

## Output Rules
1. 只返回 JSON，不要任何解释或 Markdown 代码块
2. 必须达到结构数量要求
3. 每个 description 都要有实际内容，不要留空或写"..."
4. 使用中文输出`;
}

/**
 * ⚡ 极简模式 Prompt - 快速生成
 * 适合简单主题，速度优先
 */
export function buildSimplePrompt(
    userInput: string,
    modeInstructions: string,
): string {
    return `你是思维导图生成助手。根据用户输入生成结构清晰的思维导图。

用户输入：${userInput}

${modeInstructions ? `要求：${modeInstructions}\n` : ''}

生成 3-5 个一级分支，每个分支下 2-4 个二级节点。
标题控制在 2-8 个字。

只返回 JSON 格式：
{
  "title": "标题",
  "children": [
    {
      "label": "分支",
      "description": "说明",
      "children": [
        { "label": "子节点", "description": "说明" }
      ]
    }
  ],
  "missingHints": []
}`;
}

/**
 * 🔄 对话式修改 Prompt - 局部更新导图
 * 核心特点：
 * 1. 理解用户的修改意图
 * 2. 只修改相关部分，而非重画整个导图
 * 3. 返回具体的操作指令（add_node, update_node, delete_node, expand）
 */
export function buildConversationalRefinePrompt(
    userRequest: string,
    mapStructure: string,
    selectedNode?: string
): string {
    return `# Role
你是一个思维导图修改助手。用户希望**局部修改**现有导图，而不是重新生成。

# 当前导图结构
\`\`\`
${mapStructure}
\`\`\`

${selectedNode ? `# 当前选中节点\n${selectedNode}\n` : ''}

# 用户修改请求
"${userRequest}"

# 任务
分析用户意图，生成**最小修改方案**。不要重画整个导图！

## 可用操作类型
- \`add_node\`: 新增节点
- \`update_node\`: 修改现有节点的标签或描述
- \`delete_node\`: 删除节点
- \`expand\`: 为节点添加子节点

# Output JSON
{
  "reply": "简短说明要做的修改（1-2句）",
  "suggestedActions": [
    {
      "type": "add_node",
      "description": "在「XX」下新增「YY」",
      "parentNodeLabel": "父节点名称",
      "newLabel": "新节点标签",
      "newNotes": "新节点备注（可选）",
      "children": [
        {"label": "子节点1", "notes": "备注1"},
        {"label": "子节点2"}
      ]
    }
  ]
}

## 规则
1. **最多 3 个操作**，优先选择最有影响力的修改
2. **直接执行**，不要追问确认
3. **只返回 JSON**，不要解释`;
}

/**
 * 🎯 关键词注入 - 把简单关键词变成有层级的结构
 * 参考 Mapify 的 Prompt 注入策略
 */
export function buildKeywordInjectionPrompt(
    keyword: string,
    depth: number = 3
): string {
    return `# Keyword Expansion Task
将关键词「${keyword}」扩展为 ${depth} 层的思维导图结构。

## 扩展策略
1. **语义分析**：分析关键词的核心含义和可能的维度
2. **维度拆解**：从不同角度分解（定义、分类、特征、应用、案例）
3. **层级递进**：每层更具体

## 示例
关键词：咖啡种类

输出：
{
  "title": "咖啡种类全解",
  "children": [
    {
      "label": "按产地分类",
      "description": "不同产区的风味特点",
      "children": [
        {"label": "埃塞俄比亚", "description": "花香果香，非洲第一产区"},
        {"label": "哥伦比亚", "description": "坚果巧克力调，平衡感强"},
        {"label": "巴西", "description": "低酸顺滑，全球产量最大"}
      ]
    },
    {
      "label": "按烘焙程度",
      "description": "烘焙深浅影响口感",
      "children": [
        {"label": "浅烘焙", "description": "保留酸味，花果香明显"},
        {"label": "中烘焙", "description": "平衡酸苦，适合大众口味"},
        {"label": "深烘焙", "description": "浓郁苦香，意式咖啡常用"}
      ]
    },
    {
      "label": "按冲泡方式",
      "description": "不同萃取方式的特点",
      "children": [
        {"label": "意式浓缩", "description": "高压萃取，油脂丰富"},
        {"label": "手冲滴滤", "description": "精细控制，突出风味"},
        {"label": "冷萃咖啡", "description": "低温长时间萃取，清爽低酸"}
      ]
    }
  ],
  "missingHints": ["咖啡豆处理法", "器具选择", "品鉴方法"]
}

# 现在处理关键词「${keyword}」
只返回 JSON，不要解释。`;
}
