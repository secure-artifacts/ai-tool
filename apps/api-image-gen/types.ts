// API 生图 - 类型定义

export type ImageGenModel = 'gemini-3-pro' | 'nanobanana-pro';

export type ImageSize = '512x512' | '768x768' | '1024x1024' | '1024x1536' | '1536x1024' | '1792x1024' | '1024x1792';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GeneratedPrompt {
    id: string;
    text: string;
    selected: boolean;
}

export interface ImageGenTask {
    id: string;
    promptId: string;
    promptText: string;
    model: ImageGenModel;
    size: ImageSize;
    useReferenceImage: boolean; // 是否垫图
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

export const DEFAULT_PROMPT_INSTRUCTION = `请根据输入的图片和/或文字描述，生成4个不同风格的详细图像描述词(prompt)。

要求：
1. 每个描述词应该详细、具体，适合 AI 图像生成
2. 描述词应该包含：主体、场景、风格、光线、色调等元素
3. 使用英文输出每个描述词
4. 4个描述词应该有明显的差异，例如不同风格、角度或氛围

请用以下格式输出：
PROMPT1: [描述词1]
PROMPT2: [描述词2]
PROMPT3: [描述词3]
PROMPT4: [描述词4]`;

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
