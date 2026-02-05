/**
 * AI 汇总服务 - 使用 Gemini 自动生成问题汇总
 */
import { GoogleGenAI } from "@google/genai";
import { ImageReview, ImageGroup, FeedbackItem, SEVERITY_CONFIG } from '../types';

const getAiInstance = () => {
    const storedKey = typeof window !== 'undefined' ? localStorage.getItem('user_api_key') : null;
    const keyToUse = storedKey || import.meta.env.VITE_GOOGLE_API_KEY;
    if (!keyToUse) {
        throw new Error('API key is not set. 请先在顶部的 API Key 按钮中配置可用的 Google AI Key。');
    }
    return new GoogleGenAI({ apiKey: keyToUse });
};

/**
 * 收集所有反馈信息
 */
const collectAllFeedback = (images: ImageReview[], groups: ImageGroup[]): string => {
    const feedbackLines: string[] = [];

    // 收集分组反馈
    groups.forEach(group => {
        const groupImages = images.filter(img => img.groupId === group.id);
        if (groupImages.length > 0 && group.groupFeedbackCn) {
            feedbackLines.push(`【组 "${group.name}" (${groupImages.length}张)】`);
            feedbackLines.push(group.groupFeedbackCn);
            feedbackLines.push('');
        }
    });

    // 收集单张图片反馈
    images.forEach((img, idx) => {
        if (img.feedbackItems.length > 0) {
            feedbackLines.push(`【图片 #${idx + 1}】状态: ${img.status}`);
            img.feedbackItems.forEach((item: FeedbackItem) => {
                const severityLabel = SEVERITY_CONFIG[item.severity]?.label || item.severity;
                if (item.problemCn) {
                    feedbackLines.push(`- [${severityLabel}] 问题: ${item.problemCn}`);
                }
                if (item.suggestionCn) {
                    feedbackLines.push(`  建议: ${item.suggestionCn}`);
                }
            });
            feedbackLines.push('');
        }
    });

    return feedbackLines.join('\n');
};

/**
 * 生成统计信息
 */
const generateStats = (images: ImageReview[]): string => {
    const stats = {
        total: images.length,
        approved: images.filter(i => i.status === 'approved').length,
        revision: images.filter(i => i.status === 'revision').length,
        rejected: images.filter(i => i.status === 'rejected').length,
        pending: images.filter(i => i.status === 'pending').length,
    };

    return `共 ${stats.total} 张图片：合格 ${stats.approved} 张，有建议 ${stats.revision} 张，不合格 ${stats.rejected} 张，待审 ${stats.pending} 张`;
};

/**
 * 使用 AI 生成整批问题汇总
 */
export const generateOverallSummary = async (
    images: ImageReview[],
    groups: ImageGroup[]
): Promise<string> => {
    const ai = getAiInstance();

    const allFeedback = collectAllFeedback(images, groups);
    const stats = generateStats(images);

    if (!allFeedback.trim()) {
        return '暂无具体反馈内容可供汇总。\nNo specific feedback to summarize.';
    }

    const prompt = `你是一位专业的图片审核专家。请根据以下图片审核反馈信息，生成一份简洁、专业的整批问题汇总报告。

【审核统计】
${stats}

【详细反馈】
${allFeedback}

【输出要求】
1. 先输出中文汇总，再输出英文汇总
2. 中英文之间用 "---" 分隔
3. 归纳提炼出这一批图片的共性问题
4. 按问题严重程度排序列出主要问题
5. 给出针对性的改进建议
6. 格式清晰，使用数字编号
7. 中英文各控制在 150-250 字/词以内

【输出格式示例】
**问题汇总 / Summary**

1. [严重程度] 问题描述
   建议: xxx
2. ...

---

**Summary (English)**

1. [Severity] Problem description
   Suggestion: xxx
2. ...

请直接输出汇总内容，只输出中文：`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });

        return response.text?.trim() || '生成汇总失败，请重试。';
    } catch (error) {
        console.error('[aiSummaryService] Error generating summary:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('生成汇总时发生错误，请检查 API Key 是否有效。');
    }
};

import { ToneLevel } from './translationService';

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
 * 汇总翻译结果类型
 */
export interface SummaryTranslationResult {
    english: string;
    backTranslation: string;
    isAccurate: boolean;
}

/**
 * 将中文汇总翻译成英文（支持语气配置 + 回译验证）
 */
export const translateSummaryToEnglish = async (
    chineseSummary: string,
    tone: ToneLevel = 'suggestive'
): Promise<SummaryTranslationResult> => {
    if (!chineseSummary.trim()) {
        return { english: '', backTranslation: '', isAccurate: false };
    }

    const ai = getAiInstance();
    const toneInstruction = getToneInstruction(tone);

    // 第一步：中文翻译为英文
    const translatePrompt = `You are a professional translator specializing in creative team communication. Translate the following Chinese image review summary into clear, natural English.

${toneInstruction}

Important guidelines:
- This feedback is from a Chinese reviewer to an international production team
- Avoid harsh or commanding language
- Be constructive and encouraging
- Maintain the core meaning while softening the delivery
- Keep the same structure and formatting (numbered lists, etc.)

Chinese Summary:
${chineseSummary}

Respond with ONLY the English translation, nothing else.`;

    try {
        const translateResponse = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: translatePrompt,
        });
        const englishTranslation = translateResponse.text?.trim() || '';

        // 第二步：英文回译为中文
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

Original: ${chineseSummary}
Back-translated: ${backTranslation}

The tone may differ (the back-translation might be softer), but the main points should be preserved.

Respond with ONLY "true" if the core meaning is preserved, or "false" if the meaning is significantly different.`;

        const accuracyResponse = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: accuracyPrompt,
        });
        const isAccurate = accuracyResponse.text?.trim().toLowerCase() === 'true';

        return {
            english: englishTranslation,
            backTranslation,
            isAccurate,
        };
    } catch (error) {
        console.error('[aiSummaryService] Error translating summary:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('翻译汇总时发生错误，请检查 API Key 是否有效。');
    }
};

export const aiSummaryService = {
    generateOverallSummary,
    translateSummaryToEnglish,
    collectAllFeedback,
};
