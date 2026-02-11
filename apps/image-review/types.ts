/**
 * 图片审核工具 - 类型定义
 */

// 审核状态（简化为3个）
export type ReviewStatus = 'pending' | 'approved' | 'revision' | 'rejected';

// 审核状态配置
export const REVIEW_STATUS_CONFIG: Record<ReviewStatus, { label: string; labelEn: string; description: string; icon: string; color: string }> = {
    pending: {
        label: '待审核',
        labelEn: 'Pending',
        description: '等待审核',
        icon: '⏳',
        color: 'zinc'
    },
    approved: {
        label: '合格',
        labelEn: 'Approved',
        description: '可以用于口播人物图',
        icon: '✅',
        color: 'emerald'
    },
    revision: {
        label: '有建议',
        labelEn: 'Has Suggestions',
        description: '可以简单修改达到合格',
        icon: '✏️',
        color: 'amber'
    },
    rejected: {
        label: '不合格',
        labelEn: 'Not Qualified',
        description: '整体存在问题，建议重新生成',
        icon: '❌',
        color: 'red'
    },
};

// 标注类型
export type AnnotationType = 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';

// 标注工具配置
export const ANNOTATION_TOOLS: { type: AnnotationType; label: string; icon: string }[] = [
    { type: 'rectangle', label: '矩形', icon: '□' },
    { type: 'circle', label: '圆形', icon: '○' },
    { type: 'arrow', label: '箭头', icon: '→' },
    { type: 'freehand', label: '画笔', icon: '✏️' },
    { type: 'text', label: '文字', icon: 'T' },
];

// 标注项
export interface Annotation {
    id: string;
    type: AnnotationType;
    points: { x: number; y: number }[];
    color: string;
    strokeWidth: number;
    text?: string;
}

// 翻译结果
export interface TranslationResult {
    original: string;           // 原始中文
    english: string;            // 目标语言翻译（兼容旧字段名）
    backTranslation: string;    // 回译中文
    isAccurate: boolean;        // 是否准确（AI 判断）
    targetLanguage?: string;    // 目标语言代码（支持任意 code，如 en/de/pt-BR/ar）
    targetLanguageLabel?: string; // 目标语言名称（English/German/...）
    timestamp: number;
}

// 问题严重程度
export type SeverityLevel = 'critical' | 'major' | 'minor' | 'suggestion';

// 严重程度配置
export const SEVERITY_CONFIG: Record<SeverityLevel, { label: string; labelEn: string; color: string; icon: string }> = {
    critical: { label: '严重', labelEn: 'Critical', color: 'red', icon: '🔴' },
    major: { label: '中等', labelEn: 'Major', color: 'amber', icon: '🟡' },
    minor: { label: '轻微', labelEn: 'Minor', color: 'blue', icon: '🔵' },
    suggestion: { label: '建议', labelEn: 'Suggestion', color: 'green', icon: '💡' },
};

// 双栏反馈结构
export interface FeedbackItem {
    id: string;
    severity: SeverityLevel;           // 严重程度
    problemCn: string;                 // 问题描述（中文）
    suggestionCn: string;              // 改进建议（中文）
    problemTranslation?: TranslationResult;    // 问题翻译
    suggestionTranslation?: TranslationResult; // 建议翻译
    referenceImageUrl?: string;        // 参考图 URL（可选）
    referenceImageBase64?: string;     // 参考图 Base64（用于导出）
    colorHex?: string;                 // 推荐颜色 Hex 代码（可选）
}

// 项目信息
export interface ProjectInfo {
    name: string;           // 项目名称
    reviewerName: string;   // 审核人姓名
    reviewDate: string;     // 审核日期
    batchNumber: string;    // 批次号
    notes: string;          // 备注
    overallSummary?: string; // 整批问题汇总（中文）
    overallSummaryEn?: string; // 整批问题汇总（英文）
    overallSummaryBackTranslation?: string; // 英文回译
    overallSummaryIsAccurate?: boolean; // 翻译准确性
}

// 单张图片审核
export interface ImageReview {
    id: string;
    imageUrl: string;           // 显示用 URL
    base64Data?: string;        // API 用 base64
    originalInput?: string;     // 原始输入（URL/文件名）

    // 审核信息
    status: ReviewStatus;
    feedbackItems: FeedbackItem[];  // 结构化反馈项（问题+建议）
    annotations: Annotation[];      // 图片标注

    // 旧版兼容（可选）
    feedbackCn?: string;            // 简单中文反馈
    translation?: TranslationResult; // 翻译结果

    // 元数据
    createdAt: number;
    updatedAt: number;
    groupId?: string;           // 所属组 ID

    // Gyazo 云端链接
    gyazoUrl?: string;              // 上传到 Gyazo 后的永久链接
    isUploadingToGyazo?: boolean;   // 是否正在上传
}

// 图片组（多图组合反馈）
export interface ImageGroup {
    id: string;
    name: string;
    imageIds: string[];

    // 组级别反馈
    groupFeedbackCn: string;
    groupTranslation?: TranslationResult;
    groupStatus: ReviewStatus;

    createdAt: number;
    updatedAt: number;
}

// 快捷短语
export interface QuickPhrase {
    id: string;
    text: string;
    category: string;
}

// 默认快捷短语
export const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
    // 人物相关
    { id: 'p1', text: '人物表情不自然', category: '人物' },
    { id: 'p2', text: '人物手指畸形', category: '人物' },
    { id: 'p3', text: '人物比例失调', category: '人物' },
    { id: 'p4', text: '眼睛位置不对称', category: '人物' },
    { id: 'p5', text: '嘴唇形状怪异', category: '人物' },

    // 画面相关
    { id: 's1', text: '背景模糊不清', category: '画面' },
    { id: 's2', text: '色彩过于饱和', category: '画面' },
    { id: 's3', text: '光影效果不真实', category: '画面' },
    { id: 's4', text: '构图不平衡', category: '画面' },
    { id: 's5', text: '画面有明显噪点', category: '画面' },

    // 风格相关
    { id: 't1', text: '风格不符合要求', category: '风格' },
    { id: 't2', text: '细节不够丰富', category: '风格' },
    { id: 't3', text: '整体效果很好', category: '风格' },
    { id: 't4', text: '可以作为参考', category: '风格' },
];

// 视图模式
export type ViewMode = 'grid' | 'single' | 'compare';

// 应用状态
export interface ImageReviewState {
    images: ImageReview[];
    groups: ImageGroup[];
    quickPhrases: QuickPhrase[];

    // 选择状态
    selectedIds: string[];      // 当前选中的图片 ID
    activeImageId: string | null; // 当前编辑的图片 ID

    // 视图设置
    viewMode: ViewMode;
    showAnnotations: boolean;

    // 编辑状态
    currentAnnotationTool: AnnotationType | null;
    annotationColor: string;
}

// 初始状态
export const initialImageReviewState: ImageReviewState = {
    images: [],
    groups: [],
    quickPhrases: DEFAULT_QUICK_PHRASES,
    selectedIds: [],
    activeImageId: null,
    viewMode: 'grid',
    showAnnotations: true,
    currentAnnotationTool: null,
    annotationColor: '#ef4444', // red-500
};

// 创建新图片审核项
export const createImageReview = (imageUrl: string, base64Data?: string, originalInput?: string): ImageReview => ({
    id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    imageUrl,
    base64Data,
    originalInput,
    status: 'pending',
    feedbackItems: [],
    feedbackCn: '',
    annotations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

// 创建新反馈项
export const createFeedbackItem = (severity: SeverityLevel = 'major'): FeedbackItem => ({
    id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    severity,
    problemCn: '',
    suggestionCn: '',
});

// 创建新图片组
export const createImageGroup = (name: string, imageIds: string[]): ImageGroup => ({
    id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    imageIds,
    groupFeedbackCn: '',
    groupStatus: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
});
