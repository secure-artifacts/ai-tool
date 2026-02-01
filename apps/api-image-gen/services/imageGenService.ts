// API 生图 - Gemini 服务

import { GoogleGenAI, Modality } from "@google/genai";
import { ImageGenModel, ImageSize, GeneratedPrompt } from '../types';

// 获取 AI 实例
const getAiInstance = (): GoogleGenAI => {
    // 尝试从多个位置获取API key，按优先级
    // 1. 检查是否有API池实例（全局共享）
    const apiPool = (window as any).__apiPool;
    const usePool = (window as any).__usePool;

    let apiKey = '';

    if (usePool && apiPool?.hasKeys?.()) {
        try {
            apiKey = apiPool.getCurrentKey();
        } catch (error) {
            console.error('[ImageGenService] 从API池获取密钥失败:', error);
        }
    }

    // 2. 如果API池没有key，尝试从localStorage获取手动设置的key
    if (!apiKey) {
        apiKey = typeof window !== 'undefined' ? (localStorage.getItem('user_api_key') || '') : '';
    }

    // 3. 最后尝试环境变量
    if (!apiKey) {
        apiKey = process.env.API_KEY || '';
    }

    if (!apiKey) {
        throw new Error('API key is not set. 请先在顶部的 API Key 按钮中配置可用的 Google AI Key。');
    }
    return new GoogleGenAI({ apiKey });
};

// 文件转 base64
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // 移除 data:xxx;base64, 前缀
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// 尺寸解析
const parseSize = (size: ImageSize): { width: number; height: number } => {
    const [w, h] = size.split('x').map(Number);
    return { width: w, height: h };
};

/**
 * 生成描述词 - 使用 AI 根据图片和/或文字生成多个 prompts
 * 参考: api生图-(api-image-studio) (6)/services/geminiService.ts
 */
export const generatePrompts = async (
    inputImages: File[],
    inputText: string,
    instruction: string,
    model = 'gemini-3-pro-preview', // Gemini 3 Pro 文本模型
    count = 4
): Promise<GeneratedPrompt[]> => {
    const ai = getAiInstance();

    // 准备内容 parts
    const parts: any[] = [];

    // 添加图片
    for (const file of inputImages) {
        const base64 = await fileToBase64(file);
        parts.push({
            inlineData: {
                mimeType: file.type,
                data: base64
            }
        });
    }

    // 系统指令 - 如果没有自定义指令，使用默认指令
    const systemPrompt = instruction || `
    You are an expert AI Art Director. 
    Analyze the provided image (if any) and the user's request.
    Generate ${count} distinct, highly detailed, and creative image generation prompts based on the input.
    
    If an image is provided, describe it in detail but add creative twists for the ${count} variations.
    If only text is provided, expand it into ${count} different artistic interpretations.

    Return ONLY a raw JSON array of objects. Do not use Markdown code blocks.
    Each object must have:
    - "en": The detailed prompt in English (optimized for high fidelity generation).
    - "zh": A concise description of the concept in Chinese (for the user to understand).
    `;

    parts.push({ text: systemPrompt });

    // 添加用户输入
    if (inputText.trim()) {
        parts.push({ text: `User Request: ${inputText}` });
    }

    try {
        // 调用 API - 使用与参考文件一致的格式
        const response = await ai.models.generateContent({
            model,
            contents: { parts },
            config: {
                responseMimeType: "application/json"
            }
        });

        const text = response.text || '';
        if (!text) throw new Error("No response from AI");

        // 清理 markdown 格式（如果有）
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            const parsed = JSON.parse(cleanText);

            if (Array.isArray(parsed)) {
                return parsed.map((p, index) => ({
                    id: `prompt-${Date.now()}-${index}`,
                    textEn: p.en || p.prompt || JSON.stringify(p),
                    textZh: p.zh || "无中文描述",
                    selected: true
                })).slice(0, count);
            }
        } catch (parseError) {
            console.warn('[generatePrompts] JSON解析失败，尝试文本解析:', parseError);
        }

        // 回退：尝试解析 PROMPT1_EN/ZH 格式
        const prompts: GeneratedPrompt[] = [];
        const promptNumbers = new Set<number>();
        const regexNumbers = /PROMPT(\d+)_(?:EN|ZH)/g;
        let numMatch;
        while ((numMatch = regexNumbers.exec(text)) !== null) {
            promptNumbers.add(parseInt(numMatch[1]));
        }

        Array.from(promptNumbers).sort((a, b) => a - b).forEach((num, index) => {
            const enRegex = new RegExp(`PROMPT${num}_EN:\\s*(.+?)(?=PROMPT\\d+_|$)`, 's');
            const zhRegex = new RegExp(`PROMPT${num}_ZH:\\s*(.+?)(?=PROMPT\\d+_|$)`, 's');

            const enMatch = text.match(enRegex);
            const zhMatch = text.match(zhRegex);

            if (enMatch || zhMatch) {
                prompts.push({
                    id: `prompt-${Date.now()}-${index}`,
                    textEn: (enMatch?.[1] || '').trim().replace(/\n+/g, ' '),
                    textZh: (zhMatch?.[1] || '').trim().replace(/\n+/g, ' '),
                    selected: true
                });
            }
        });

        if (prompts.length > 0) return prompts;

        // 最后回退：返回原始输入
        return [{
            id: `prompt-${Date.now()}-0`,
            textEn: inputText || text.slice(0, 200),
            textZh: "生成失败，使用原始输入",
            selected: true
        }];

    } catch (error) {
        console.error('[generatePrompts] 生成失败:', error);
        return [{
            id: `prompt-${Date.now()}-0`,
            textEn: inputText,
            textZh: "生成失败，使用原始输入",
            selected: true
        }];
    }
};

/**
 * 生成图片 - 使用 Gemini 生图
 */
export const generateImage = async (
    prompt: string,
    referenceImages: File[] | null,
    model: ImageGenModel,
    size: ImageSize,
    onProgress?: (progress: number) => void
): Promise<string> => {
    const ai = getAiInstance();
    const { width, height } = parseSize(size);

    // 所有模型都使用 Gemini 生图
    return generateWithGemini(ai, prompt, referenceImages, model, width, height, onProgress);
};

/**
 * Gemini 生图
 */
const generateWithGemini = async (
    ai: GoogleGenAI,
    prompt: string,
    referenceImages: File[] | null,
    model: ImageGenModel,
    width: number,
    height: number,
    onProgress?: (progress: number) => void
): Promise<string> => {
    onProgress?.(10);

    const contents: any[] = [];

    // 如果有参考图片（垫图模式）
    if (referenceImages && referenceImages.length > 0) {
        for (const file of referenceImages) {
            const base64 = await fileToBase64(file);
            contents.push({
                inlineData: {
                    mimeType: file.type,
                    data: base64
                }
            });
        }
        contents.push({ text: `Based on the reference image(s), generate a new image: ${prompt}` });
    } else {
        contents.push({ text: prompt });
    }

    onProgress?.(30);

    // 使用选择的模型直接调用
    // gemini-2.5-flash-image 和 gemini-3-pro-image-preview 都是有效的模型名称
    const apiModel = model;

    // 调用 Gemini 生图 API - 使用与AI图片编辑器一致的格式
    const response = await ai.models.generateContent({
        model: apiModel,
        contents: {
            parts: contents,
        },
        config: {
            responseModalities: [Modality.IMAGE],
        } as any
    });

    onProgress?.(80);

    // 提取生成的图片
    if (response?.candidates?.length > 0 && response.candidates[0].content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const mimeType: string = part.inlineData.mimeType;
                onProgress?.(100);
                return `data:${mimeType};base64,${base64ImageBytes}`;
            }
        }
    }

    // 错误处理
    let errorMessage = '未能生成图片';
    if (response?.promptFeedback?.blockReason) {
        errorMessage = `请求因安全策略被拒绝 (${response.promptFeedback.blockReason}).`;
    } else if (!response?.candidates || response.candidates.length === 0) {
        errorMessage = '请求成功，但模型未返回任何内容。这可能是由于内容安全策略。';
    }
    throw new Error(errorMessage);
};

/**
 * NanoBanana 生图 (待实现)
 */
const generateWithNanoBanana = async (
    prompt: string,
    referenceImages: File[] | null,
    width: number,
    height: number,
    onProgress?: (progress: number) => void
): Promise<string> => {
    // TODO: 实现 NanoBanana API 调用
    // 这里需要用户提供 NanoBanana 的 API 接口信息
    throw new Error('NanoBanana Pro 接口尚未配置，请联系管理员');
};

/**
 * 下载图片
 */
export const downloadImage = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * 批量下载所有图片
 */
export const downloadAllImages = async (
    images: { url: string; name: string }[],
    folderName: string
) => {
    for (let i = 0; i < images.length; i++) {
        const { url, name } = images[i];
        downloadImage(url, `${folderName}_${name}`);
        // 添加延迟避免浏览器阻止
        await new Promise(resolve => setTimeout(resolve, 500));
    }
};
