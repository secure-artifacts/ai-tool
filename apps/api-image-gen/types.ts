// API 生图 - 类型定义

export type ImageGenModel = 'gemini-3-pro' | 'nanobanana-pro';

export type ImageSize = '512x512' | '768x768' | '1024x1024' | '1024x1536' | '1536x1024' | '1792x1024' | '1024x1792';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GeneratedPrompt {
    id: string;
    textEn: string;  // 英文版本 (用于生成)
    textZh: string;  // 中文版本 (用于显示)
    selected: boolean;
}

// 生成唯一文件名前缀
export const generateFilePrefix = (): string => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const randomStr = Math.random().toString(36).substring(2, 6);
    return `api-gen-${dateStr}-${timeStr}-${randomStr}`;
};

export interface ImageGenTask {
    id: string;
    promptId: string;
    promptText: string;      // 英文描述词 (用于生成)
    promptTextZh?: string;   // 中文描述词 (用于显示)
    filename: string;        // 唯一文件名，同一张图多次下载保持不变
    model: ImageGenModel;
    size: ImageSize;
    useReferenceImage: boolean; // 是否垫图
    referenceImages?: File[];   // 参考图片 (垫图模式下使用)
    status: TaskStatus;
    progress: number;
    result?: string; // base64 或 URL
    error?: string;
    createdAt: number;
    completedAt?: number;
}

export interface WorkflowState {
    // 第一步：输入
    inputImages: File[];
    inputText: string;

    // 第二步：描述词生成
    promptInstruction: string; // 自定义指令
    promptCount: number; // 描述词个数
    generatedPrompts: GeneratedPrompt[];
    isGeneratingPrompts: boolean;

    // 第三步：生图
    model: ImageGenModel;
    size: ImageSize;
    useReferenceImage: boolean;
    tasks: ImageGenTask[];
    isGeneratingImages: boolean;
    autoDownload: boolean;
}

// 生成默认指令 (根据数量动态生成)
export const generateDefaultInstruction = (count: number): string => {
    const promptLines = Array.from({ length: count }, (_, i) =>
        `PROMPT${i + 1}_EN: [English description for image generation]\nPROMPT${i + 1}_ZH: [对应的中文描述]`
    ).join('\n');

    return `请根据输入的图片和/或文字描述，生成${count}个不同风格的详细图像描述词(prompt)。

要求：
1. 每个描述词应该详细、具体，适合 AI 图像生成
2. 描述词应该包含：主体、场景、风格、光线、色调等元素
3. 同时提供英文版本和中文版本 (英文用于生成，中文方便查看)
4. ${count}个描述词应该有明显的差异，例如不同风格、角度或氛围

请严格按照以下格式输出 (每个 prompt 包含 EN 和 ZH 两行)：
${promptLines}`;
};

export const DEFAULT_PROMPT_INSTRUCTION = generateDefaultInstruction(4);

export const SIZE_OPTIONS: { value: ImageSize; label: string }[] = [
    { value: '512x512', label: '512×512 (1:1)' },
    { value: '768x768', label: '768×768 (1:1)' },
    { value: '1024x1024', label: '1024×1024 (1:1)' },
    { value: '1024x1536', label: '1024×1536 (2:3 竖版)' },
    { value: '1536x1024', label: '1536×1024 (3:2 横版)' },
    { value: '1792x1024', label: '1792×1024 (16:9 宽屏)' },
    { value: '1024x1792', label: '1024×1792 (9:16 竖屏)' },
];

export const MODEL_OPTIONS: { value: ImageGenModel; label: string }[] = [
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'nanobanana-pro', label: 'NanoBanana Pro' },
];
