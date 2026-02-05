/**
 * 翻译服务 - 中英文翻译与回译验证
 * 支持语气级别选择（温和、协作式的表达）
 */

import { GoogleGenAI } from "@google/genai";
import { TranslationResult } from '../types';

// 语气级别类型
export type ToneLevel = 'neutral' | 'suggestive' | 'collaborative';

// 语气级别配置
export const TONE_CONFIG: Record<ToneLevel, { label: string; labelEn: string; description: string }> = {
    neutral: {
        label: '中性',
        labelEn: 'Neutral',
        description: '客观陈述问题，不带情感色彩'
    },
    suggestive: {
        label: '建议式',
        labelEn: 'Suggestive',
        description: '以建议的方式表达，温和友好'
    },
    collaborative: {
        label: '协作式',
        labelEn: 'Collaborative',
        description: '强调合作，共同解决问题'
    },
};

// 获取 API Key（使用整个软件统一的 user_api_key）
const getApiKey = (): string => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('user_api_key') || '';
    }
    return '';
};

// 根据语气级别生成翻译提示词
const getToneInstruction = (tone: ToneLevel): string => {
    switch (tone) {
        case 'neutral':
            return 'Keep the translation professional and objective, stating facts without emotional language.';
        case 'suggestive':
            return `Use a gentle, suggestive tone. Instead of commands like "Fix this" or "Change that", use phrases like:
- "It might be helpful to..."
- "Consider adjusting..."
- "Perhaps we could..."
- "This could benefit from..."
- "You might want to look at..."
The goal is to provide feedback in a friendly, non-confrontational way.`;
        case 'collaborative':
            return `Use a collaborative, team-oriented tone. Frame feedback as shared goals. Use phrases like:
- "Let's work on..."
- "We could improve this by..."
- "Together, we might consider..."
- "How about we try..."
- "It would be great if we could..."
The goal is to make the recipient feel like a valued team member, not someone being criticized.`;
        default:
            return '';
    }
};

/**
 * 翻译中文反馈为英文，并进行回译验证
 * @param chineseFeedback 中文反馈内容
 * @param apiKey 可选的 API Key
 * @param tone 语气级别
 */
export const translateFeedback = async (
    chineseFeedback: string,
    apiKey?: string,
    tone: ToneLevel = 'suggestive'
): Promise<TranslationResult> => {
    const key = apiKey || getApiKey();
    if (!key) {
        throw new Error('请先配置 API Key');
    }

    const ai = new GoogleGenAI({ apiKey: key });
    const toneInstruction = getToneInstruction(tone);

    // 第一步：中文翻译为英文（带语气调整）
    const translatePrompt = `You are a professional translator specializing in creative team communication. Translate the following Chinese feedback about AI-generated images into clear, natural English.

${toneInstruction}

Important guidelines:
- This feedback is from a Chinese reviewer to an international production team
- Avoid harsh or commanding language
- Be constructive and encouraging
- Maintain the core meaning while softening the delivery

Chinese feedback:
${chineseFeedback}

Respond with ONLY the English translation, nothing else.`;

    const translateResponse = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: translatePrompt,
    });

    const englishTranslation = translateResponse.text?.trim() || '';

    // 第二步：英文回译为中文（验证）
    const backTranslatePrompt = `You are a professional translator. Translate the following English text back into Chinese. This is for verification purposes.

English:
${englishTranslation}

Respond with ONLY the Chinese translation, nothing else.`;

    const backTranslateResponse = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: backTranslatePrompt,
    });

    const backTranslation = backTranslateResponse.text?.trim() || '';

    // 第三步：判断翻译是否准确
    const accuracyPrompt = `Compare these two Chinese texts and determine if they convey the same CORE meaning (not necessarily word-for-word):

Original: ${chineseFeedback}
Back-translated: ${backTranslation}

The tone may differ (the back-translation might be softer), but the main point should be preserved.

Respond with ONLY "true" if the core meaning is preserved, or "false" if the meaning is significantly different.`;

    const accuracyResponse = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: accuracyPrompt,
    });

    const isAccurate = accuracyResponse.text?.trim().toLowerCase() === 'true';

    return {
        original: chineseFeedback,
        english: englishTranslation,
        backTranslation,
        isAccurate,
        timestamp: Date.now(),
    };
};

/**
 * 批量翻译多个反馈
 */
export const translateFeedbackBatch = async (
    feedbacks: string[],
    apiKey?: string,
    onProgress?: (completed: number, total: number) => void,
    tone: ToneLevel = 'suggestive'
): Promise<TranslationResult[]> => {
    const results: TranslationResult[] = [];

    for (let i = 0; i < feedbacks.length; i++) {
        const feedback = feedbacks[i];
        if (feedback.trim()) {
            try {
                const result = await translateFeedback(feedback, apiKey, tone);
                results.push(result);
            } catch (error) {
                // 失败时返回空结果
                results.push({
                    original: feedback,
                    english: '',
                    backTranslation: '',
                    isAccurate: false,
                    timestamp: Date.now(),
                });
            }
        }
        onProgress?.(i + 1, feedbacks.length);
    }

    return results;
};

/**
 * 格式化翻译结果为可复制的文本
 */
export const formatTranslationForCopy = (
    result: TranslationResult,
    format: 'english-only' | 'with-back' | 'full'
): string => {
    switch (format) {
        case 'english-only':
            return result.english;
        case 'with-back':
            return `${result.english}\n(${result.backTranslation})`;
        case 'full':
            return `📝 原始反馈:\n${result.original}\n\n🔤 英文翻译:\n${result.english}\n\n🔙 回译确认:\n${result.backTranslation} ${result.isAccurate ? '✅' : '⚠️'}`;
        default:
            return result.english;
    }
};
