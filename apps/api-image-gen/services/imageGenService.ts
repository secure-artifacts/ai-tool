// API 生图 - Gemini 服务

import { GoogleGenAI, Modality } from "@google/genai";
import { ImageGenModel, ImageSize, GeneratedPrompt } from '../types';

// 获取 AI 实例
const getAiInstance = (): GoogleGenAI => {
    const apiKey = (window as any).__geminiApiKey || localStorage.getItem('gemini_api_key') || '';
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
 */
export const generatePrompts = async (
    inputImages: File[],
    inputText: string,
    instruction: string,
    model = 'gemini-2.0-flash'
): Promise<GeneratedPrompt[]> => {
    const ai = getAiInstance();

    // 准备内容
    const contents: any[] = [];

    // 添加图片
    for (const file of inputImages) {
        const base64 = await fileToBase64(file);
        contents.push({
            inlineData: {
                mimeType: file.type,
                data: base64
            }
        });
    }

    // 添加文字描述
    if (inputText.trim()) {
        contents.push({ text: `用户输入的描述: ${inputText}` });
    }

    // 添加指令
    contents.push({ text: instruction });

    // 调用 API
    const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: contents }]
    });

    const text = response.text || '';

    // 解析结果 - 提取 PROMPT1_EN, PROMPT1_ZH 等双语格式
    const prompts: GeneratedPrompt[] = [];

    // 匹配所有 PROMPT{N}_EN 和 PROMPT{N}_ZH
    const promptNumbers = new Set<number>();
    const regexNumbers = /PROMPT(\d+)_(?:EN|ZH)/g;
    let numMatch;
    while ((numMatch = regexNumbers.exec(text)) !== null) {
        promptNumbers.add(parseInt(numMatch[1]));
    }

    // 对于每个提取到的编号，获取 EN 和 ZH 版本
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

    // 如果没有匹配到双语格式，尝试单语格式 (PROMPT1:)
    if (prompts.length === 0) {
        const regex = /PROMPT\d+:\s*(.+?)(?=PROMPT\d+:|$)/gs;
        let match;
        let index = 0;
        while ((match = regex.exec(text)) !== null) {
            const promptText = match[1].trim();
            prompts.push({
                id: `prompt-${Date.now()}-${index}`,
                textEn: promptText,
                textZh: promptText, // 单语时 EN/ZH 相同
                selected: true
            });
            index++;
        }
    }

    // 最后尝试按行分割
    if (prompts.length === 0) {
        const lines = text.split('\n').filter(line => line.trim().length > 20);
        lines.slice(0, 4).forEach((line, i) => {
            const cleanedLine = line.replace(/^\d+[\.\)]\s*/, '').trim();
            prompts.push({
                id: `prompt-${Date.now()}-${i}`,
                textEn: cleanedLine,
                textZh: cleanedLine,
                selected: true
            });
        });
    }

    return prompts;
};

/**
 * 生成图片 - 使用 Gemini 或 NanoBanana 生图
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

    // 根据模型选择不同的 API
    if (model === 'gemini-3-pro') {
        return generateWithGemini(ai, prompt, referenceImages, width, height, onProgress);
    } else {
        return generateWithNanoBanana(prompt, referenceImages, width, height, onProgress);
    }
};

/**
 * Gemini 生图
 */
const generateWithGemini = async (
    ai: GoogleGenAI,
    prompt: string,
    referenceImages: File[] | null,
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

    // 调用 Gemini 生图 API
    const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp-image-generation',
        contents: [{ role: 'user', parts: contents }],
        config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
        }
    });

    onProgress?.(80);

    // 提取生成的图片
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
            onProgress?.(100);
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }

    throw new Error('未能生成图片');
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
