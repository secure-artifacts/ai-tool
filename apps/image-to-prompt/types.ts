/**
 * Image to Prompt Tool - Type Definitions
 * 反推提示词工具 - 类型定义
 * 
 * 合并自正式版 index.tsx 和创艺魔盒 2 的功能
 */

// AI 绘画专家类型
export type ExpertKey = 'general' | 'midjourney' | 'dalle3' | 'sd' | 'flux' | 'bing' | 'whisk' | 'dreamina';

// 专家描述
export const expertDescriptions: Record<ExpertKey, string> = {
    general: 'A versatile expert for general-purpose prompts.',
    midjourney: 'Specializes in Midjourney-style prompts with artistic flair.',
    dalle3: 'Tailored for DALL-E 3, focusing on detailed and realistic descriptions.',
    sd: 'Optimized for Stable Diffusion, including keywords and negative prompts.',
    flux: 'Designed for Flux models with a focus on photorealism.',
    bing: 'Crafted for Bing Image Creator (DALL-E based).',
    whisk: 'Optimized for Google Whisk experimental tool.',
    dreamina: 'Tailored for Dreamina (Doubao) image generation.',
};

// 图片状态
export type ImageStatus = 'pending' | 'staging' | 'processing' | 'success' | 'error';

// 会话状态
export type SessionStatus = 'staging' | 'processing' | 'complete';

// 批量处理模式
export type BatchMode = 'accurate' | 'fast';

// 融合模式
export type FusionMode = 'batch' | 'fusion';

// 融合角色
export type FusionRole = 'style' | 'composition' | 'scene' | 'character' | 'inspiration';

// 消息类型
export interface Message {
    sender: 'user' | 'model';
    text: string;
}

// 图片数据
export interface ImageData {
    file: File | null;
    url: string;
    base64: string;
    type: string;
    name: string;
    sourceUrl?: string;
}

// 单张图片状态
export interface ImageEntry {
    id: string;
    imageData: ImageData;
    chatHistory: Message[];
    status: ImageStatus;
    error: string | null;
    preModificationPrompt?: string; // 预处理修改指令（来自创艺魔盒 2）
}

// 会话
export interface Session {
    id: string;
    images: ImageEntry[];
    experts: ExpertKey[];
    status: SessionStatus;
}

// 融合项目
export interface FusionItem {
    id: string;
    imageData: ImageData;
    role: FusionRole;
}

// 融合结果
export interface FusionResult {
    englishPrompt: string;
    chinesePrompt: string;
}

// 融合对话消息
export interface FusionChatMessage {
    sender: 'user' | 'model';
    text: string;
}

// 预设类型
export interface Preset {
    id: string;
    label: string;
    prompt: string;
    isCustom?: boolean;
}

// 主状态
export interface ImageToPromptState {
    // 会话管理
    sessions: Session[];
    activeSessionId: string | null;
    activeImageId: string | null;

    // 用户输入
    userInput: Record<string, string>;

    // 错误信息
    error: string | null;

    // 修饰符预设
    modifiers: Preset[];

    // 融合模式相关（来自创艺魔盒 2）
    fusionMode: FusionMode;
    fusionItems: FusionItem[];
    fusionResult: FusionResult | null;
    fusionChatHistory: FusionChatMessage[];
    fusionChatInput: string;
    extraInstruction: string;

    // 批量处理模式（来自正式版）
    batchMode: BatchMode;

    // 手动指令
    manualInstruction: string;

    // 选中的模板版本
    selectedTemplateVersionId: string;
}

// 组件 Props
export interface ImageToPromptToolProps {
    // 从正式版传入的依赖
    templateBuilderState?: any;
    setTemplateBuilderState?: React.Dispatch<React.SetStateAction<any>>;
    descState?: any;
    setDescState?: React.Dispatch<React.SetStateAction<any>>;
    onNavigateToDesc?: () => void;
    onNavigateToTemplate?: () => void;
    descControlRef?: React.MutableRefObject<any>;
    textModel?: string;
}

// 专家提示词结果
export interface ExpertPrompt {
    expert: string;
    englishPrompt: string;
    chinesePrompt: string;
}

// API 响应 Schema
export const singleImageResponseSchema = {
    type: "array",
    items: {
        type: "object",
        properties: {
            expert: { type: "string" },
            englishPrompt: { type: "string" },
            chinesePrompt: { type: "string" }
        },
        required: ["expert", "englishPrompt", "chinesePrompt"]
    }
};

export const batchImageResponseSchema = {
    type: "object",
    properties: {
        results: {
            type: "array",
            items: singleImageResponseSchema
        }
    },
    required: ["results"]
};

// 默认修饰符预设
export const defaultModifiers: Preset[] = [
    { id: 'mod-detailed', label: '更详细', prompt: ', add more intricate details' },
    { id: 'mod-artistic', label: '艺术感', prompt: ', in an artistic style' },
    { id: 'mod-realistic', label: '写实', prompt: ', photorealistic, high detail' },
    { id: 'mod-cinematic', label: '电影感', prompt: ', cinematic lighting, dramatic' },
    { id: 'mod-anime', label: '动漫风', prompt: ', anime style illustration' },
];

// 本地存储 Keys
export const STORAGE_KEYS = {
    SESSIONS: 'aetherius-prompt-tool-sessions',
    MODIFIERS: 'aetherius-prompt-tool-modifiers',
    BATCH_MODE: 'imageToPrompt_batchMode',
    MANUAL_INSTRUCTION: 'imageToPrompt_manualInstruction',
    HIDE_DEPRECATION_WARNING: 'imageToPrompt_hideDeprecationWarning',
};
