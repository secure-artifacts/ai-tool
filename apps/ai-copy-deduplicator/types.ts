// 文案去重模块类型定义

/**
 * 单条文案项
 */
export interface CopyItem {
    id: string;
    originalText: string;      // 原始文案（用于对比的外文）
    chineseText?: string;      // 对应的中文翻译（可选，仅用于显示）
    processedText: string;     // 处理后的文案（去除标题/互动语）
    embedding?: number[];      // 文本向量
    addedAt: number;           // 添加时间戳
    source?: string;           // 来源批次标识
}

/**
 * 带相似度的文案项（用于表格展示）
 */
export interface SimilarCopyItem extends CopyItem {
    similarity: number;        // 与代表文案的相似度 (0-1)
}

/**
 * 相似组（表格中的一行）
 */
export interface SimilarGroup {
    id: string;
    representative: CopyItem;           // 代表文案（第一列）
    similarItems: SimilarCopyItem[];    // 相似文案列表（后续列）
    maxSimilarity: number;              // 最高相似度
    aiReason?: string;                  // AI 判断的理由
}

/**
 * 与文案库匹配结果
 */
export interface LibraryMatch {
    newItemId: string;         // 新导入的文案ID
    libraryItem: CopyItem;     // 库中匹配到的文案
    similarity: number;        // 相似度
}

/**
 * 文案的最终分类状态
 */
export type CopyItemStatus =
    | 'unique_new'            // 🟢 新增独特：批次内独特 + 库中不存在
    | 'batch_similar'         // 🟡 批次内相似：本批次中有相似文案
    | 'library_exists';       // 🔴 库中已存在：与文案库中已有文案相似

/**
 * 处理后的文案项
 */
export interface ProcessedCopyItem extends CopyItem {
    status: CopyItemStatus;
    matchedLibraryItem?: CopyItem;  // 如果是 library_exists，匹配到的库文案
    groupId?: string;               // 如果是 batch_similar，所属的相似组ID
}

/**
 * 排除规则配置
 */
export interface ExcludePatterns {
    titleKeywords: string[];      // 标题常见关键词
    endingKeywords: string[];     // 结尾互动语关键词
    useAiDetection: boolean;      // 是否使用 AI 智能检测
}

/**
 * 处理结果统计
 */
export interface ProcessingStats {
    totalInput: number;           // 本次输入总数
    uniqueNew: number;            // 新增独特数（将入库）
    batchSimilarGroups: number;   // 批次内相似组数
    libraryExists: number;        // 库中已存在数
    processingTime: number;       // 处理耗时(ms)
}

/**
 * 去重处理结果
 */
export interface DeduplicationResult {
    similarGroups: SimilarGroup[];      // 相似组列表（表格数据）
    libraryMatches: LibraryMatch[];     // 与库匹配结果
    newUniqueItems: CopyItem[];         // 新的独特文案（将入库）
    stats: ProcessingStats;             // 统计信息
}

/**
 * 模块状态
 */
export interface CopyDedupState {
    // 文案库
    library: CopyItem[];

    // 当前批次处理
    inputText: string;                  // 输入的原始文本
    isProcessing: boolean;              // 是否正在处理
    processingProgress: number;         // 处理进度 (0-100)
    processingStatus: string;           // 处理状态描述

    // 处理结果
    result: DeduplicationResult | null;

    // 设置
    similarityThreshold: number;        // 相似度阈值 (0-1)，默认 0.8
    excludePatterns: ExcludePatterns;   // 排除规则
    customPrompt: string;               // 自定义 AI 判断指令

    // UI 状态
    selectedGroupId: string | null;     // 当前选中的相似组
    showLibraryPanel: boolean;          // 是否显示文案库面板
    showSettings: boolean;              // 是否显示设置面板
}

export const DEFAULT_JUDGE_PROMPT = `你是一个专业的文案去重与清洗专家。你需要分析一批"情感/宗教/祈祷"类的短文案，找出重复和相似的内容。

# 预处理规则（分析时忽略这些部分）:
- 忽略通用标题（如："THE MOST POWERFUL PRAYER", "Read it once", "A sign from God"）
- 忽略互动引导语（如："Type Amen", "Share this", "Pass to someone", "Link in bio"）
- 忽略乱码或无意义的噪音

# 相似度判断标准（只比对核心正文）:

1. 【完全重复】语义重合度 > 90%（包括只是替换了几个同义词）
   -> 只保留版本最干净、排版最好的一条
   
2. 【包含关系】文案B完全包含文案A，但增加内容 < 10%
   -> 只保留较短的原始版本A
   
3. 【变体保留】虽然相似，但有明显的"时效性信息"或"特定场景"差异
   -> 两条都保留
   
4. 【标题党区分】标题一样但正文核心内容完全不同
   -> 两条都保留

# 输出格式（严格JSON）:
{
  "uniqueItems": [
    { "index": 文案序号, "reason": "为什么独特的简短原因" }
  ],
  "duplicateGroups": [
    {
      "keepIndex": 保留的文案序号,
      "removeIndices": [要删除的文案序号数组],
      "reason": "判断理由（简短）"
    }
  ]
}`;

/**
 * 初始状态
 */
export const initialCopyDedupState: CopyDedupState = {
    library: [],
    inputText: '',
    isProcessing: false,
    processingProgress: 0,
    processingStatus: '',
    result: null,
    similarityThreshold: 0.8,
    excludePatterns: {
        titleKeywords: ['【', '】', '#', '标题', '主题'],
        endingKeywords: ['关注', '点赞', '收藏', '转发', '评论', '私信', '留言', '双击', '❤️', '👍'],
        useAiDetection: true,
    },
    customPrompt: DEFAULT_JUDGE_PROMPT,
    selectedGroupId: null,
    showLibraryPanel: false,
    showSettings: false,
};
