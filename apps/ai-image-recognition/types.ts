// 工作模式：standard=标准识别模式, creative=创新模式
export type WorkMode = 'standard' | 'creative';

// 创新模式结果 - 每张图片的创新结果
export interface CreativeResult {
    imageId: string;
    originalDesc: string; // 原始描述词
    originalDescZh?: string; // 原始中文描述
    innovations: Array<{
        id: string;
        textEn: string; // 创新词（英文）
        textZh: string; // 创新词（中文）
    }>;
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
}

// 创新融合角色类型
export type CreativeFusionRole = 'style' | 'composition' | 'subject' | 'lighting' | 'inspiration';

// 创新融合项 - 用于灵感融合创新
export interface CreativeFusionItem {
    imageId: string;
    role: CreativeFusionRole;
}

// 创新融合结果
export interface CreativeFusionResult {
    innovations: Array<{
        id: string;
        textEn: string;
        textZh: string;
    }>;
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
}

// 融合组 - 支持多组批量融合
export interface FusionGroup {
    id: string;
    items: CreativeFusionItem[]; // 组内的图片项
    result?: CreativeFusionResult; // 该组的融合结果
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[]; // Base64 data
    timestamp: number;
}

// 创新项 - 每个创新结果都有独立的对话功能
export interface InnovationItem {
    id: string;
    text: string; // 创新后的提示词
    chatHistory: ChatMessage[]; // 该创新词的对话历史
    isChatOpen: boolean; // 对话面板是否打开
    chatInput: string; // 当前输入
    chatAttachments: string[]; // 待发送的图片附件
    isChatLoading: boolean; // 是否正在加载
}

// 融合子图 - 卡片内的额外融合图片
export interface FusionSubImage {
    id: string;
    imageUrl: string; // 显示用的URL（blob或远程）
    base64Data?: string; // API处理用的base64
    role: CreativeFusionRole; // 融合角色
}

export interface ImageItem {
    id: string;
    sourceType: 'file' | 'url' | 'formula';
    originalInput: string; // The raw text (URL or Formula) or filename
    imageUrl: string; // The displayable blob URL or remote URL
    fetchUrl?: string; // The actual URL fetched
    base64Data?: string; // For API processing
    mimeType?: string;
    status: 'idle' | 'loading' | 'success' | 'error';
    result?: string;
    errorMsg?: string;
    gyazoUrl?: string; // 上传到 Gyazo 后的链接
    isUploadingToGyazo?: boolean; // 是否正在上传到 Gyazo
    // 新增：对话功能
    chatHistory: ChatMessage[];
    isChatOpen?: boolean;
    isChatLoading?: boolean;
    chatInput?: string;
    chatAttachments?: string[]; // 待发送的图片
    // 新增：单独提示词
    customPrompt?: string;
    useCustomPrompt?: boolean;
    mergeWithGlobalPrompt?: boolean; // 是否与全局指令合并（true=合并模式，false=独立模式）
    // 新增：创新指令（单图覆盖）
    customInnovationInstruction?: string;
    customInnovationCount?: number; // 每次生成个数
    customInnovationRounds?: number; // 轮数
    customInnovationTemplateId?: string; // 使用的模板ID
    // 新增：提示词创新功能 - 现在使用 InnovationItem[] 替代 string[]
    innovationOutputs?: string[]; // 保留旧字段以兼容
    innovationItems?: InnovationItem[]; // 新的创新项列表，每项支持独立对话
    isInnovationOpen?: boolean; // 创新面板是否打开
    isInnovating?: boolean; // 是否正在创新
    innovationError?: string; // 创新错误信息
    // 翻译缓存
    translatedResult?: string; // 缓存的翻译结果
    lastSelectedText?: string; // 上次选中的文本
    lastTranslatedSelection?: string; // 上次选中翻译的结果
    // 多图融合：卡片内的额外融合图片
    fusionImages?: FusionSubImage[]; // 融合子图列表
}

export interface Preset {
    id: string;
    name: string;
    text: string;
}

export type ProcessingMode = 'sequential' | 'parallel';

// 单个标签页的数据
export interface RecognitionTab {
    id: string;
    name: string;
    images: ImageItem[];
    prompt: string;
    innovationInstruction?: string;
    globalInnovationTemplateId?: string;
    globalInnovationCount?: number;
    globalInnovationRounds?: number;
    isProcessing: boolean;
    isQueued?: boolean; // 是否在等待队列中
    createdAt: number;
}

export interface ImageRecognitionState {
    // 多标签页支持
    tabs: RecognitionTab[];
    activeTabId: string;
    // 兼容旧版本 - 这些字段将映射到当前活动标签页
    images: ImageItem[];
    prompt: string;
    presets: Preset[];
    innovationInstruction?: string; // 全局创新指令
    globalInnovationTemplateId?: string; // 全局创新模板ID
    globalInnovationCount?: number; // 全局每轮个数
    globalInnovationRounds?: number; // 全局轮数
    isProcessing: boolean;
    copyMode: 'resultOnly' | 'originalAndResult' | 'originalOnly' | 'linkOnly';
    viewMode: 'grid' | 'list' | 'compact';
    autoUploadGyazo: boolean; // 是否自动上传到 Gyazo
    pureReplyMode?: boolean; // 纯净回复模式 - AI 回复只包含描述词，无多余内容
    // 创新模式相关
    workMode?: WorkMode; // 工作模式：standard=标准模式, creative=创新模式
    creativeCount?: number; // 创新模式：每张图生成多少个创新变体
    creativeResults?: CreativeResult[]; // 创新模式：所有图片的创新结果
    creativeInstruction?: string; // 创新模式：自定义创新指令
    needOriginalDesc?: boolean; // 创新模式：是否需要先获取原始描述词（开启则两步流程，关闭则直接创新）
    originalDescPresetId?: string; // 创新模式：用于获取原始描述的预设ID（默认使用 ai提示词-1）
}

// 默认预设 - 用于首次加载或 localStorage 为空时
// 导出供云端同步服务使用
export const DEFAULT_PRESETS: Preset[] = [
    {
        id: '1', name: '图片转为AI提示词-1（识别原始图片风格）', text: `详细描述图片，不要图片中的文字。给我完整的AI描述词，方便我直接给其他软件生成图片或者视频使用。你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。并且英文回复我。

关键细节要求：你对每个提示词的描述必须详尽且高度细致。切勿简略。

主体与场景：极其精确地描述所有主体、物体和角色。对于人物，详细说明其外貌、服装（面料、款式、颜色）、配饰、姿势、表情和动作。指定他们彼此之间以及与环境的空间关系。

构图与风格：明确定义镜头类型（如"特写"、"全景"）、摄像机角度（如"低角度"、"荷兰式倾斜角"）以及整体艺术风格（如"超写实 3D 渲染"、"印象派油画"、"动漫关键视觉图"）。

艺术元素：如果图像具有独特的艺术风格，你必须描述其具体特征。这包括笔触（如"明显的厚涂笔触"、"平滑融合的数字喷枪"）、线条（如"锐利、干净的赛璐璐阴影轮廓"、"草率、松散的铅笔线条"）、调色板（如"鲜艳的霓虹色"、"柔和、低饱和度的色调"）和光影（如"戏剧性的明暗对比照明"、"柔和、弥散的晨光"）。

环境：详细描述背景和前景，包括地点、时间、天气和特定的环境元素。

你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。并且英文回复我。` },
    { id: '2', name: '图片转为AI提示词-2（统一转为摄影真实风格）', text: '详细描述图片，不要图片中的文字。要摄影风格。给我完整的AI描述词，方便我直接给其他软件生成视频或者图片使用。你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。并且英文回复我。' },
    { id: '3', name: '通用分类', text: '请分析这张图片中的人物，根据以下类别进行分类，仅返回类别编号和名称：\n1. 婴儿，幼儿\n2. 小学生，学生\n3. 家庭\n4. 成年男性\n5. 成年女性\n6. 老人\n\n如果图片中没有人物或无法判断，请根据画面内容自定义分类（例如：风景、人物、食物、文档、电子产品等）。' },
    { id: '4', name: '生成标签', text: '为这张图片生成5-10个相关的标签，用逗号分隔。' },
    { id: '5', name: 'OCR 文字提取', text: '提取图片中所有可见的文字，保持原有排版，直接输出文字内容。' },
];

// 从 localStorage 加载预设，并确保默认预设始终存在
const loadPresetsFromStorage = (): Preset[] => {
    if (typeof window === 'undefined') return DEFAULT_PRESETS;
    try {
        const saved = localStorage.getItem('ai-classifier-presets');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // 获取默认预设的 ID 列表
                const defaultPresetIds = new Set(DEFAULT_PRESETS.map(p => p.id));

                // 分离本地数据：排除默认预设ID的自定义预设
                const localCustomPresets = parsed.filter((p: Preset) => !defaultPresetIds.has(p.id));

                // 合并：默认预设（最新版本）+ 本地自定义预设
                // 默认预设始终使用代码中的最新版本，不被本地覆盖
                const merged = [...DEFAULT_PRESETS, ...localCustomPresets];

                // 保存合并后的列表
                localStorage.setItem('ai-classifier-presets', JSON.stringify(merged));
                return merged;
            }
        }
    } catch (e) {
        console.warn('Failed to load presets from localStorage:', e);
    }
    return DEFAULT_PRESETS;
};

// 保存预设到 localStorage（用于跨组件同步）
export const savePresetsToStorage = (presets: Preset[]): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem('ai-classifier-presets', JSON.stringify(presets));
    } catch (e) {
        console.warn('Failed to save presets to localStorage:', e);
    }
};

// 创建默认标签页的工厂函数
export const createDefaultTab = (name: string = '标签页 1'): RecognitionTab => ({
    id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    images: [],
    prompt: '',
    innovationInstruction: '',
    globalInnovationTemplateId: '__system_default__',
    globalInnovationCount: 3,
    globalInnovationRounds: 1,
    isProcessing: false,
    createdAt: Date.now(),
});

const defaultTab = createDefaultTab();

export const initialImageRecognitionState: ImageRecognitionState = {
    // 多标签页
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
    // 兼容旧版本
    images: [],
    prompt: '',
    presets: loadPresetsFromStorage(),  // 从 localStorage 加载预设
    innovationInstruction: '',
    globalInnovationTemplateId: '__system_default__',
    globalInnovationCount: 3,
    globalInnovationRounds: 1,
    isProcessing: false,
    copyMode: 'resultOnly',
    viewMode: 'list',
    autoUploadGyazo: true, // 默认开启
    pureReplyMode: false, // 纯净回复模式默认关闭
    // 创新模式相关
    workMode: 'standard', // 默认标准模式
    creativeCount: 4, // 默认每张图生成4个创新变体
    creativeResults: [],
    creativeInstruction: '',
};

